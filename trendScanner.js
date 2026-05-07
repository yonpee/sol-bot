// ============================================================
// trendScanner.js - トレンド検知モジュール
// 役割: 上昇トレンドのコインを検知して自動購入する
// ============================================================

const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");

// ============================================================
// 🔧 トレンド検知の設定
// ============================================================
constconst TREND_CONFIG = {
  MIN_PRICE_CHANGE_5M: -100, ← 条件なし
  MIN_LIQUIDITY_USD: 100,   ← ほぼ条件なし
  MIN_VOLUME_24H: 0,        ← 条件なし
  MAX_POSITIONS: 1,         ← 1件だけ
  CHAINS: ["solana"],

// 購入済みトークンを記録（重複購入防止）
const purchasedTokens = new Set();

// ============================================================
// 📡 DexScreenerからトレンドコインを取得
// ============================================================
async function getTrendingTokens() {
  try {
    // DexScreenerのトレンドAPIを使う
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/search?q=solana",
      {
        timeout: 10000,
        headers: { "User-Agent": "SolanaBot/1.0" },
      }
    );

    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) return [];

    // 条件でフィルタリング
    const trendingPairs = data.pairs.filter((pair) => {
      // Solanaチェーンのみ
      if (!TREND_CONFIG.CHAINS.includes(pair.chainId)) return false;

      // 流動性チェック
      const liquidity = parseFloat(pair.liquidity?.usd || 0);
      if (liquidity < TREND_CONFIG.MIN_LIQUIDITY_USD) return false;

      // 24時間出来高チェック
      const volume24h = parseFloat(pair.volume?.h24 || 0);
      if (volume24h < TREND_CONFIG.MIN_VOLUME_24H) return false;

      // 5分上昇率チェック
      const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
      if (priceChange5m < TREND_CONFIG.MIN_PRICE_CHANGE_5M) return false;

      // 購入済みチェック
      if (purchasedTokens.has(pair.baseToken?.address)) return false;

      // 価格が存在するか
      if (!pair.priceUsd || parseFloat(pair.priceUsd) <= 0) return false;

      return true;
    });

    // 5分上昇率が高い順に並べる
    trendingPairs.sort((a, b) => {
      const aChange = parseFloat(a.priceChange?.m5 || 0);
      const bChange = parseFloat(b.priceChange?.m5 || 0);
      return bChange - aChange;
    });

    return trendingPairs;

  } catch (error) {
    console.error("❌ トレンドデータ取得エラー:", error.message);
    return [];
  }
}

// ============================================================
// 📢 トレンド購入をDiscordに通知
// ============================================================
async function sendTrendBuyNotification(pair, tradeResult) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const jstTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());

  const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
  const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);
  const liquidity = parseFloat(pair.liquidity?.usd || 0);
  const volume24h = parseFloat(pair.volume?.h24 || 0);
  const dexLink = `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;

  const payload = {
    content: "📈 **トレンド上昇コイン自動購入！** @everyone",
    embeds: [{
      title: `🚀 ${pair.baseToken?.name || "不明"} ($${pair.baseToken?.symbol || "?"})`,
      description: "上昇トレンドを検知して自動購入しました！",
      color: 0x00ff00, // 緑色

      fields: [
        {
          name: "💰 購入価格",
          value: `$${parseFloat(pair.priceUsd).toFixed(8)}`,
          inline: true,
        },
        {
          name: "📈 5分上昇率",
          value: `+${priceChange5m.toFixed(2)}%`,
          inline: true,
        },
        {
          name: "📊 1時間変化",
          value: `${priceChange1h.toFixed(2)}%`,
          inline: true,
        },
        {
          name: "💧 流動性",
          value: `$${liquidity.toLocaleString()}`,
          inline: true,
        },
        {
          name: "📦 24h出来高",
          value: `$${volume24h.toLocaleString()}`,
          inline: true,
        },
        {
          name: "💵 購入金額",
          value: tradeResult ? "$5" : "❌ 失敗",
          inline: true,
        },
        {
          name: "🎯 利確ライン",
          value: "+50%",
          inline: true,
        },
        {
          name: "🔴 損切りライン",
          value: "-30%",
          inline: true,
        },
        {
          name: "🔗 DexScreener",
          value: `[チャートを見る](${dexLink})`,
          inline: false,
        },
        tradeResult
          ? { name: "🔗 購入TX", value: `[確認する](https://solscan.io/tx/${tradeResult.txid})`, inline: false }
          : { name: "⚠️ 購入", value: "失敗", inline: false },
      ],

      footer: { text: `Solana Trend Bot | ${jstTime} JST` },
    }],
  };

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  } catch (error) {
    console.error("❌ 通知エラー:", error.message);
  }
}

// ============================================================
// 🔄 トレンドチェックのメイン処理
// ============================================================
async function checkTrends(solPriceUsd) {
  console.log("📈 トレンドチェック中...");

  // 最大ポジション数チェック
  if (positions.length >= TREND_CONFIG.MAX_POSITIONS) {
    console.log(`⏸️ 最大ポジション数(${TREND_CONFIG.MAX_POSITIONS})に達しています`);
    return;
  }

  const trendingTokens = await getTrendingTokens();

  if (trendingTokens.length === 0) {
    console.log("📊 上昇トレンドのコインなし");
    return;
  }

  console.log(`📈 上昇トレンド検知: ${trendingTokens.length}件`);

  // 上位3件まで処理
  const targets = trendingTokens.slice(0, 3);

  for (const pair of targets) {
    // 最大ポジション数チェック
    if (positions.length >= TREND_CONFIG.MAX_POSITIONS) break;

    const symbol = pair.baseToken?.symbol || "不明";
    const change5m = parseFloat(pair.priceChange?.m5 || 0);
    console.log(`  → ${symbol}: +${change5m.toFixed(2)}%`);

    // 自動購入
    const tradeResult = await buyToken(
      pair.baseToken.address,
      solPriceUsd
    );

    if (tradeResult) {
      addPosition(tradeResult);
      purchasedTokens.add(pair.baseToken.address);
      console.log(`✅ 自動購入成功: ${symbol}`);
    }

    await sendTrendBuyNotification(pair, tradeResult);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

module.exports = { checkTrends };
