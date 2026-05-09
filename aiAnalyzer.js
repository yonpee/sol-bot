const axios = require("axios");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function analyzeWithClaude(tokenSymbol, marketData) {
  if (!ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY未設定 → AI分析スキップ");
    return { score: 0, reason: "AI分析なし", sentiment: "neutral" };
  }

  try {
    const prompt = `あなたは仮想通貨トレーダーのAIアシスタントです。
以下のテクニカルデータをもとに、${tokenSymbol}を今すぐ購入すべきか判断してください。

テクニカルデータ:
- 5分変化: ${marketData.priceChange5m}%
- 1時間変化: ${marketData.priceChange1h}%
- 24時間変化: ${marketData.priceChange24h}%
- テクニカルスコア: ${marketData.score}
- シグナル: ${marketData.reasons?.join(", ")}

以下の観点で分析してください:
1. テクニカル指標から見た買いシグナルの強さ
2. トレンドの継続性
3. リスクリワードの観点

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
        model: "claude-sonnet-4-5",
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

async function getAiMarketSentiment(marketData) {
  if (!ANTHROPIC_API_KEY) {
    return { score: 0, reason: "AI分析なし", sentiment: "neutral", shouldTrade: true };
  }

  try {
    const prompt = `あなたは仮想通貨市場のテクニカルアナリストです。
以下のSOL市場データをもとに、今取引すべきか判断してください。

SOL市場データ:
- SOL 1時間変化: ${marketData?.solTrend || 0}%
- 監視コインの平均スコア: ${marketData?.avgScore || 0}

以下の観点で判断してください:
1. SOLのトレンド方向
2. 市場全体の勢い
3. 今は取引に適したタイミングか

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
        model: "claude-sonnet-4-5",
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
