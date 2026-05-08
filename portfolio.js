const axios = require("axios");
const { sellToken, TRADE_CONFIG } = require("./trader");

const positions = [];

async function getCurrentPrice(tokenMint) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
      { timeout: 10000 }
    );
    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return null;

    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) return null;

    const bestPair = solanaPairs.reduce((best, current) => {
      const bestLiq = parseFloat(best?.liquidity?.usd || 0);
      const currLiq = parseFloat(current.liquidity?.usd || 0);
      return currLiq > bestLiq ? current : best;
    }, solanaPairs[0]);

    return parseFloat(bestPair.priceUsd);
  } catch (error) {
    console.error("価格取得エラー:", error.message);
    return null;
  }
}

function addPosition(tradeResult) {
  positions.push({
    tokenMint: tradeResult.tokenMint,
    buyPrice: tradeResult.buyPrice || 0,
    tokenAmount: tradeResult.tokenAmount || 0,
    buyAmountUsd: tradeResult.buyAmountUsd,
    txid: tradeResult.txid,
    timestamp: tradeResult.timestamp,
    isPumpFun: tradeResult.isPumpFun || false,
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
        { name: "💰 投資額", value: `$${position.buyAmountUsd}`, inline: true },
        { name: "🔗 TX", value: sellResult.txid ? `[確認する](https://solscan.io/tx/${sellResult.txid})` : "なし", inline: false },
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
    // PumpFunコインは時間ベースで管理
    if (position.isPumpFun) {
      const holdingMinutes = (Date.now() - position.timestamp) / 1000 / 60;
      console.log(`  ⏱️ ${position.tokenMint.substring(0, 8)}... 保有時間: ${holdingMinutes.toFixed(1)}分`);

      // 30分経過したら強制売却
      if (holdingMinutes >= 30) {
        console.log(`⏰ 30分経過 → 強制売却`);
        const sellResult = await sellToken(position, 0, "時間切れ");
        if (sellResult) {
          await sendSellNotification(position, sellResult, 0);
        }
        removePosition(position.tokenMint);
        continue;
      }

      // 価格が取得できる場合は損益チェック
      const currentPrice = await getCurrentPrice(position.tokenMint);
      if (currentPrice && position.buyPrice > 0) {
        const profitPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
        console.log(`  📈 損益: ${profitPercent.toFixed(2)}%`);

        if (profitPercent >= TRADE_CONFIG.TAKE_PROFIT_PERCENT) {
          console.log(`🎯 利確！${profitPercent.toFixed(2)}%`);
          const sellResult = await sellToken(position, currentPrice, "利確");
          if (sellResult) {
            await sendSellNotification(position, sellResult, profitPercent);
          }
          removePosition(position.tokenMint);
        } else if (profitPercent <= TRADE_CONFIG.STOP_LOSS_PERCENT) {
          console.log(`🔴 損切り！${profitPercent.toFixed(2)}%`);
          const sellResult = await sellToken(position, currentPrice, "損切り");
          if (sellResult) {
            await sendSellNotification(position, sellResult, profitPercent);
          }
          removePosition(position.tokenMint);
        }
      }
      continue;
    }

    // 通常コインの処理
    const currentPrice = await getCurrentPrice(position.tokenMint);
    if (!currentPrice) {
      console.log(`⚠️ 価格取得失敗 → スキップ`);
      continue;
    }

    const profitPercent = position.buyPrice > 0
      ? ((currentPrice - position.buyPrice) / position.buyPrice) * 100
      : 0;

    console.log(`  📈 ${position.tokenMint.substring(0, 8)}...: ${profitPercent.toFixed(2)}%`);

    if (profitPercent >= TRADE_CONFIG.TAKE_PROFIT_PERCENT) {
      console.log(`🎯 利確！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "利確");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
        removePosition(position.tokenMint);
      } else {
        console.log("売り失敗 → 次回再試行");
      }
    } else if (profitPercent <= TRADE_CONFIG.STOP_LOSS_PERCENT) {
      console.log(`🔴 損切り！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "損切り");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
      }
      removePosition(position.tokenMint);
    }
  }
}

module.exports = { addPosition, monitorPositions, positions };
