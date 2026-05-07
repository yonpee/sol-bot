const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition } = require("./portfolio");

const LISTING_CONFIG = {
  NEW_LISTING_MINUTES: 1,
  MIN_LIQUIDITY_USD: 10000,
  CHAIN: "solana",
};

const notifiedTokens = new Set();

async function getNewListings() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/search?q=solana",
      { timeout: 10000, headers: { "User-Agent": "SolanaBot/1.0" } }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return [];

    const now = Date.now();
    const cutoffTime = LISTING_CONFIG.NEW_LISTING_MINUTES * 60 * 1000;

    return data.pairs.filter((pair) => {
      if (pair.chainId !== LISTING_CONFIG.CHAIN) return false;
      const liquidity = parseFloat(pair.liquidity?.usd || 0);
      if (liquidity < LISTING_CONFIG.MIN_LIQUIDITY_USD) return false;
      if (!pair.pairCreatedAt) return false;
      if (now - pair.pairCreatedAt > cutoffTime) return false;
      if (notifiedTokens.has(pair.pairAddress)) return false;
      return true;
    });
  } catch (error) {
    console.error("❌ 新規上場データ取得エラー:", error.message);
    return [];
  }
}

async function sendNewListingNotification(pair, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const listedAgoSec = Math.round((Date.now() - pair.pairCreatedAt) / 1000);
  const listedAgoText = listedAgoSec < 60 ? `${listedAgoSec}秒前` : `${Math.round(listedAgoSec / 60)}分前`;
  const dexLink = `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;

  const payload = {
    content: "🆕 **新規上場検知＆自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${pair.baseToken?.name || "不明"} ($${pair.baseToken?.symbol || "?"})`,
      color: 0x00ffff,
      fields: [
        { name: "💰 購入価格", value: `$${parseFloat(pair.priceUsd).toFixed(8)}`, inline: true },
        { name: "⏱️ 上場時間", value: listedAgoText, inline: true },
        { name: "💧 流動性", value: `$${parseFloat(pair.liquidity?.usd || 0).toLocaleString()}`, inline: true },
        { name: "💵 購入金額", value: `$${tradeResult ? "10" : "失敗"}`, inline: true },
        { name: "🎯 利確ライン", value: "+30%", inline: true },
        { name: "🔴 損切りライン", value: "-20%", inline: true },
        { name: "🔗 DexScreener", value: `[チャートを見る](${dexLink})`, inline: false },
        tradeResult ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false } : { name: "⚠️ 購入", value: "失敗", inline: false },
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
    console.error("❌ 通知エラー:", error.message);
  }
}

async function checkNewListings(solPriceUsd) {
  console.log("🔍 新規上場チェック中...");
  const newListings = await getNewListings();

  if (newListings.length === 0) {
    console.log("📊 新規上場なし");
    return;
  }

  console.log(`🆕 新規上場検知: ${newListings.length}件`);

  for (const pair of newListings) {
    console.log(`  → ${pair.baseToken?.symbol}`);
    notifiedTokens.add(pair.pairAddress);

    // 自動購入
    const tradeResult = await buyToken(pair.baseToken.address, solPriceUsd);
    if (tradeResult) {
      addPosition(tradeResult);
      console.log(`✅ 自動購入成功: ${pair.baseToken?.symbol}`);
    }

    await sendNewListingNotification(pair, tradeResult);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

module.exports = { checkNewListings };
