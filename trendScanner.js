const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");
const { analyzeWithClaude } = require("./aiAnalyzer");
const { addTradeHistory } = require("./api");

const WATCH_TOKENS = [
  { symbol: "JUP",   address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY",   address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "BONK",  address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF",   address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "MEW",   address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "PYTH",  address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "ORCA",  address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "AI16Z", address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
];

const CONFIG = {
  MIN_PRICE_CHANGE_5M: 1,
  MIN_SCORE: 40,
  REQUEST_INTERVAL_MS: 600,
  RATE_LIMIT_WAIT_MS: 60000,
};

let lastRateLimitTime = 0;

function hasPosition(tokenAddress) {
  return positions.some(function(p) { return p.tokenMint === tokenAddress; });
}

function analyzeToken(pair) {
  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);
  const priceChange24h = parseFloat(pair.priceChange?.h24 || 0);
  const volume24h = parseFloat(pair.volume?.h24 || 0);
  const volume6h = parseFloat(pair.volume?.h6 || 0);
  const txns5m = (pair.txns?.m5?.buys || 0) + (pair.txns?.m5?.sells || 0);
  const txns1h = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
  const liquidity = parseFloat(pair.liquidity?.usd || 0);

  let score = 0;
  let reasons = [];

  if (priceChange5m >= 1) { score += 30; reasons.push("5m+" + priceChange5m.toFixed(1) + "%"); }
  if (priceChange1h > 0) { score += 20; reasons.push("1時間プラス"); }
  if (priceChange24h > 0) { score += 10; reasons.push("24時間上昇"); }

  const volumeRatio = volume6h > 0 ? (volume24h / 4) / volume6h : 1;
  if (volumeRatio > 1.2) { score += 20; reasons.push("出来高" + volumeRatio.toFixed(1) + "倍増"); }

  const txRatio = txns1h > 0 ? (txns5m * 12) / txns1h : 1;
  if (txRatio > 1.5) { score += 15; reasons.push("取引" + txRatio.toFixed(1) + "倍増"); }

  if (liquidity < 100000) { score -= 30; reasons.push("流動性低"); }

  return { score: score, reasons: reasons, priceChange5m: priceChange5m, priceChange1h: priceChange1h, priceChange24h: priceChange24h };
}

async function getTokenPrice(tokenAddress) {
  try {
    if (Date.now() - lastRateLimitTime < CONFIG.RATE_LIMIT_WAIT_MS) {
      return null;
    }
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/tokens/" + tokenAddress,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;
    const solanaPairs = data.pairs.filter(function(p) { return p.chainId === "solana"; });
    if (solanaPairs.length === 0) return null;
    return solanaPairs.reduce(function(best, current) {
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.log("DexScreenerレート制限 → 1分待機");
      lastRateLimitTime = Date.now();
    }
    return null;
  }
}

async function sendBuyNotification(symbol, analysis, aiResult, txid, dexLink) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  const jstTime = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" });
  try {
    await axios.post(webhookUrl, {
      content: "🤖 **自動購入！**",
      embeds: [{
        title: symbol + " 購入 (スコア: " + analysis.score + ")",
        color: 0x00ff00,
        fields: [
          { name: "📈 5分変化", value: "+" + analysis.priceChange5m.toFixed(2) + "%", inline: true },
          { name: "📊 1時間変化", value: analysis.priceChange1h.toFixed(2) + "%", inline: true },
          { name: "💵 金額", value: "$" + analysis.buyAmountUsd || "$10", inline: true },
          { name: "🎯 利確/損切り", value: "+8% / -4%", inline: true },
          { name: "🤖 AI", value: (aiResult && aiResult.reason) ? aiResult.reason : "分析完了", inline: true },
          { name: "📊 理由", value: analysis.reasons.join(" / ") || "なし", inline: false },
          { name: "🔗 TX", value: "[確認](https://solscan.io/tx/" + txid + ")", inline: false },
          { name: "🔗 Chart", value: "[DexScreener](" + dexLink + ")", inline: false },
        ],
        footer: { text: jstTime },
      }],
    }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
  } catch (error) {
    console.error("購入通知エラー:", error.message);
  }
}

async function checkTrends(solPriceUsd) {
  console.log("コイン監視中...");

  const results = [];

  for (let i = 0; i < WATCH_TOKENS.length; i++) {
    const token = WATCH_TOKENS[i];

    // すでにそのコインのポジションがあればスキップ
    if (hasPosition(token.address)) {
      console.log(token.symbol + ": 保有中のためスキップ");
      continue;
    }

    const pair = await getTokenPrice(token.address);
    if (!pair) {
      await new Promise(function(r) { setTimeout(r, CONFIG.REQUEST_INTERVAL_MS); });
      continue;
    }

    const analysis = analyzeToken(pair);
    console.log(token.symbol + ": " + analysis.priceChange5m.toFixed(2) + "% | " + analysis.score + "点");

    if (analysis.score >= CONFIG.MIN_SCORE && analysis.priceChange5m >= CONFIG.MIN_PRICE_CHANGE_5M) {
      results.push({ token: token, pair: pair, analysis: analysis });
    }

    await new Promise(function(r) { setTimeout(r, CONFIG.REQUEST_INTERVAL_MS); });
  }

  if (results.length === 0) {
    console.log("購入条件なし");
    return;
  }

  results.sort(function(a, b) { return b.analysis.score - a.analysis.score; });
  console.log("購入候補: " + results.length + "件");

  for (let j = 0; j < results.length; j++) {
    const result = results[j];

    // 購入直前にもう一度チェック
    if (hasPosition(result.token.address)) {
      console.log(result.token.symbol + ": 既に保有中");
      continue;
    }

    const tradeResult = await buyToken(result.token.address, solPriceUsd, false);
    if (tradeResult) {
      tradeResult.symbol = result.token.symbol;
      addPosition(tradeResult);
      console.log("購入成功: " + result.token.symbol);

      addTradeHistory({
        symbol: result.token.symbol,
        type: "buy",
        amount: tradeResult.buyAmountUsd,
        profit: null,
        reason: result.analysis.reasons.join(" / "),
        txid: tradeResult.txid,
      });

      const aiResult = await analyzeWithClaude(result.token.symbol, {
        priceChange5m: result.analysis.priceChange5m,
        priceChange1h: result.analysis.priceChange1h,
        priceChange24h: result.analysis.priceChange24h,
        score: result.analysis.score,
        reasons: result.analysis.reasons,
      });

      const dexLink = "https://dexscreener.com/" + result.pair.chainId + "/" + result.pair.pairAddress;
      await sendBuyNotification(result.token.symbol, result.analysis, aiResult, tradeResult.txid, dexLink);
    } else {
      console.log(result.token.symbol + ": 購入失敗 → 次の候補へ");
    }

    await new Promise(function(r) { setTimeout(r, 500); });
  }
}

module.exports = { checkTrends: checkTrends };
