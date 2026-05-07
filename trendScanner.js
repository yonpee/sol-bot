const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

// JUP専用設定
const JUP = {
  symbol: "JUP",
  address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

const CONFIG = {
  BUY_THRESHOLD: 3,    // 5分で+3%以上上昇したら買う
  MAX_POSITIONS: 3,    // 最大3ポジションまで
  CHECK_COOLDOWN: 0,   // クールダウンなし
};

// 価格履歴（短期トレンド分析用）
const priceHistory = [];
let lastBuyPrice = null;
let positionCount = 0;

async function getJupPrice() {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${JUP.address}`,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;

    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;

    return solanaPairs.reduce((best, current) => {
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);
  } catch (error) {
    console.error("JUP価格取得エラー:", error.message);
    return null;
  }
}

async function sendNotification(pair, type, tradeResult, profitPercent) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const price = parseFloat(pair.priceUsd || 0);
  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const liquidity = parseFloat(pair.liquidity?.usd || 0);
  const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;

  let title, color, content;

  if (type === "buy") {
    title = "🛒 JUP 自動購入！";
    color = 0x00ff00;
    content = "📈 **JUP購入シグナル！** @everyone";
  } else if (type === "profit") {
    title = "💰 JUP 利確成功！";
    color = 0xffd700;
    content = "💰 **JUP利確！** @everyone";
  } else {
    title = "🔴 JUP 損切り";
    color = 0xff0000;
    content = "🔴 **JUP損切り** @everyone";
  }

  const fields = [
    { name: "💰 現在価格", value: `$${price.toFixed(6)}`, inline: true },
    { name: "📈 5分変化", value: `${priceChange5m.toFixed(2)}%`, inline: true },
    { name: "💧 流動性", value: `$${(liquidity / 1000000).toFixed(2)}M`, inline: true },
  ];

  if (type === "buy") {
    fields.push(
      { name: "💵 購入金額", value: tradeResult ? "$5" : "失敗", inline: true },
      { name: "🎯 利確目標", value: `+10%`, inline: true },
      { name: "🔴 損切り", value: `-30%`, inline: true },
    );
    if (tradeResult) {
      fields.push({ name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false });
    }
  } else {
    fields.push(
      { name: "📊 損益", value: `**${profitPercent?.toFixed(2)}%**`, inline: true },
      { name: "🔗 TX", value: tradeResult ? `[確認する](https://solscan.io/tx/${tradeResult.txid})` : "失敗", inline: false },
    );
  }

  fields.push({ name: "🔗 DexScreener", value: `[チャートを見る](${dexLink})`, inline: false });

  const payload = {
    content,
    embeds: [{
      title,
      color,
      fields,
      footer: { text: `JUP専用Bot | ${jstTime} JST` },
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

async function checkTrends(solPriceUsd) {
  console.log("📈 JUP監視中...");

  const pair = await getJupPrice();
  if (!pair) {
    console.log("JUP価格取得失敗");
    return;
  }

  const price = parseFloat(pair.priceUsd || 0);
  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);

  console.log(`JUP: $${price.toFixed(6)} | 5m: ${priceChange5m.toFixed(2)}% | 1h: ${priceChange1h.toFixed(2)}%`);

  // 価格履歴に追加
  priceHistory.push({ price, timestamp: Date.now() });
  if (priceHistory.length > 20) priceHistory.shift();

  // 購入判定
  if (positions.length < CONFIG.MAX_POSITIONS) {
    if (priceChange5m >= CONFIG.BUY_THRESHOLD) {
      console.log(`🎯 購入シグナル! +${priceChange5m.toFixed(2)}%`);

      const tradeResult = await buyToken(JUP.address, solPriceUsd);

      if (tradeResult) {
        addPosition(tradeResult);
        lastBuyPrice = price;
        positionCount++;
        console.log(`✅ JUP購入成功! ポジション: ${positions.length}件`);
      }

      await sendNotification(pair, "buy", tradeResult, null);
    } else {
      console.log(`待機中... (購入条件: +${CONFIG.BUY_THRESHOLD}% | 現在: ${priceChange5m.toFixed(2)}%)`);
    }
  } else {
    console.log(`最大ポジション数(${CONFIG.MAX_POSITIONS})に達しています`);
  }
}

module.exports = { checkTrends };
