const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let tradeHistory = [];
let botConfig = {
  takeProfit: 8,
  stopLoss: -4,
  buyAmount: 10,
  minChange5m: 1,
  active: true,
};

// 取引履歴に追加する関数
function addTradeHistory(trade) {
  tradeHistory.unshift({
    id: Date.now(),
    symbol: trade.symbol,
    type: trade.type,
    amount: trade.amount,
    profit: trade.profit || null,
    reason: trade.reason || "",
    txid: trade.txid || "",
    timestamp: new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }),
  });
  // 最大50件まで保存
  if (tradeHistory.length > 50) tradeHistory.pop();
}

// Bot状態を取得
app.get("/status", (req, res) => {
  const { positions } = require("./portfolio");
  res.json({
    active: botConfig.active,
    positions: positions,
    positionCount: positions.length,
    config: botConfig,
  });
});

// 取引履歴を取得
app.get("/history", (req, res) => {
  res.json({ history: tradeHistory });
});

// 設定を変更
app.post("/config", (req, res) => {
  const { takeProfit, stopLoss, buyAmount, minChange5m, active } = req.body;
  if (takeProfit !== undefined) botConfig.takeProfit = parseFloat(takeProfit);
  if (stopLoss !== undefined) botConfig.stopLoss = parseFloat(stopLoss);
  if (buyAmount !== undefined) botConfig.buyAmount = parseFloat(buyAmount);
  if (minChange5m !== undefined) botConfig.minChange5m = parseFloat(minChange5m);
  if (active !== undefined) botConfig.active = active;
  console.log("設定変更:", botConfig);
  res.json({ success: true, config: botConfig });
});

// ヘルスチェック
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

function startApi() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("API サーバー起動: port " + PORT);
  });
}

module.exports = { startApi, addTradeHistory, botConfig };
