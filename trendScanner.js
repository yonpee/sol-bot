const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const WATCH_TOKENS = [
  { symbol: "JUP",     address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY",     address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "PYTH",    address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "ORCA",    address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "DRIFT",   address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7" },
  { symbol: "RENDER",  address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  { symbol: "HNT",     address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux" },
  { symbol: "BONK",    address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF",     address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT",  address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "MEW",     address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "BOME",    address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "GOAT",    address: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump" },
  { symbol: "AI16Z",   address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
  { symbol: "ZEREBRO", address: "8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn" },
  { symbol: "SLERF",   address: "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3" },
];

const CONFIG = {
  MIN_PRICE_CHANGE_5M: 1,
  MIN_PRICE_CHANGE_1H: 0,
  MIN_VOLUME_CHANGE: 20,
  MAX_POSITIONS: 1,
  REQUEST_INTERVAL_MS: 500,
  RATE_LIMIT_WAIT_MS: 60000,
};

const purchasedTokens = new Set();
let lastRateLimitTime = 0;
let solTrend = 0;

async function getSolTrend() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
      { timeout: 10000 }
    );
    const pairs = response.data?.pairs?.filter(p => p.chainId === "solana") || [];
    if (pairs.length === 0) return 0;
    const best = pairs.reduce((a, b) =>
      parseFloat(b.liquidity?.usd || 0) > parseFloat(a.liquidity?.usd || 0) ? b : a
    );
    solTrend = parseFloat(best.priceChange?.h1 || 0);
    console.log(`SOLトレンド(1h): ${solTrend.toFixed(2)}%`);
    return solTrend;
  } catch (error) {
    return 0;
  }
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

  // スコア計算（高いほど良い）
  let score = 0;
  let reasons = [];

  // 5分上昇（最重要）
  if (priceChange5m >= 1) {
    score += 30;
    reasons.push(`5分+${priceChange5m.toFixed(1)}%上昇`);
  }

  // 1時間トレンド
  if (priceChange1h > 0) {
    score += 20;
    reasons.push(`1時間もプラス(${priceChange1h.toFixed(1)}%)`);
  } else {
    score -= 10;
    reasons.push(`1時間マイナス(${priceChange1h.toFixed(1)}%)`);
  }

  // 24時間トレンド
  if (priceChange24h > 0) {
    score += 10;
    reasons.push(`24時間上昇トレンド`);
  }

  // 出来高増加チェック
  const volumeRatio = volume6h > 0 ? (volume24h / 4) / volume6h : 1;
  if (volumeRatio > 1.2) {
    score += 20;
    reasons.push(`出来高急増(${volumeRatio.toFixed(1)}倍)`);
  }

  // 取引回数増加チェック
  const txRatio = txns1h > 0 ? (txns5m * 12) / txns1h : 1;
  if (txRatio > 1.5) {
    score += 15;
    reasons.push(`取引急増(${txRatio.toFixed(1)}倍)`);
  }

  // SOL全体が下落中なら減点
  if (solTrend < -2) {
    score -= 20;
    reasons.push(`SOL下落トレンド注意`);
  }

  // 流動性チェック
  if (liquidity < 100000) {
    score -= 30;
    reasons.push(`流動性低い($${(liquidity/1000).toFixed(0)}K)`);
  }

  return { score, reasons, priceChange5m, priceChange1h, priceChange24h, volume24h };
}

async function getTokenPrice(tokenAddress) {
  try {
    if (Date.now() - lastRateLimitTime < CONFIG.RATE_LIMIT_WAIT_MS) {
      const waitRemain = Math.ceil(
        (CONFIG.RATE_LIMIT_WAIT_MS - (Date.now() - lastRateLimitTime)) / 1000
      );
      console.log(`レート制限待機中... あと${waitRemain}秒`);
      return null;
    }

    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;
    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;
    return solanaPairs.reduce((best, current) => {
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);
  } catch (error) {
    if (error.response?.status === 429) {
      console.log("DexScreenerレート制限 → 1分待機");
      lastRateLimitTime = Date.now();
    } else {
      console.error(`価格取得エラー:`, error.message);
    }
    return null;
  }
}

async function sendBuyNotification(symbol, analysis, txid, dexLink) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: `🛒 ${symbol} 自動購入 (スコア: ${analysis.score})`,
        color: 0x00ff00,
        fields: [
          { name: "📈 5分変化", value: `+${analysis.priceChange5m.toFixed(2)}%`, inline: true },
          { name: "📊 1時間変化", value: `${analysis.priceChange1h.toFixed(2)}%`, inline: true },
          { name: "📉 24時間変化", value: `${analysis.priceChange24h.toFixed(2)}%`, inline: true },
          { name: "💵 金額", value: "$10相当のSOL", inline: true },
          { name: "🎯 利確", value: "+8%", inline: true },
          { name: "🔴 損切り", value: "-4%", inline: true },
          { name: "🧠 購入理由", value: analysis.reasons.join("\n"), inline: false },
          { name: "🔗 TX", value: `[確認](https://solscan.io/tx/${txid})`, inline: false },
          { name: "🔗 Chart", value: `[DexScreener](${dexLink})`, inline: false },
        ],
        footer: { text: `SOLトレンド: ${solTrend.toFixed(2)}% | ${jstTime}` },
      }],
    }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
  } catch (error) {
    console.error("購入通知エラー:", error.message);
  }
}

