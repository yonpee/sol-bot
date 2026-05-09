const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { sellToken, TRADE_CONFIG } = require("./trader");
const { addTradeHistory } = require("./api");

const positions = [];

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function savePositionToSupabase(position) {
  const supabase = getSupabase();
  if (!supabase) {
    console.log("Supabase未設定 → スキップ");
    return;
  }
  try {
    await supabase.from("positions").delete().neq("id", 0);
    if (position) {
      const { error } = await supabase.from("positions").insert([{
        token_mint: position.tokenMint,
        symbol: position.symbol || "不明",
        buy_price: position.buyPrice,
        token_amount: position.tokenAmount,
        buy_amount_usd: position.buyAmountUsd,
        txid: position.txid,
        take_profit: position.takeProfit || TRADE_CONFIG.TAKE_PROFIT_PERCENT,
        stop_loss: position.stopLoss || TRADE_CONFIG.STOP_LOSS_PERCENT,
        timestamp: position.timestamp,
      }]);
      if (error) throw error;
      console.log("Supabaseにポジション保存完了");
    } else {
      console.log("Supabaseのポジションをクリア");
    }
  } catch (error) {
    console.error("Supabase保存エラー:", error.message);
  }
}

async function saveHistoryToSupabase(trade) {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("trade_history").insert([{
      symbol: trade.symbol,
      type: trade.type,
      amount: trade.amount,
      profit: trade.profit,
      reason: trade.reason,
      txid: trade.txid,
    }]);
  } catch (error) {
    console.error("Supabase履歴保存エラー:", error.message);
  }
}

async function loadPositionFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    loadPositionFromEnv();
    return;
  }
  try {
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      const row = data[0];
      const position = {
        tokenMint: row.token_mint,
        symbol: row.symbol,
        buyPrice: parseFloat(row.buy_price),
        tokenAmount: parseFloat(row.token_amount),
        buyAmountUsd: parseFloat(row.buy_amount_usd),
        txid: row.txid,
        takeProfit: parseFloat(row.take_profit),
        stopLoss: parseFloat(row.stop_loss),
        timestamp: parseInt(row.timestamp),
        retryCount: 0,
      };
      positions.push(position);
      console.log("Supabaseからポジション復元: " + position.symbol);
    } else {
      console.log("保存済みポジションなし");
    }
  } catch (error) {
    console.error("Supabase復元エラー:", error.message);
    loadPositionFromEnv();
  }
}

async function loadHistoryFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("trade_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Supabase履歴取得エラー:", error.message);
    return [];
  }
}

function loadPositionFromEnv() {
  try {
    const saved = process.env.CURRENT_POSITION;
    if (!saved || saved === "{}") {
      console.log("保存済みポジションなし");
      return;
    }
    const position = JSON.parse(saved);
    if (position && position.tokenMint) {
      positions.push(position);
      console.log("envからポジション復元: " + position.tokenMint.substring(0, 8) + "...");
    }
  } catch (error) {
    console.error("ポジション復元エラー:", error.message);
  }
}

async function getCurrentPrice(tokenMint) {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/tokens/" + tokenMint,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;
    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;
    return solanaPairs.reduce((best, current) => {
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best?.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);
  } catch (error) {
    console.error("価格取得エラー:", error.message);
    return null;
  }
}

function addPosition(tradeResult) {
  if (positions.length >= 1) {
    console.log("既にポジションあり → 追加しない");
    return;
  }
  const position = {
    tokenMint: tradeResult.tokenMint,
    buyPrice: tradeResult.buyPrice || 0,
    tokenAmount: tradeResult.tokenAmount || 0,
    buyAmountUsd: tradeResult.buyAmountUsd,
    txid: tradeResult.txid,
    symbol: tradeResult.symbol || "不明",
    timestamp: tradeResult.timestamp,
    takeProfit: tradeResult.takeProfit || TRADE_CONFIG.TAKE_PROFIT_PERCENT,
    stopLoss: tradeResult.stopLoss || TRADE_CONFIG.STOP_LOSS_PERCENT,
    retryCount: 0,
  };
  positions.push(position);
  savePositionToSupabase(position);
  console.log("ポジション追加: " + position.symbol);
}

function removePosition(tokenMint) {
  const index = positions.findIndex((p) => p.tokenMint === tokenMint);
  if (index !== -1) {
    positions.splice(index, 1);
    savePositionToSupabase(null);
    console.log("ポジション削除完了");
  }
}

