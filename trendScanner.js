const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");
const { analyzeWithClaude, getAiMarketSentiment } = require("./aiAnalyzer");

const WATCH_TOKENS = [
  { symbol: "JUP",     address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY",     address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "PYTH",    address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "ORCA",    address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "DRIFT",   address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7" },
  { symbol: "RENDER",  address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  { symbol: "BONK",    address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF",     address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "MEW",     address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "BOME",    address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "AI16Z",   address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
  { symbol: "ZEREBRO", address: "8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn" },
  { symbol: "SLERF",   address: "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3" },
];

const CONFIG = {
  MIN_PRICE_CHANGE_5M: 1,
  MIN_SCORE: 50,
  MAX_POSITIONS: 1,
  REQUEST_INTERVAL_MS: 500,
  RATE_LIMIT_WAIT_MS: 60000,
};

const purchasedTokens = new Set();
let lastRateLimitTime = 0;
let solTrend = 0;
let lastAiAnalysisTime = 0;
let cachedMarketSentiment = { score: 0, sentiment: "neutral", shouldTrade: true, reason: "未分析" };

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

  let score = 0;
  let reasons = [];

  if (priceChange5m >= 1) { score += 30; reasons.push(`5分+${priceChange5m.toFixed(1)}%`); }
  if (priceChange1h > 0) { score += 20; reasons.push(`1時間プラス`); }
  else { score -= 10; }
  if (priceChange24h > 0) { score += 10; reasons.push(`24時間上昇`); }

  const volumeRatio = volume6h > 0 ? (volume24h / 4) / volume6h : 1;
  if (volumeRatio > 1.2) { score += 20; reasons.push(`出来高${volumeRatio.toFixed(1)}倍増`); }

  const txRatio = txns1h > 0 ? (txns5m * 12) / txns1h : 1;
  if (txRatio > 1.5) { score += 15; reasons.push(`取引${txRatio.toFixed(1)}倍増`); }

  if (solTrend < -2) { score -= 20; reasons.push(`SOL下落注意`); }
  if (liquidity < 100000) { score -= 30; reasons.push(`流動性低`); }

  return { score, reasons, priceChange5m, priceChange1h, priceChange24h };
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
    }
    return null;
  }
}

async function sendBuyNotification(symbol, analysis, aiResult, txid, dexLink) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime​​​​​​​​​​​​​​​​