async function checkTrends(solPriceUsd) {
  console.log("コイン監視中...");

  if (positions.length >= CONFIG.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  // まずSOL全体のトレンドを確認
  await getSolTrend();

  // SOLが大きく下落中なら購入しない
  if (solTrend < -3) {
    console.log(`SOL下落トレンド中(${solTrend.toFixed(2)}%) → 購入見送り`);
    return;
  }

  const results = [];

  for (const token of WATCH_TOKENS) {
    if (purchasedTokens.has(token.address)) continue;

    const pair = await getTokenPrice(token.address);
    if (!pair) {
      await new Promise((r) => setTimeout(r, CONFIG.REQUEST_INTERVAL_MS));
      continue;
    }

    const analysis = analyzeToken(pair);
    const priceChange5m = analysis.priceChange5m;

    console.log(`${token.symbol}: 5m ${priceChange5m.toFixed(2)}% | スコア: ${analysis.score} | ${analysis.reasons[0] || ""}`);

    // 購入条件: スコア50以上 かつ 5分で+1%以上
    if (analysis.score >= 50 && priceChange5m >= CONFIG.MIN_PRICE_CHANGE_5M) {
      results.push({ token, pair, analysis });
    }

    await new Promise((r) => setTimeout(r, CONFIG.REQUEST_INTERVAL_MS));
  }

  if (results.length === 0) {
    console.log("購入条件なし（スコア不足または上昇不足）");
    return;
  }

  // スコアが高い順に並べる
  results.sort((a, b) => b.analysis.score - a.analysis.score);
  console.log(`購入候補: ${results.length}件`);
  results.forEach(r => console.log(
    `  ${r.token.symbol}: スコア${r.analysis.score} | ${r.analysis.reasons.join(", ")}`
  ));

  const best = results[0];
  console.log(`購入決定: ${best.token.symbol} スコア:${best.analysis.score}`);
  console.log(`購入理由: ${best.analysis.reasons.join(" / ")}`);

  const tradeResult = await buyToken(best.token.address, solPriceUsd, false);

  if (tradeResult) {
    addPosition(tradeResult);
    purchasedTokens.add(best.token.address);
    console.log(`購入成功: ${best.token.symbol}`);
    const dexLink = `https://dexscreener.com/${best.pair.chainId}/${best.pair.pairAddress}`;
    await sendBuyNotification(best.token.symbol, best.analysis, tradeResult.txid, dexLink);
  } else {
    console.log(`購入失敗: ${best.token.symbol}`);
  }
}

module.exports = { checkTrends };