async function sendSellNotification(position, sellResult, profitPercent) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  const isProfit = profitPercent >= 0;
  const jstTime = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" });
  try {
    await axios.post(webhookUrl, {
      content: isProfit ? "💰 **利確！**" : "🔴 **損切り！**",
      embeds: [{
        title: isProfit ? "💰 利確完了" : "🔴 損切り完了",
        color: isProfit ? 0x00ff00 : 0xff0000,
        fields: [
          { name: "📊 損益", value: "**" + profitPercent.toFixed(2) + "%**", inline: true },
          { name: "💰 投資額", value: "$" + position.buyAmountUsd, inline: true },
          { name: "🔗 TX", value: sellResult?.txid ? "[確認](https://solscan.io/tx/" + sellResult.txid + ")" : "なし", inline: false },
        ],
        footer: { text: jstTime },
      }],
    }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
  } catch (error) {
    console.error("売却通知エラー:", error.message);
  }
}

async function monitorPositions() {
  if (positions.length === 0) {
    console.log("保有ポジションなし");
    return;
  }

  console.log("ポジション監視中... " + positions.length + "件");

  for (const position of [...positions]) {
    const holdingMinutes = (Date.now() - position.timestamp) / 1000 / 60;
    const takeProfitLine = position.takeProfit || TRADE_CONFIG.TAKE_PROFIT_PERCENT;
    const stopLossLine = position.stopLoss || TRADE_CONFIG.STOP_LOSS_PERCENT;

    if (holdingMinutes >= 30) {
      console.log("30分経過 → 強制売却");
      const result = await sellToken(position, 0, "時間切れ");
      if (result) {
        await sendSellNotification(position, result, 0);
        await saveHistoryToSupabase({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: 0, reason: "時間切れ", txid: result.txid });
        addTradeHistory({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: 0, reason: "時間切れ（30分）", txid: result.txid });
      }
      removePosition(position.tokenMint);
      continue;
    }

    const pairData = await getCurrentPrice(position.tokenMint);
    if (!pairData) { console.log("価格取得失敗"); continue; }

    const currentPrice = parseFloat(pairData.priceUsd || 0);
    const profitPercent = position.buyPrice > 0
      ? ((currentPrice - position.buyPrice) / position.buyPrice) * 100
      : 0;

    console.log("損益: " + profitPercent.toFixed(2) + "% | 利確: +" + takeProfitLine + "% | 損切り: " + stopLossLine + "%");

    if (profitPercent >= takeProfitLine) {
      console.log("利確! +" + profitPercent.toFixed(2) + "%");
      const result = await sellToken(position, currentPrice, "利確");
      if (result) {
        await sendSellNotification(position, result, profitPercent);
        const profitUsd = parseFloat((position.buyAmountUsd * profitPercent / 100).toFixed(2));
        await saveHistoryToSupabase({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: profitUsd, reason: "利確 +" + profitPercent.toFixed(2) + "%", txid: result.txid });
        addTradeHistory({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: profitUsd, reason: "利確 +" + profitPercent.toFixed(2) + "%", txid: result.txid });
        removePosition(position.tokenMint);
      } else {
        position.retryCount = (position.retryCount || 0) + 1;
        console.log("売却失敗 リトライ" + position.retryCount + "/3");
        if (position.retryCount >= 3) removePosition(position.tokenMint);
      }
      continue;
    }

    if (profitPercent <= stopLossLine) {
      console.log("損切り! " + profitPercent.toFixed(2) + "%");
      const result = await sellToken(position, currentPrice, "損切り");
      if (result) {
        await sendSellNotification(position, result, profitPercent);
        const profitUsd = parseFloat((position.buyAmountUsd * profitPercent / 100).toFixed(2));
        await saveHistoryToSupabase({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: profitUsd, reason: "損切り " + profitPercent.toFixed(2) + "%", txid: result.txid });
        addTradeHistory({ symbol: position.symbol, type: "sell", amount: position.buyAmountUsd, profit: profitUsd, reason: "損切り " + profitPercent.toFixed(2) + "%", txid: result.txid });
      } else {
        position.retryCount = (position.retryCount || 0) + 1;
        console.log("売却失敗 リトライ" + position.retryCount + "/3");
        if (position.retryCount >= 3) removePosition(position.tokenMint);
        return;
      }
      removePosition(position.tokenMint);
    }
  }
}

module.exports = { addPosition, removePosition, monitorPositions, positions, loadPositionFromSupabase, loadPositionFromEnv, loadHistoryFromSupabase };
