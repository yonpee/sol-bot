const axios = require("axios");

async function getSolanaPrice() {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { timeout: 10000 }
    );
    const price = response.data?.solana?.usd;
    if (!price) return null;
    return {
      price: parseFloat(price),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("SOL価格取得エラー:", error.message);
    return null;
  }
}

module.exports = { getSolanaPrice };
