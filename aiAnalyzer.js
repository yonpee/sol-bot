const axios = require("axios");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function analyzeWithClaude(tokenSymbol, marketData) {
  if (!ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY未設定 → AI分析スキップ");
    return { score: 0, reason: "AI分析なし", sentiment: "neutral" };
  }

  try {
    const now = new Date().toISOString();

    const prompt = `あなたは仮想通貨トレーダーのAIアシスタントです。
以下の情報をもとに、${tokenSymbol}を今すぐ購入すべきか判断してください。

現在時刻: ${now}

テクニカルデータ:
- 5分変化: ${marketData.priceChange5m}%
- 1時間変化: ${marketData.priceChange1h}%
- 24時間変化: ${marketData.priceChange24h}%
- テクニカルスコア: ${marketData.score}
- 理由: ${marketData.reasons?.join(", ")}

以下の観点で分析してください:
1. 現在の世界情勢とマクロ経済の影響
2. 仮想通貨市場全体のトレンド
3. Solanaエコシステムの状況
4. ${tokenSymbol}の購入タイミングとして適切か

必ずJSON形式のみで回答（他テキスト不要）:
{
  "score": -30から30の整数,
  "sentiment": "bullish"または"bearish"または"neutral",
  "reason": "50文字以内の理由",
  "risk": "high"または"medium"または"low"
}`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 30000,
      }
    );

    const text = response.data?.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    console.log(`AI分析(${tokenSymbol}): ${result.sentiment} | ${result.reason}`);
    return result;

  } catch (error) {
    console.error("Claude APIエラー:", error.message);
    return { score: 0, reason: "AI分析失敗", sentiment: "neutral" };
  }
}

async function getAiMarketSentiment() {
  if (!ANTHROPIC_API_KEY) {
    return { score: 0, reason: "AI分析なし", sentiment: "neutral", shouldTrade: true };
  }

  try {
    const now = new Date().toISOString();

    const prompt = `あなたは仮想通貨市場のアナリストです。
現在時刻: ${now}

今この瞬間の以下について判断してください:
1. 世界の株式市場・経済指標の状況
2. 仮想通貨市場全体のセンチメント
3. Solana（SOL）の市場環境
4. 今は取引しやすい環境か

必ずJSON形式のみで回答（他テキスト不要）:
{
  "score": -20から20の整数,
  "sentiment": "bullish"または"bearish"または"neutral",
  "reason": "50文字以内",
  "shouldTrade": trueまたはfalse
}`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 30000,
      }
    );

    const text = response.data?.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    console.log(`AI市場分析: ${result.sentiment} | ${result.reason}`);
    console.log(`取引推奨: ${result.shouldTrade ? "YES" : "NO"}`);
    return result;

  } catch (error) {
    console.error("AI市場分析エラー:", error.message);
    return { score: 0, reason: "分析失敗", sentiment: "neutral", shouldTrade: true };
  }
}

module.exports = { analyzeWithClaude, getAiMarketSentiment };
