const axios = require("axios");
const { sellToken, TRADE_CONFIG } = require("./trader");
const { addTradeHistory } = require("./api");

const positions = [];

async function savePositionToRailway(position) {
  try {
    const token = process.env.RAILWAY_TOKEN;
    const serviceId = process.env.RAILWAY_SERVICE_ID;

    if (!token || !serviceId) {
      process.env.CURRENT_POSITION = position ? JSON.stringify(position) : "{}";
      return;
    }

    const value = position ? JSON.stringify(position) : "{}";

    await axios.post(
      "https://backboard.railway.app/graphql/v2",
      {
        query: `
          mutation UpsertVariable($input: VariableUpsertInput!) {
            variableUpsert(input: $input)
          }
        `,
        variables: {
          input: {
            serviceId: serviceId,
            environmentId: process.env.RAILWAY_ENVIRONMENT_ID || "",
            name: "CURRENT_POSITION",
            value: value,
          },
        },
      },
      {
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    console.log("ポジションをRailwayに保存しました");
  } catch (error) {
    console.error("Railway保存エラー:", error.message);
    process.env.CURRENT_POSITION = position ? JSON.stringify(position) : "{}";
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
      console.log("ポジション復元: " + position.tokenMint.substring(0, 8) + "...");
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
  savePositionToRailway(position);
  console.log("ポジション追加: " + position.symbol);
}

function removePosition(tokenMint) {
  const index = positions.findIndex((p) => p.tokenMint === tokenMint);
  if (index !== -1) {
    positions.splice(index, 1);
    savePositionToRailway(null);
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
          { name: "🔗 TX", value: sellResult?.txid
            ? "[確認](https://solscan.io/tx/" + sellResult.txid + ")"
            : "なし", inline: false },
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
    console.log("保有時間: " + holdingMinutes.toFixed(1) + "分");

    // ポジションごとの利確・損切りライン
    const takeProfitLine = position.takeProfit || TRADE_CONFIG.TAKE_PROFIT_PERCENT;
    const stopLossLine = position.stopLoss || TRADE_CONFIG.STOP_LOSS_PERCENT;

    // 30分強制売却
    if (holdingMinutes >= 30) {
      console.log("30分経過 → 強制売却");
      const result = await sellToken(position, 0, "時間切れ");
      if (result) {
        await sendSellNotification(position, result, 0);
        addTradeHistory({
          symbol: position.symbol || "不明",
          type: "sell",
          amount: position.buyAmountUsd,
          profit: 0,
          reason: "時間切れ（30分）",
          txid: result.txid,
        });
      }
      removePosition(position.tokenMint);
      continue;
    }

    const pairData = await getCurrentPrice(position.tokenMint);
    if (!pairData) {
      console.log("価格取得失敗");
      continue;
    }

    const currentPrice = parseFloat(pairData.priceUsd || 0);
    const profitPercent = position.buyPrice > 0
      ? ((currentPrice - position.buyPrice) / position.buyPrice) * 100
      : 0;

    console.log("損益: " + profitPercent.toFixed(2) + "% | 利確: +" + takeProfitLine + "% | 損切り: " + stopLossLine + "%");

    // 利確
    if (profitPercent >= takeProfitLine) {
      console.log("利確! +" + profitPercent.toFixed(2) + "%");
      const result = await sellToken(position, currentPrice, "利確");
      if (result) {
        await sendSellNotification(position, result, profitPercent);
        const profitUsd = position.buyAmountUsd * profitPercent / 100;
        addTradeHistory({
          symbol: position.symbol || "不明",
          type: "sell",
          amount: position.buyAmountUsd,
          profit: parseFloat(profitUsd.toFixed(2)),
          reason: "利確 +" + profitPercent.toFixed(2) + "%",
          txid: result.txid,
        });
        removePosition(position.tokenMint);
      } else {
        position.retryCount = (position.retryCount || 0) + 1;
        console.log("売却失敗 リトライ" + position.retryCount + "/3");
        if (position.retryCount >= 3) removePosition(position.tokenMint);
      }
      continue;
    }

    // 損切り
    if (profitPercent <= stopLossLine) {
      console.log("損切り! " + profitPercent.toFixed(2) + "%");
      const result = await sellToken(position, currentPrice, "損切り");
      if (result) {
        await sendSellNotification(position, result, profitPercent);
        const profitUsd = position.buyAmountUsd * profitPercent / 100;
        addTradeHistory({
          symbol: position.symbol || "不明",
          type: "sell",
          amount: position.buyAmountUsd,
          profit: parseFloat(profitUsd.toFixed(2)),
          reason: "損切り " + profitPercent.toFixed(2) + "%",
          txid: result.txid,
        });
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

module.exports = { addPosition, removePosition, monitorPositions, positions, loadPositionFromEnv };
