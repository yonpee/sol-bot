const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const WATCH_TOKENS = [
  { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT", address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "GOAT", address: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump" },
  { symbol: "AI16Z", address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
  { symbol: "MEW", address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "PYTH", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
];

const CONFIG = {
  MIN_PRICE_CHANGE_5M: 0.5,
  MAX_POSITIONS: 1,
  REQUEST_INTERVAL_MS: 500,
  RATE_LIMIT_WAIT_MS: 60000,
};

const purchasedTokens = new Set();
let lastRateLimitTime = 0;

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
      console.error(`エラー(${tokenAddress.substring(0, 8)}): ${error.message}`);
    }
    return null;
  }
}

async function sendBuyNotification(symbol, price, priceChange5m, txid, dexLink) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: `🛒 ${symbol} 自動購入`,
        color: 0x00ff00,
        fields: [
          { name: "💰 価格", value: `$${price.toFixed(8)}`, inline: true },
          { name: "📈 5分変化", value: `+${priceChange5m.toFixed(2)}%`, inline: true },
          { name: "💵 金額", value: "$10 SOL", inline: true },
          { name: "🔗 TX", value: `[確認](https://solscan.io/tx/${txid})`, inline: false },
          { name: "🔗 Chart", value: `[DexScreener](${dexLink})`, inline: false },
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

  if (positions.length >= CONFIG.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
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

    const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
    console.log(`${token.symbol}: ${priceChange5m.toFixed(2)}%`);

    if (priceChange5m >= CONFIG.MIN_PRICE_CHANGE_5M) {
      results.push({ token, pair, priceChange5m });
    }

    await new Promise((r) => setTimeout(r, CONFIG.REQUEST_INTERVAL_MS));
  }

  if (results.length === 0) {
    console.log("購入条件なし");
    return;
  }

  results.sort((a, b) => b.priceChange5m - a.priceChange5m);
  const best = results[0];
  console.log(`購入: ${best.token.symbol} +${best.priceChange5m.toFixed(2)}%`);

  const tradeResult = await buyToken(best.token.address, solPriceUsd, false);

  if (tradeResult) {
    addPosition(tradeResult);
    purchasedTokens.add(best.token.address);
    console.log(`購入成功: ${best.token.symbol}`);
    const dexLink = `https://dexscreener.com/${best.pair.chainId}/${best.pair.pairAddress}`;
    await sendBuyNotification(
      best.token.symbol,
      parseFloat(best.pair.priceUsd || 0),
      best.priceChange5m,
      tradeResult.txid,
      dexLink
    );
  } else {
    console.log(`購入失敗: ${best.token.symbol}`);
  }
}

module.exports = { checkTrends };
