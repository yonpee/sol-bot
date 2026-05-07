const axios = require("axios");
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");

const TRADE_CONFIG = {
  BUY_AMOUNT_USD: 5,
  TAKE_PROFIT_PERCENT: 50,
  STOP_LOSS_PERCENT: -30,
  SLIPPAGE_BPS: 300,
  SOL_MINT: "So11111111111111111111111111111111111111112",
};

function getWallet() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("WALLET_PRIVATE_KEY が未設定！");
  try {
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error("秘密鍵の形式エラー: " + error.message);
  }
}

function getConnection() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl, "confirmed");
}

async function usdToLamports(usdAmount, solPriceUsd) {
  const solAmount = usdAmount / solPriceUsd;
  return Math.floor(solAmount * 1_000_000_000);
}

async function testConnections() {
  console.log("🔍 API接続テスト開始...");

  const apis = [
    "https://api.raydium.io/v2/main/pairs",
    "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50",
    "https://price.jup.ag/v6/price?ids=SOL",
  ];

  for (const url of apis) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      console.log(`✅ 接続成功: ${url.substring(0, 50)}`);
    } catch (error) {
      console.log(`❌ 接続失敗: ${url.substring(0, 50)} → ${error.message}`);
    }
  }
}

async function buyToken(tokenMint, solPriceUsd) {
  console.log(`買い注文開始: ${tokenMint}`);
  await testConnections();
  return null;
}

async function sellToken(position, currentPrice, reason) {
  return null;
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
