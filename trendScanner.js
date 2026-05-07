const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

// Raydiumで売買できる有名コイン一覧
const WATCH_TOKENS = [
  // ミームコイン
  { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT", address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "MYRO", address: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4" },
  { symbol: "BOME", address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "SLERF", address: "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3" },
  { symbol: "DOGGO", address: "5LSFpvLDkcdV2a3Kiyzmg5YcJd4HnGqkRcVd8q8T1J9" },
  { symbol: "MEW", address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "PENG", address: "A3eME5CetyZPBoWbRUwY3tSe25S6tb18ba9ZPbWk9eFJ" },
  { symbol: "GIGA", address: "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9" },
  // AIコイン
  { symbol: "GOAT", address: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump" },
  { symbol: "AI16Z", address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
  { symbol: "AIXBT", address: "AIXBT9mdTvjSvCLBSiCXNSgS3rVkJRPhMhVCZVQYpump" },
  { symbol: "FARTCOIN", address: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
  { symbol: "ARC", address: "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump" },
  { symbol: "ZEREBRO", address: "8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn" },
  // DeFiコイン
  { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "PYTH", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "ORCA", address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
];

const TRADE_CONFIG_LOCAL = {
  MIN_PRICE_CHANGE_5M: 2,
  MAX_POSITIONS: 1,
};

const purchasedTokens = new Set();

async function getTokenPrice(tokenAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;

    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;

    return solanaPairs.reduce((best, current) => {
      const bestLiq = parseFloat(best?.liquidity?.usd || 0);
      const currLiq = parseFloat(current.liquidity?.usd || 0);
      return currLiq > bestLiq ? current : best;
    }, solanaPairs[0]);
  } catch (error) {
    console.error(`価格取得エラー (${tokenAddress}):`, error.message);
    return null;
  }
}

async function sendBuyNotification(pair, symbol, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const liquidity = parseFloat(pair.liquidity?.usd || 0);
  const dexLink = `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;

  const payload = {
    content: "📈 **上昇トレンドコイン自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${pair.baseToken?.name || symbol} ($${symbol})`,
      color: 0x00ff00,
      fields: [
        { name: "💰 購入価格", value: `$${parseFloat(pair.priceUsd || 0).toFixed(8)}`, inline: true },
        { name: "📈 5分変化", value: `+${priceChange5m.toFixed(2)}%`, inline: true },
        { name: "💧 流動性", value: `$${(liquidity / 1000000).toFixed(2)}M`, inline: true },
        { name: "💵 購入金額", value: tradeResult ? "$5" : "失敗", inline: true },
        { name: "🎯 利確", value: "+10%", inline: true },
        { name: "🔴 損切り", value: "-30%", inline: true },
        { name: "🔗 DexScreener", value: `[チャートを見る](${dexLink})`, inline: false },
        tradeResult
          ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "購入結果", value: "失敗", inline: false },
      ],
      footer: { text: `Solana Trade Bot | ${jstTime} JST` },
    }],
  };

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (error) {
    console.error("通知エラー:", error.message);
  }
}

async function checkTrends(solPriceUsd) {
  console.log("📈 コイン監視中...");

  if (positions.length >= TRADE_CONFIG_LOCAL.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  const results = [];

  for (const token of WATCH_TOKENS) {
    if (purchasedTokens.has(token.address)) continue;
    const pair = await getTokenPrice(token.address);
    if (!pair) continue;
    const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
    if (priceChange5m >= TRADE_CONFIG_LOCAL.MIN_PRICE_CHANGE_5M) {
      results.push({ token, pair, priceChange5m });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (results.length === 0) {
    console.log("購入条件を満たすコインなし");
    return;
  }

  // 上昇率が高い順に並べる
  results.sort((a, b) => b.priceChange5m - a.priceChange5m);
  console.log(`購入候補: ${results.length}件`);
  results.forEach(r => console.log(`  ${r.token.symbol}: +${r.priceChange5m.toFixed(2)}%`));

  // 一番上昇率が高いコインを購入
  const best = results[0];
  console.log(`🎯 購入: ${best.token.symbol} +${best.priceChange5m.toFixed(2)}%`);

  const tradeResult = await buyToken(best.token.address, solPriceUsd);

  if (tradeResult) {
    addPosition(tradeResult);
    purchasedTokens.add(best.token.address);
    console.log(`✅ 購入成功: ${best.token.symbol}`);
  } else {
    console.log(`❌ 購入失敗: ${best.token.symbol}`);
  }

  await sendBuyNotification(best.pair, best.token.symbol, tradeResult);
}

module.exports = { checkTrends };
