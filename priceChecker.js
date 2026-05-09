const axios = require("axios");

async function getSolanaPrice() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;

    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;

    const bestPair = solanaPairs.reduce((best, current) => {
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);

    return {
      price: parseFloat(bestPair.priceUsd),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("SOL価格取得エラー:", error.message);
    return null;
  }
}

module.exports = { getSolanaPrice };
