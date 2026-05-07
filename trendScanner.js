const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";

const LISTING_CONFIG = {
  NEW_LISTING_MINUTES: 30,
  MIN_LIQUIDITY_USD: 5000,
  MAX_POSITIONS: 1,
  CHAINS: ["solana"],
};

const purchasedTokens = new Set();

async function getNewListings() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { timeout: 10000, headers: { "User-Agent": "SolanaBot/1.0" } }
    );

    const data = response.data;
    if (!data || data.length === 0) return [];

    console.log(`取得トークン数: ${data.length}`);

    const now = Date.now();
    const cutoffTime = LISTING_CONFIG.NEW_LISTING_MINUTES * 60 * 1000;

    const filtered = data.filter((token) => {
      if (token.chainId !== "solana") return false;
      if (!token.tokenAddress) return false;
      if (token.tokenAddress === SOL_ADDRESS) return false;
      if (purchasedTokens.has(token.tokenAddress)) return false;
      return true;
    });

    console.log(`Solanaの新規トークン: ${filtered.length}件`);
    return filtered;
  } catch (error) {
    console.error("新規上場データ取得エラー:", error.message);
    return [];
  }
}

async function getTokenInfo(tokenAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
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

    const liquidity = parseFloat(bestPair.liquidity?.usd || 0);
    if (liquidity < LISTING_CONFIG.MIN_LIQUIDITY_USD) {
      console.log(`流動性不足: $${liquidity.toFixed(0)} < $${LISTING_CONFIG.MIN_LIQUIDITY_USD}`);
      return null;
    }

    console.log(`流動性OK: $${liquidity.toFixed(0)} | ${bestPair.baseToken?.symbol}`);
    return bestPair;
  } catch (error) {
    console.error("トークン情報取得エラー:", error.message);
    return null;
  }
}

async function sendBuyNotification(pair, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const liquidity = parseFloat(pair.liquidity?.usd || 0);
  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const dexLink = `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;

  const payload = {
    content: "🆕 **新規上場コイン自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${pair.baseToken?.name || "不明"} ($${pair.baseToken?.symbol || "?"})`,
      color: 0x00ffff,
      fields: [
        { name: "💰 購入価格", value: `$${parseFloat(pair.priceUsd || 0).toFixed(8)}`, inline: true },
        { name: "📈 5分変化", value: `${priceChange5m.toFixed(2)}%`, inline: true },
        { name: "💧 流動性", value: `$${liquidity.toLocaleString()}`, inline: true },
        { name: "💵 購入金額", value: tradeResult ? "$5" : "失敗", inline: true },
        { name: "🎯 利確", value: "+50%", inline: true },
        { name: "🔴 損切り", value: "-30%", inline: true },
        { name: "🔗 DexScreener", value: `[チャートを見る](${dexLink})`, inline: false },
        tradeResult
          ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "購入結果", value: "失敗", inline: false },
      ],
      footer: { text: `Solana New Listing Bot | ${jstTime} JST` },
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
  console.log("🆕 新規上場チェック中...");

  if (positions.length >= LISTING_CONFIG.MAX_POSITIONS) {
    console.log("最大ポジション数に達しています");
    return;
  }

  const newListings = await getNewListings();
  if (newListings.length === 0) {
    console.log("新規上場なし");
    return;
  }

  for (const token of newListings.slice(0, 5)) {
    if (positions.length >= LISTING_CONFIG.MAX_POSITIONS) break;

    const pair = await getTokenInfo(token.tokenAddress);
    if (!pair) continue;

    const symbol = pair.baseToken?.symbol || "不明";
    console.log(`購入試行: ${symbol}`);

    const tradeResult = await buyToken(token.tokenAddress, solPriceUsd);

    if (tradeResult) {
      addPosition(tradeResult);
      purchasedTokens.add(token.tokenAddress);
      console.log(`✅ 購入成功: ${symbol}`);
      await sendBuyNotification(pair, tradeResult);
      break;
    } else {
      console.log(`❌ 購入失敗: ${symbol} → 次のコインへ`);
      await sendBuyNotification(pair, null);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

module.exports = { checkTrends };
