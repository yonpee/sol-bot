const axios = require("axios");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function getMarketNews() {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/search?q=solana",
      { timeout: 10000 }
    );
    return response.data?.pairs?.slice(0, 5) || [];
  } catch (error) {
    console.error("マーケットデータ取得エラー:", error.message);
    return [];
  }
}

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

マーケットデータ:
${JSON.stringify(marketData, null, 2)}

以下の観点で分析してください:
1. 現在の世界情勢・マクロ経済の影響
2. 仮想通貨市場全体のトレンド
3. Solanaエコシステムの状況
4. ${tokenSymbol}固有のリスクとチャンス

必ずJSON形式のみで回答してください（他のテキストは不要）:
{
  "score": -30から30の整数（買いに有利なら正、不利なら負）,
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

    console.log(`AI分析(${tokenSymbol}): スコア${result.score} | ${result.sentiment} | ${result.reason}`);
    return result;

  } catch (error) {
    console.error("Claude API エラー:", error.message);
    return { score: 0, reason: "AI分析失敗", sentiment: "neutral" };
  }
}

async function getAiMarketSentiment() {
  if (!ANTHROPIC_API_KEY) {
    return { score: 0, reason: "AI分析なし", sentiment: "neutral" };
  }

  try {
    const now = new Date().toISOString();

    const prompt = `あなたは仮想通貨市場のアナリストです。
現在時刻: ${now}

今この瞬間の以下について簡潔に判断してください:
1. 世界の株式市場・経済指標の状況
2. 仮想通貨市場全体のセンチメント
3. Solana（SOL）の市場環境
4. 今は買いやすい環境か、リスクが高いか

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

    console.log(`AI市場分析: スコア${result.score} | ${result.sentiment} | ${result.reason}`);
    console.log(`取引推奨: ${result.shouldTrade ? "YES" : "NO"}`);
    return result;

  } catch (error) {
    console.error("AI市場分析エラー:", error.message);
    return { score: 0, reason: "分析失敗", sentiment: "neutral", shouldTrade: true };
  }
}

module.exports = { analyzeWithClaude, getAiMarketSentiment };
