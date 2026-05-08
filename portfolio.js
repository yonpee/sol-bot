const axios = require("axios");
const { sellToken, TRADE_CONFIG } = require("./trader");

// 起動時にRailway Variablesからポジションを復元
const positions = [];

function loadPositionFromEnv() {
  try {
    const saved = process.env.CURRENT_POSITION;
    if (!saved || saved === "{}") {
      console.log("保存済みポジションなし");
      return;
    }
    const position = JSON.parse(saved);
    if (position.tokenMint) {
      positions.push(position);
      console.log(`ポジション復元: ${position.tokenMint}`);
    }
  } catch (error) {
    console.error("ポジション復元エラー:", error.message);
  }
}

async function savePositionToEnv(position) {
  try {
    const railwayToken = process.env.RAILWAY_TOKEN;
    const serviceId = process.env.RAILWAY_SERVICE_ID;
    const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;

    if (!railwayToken || !serviceId || !environmentId) {
      console.log("Railway API未設定 → メモリのみ保存");
      return;
    }

    const value = position ? JSON.stringify(position) : "{}";

    await axios.post(
      "https://backboard.railway.app/graphql/v2",
      {
        query: `
          mutation {
            variableUpsert(input: {
              serviceId: "${serviceId}"
              environmentId: "${environmentId}"
              name: "CURRENT_POSITION"
              value: ${JSON.stringify(value)}
            })
          }
        `,
      },
      {
        headers: {
          Authorization: `Bearer ${railwayToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    console.log("ポジションをRailwayに保存しました");
  } catch (error) {
    console.error("Railway保存エラー:", error.message);
  }
}

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
      return parseFloat(current.liquidity?.usd || 0) > parseFloat(best.liquidity?.usd || 0)
        ? current : best;
    }, solanaPairs[0]);
    return parseFloat(bestPair.priceUsd);
  } catch (error) {
    console.error("価格取得エラー:", error.message);
    return null;
  }
}

function addPosition(tradeResult) {
  const position = {
    tokenMint: tradeResult.tokenMint,
    buyPrice: tradeResult.buyPrice || 0,
    tokenAmount: tradeResult.tokenAmount || 0,
    buyAmountUsd: tradeResult.buyAmountUsd,
    txid: tradeResult.txid,
    timestamp: tradeResult.timestamp,
    isPumpFun: tradeResult.isPumpFun || false,
    retryCount: 0,
  };
  positions.push(position);
  savePositionToEnv(position);
  console.log(`📝 ポジション追加: ${tradeResult.tokenMint}`);
  console.log(`   保有中ポジション数: ${positions.length}`);
}

function removePosition(tokenMint) {
  const index = positions.findIndex((p) => p.tokenMint === tokenMint);
  if (index !== -1) {
    positions.splice(index, 1);
    savePositionToEnv(null);
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
        { name: "🔗 TX", value: sellResult.txid
          ? `[確認する](https://solscan.io/tx/${sellResult.txid})`
          : "なし", inline: false },
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
    const holdingMinutes = (Date.now() - position.timestamp) / 1000 / 60;

    const currentPrice = await getCurrentPrice(position.tokenMint);

    // 価格取得失敗
    if (!currentPrice) {
      console.log(`⚠️ 価格取得失敗 (${holdingMinutes.toFixed(1)}分保有)`);
      // 30分以上保有していたら強制削除
      if (holdingMinutes >= 30) {
        console.log("30分経過 → ポジション強制削除");
        removePosition(position.tokenMint);
      }
      continue;
    }

    // 損益計算
    const profitPercent = position.buyPrice > 0
      ? ((currentPrice - position.buyPrice) / position.buyPrice) * 100
      : 0;

    console.log(`  📈 損益: ${profitPercent.toFixed(2)}% | 保有: ${holdingMinutes.toFixed(1)}分`);

    // 30分強制売却
    if (holdingMinutes >= 30) {
      console.log("⏰ 30分経過 → 強制売却");
      const sellResult = await sellToken(position, currentPrice, "時間切れ");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
      }
      removePosition(position.tokenMint);
      continue;
    }

    // 利確判定
    if (profitPercent >= TRADE_CONFIG.TAKE_PROFIT_PERCENT) {
      console.log(`🎯 利確！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "利確");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
        removePosition(position.tokenMint);
      } else {
        // 売却失敗 → リトライカウント増加
        position.retryCount = (position.retryCount || 0) + 1;
        console.log(`売却失敗 → リトライ ${position.retryCount}/3`);
        if (position.retryCount >= 3) {
          console.log("3回失敗 → ポジション削除");
          removePosition(position.tokenMint);
        }
      }
      continue;
    }

    // 損切り判定
    if (profitPercent <= TRADE_CONFIG.STOP_LOSS_PERCENT) {
      console.log(`🔴 損切り！${profitPercent.toFixed(2)}%`);
      const sellResult = await sellToken(position, currentPrice, "損切り");
      if (sellResult) {
        await sendSellNotification(position, sellResult, profitPercent);
      } else {
        position.retryCount = (position.retryCount || 0) + 1;
        console.log(`売却失敗 → リトライ ${position.retryCount}/3`);
        if (position.retryCount >= 3) {
          console.log("3回失敗 → ポジション削除");
          removePosition(position.tokenMint);
          return;
        }
        return;
      }
      removePosition(position.tokenMint);
    }
  }
}

module.exports = { addPosition, monitorPositions, positions, loadPositionFromEnv };
