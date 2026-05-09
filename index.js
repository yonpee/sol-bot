require("dotenv").config();
const cron = require("node-cron");
const { getSolanaPrice } = require("./priceChecker");
const { sendDiscordNotification } = require("./notifier");
const { checkTrends } = require("./trendScanner");
const { monitorPositions, loadPositionFromSupabase } = require("./portfolio");
const { startApi } = require("./api");

const CONFIG = {
  CHECK_INTERVAL_MINUTES: 2,
  PRICE_HISTORY_MINUTES: 5,
  DROP_THRESHOLD_PERCENT: 3.0,
};

const priceHistory = [];
module.exports = { CONFIG };

function checkEnvironmentVariables() {
  console.log("環境変数チェック中...");
  const requiredVars = ["DISCORD_WEBHOOK_URL", "WALLET_PRIVATE_KEY"];
  let hasError = false;
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      console.error(varName + " が未設定！");
      hasError = true;
    } else {
      console.log(varName + ": 設定済み");
    }
  }
  if (hasError) { process.exit(1); }
  console.log("環境変数チェック完了！\n");
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
  if (oldPrices.length === 0) return null;
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
  console.log("\n[" + now + "] チェック開始...");
  const priceData = await getSolanaPrice();
  if (!priceData) { console.log("価格取得失敗"); return null; }
  console.log("SOL: $" + priceData.price.toFixed(4));
  updatePriceHistory(priceData);
  const dropInfo = detectPriceDrop(priceData.price);
  if (!dropInfo) { console.log("比較データ収集中..."); return priceData; }
  if (dropInfo.changePercent <= -CONFIG.DROP_THRESHOLD_PERCENT) {
    await sendDiscordNotification(priceData, dropInfo);
  }
  return priceData;
}

async function startBot() {
  console.log("Solana Trade Bot 起動中...");
  checkEnvironmentVariables();

  // Supabaseからポジションを復元
  await loadPositionFromSupabase();

  // APIサーバー起動
  startApi();

  const priceData = await checkPrice();
  if (priceData) {
    await checkTrends(priceData.price);
    await monitorPositions();
  }

  cron.schedule("*/" + CONFIG.CHECK_INTERVAL_MINUTES + " * * * *", async () => {
    const pd = await checkPrice();
    if (pd) {
      await checkTrends(pd.price);
      await monitorPositions();
    }
  });

  console.log("Bot稼働中！");
}

process.on("uncaughtException", (e) => { console.error("エラー:", e.message); });
process.on("unhandledRejection", (r) => { console.error("Promiseエラー:", r); });
process.on("SIGINT", () => { console.log("Bot停止"); process.exit(0); });

startBot().catch((e) => { console.error("起動エラー:", e); process.exit(1); });
