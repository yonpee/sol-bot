const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

let tradeHistory = [];
let botConfig = {
  takeProfit: 8,
  stopLoss: -4,
  buyAmount: 10,
  minChange5m: 1,
  active: true,
};

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
  if (tradeHistory.length > 50) tradeHistory.pop();
}

app.options("*", cors());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/status", (req, res) => {
  const { positions } = require("./portfolio");
  res.json({
    active: botConfig.active,
    positions: positions,
    positionCount: positions.length,
    config: botConfig,
  });
});

app.get("/history", (req, res) => {
  res.json({ history: tradeHistory });
});

app.post("/config", (req, res) => {
  const { takeProfit, stopLoss, buyAmount, minChange5m, active } = req.body;
  if (takeProfit !== undefined) botConfig.takeProfit = parseFloat(takeProfit);
  if (stopLoss !== undefined) botConfig.stopLoss = parseFloat(stopLoss);
  if (buyAmount !== undefined) botConfig.buyAmount = parseFloat(buyAmount);
  if (minChange5m !== undefined) botConfig.minChange5m = parseFloat(minChange5m);
  if (active !== undefined) botConfig.active = active;
  console.log("設定変更:", JSON.stringify(botConfig));
  res.json({ success: true, config: botConfig });
});

function startApi() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log("API サーバー起動: port " + PORT);
  });
}

module.exports = { startApi, addTradeHistory, botConfig };
