const axios = require("axios");

const DEXSCREENER_API_URL = "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112";
const DEXSCREENER_LINK = "https://dexscreener.com/solana/So11111111111111111111111111111111111111112";

async function getSolanaPrice() {
  try {
    const response = await axios.get(DEXSCREENER_API_URL, {
      timeout: 10000,
      headers: { "User-Agent": "SolanaBot/1.0" },
    });
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) {
      console.warn("⚠️ 価格データなし");
      return null;
    }
    const bestPair = data.pairs.reduce((best, current) => {
      const bestLiq = parseFloat(best.liquidity?.usd || 0);
      const currLiq = parseFloat(current.liquidity?.usd || 0);
      return currLiq > bestLiq ? current : best;
    });
    return {
      price: parseFloat(bestPair.priceUsd),
      symbol: bestPair.baseToken?.symbol || "SOL",
      dexId: bestPair.dexId,
      volume24h: parseFloat(bestPair.volume?.h24 || 0),
      liquidity: parseFloat(bestPair.liquidity?.usd || 0),
      priceChange5m: parseFloat(bestPair.priceChange?.m5 || 0),
      dexScreenerLink: DEXSCREENER_LINK,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("❌ 価格取得エラー:", error.message);
    return null;
  }
}

module.exports = { getSolanaPrice, DEXSCREENER_LINK };
