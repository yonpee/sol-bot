const axios = require("axios");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function analyzeWithClaude(tokenSymbol, marketData) {
  if (!ANTHROPIC_API_KEY) {
    return { score: 0, reason: "AI分析なし", sentiment: "neutral" };
  }

  try {
    const prompt = "仮想通貨トレーダーとして" + tokenSymbol + "の購入判断をしてください。データ: 5分変化=" + marketData.priceChange5m + "%, 1時間変化=" + marketData.priceChange1h + "%, スコア=" + marketData.score + ". JSON形式のみで回答: {\"score\": -30から30の整数, \"sentiment\": \"bullish\"または\"bearish\"または\"neutral\", \"reason\": \"30文字以内\"}";

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 15000,
      }
    );

    const text = response.data?.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    console.log("AI分析(" + tokenSymbol + "): " + result.sentiment + " | " + result.reason);
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
    const prompt = "仮想通貨市場アナリストとして現在の市場環境を判断してください。SOL1時間変化=" + (marketData?.solTrend || 0) + "%. JSON形式のみで回答: {\"score\": -20から20の整数, \"sentiment\": \"bullish\"または\"bearish\"または\"neutral\", \"reason\": \"30文字以内\", \"shouldTrade\": trueまたはfalse}";

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 15000,
      }
    );

    const text = response.data?.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    console.log("AI市場分析: " + result.sentiment + " | " + result.reason);
    console.log("取引推奨: " + (result.shouldTrade ? "YES" : "NO"));
    return result;

  } catch (error) {
    console.error("AI市場分析エラー:", error.message);
    return { score: 0, reason: "分析失敗", sentiment: "neutral", shouldTrade: true };
  }
}

module.exports = { analyzeWithClaude, getAiMarketSentiment };
