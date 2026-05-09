const axios = require("axios");

async function getSolanaPrice() {
  const apis = [
    {
      name: "Kraken",
      url: "https://api.kraken.com/0/public/Ticker?pair=SOLUSD",
      parse: (data) => parseFloat(data.result?.SOLUSD?.c?.[0] || data.result?.XSOLUSD?.c?.[0]),
    },
    {
      name: "CoinGecko",
      url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      parse: (data) => parseFloat(data?.solana?.usd),
    },
    {
      name: "DexScreener",
      url: "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
      parse: (data) => {
        const pairs = data?.pairs?.filter(p => p.chainId === "solana") || [];
        if (pairs.length === 0) return null;
        const best = pairs.reduce((a, b) =>
          parseFloat(b.liquidity?.usd || 0) > parseFloat(a.liquidity?.usd || 0) ? b : a
        );
        return parseFloat(best.priceUsd);
      },
    },
  ];

  for (const api of apis) {
    try {
      const response = await axios.get(api.url, { timeout: 10000 });
      const price = api.parse(response.data);
      if (price && price > 0) {
        console.log("SOL価格取得成功(" + api.name + "): $" + price.toFixed(4));
        return { price, timestamp: Date.now() };
      }
    } catch (error) {
      console.log(api.name + "失敗: " + error.message);
    }
  }

  console.error("全APIで価格取得失敗");
  return null;
}

module.exports = { getSolanaPrice };
