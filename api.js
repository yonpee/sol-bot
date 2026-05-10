const express = require("express");
const cors = require("cors");
const { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: ws } });
}

async function loadConfigFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from("bot_config")
      .select("*")
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      const row = data[0];
      botConfig.takeProfit = parseFloat(row.take_profit);
      botConfig.stopLoss = parseFloat(row.stop_loss);
      botConfig.buyAmount = parseFloat(row.buy_amount);
      botConfig.minChange5m = parseFloat(row.min_change_5m);
      botConfig.active = row.active;
      console.log("Supabaseから設定復元: 購入金額$" + botConfig.buyAmount);
    }
  } catch (error) {
    console.error("設定復元エラー:", error.message);
  }
}

async function saveConfigToSupabase() {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("bot_config")
      .update({
        take_profit: botConfig.takeProfit,
        stop_loss: botConfig.stopLoss,
        buy_amount: botConfig.buyAmount,
        min_change_5m: botConfig.minChange5m,
        active: botConfig.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw error;
    console.log("設定をSupabaseに保存完了");
  } catch (error) {
    console.error("設定保存エラー:", error.message);
  }
}

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

async function getWalletBalance() {
  try {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) return null;
    const secretKey = bs58.decode(privateKey);
    const wallet = Keypair.fromSecretKey(secretKey);
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");
    const balance = await connection.getBalance(wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("残高取得エラー:", error.message);
    return null;
  }
}

app.get("/health", function(req, res) {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/status", async function(req, res) {
  const { positions } = require("./portfolio");
  const solBalance = await getWalletBalance();
  res.json({
    active: botConfig.active,
    positions: positions,
    positionCount: positions.length,
    config: botConfig,
    solBalance: solBalance,
  });
});

app.get("/history", async function(req, res) {
  try {
    const { loadHistoryFromSupabase } = require("./portfolio");
    const supabaseHistory = await loadHistoryFromSupabase();
    if (supabaseHistory.length > 0) {
      const formatted = supabaseHistory.map(function(h) {
        return {
          id: h.id,
          symbol: h.symbol,
          type: h.type,
          amount: parseFloat(h.amount || 0),
          profit: h.profit !== null ? parseFloat(h.profit) : null,
          reason: h.reason,
          txid: h.txid,
          timestamp: new Date(h.created_at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }),
        };
      });
      res.json({ history: formatted });
    } else {
      res.json({ history: tradeHistory });
    }
  } catch (e) {
    res.json({ history: tradeHistory });
  }
});

app.post("/config", async function(req, res) {
  const { takeProfit, stopLoss, buyAmount, minChange5m, active } = req.body;
  if (takeProfit !== undefined) botConfig.takeProfit = parseFloat(takeProfit);
  if (stopLoss !== undefined) botConfig.stopLoss = parseFloat(stopLoss);
  if (buyAmount !== undefined) botConfig.buyAmount = parseFloat(buyAmount);
  if (minChange5m !== undefined) botConfig.minChange5m = parseFloat(minChange5m);
  if (active !== undefined) botConfig.active = active;
  console.log("設定変更:", JSON.stringify(botConfig));
  await saveConfigToSupabase();
  res.json({ success: true, config: botConfig });
});

app.post("/manual-buy", async function(req, res) {
  try {
    const { tokenAddress, symbol, takeProfit, stopLoss, amount } = req.body;
    if (!tokenAddress) {
      return res.status(400).json({ success: false, error: "tokenAddressが必要です" });
    }

    const { getSolanaPrice } = require("./priceChecker");
    const { buyToken } = require("./trader");
    const { addPosition, positions } = require("./portfolio");

    const alreadyHas = positions.some(function(p) { return p.tokenMint === tokenAddress; });
    if (alreadyHas) {
      return res.status(400).json({ success: false, error: "既にこのコインのポジションがあります" });
    }

    const priceData = await getSolanaPrice();
    if (!priceData) {
      return res.status(500).json({ success: false, error: "SOL価格取得失敗" });
    }

    const prevAmount = botConfig.buyAmount;
    const prevTakeProfit = botConfig.takeProfit;
    const prevStopLoss = botConfig.stopLoss;
    if (amount) botConfig.buyAmount = parseFloat(amount);
    if (takeProfit) botConfig.takeProfit = parseFloat(takeProfit);
    if (stopLoss) botConfig.stopLoss = parseFloat(stopLoss);

    console.log("手動購入開始:", tokenAddress);
    const tradeResult = await buyToken(tokenAddress, priceData.price, false);

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

app.post("/manual-sell", async function(req, res) {
  try {
    const { positions, removePosition } = require("./portfolio");
    const { sellToken } = require("./trader");
    const { tokenMint } = req.body;

    if (positions.length === 0) {
      return res.status(400).json({ success: false, error: "ポジションがありません" });
    }

    const position = tokenMint
      ? positions.find(function(p) { return p.tokenMint === tokenMint; })
      : positions[0];

    if (!position) {
      return res.status(400).json({ success: false, error: "指定のポジションが見つかりません" });
    }

    console.log("手動売却開始:", position.tokenMint);
    const result = await sellToken(position, 0, "手動売却");

    if (!result) {
      return res.status(500).json({ success: false, error: "売却失敗" });
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

async function start​​​​​​​​​​​​​​​​
