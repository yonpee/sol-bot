require("dotenv").config();
const cron = require("node-cron");
const { getSolanaPrice } = require("./priceChecker");
const { sendDiscordNotification, sendStartupNotification } = require("./notifier");

const CONFIG = {
  CHECK_INTERVAL_MINUTES: 1,
  PRICE_HISTORY_MINUTES: 5,
  DROP_THRESHOLD_PERCENT: 3.0,
};

const priceHistory = [];
module.exports = { CONFIG };

function checkEnvironmentVariables() {
  console.log("🔍 環境変数をチェック中...");
  const requiredVars = ["DISCORD_WEBHOOK_URL"];
  let hasError = false;
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      console.error(`❌ エラー: ${varName} が設定されていません！`);
      hasError = true;
    } else {
      console.log(`✅ ${varName}: 設定済み`);
    }
  }
  if (hasError) {
    console.error("🛑 必須の環境変数が不足しています。Botを終了します。");
    process.exit(1);
  }
  console.log("✅ 環境変数チェック完了！\n");
}

function updatePriceHistory(priceData) {
  priceHistory.push({ price: priceData.price, timestamp: priceData.timestamp });
  const cutoffTime = Date.now() - CONFIG.PRICE_HISTORY_MINUTES * 2 * 60 * 1000;
  while (priceHistory.length > 0 && priceHistory[0].timestamp < cutoffTime) {
    priceHistory.shift();
  }
}

function detectPriceDrop(currentPrice) {
  const compareTime = Date.now() - CONFIG.PRICE_HISTORY_MINUTES * 60 * 1000;
  const oldPrices = priceHistory.filter((p) => p.timestamp <= compareTime + 30000);
  if (oldPrices.length === 0) {
    console.log(`📊 比較データ不足`);
    return null;
  }
  const oldestPrice = oldPrices[oldPrices.length - 1];
  const priceChange = ((currentPrice - oldestPrice.price) / oldestPrice.price) * 100;
  return {
    oldPrice: oldestPrice.price,
    changePercent: priceChange,
    minutesAgo: Math.round((Date.now() - oldestPrice.timestamp) / 1000 / 60),
  };
}

async function checkPrice() {
  const now = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" });
  console.log(`\n⏰ [${now}] 価格チェック開始...`);
  const priceData = await getSolanaPrice();
  if (!priceData) {
    console.log("⚠️ 価格取得失敗。次のチェックまで待機します。");
    return;
  }
  console.log(`💰 SOL現在価格: $${priceData.price.toFixed(4)}`);
  updatePriceHistory(priceData);
  console.log(`📝 価格履歴: ${priceHistory.length}件`);
  const dropInfo = detectPriceDrop(priceData.price);
  if (!dropInfo) {
    console.log("📊 比較データ収集中...");
    return;
  }
  console.log(`📉 ${dropInfo.minutesAgo}分前との比較: ${dropInfo.changePercent.toFixed(2)}%`);
  if (dropInfo.changePercent <= -CONFIG.DROP_THRESHOLD_PERCENT) {
    console.log(`🚨 下落検知！通知中...`);
    await sendDiscordNotification(priceData, dropInfo);
  } else {
    console.log(`✅ 異常なし`);
  }
}

async function startBot() {
  console.log("🚀 Solana Price Bot 起動中...");
  checkEnvironmentVariables();
  await sendStartupNotification(CONFIG);
  await checkPrice();
  cron.schedule(`*/${CONFIG.CHECK_INTERVAL_MINUTES} * * * *`, async () => {
    await checkPrice();
  });
  console.log(`✅ Bot稼働中！`);
}

process.on("uncaughtException", (error) => { console.error("🔥 エラー:", error.message); });
process.on("unhandledRejection", (reason) => { console.error("🔥 Promiseエラー:", reason); });
process.on("SIGINT", () => { console.log("\n👋 Bot停止"); process.exit(0); });

startBot().catch((error) => { console.error("🔥 起動エラー:", error); process.exit(1); });
