const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";

// Raydiumで確実に売買できる有名コイン
const WATCH_TOKENS = [
  { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT", address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "MYRO", address: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4" },
  { symbol: "BOME", address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
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

    const bestPair = solanaPairs.reduce((best, current) => {
      const bestLiq = parseFloat(best?.liquidity?.usd || 0);
      const currLiq = parseFloat(current.liquidity?.usd || 0);
      return currLiq > bestLiq ? current : best;
    }, solanaPairs[0]);

    return bestPair;
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
  console.log("📈 有名コイン監視中...");

  if (positions.length >= TRADE_CONFIG_LOCAL.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  for (const token of WATCH_TOKENS) {
    if (positions.length >= TRADE_CONFIG_LOCAL.MAX_POSITIONS) break;
    if (purchasedTokens.has(token.address)) continue;

    const pair = await getTokenPrice(token.address);
    if (!pair) continue;

    const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
    console.log(`${token.symbol}: 5m変化 ${priceChange5m.toFixed(2)}%`);

    // 5分で2%以上上昇していたら購入
    if (priceChange5m >= TRADE_CONFIG_LOCAL.MIN_PRICE_CHANGE_5M) {
      console.log(`🎯 購入条件達成: ${token.symbol} +${priceChange5m.toFixed(2)}%`);

      const tradeResult = await buyToken(token.address, solPriceUsd);

      if (tradeResult) {
        addPosition(tradeResult);
        purchasedTokens.add(token.address);
        console.log(`✅ 購入成功: ${token.symbol}`);
        await sendBuyNotification(pair, token.symbol, tradeResult);
        break;
      } else {
        console.log(`❌ 購入失敗: ${token.symbol}`);
        await sendBuyNotification(pair, token.symbol, null);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

module.exports = { checkTrends };
