const WebSocket = require("ws");
const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const PUMPFUN_CONFIG = {
  MAX_POSITIONS: 1,
};

let ws = null;
let solPriceUsd = 0;
const purchasedTokens = new Set();
let isProcessing = false;

async function sendNotification(token, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const payload = {
    content: "🆕 **PumpFun新規上場！** @everyone",
    embeds: [{
      title: `🚀 ${token.name} ($${token.symbol})`,
      color: 0x00ffff,
      fields: [
        { name: "💎 シンボル", value: `$${token.symbol || "?"}`, inline: true },
        { name: "💵 購入", value: tradeResult ? "成功 $5" : "失敗", inline: true },
        { name: "🔗 PumpFun", value: `[見る](https://pump.fun/${token.mint})`, inline: false },
        tradeResult
          ? { name: "🔗 TX", value: `[確認](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "結果", value: "失敗", inline: false },
      ],
      footer: { text: `PumpFun Bot | ${jstTime} JST` },
    }],
  };

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (error) {
    console.error("通知エラー:", error.message);
  }
}

async function handleNewToken(token) {
  if (isProcessing) return;
  if (positions.length >= PUMPFUN_CONFIG.MAX_POSITIONS) return;
  if (purchasedTokens.has(token.mint)) return;
  if (!token.mint) return;
  if (!solPriceUsd || solPriceUsd === 0) return;

  isProcessing = true;
  console.log(`🆕 ${token.name} ($${token.symbol})`);

  try {
    const tradeResult = await buyToken(token.mint, solPriceUsd, true);

    if (tradeResult) {
      addPosition(tradeResult);
      purchasedTokens.add(token.mint);
      console.log(`✅ 購入成功: ${token.symbol}`);
    } else {
      console.log(`❌ 購入失敗: ${token.symbol}`);
    }

    await sendNotification(token, tradeResult);
  } finally {
    isProcessing = false;
  }
}

function connectPumpFun() {
  console.log("🔌 PumpFun接続中...");

  ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    console.log("✅ PumpFun接続成功！");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
  });

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.txType === "create") {
        await handleNewToken({
          mint: message.mint,
          name: message.name,
          symbol: message.symbol,
        });
      }
    } catch (error) {
      // エラーを無視して続行
    }
  });

  ws.on("error", () => {});

  ws.on("close", () => {
    console.log("再接続中...");
    setTimeout(connectPumpFun, 10000);
  });
}

function setSolPrice(price) {
  solPriceUsd = price;
}

module.exports = { connectPumpFun, setSolPrice };
