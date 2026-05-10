const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());
app.options("*", cors());

let tradeHistory = [];
let botConfig = {
  takeProfit: 8,
  stopLoss: -4,
  buyAmount: 10,
  minChange5m: 1,
  active: true,
};

function getBotConfig() {
  return botConfig;
}

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

app.get("/history", async (req, res) => {
  try {
    const { loadHistoryFromSupabase } = require("./portfolio");
    const supabaseHistory = await loadHistoryFromSupabase();
    if (supabaseHistory.length > 0) {
      const formatted = supabaseHistory.map(h => ({
        id: h.id,
        symbol: h.symbol,
        type: h.type,
        amount: parseFloat(h.amount || 0),
        profit: h.profit !== null ? parseFloat(h.profit) : null,
        reason: h.reason,
        txid: h.txid,
        timestamp: new Date(h.created_at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }),
      }));
      res.json({ history: formatted });
    } else {
      res.json({ history: tradeHistory });
    }
  } catch (e) {
    res.json({ history: tradeHistory });
  }
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

app.post("/manual-buy", async (req, res) => {
  try {
    const { tokenAddress, symbol, takeProfit, stopLoss, amount } = req.body;
    if (!tokenAddress) {
      return res.status(400).json({ success: false, error: "tokenAddressが必要です" });
    }

    const { getSolanaPrice } = require("./priceChecker");
    const { buyToken } = require("./trader");
    const { addPosition, positions } = require("./portfolio");

    if (positions.length >= 1) {
      return res.status(400).json({ success: false, error: "既にポジションがあります" });
    }

    const priceData = await getSolanaPrice();
    if (!priceData) {
      return res.status(500).json({ success: false, error: "SOL価格取得失敗" });
    }

    // 手動購入時の設定を一時的に上書き
    const prevAmount = botConfig.buyAmount;
    const prevTakeProfit = botConfig.takeProfit;
    const prevStopLoss = botConfig.stopLoss;
    if (amount) botConfig.buyAmount = parseFloat(amount);
    if (takeProfit) botConfig.takeProfit = parseFloat(takeProfit);
    if (stopLoss) botConfig.stopLoss = parseFloat(stopLoss);

    console.log("手動購入開始:", tokenAddress);
    const tradeResult = await buyToken(tokenAddress, priceData.price, false);

    // 設定を元に戻す
    botConfig.buyAmount = prevAmount;
    botConfig.takeProfit = prevTakeProfit;
    botConfig.stopLoss = prevStopLoss;

    if (!tradeResult) {
      return res.status(500).json({ success: false, error: "購入失敗（ルートなしまたは残高不足）" });
    }

    tradeResult.symbol = symbol || tokenAddress.substring(0, 8);
    tradeResult.takeProfit = takeProfit || botConfig.takeProfit;
    tradeResult.stopLoss = stopLoss || botConfig.stopLoss;

    addPosition(tradeResult);
    addTradeHistory({
      symbol: tradeResult.symbol,
      type: "buy",
      amount: tradeResult.buyAmountUsd,
      profit: null,
      reason: "手動購入",
      txid: tradeResult.txid,
    });

    const { saveHistoryToSupabase } = require("./portfolio");
    await saveHistoryToSupabase({
      symbol: tradeResult.symbol,
      type: "buy",
      amount: tradeResult.buyAmountUsd,
      profit: null,
      reason: "手動購入",
      txid: tradeResult.txid,
    });

    console.log("手動購入成功:", tradeResult.txid);
    res.json({ success: true, txid: tradeResult.txid });

  } catch (e) {
    console.error("手動購入エラー:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/manual-sell", async (req, res) => {
  try {
    const { positions, removePosition } = require("./portfolio");
    const { sellToken } = require("./trader");

    if (positions.length === 0) {
      return res.status(400).json({ success: false, error: "ポジションがありません" });
    }

    const position = positions[0];
    console.log("手動売却開始:", position.tokenMint);

    const result = await sellToken(position, 0, "手動売却");

    if (!result) {
      return res.status(500).json({ success: false, error: "売却失敗（流動性不足の可能性）" });
    }

    addTradeHistory({
      symbol: position.symbol || "不明",
      type: "sell",
      amount: position.buyAmountUsd,
      profit: null,
      reason: "手動売却",
      txid: result.txid,
    });

    const { saveHistoryToSupabase } = require("./portfolio");
    await saveHistoryToSupabase({
      symbol: position.symbol || "不明",
      type: "sell",
      amount: position.buyAmountUsd,
      profit: null,
      reason: "手動売却",
      txid: result.txid,
    });

    removePosition(position.tokenMint);

    console.log("手動売却成功:", result.txid);
    res.json({ success: true, txid: result.txid });

  } catch (e) {
    console.error("手動売却エラー:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

function startApi() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log("API サーバー起動: port " + PORT);
  });
}

module.exports = { startApi, addTradeHistory, botConfig, getBotConfig };
