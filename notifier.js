const axios = require("axios");

function getJSTTimeString() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());
}

async function postToDiscord(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) { console.error("❌ DISCORD_WEBHOOK_URLが未設定！"); return; }
  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log("✅ Discord通知送信成功！");
  } catch (error) {
    console.error("❌ Discord通知エラー:", error.message);
  }
}

async function sendDiscordNotification(priceData, dropInfo) {
  const jstTime = getJSTTimeString();
  const absChange = Math.abs(dropInfo.changePercent).toFixed(2);
  const payload = {
    content: "🚨 **価格急落アラート！** @everyone",
    embeds: [{
      title: "📉 SOL 価格急落検知！",
      description: `**${absChange}%** 下落しました！`,
      color: 0xff0000,
      fields: [
        { name: "💰 現在価格", value: `**$${priceData.price.toFixed(4)}**`, inline: true },
        { name: "📊 下落率", value: `**${dropInfo.changePercent.toFixed(2)}%**`, inline: true },
        { name: "📈 比較基準", value: `$${dropInfo.oldPrice.toFixed(4)} (${dropInfo.minutesAgo}分前)`, inline: true },
        { name: "🔗 DexScreenerで確認", value: `[チャートを見る](${priceData.dexScreenerLink})`, inline: false },
      ],
      footer: { text: `Solana Price Bot | ${jstTime} JST` },
      thumbnail: { url: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
    }],
  };
  await postToDiscord(payload);
}

async function sendStartupNotification(config) {
  const jstTime = getJSTTimeString();
  const payload = {
    embeds: [{
      title: "🤖 Solana Price Bot 起動完了！",
      description: "価格監視を開始しました",
      color: 0x00ff00,
      fields: [
        { name: "📊 監視トークン", value: "SOL (Solana)", inline: true },
        { name: "⏱️ チェック間隔", value: `${config.CHECK_INTERVAL_MINUTES}分ごと`, inline: true },
        { name: "🚨 通知条件", value: `${config.PRICE_HISTORY_MINUTES}分以内に${config.DROP_THRESHOLD_PERCENT}%以上下落`, inline: false },
      ],
      footer: { text: `起動時刻: ${jstTime} JST` },
    }],
  };
  await postToDiscord(payload);
}

module.exports = { sendDiscordNotification, sendStartupNotification };
