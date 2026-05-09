const axios = require("axios");

async function sendDiscordNotification(priceData, dropInfo) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const payload = {
    content: "🚨 **SOL急落アラート！** @everyone",
    embeds: [{
      title: "⚠️ Solana 価格急落検知",
      color: 0xff0000,
      fields: [
        { name: "💰 現在価格", value: `$${priceData.price.toFixed(4)}`, inline: true },
        { name: "📉 変化率", value: `${dropInfo.changePercent.toFixed(2)}%`, inline: true },
        { name: "⏱️ 比較時間", value: `${dropInfo.minutesAgo}分前比較`, inline: true },
        { name: "📊 基準価格", value: `$${dropInfo.oldPrice.toFixed(4)}`, inline: true },
      ],
      footer: { text: `Solana Bot | ${jstTime} JST` },
    }],
  };

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log("急落通知送信成功！");
  } catch (error) {
    console.error("通知エラー:", error.message);
  }
}

async function sendStartupNotification(config) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date());

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: "🤖 Solana Trade Bot 起動",
        color: 0x38bdf8,
        fields: [
          { name: "⏱️ チェック間隔", value: `${config.CHECK_INTERVAL_MINUTES}分ごと`, inline: true },
          { name: "🚨 急落通知", value: `${config.DROP_THRESHOLD_PERCENT}%以上下落`, inline: true },
        ],
        footer: { text: `起動時刻: ${jstTime} JST` },
      }],
    }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
  } catch (error) {
    console.error("起動通知エラー:", error.message);
  }
}

module.exports = { sendDiscordNotification, sendStartupNotification };
