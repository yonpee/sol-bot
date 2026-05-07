const axios = require("axios");
const { sellToken, TRADE_CONFIG } = require("./trader");

// 起動時にポジションをリセット
const positions = [];

async function getCurrentPrice(tokenMint) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;
    const bestPair = data.pairs.reduce((best, current) => {
      const bestLiq = parseFloat(best.liquidity?.usd || 0);
      const currLiq = parseFloat(current.liquidity?.usd || 0);
      return currLiq > bestLiq ? current : best;
    });
    return parseFloat(bestPair.priceUsd);
  } catch (error) {
    console.error("価格取得エラー:", error.message);
    return null;
  }
}

function addPosition(tradeResult) {
  positions.push({
    tokenMint: tradeResult.tokenMint,
    buyPrice: tradeResult.buyPrice,
    tokenAmount: tradeResult.tokenAmount,
    buyAmountUsd: tradeResult.buyAmountUsd,
    txid: tradeResult.txid,
    timestamp: tradeResult.timestamp,
  });
  console.log(`📝 ポジション追加: ${tradeResult.tokenMint}`);
  console.log(`   保有中ポジション数: ${positions.length}`);
}

function removePosition(tokenMint) {
  const index = positions.findIndex((p) => p.tokenMint === tokenMint);
  if (index !== -1) {
    positions.splice(index, 1);
    console.log(`🗑️ ポジション削除: ${tokenMint}`);
  }
}

async function sendSellNotification(position, sellResult, profitPercent) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const isProfit = profitPercent >= 0;
  const emoji = isProfit ? "💰" : "🔴";
  const color = isProfit ? 0x00ff00 : 0xff0000;
  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date());

  const payload = {
    content: `${emoji} **自動${sellResult.reason}！**`,
    embeds: [{
      title: `${isProfit ? "💰 利確" : "🔴 損切り"} 完了`,
      color,
      fields: [
        { name: "📊 損益", value: `**${profitPercent.toFixed(2)}%**`, inline: true },
        { name: "💵 買値", value: `$${position.buyPrice.toFixed(8)}`, inline: true },
        { name: "💵 売値", value: `$${sellResult.currentPrice.toFixed(8)}`, inline: true },
        { name: "💰 投資額", value: `$${position.buyAmountUsd}`, inline: true },
        { name: "🔗 TX", value: `[確認する](https://solscan.io/tx/${sellResult.txid})`, inline: false },
      ],
      footer: { text: `Solana Trade Bot | ${jstTime} JST` },
    }],
  };

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (error) {
    console.error("売却通知エラー:", error.message);
  }
}

async function monitorPositions() {
  if (positions.length === 0) {
    console.log("📊 保有ポジションなし");
    return;
  }

  console.log(`👀 ポジション監視中... ${positions.length}件`);

  for (const position of [...positions]) {
    const currentPrice = await getCurrentPrice(position.tokenMint);
    if (!currentPrice) {
      console.log(`⚠️ 価格取得失敗 → ポジション削除`);
      removePosition(position.tokenMint);
      continue;
    }

    const profitPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
    console.log(`  📈 ${position.tokenMint.substring(0, 8)}...: ${profitPercent.toFixed(2)}%`);

    if (profitPercent >= TRADE_CONFIG.TAKE_PROFIT_PERCENT) {
      console.log(`🎯 利確条件達成！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "利確");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
        removePosition(position.tokenMint);
      } else {
        console.log("売り失敗 → 流動性不足のためポジション削除");
        removePosition(position.tokenMint);
      }
      continue;
    }

    if (profitPercent <= TRADE_CONFIG.STOP_LOSS_PERCENT) {
      console.log(`🔴 損切り条件達成！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "損切り");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
      } else {
        console.log("売り失敗 → 流動性不足のためポジション削除");
      }
      removePosition(position.tokenMint);
    }
  }
}

module.exports = { addPosition, monitorPositions, positions };
