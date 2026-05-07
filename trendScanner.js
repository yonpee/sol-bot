const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";

const TREND_CONFIG = {
  MIN_PRICE_CHANGE_5M: -100,
  MIN_LIQUIDITY_USD: 100,
  MIN_VOLUME_24H: 0,
  MAX_POSITIONS: 1,
  CHAINS: ["solana"],
};

const purchasedTokens = new Set();

async function getTrendingTokens() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/search?q=meme",
      { timeout: 10000, headers: { "User-Agent": "SolanaBot/1.0" } }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return [];

    console.log(`取得ペア数: ${data.pairs.length}`);

    const trendingPairs = data.pairs.filter((pair) => {
      if (!TREND_CONFIG.CHAINS.includes(pair.chainId)) return false;
      if (pair.baseToken?.address === SOL_ADDRESS) return false;
      if (pair.baseToken?.address === WSOL_ADDRESS) return false;
      if (pair.baseToken?.symbol === "SOL") return false;
      if (pair.baseToken?.symbol === "WSOL") return false;
      const liquidity = parseFloat(pair.liquidity?.usd || 0);
      if (liquidity < TREND_CONFIG.MIN_LIQUIDITY_USD) return false;
      const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
      if (priceChange5m < TREND_CONFIG.MIN_PRICE_CHANGE_5M) return false;
      if (purchasedTokens.has(pair.baseToken?.address)) return false;
      if (!pair.priceUsd || parseFloat(pair.priceUsd) <= 0) return false;
      if (!pair.baseToken?.address) return false;
      return true;
    });

    trendingPairs.sort((a, b) => {
      return parseFloat(b.priceChange?.m5 || 0) - parseFloat(a.priceChange?.m5 || 0);
    });

    console.log(`対象コイン: ${trendingPairs.length}件`);
    if (trendingPairs.length > 0) {
      console.log(`1位: ${trendingPairs[0].baseToken?.symbol} (${trendingPairs[0].baseToken?.address})`);
    }
    return trendingPairs;
  } catch (error) {
    console.error("トレンドデータ取得エラー:", error.message);
    return [];
  }
}

async function sendTrendBuyNotification(pair, tradeResult) {
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
    content: "📈 **トレンド上昇コイン自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${pair.baseToken?.name || "不明"} ($${pair.baseToken?.symbol || "?"})`,
      color: 0x00ff00,
      fields: [
        { name: "💰 購入価格", value: `$${parseFloat(pair.priceUsd).toFixed(8)}`, inline: true },
        { name: "📈 5分変化", value: `${priceChange5m.toFixed(2)}%`, inline: true },
        { name: "💧 流動性", value: `$${liquidity.toLocaleString()}`, inline: true },
        { name: "💵 購入金額", value: tradeResult ? "$5" : "失敗", inline: true },
        { name: "🎯 利確", value: "+50%", inline: true },
        { name: "🔴 損切り", value: "-30%", inline: true },
        { name: "🔗 DexScreener", value: `[チャートを見る](${dexLink})`, inline: false },
        tradeResult
          ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "購入結果", value: "失敗", inline: false },
      ],
      footer: { text: `Solana Trend Bot | ${jstTime} JST` },
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
  console.log("📈 トレンドチェック中...");

  if (positions.length >= TREND_CONFIG.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  const trendingTokens = await getTrendingTokens();

  if (trendingTokens.length === 0) {
    console.log("上昇トレンドのコインなし");
    return;
  }

  const target = trendingTokens[0];
  const symbol = target.baseToken?.symbol || "不明";
  console.log(`購入試行: ${symbol} (${target.baseToken?.address})`);

  const tradeResult = await buyToken(target.baseToken.address, solPriceUsd);

  if (tradeResult) {
    addPosition(tradeResult);
    purchasedTokens.add(target.baseToken.address);
    console.log(`✅ 購入成功: ${symbol}`);
  } else {
    console.log(`❌ 購入失敗: ${symbol}`);
  }

  await sendTrendBuyNotification(target, tradeResult);
}

module.exports = { checkTrends };
