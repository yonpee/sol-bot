const axios = require("axios");

async function getSolanaPrice() {
  try {
    const response = await axios.get(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { timeout: 10000 }
    );
    const price = parseFloat(response.data?.price);
    if (!price) return null;
    console.log("SOL価格取得成功: $" + price.toFixed(4));
    return {
      price: price,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("SOL価格取得エラー:", error.message);
    return null;
  }
}

module.exports = { getSolanaPrice };
