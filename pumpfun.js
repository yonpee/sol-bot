const WebSocket = require("ws");
const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const PUMPFUN_CONFIG = {
  MAX_POSITIONS: 3,
  MIN_SOL_LIQUIDITY: 5,
  TAKE_PROFIT_PERCENT: 30,
  STOP_LOSS_PERCENT: -20,
};

let ws = null;
let solPriceUsd = 0;
const purchasedTokens = new Set();

async function sendNotification(token, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const payload = {
    content: "🆕 **PumpFun新規上場！自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${token.name} ($${token.symbol})`,
      description: token.description?.substring(0, 100) || "新規上場コイン",
      color: 0x00ffff,
      fields: [
        { name: "📝 名前", value: token.name || "不明", inline: true },
        { name: "💎 シンボル", value: `$${token.symbol || "?"}`, inline: true },
        { name: "💵 購入金額", value: tradeResult ? "$5" : "失敗", inline: true },
        { name: "🎯 利確", value: `+${PUMPFUN_CONFIG.TAKE_PROFIT_PERCENT}%`, inline: true },
        { name: "🔴 損切り", value: `${PUMPFUN_CONFIG.STOP_LOSS_PERCENT}%`, inline: true },
        { name: "🔗 PumpFun", value: `[見る](https://pump.fun/${token.mint})`, inline: false },
        tradeResult
          ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "購入結果", value: "失敗", inline: false },
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
  console.log(`🆕 新規上場検知: ${token.name} ($${token.symbol})`);

  if (positions.length >= PUMPFUN_CONFIG.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  if (purchasedTokens.has(token.mint)) {
    console.log("購入済みのトークンです");
    return;
  }

  if (!token.mint) {
    console.log("ミントアドレスなし → スキップ");
    return;
  }

  console.log(`購入試行: ${token.mint}`);
  const tradeResult = await buyToken(token.mint, solPriceUsd);

  if (tradeResult) {
    addPosition(tradeResult);
    purchasedTokens.add(token.mint);
    console.log(`✅ 購入成功: ${token.symbol}`);
  } else {
    console.log(`❌ 購入失敗: ${token.symbol}`);
  }

  await sendNotification(token, tradeResult);
}

function connectPumpFun() {
  console.log("🔌 PumpFun WebSocketに接続中...");

  ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    console.log("✅ PumpFun WebSocket接続成功！");

    // 新規トークンの監視を開始
    ws.send(JSON.stringify({
      method: "subscribeNewToken",
    }));

    console.log("👀 新規上場コインの監視開始！");
  });

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      // 新規トークンイベント
      if (message.txType === "create") {
        await handleNewToken({
          mint: message.mint,
          name: message.name,
          symbol: message.symbol,
          description: message.description,
        });
      }
    } catch (error) {
      console.error("メッセージ処理エラー:", error.message);
    }
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocketエラー:", error.message);
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket切断 → 5秒後に再接続...");
    setTimeout(connectPumpFun, 5000);
  });
}

function setSolPrice(price) {
  solPriceUsd = price;
}

module.exports = { connectPumpFun, setSolPrice };
