// ============================================================
// trader.js - Jupiter APIで自動売買するモジュール
// 役割: トークンの買い・売りを自動実行する
// ============================================================

const axios = require("axios");
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");

// ============================================================
// 🔧 売買設定
// ============================================================
const TRADE_CONFIG = {
  // 1回の買い金額（ドル）
  BUY_AMOUNT_USD: 5,
  // 利確ライン（%）
  TAKE_PROFIT_PERCENT: 30,
  // 損切りライン（%）
  STOP_LOSS_PERCENT: -20,
  // スリッページ（%）- 価格のズレを許容する範囲
  SLIPPAGE_BPS: 300, // 3%
  // SOLのミントアドレス
  SOL_MINT: "So11111111111111111111111111111111111111112",
  // Jupiter API
  JUPITER_QUOTE_API: "https://quote-api.jup.ag/v6/quote",
  JUPITER_SWAP_API: "https://quote-api.jup.ag/v6/swap",
};

// ============================================================
// 🔑 Walletの初期化
// ============================================================
function getWallet() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("WALLET_PRIVATE_KEY が設定されていません！");
  }
  try {
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error("秘密鍵の形式が正しくありません: " + error.message);
  }
}

// ============================================================
// 🌐 Solana接続
// ============================================================
function getConnection() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl, "confirmed");
}

// ============================================================
// 💰 SOL価格を取得してUSD→lamports変換
// ============================================================
async function usdToLamports(usdAmount, solPriceUsd) {
  const solAmount = usdAmount / solPriceUsd;
  // 1 SOL = 1,000,000,000 lamports
  return Math.floor(solAmount * 1_000_000_000);
}

// ============================================================
// 🛒 トークンを買う関数
// ============================================================
async function buyToken(tokenMint, solPriceUsd) {
  console.log(`🛒 買い注文開始: ${tokenMint}`);

  try {
    const wallet = getWallet();
    const connection = getConnection();

    // 買い金額をlamportsに変換
    const lamports = await usdToLamports(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);
    console.log(`💰 買い金額: $${TRADE_CONFIG.BUY_AMOUNT_USD} = ${lamports} lamports`);

    // Step1: Jupiterでクォートを取得
    const quoteResponse = await axios.get(TRADE_CONFIG.JUPITER_QUOTE_API, {
      params: {
        inputMint: TRADE_CONFIG.SOL_MINT,
        outputMint: tokenMint,
        amount: lamports,
        slippageBps: TRADE_CONFIG.SLIPPAGE_BPS,
      },
      timeout: 10000,
    });

    const quote = quoteResponse.data;
    if (!quote || quote.error) {
      console.error("❌ クォート取得失敗:", quote?.error);
      return null;
    }

    console.log(`📊 取得予定数量: ${quote.outAmount}`);

    // Step2: スワップトランザクションを作成
    const swapResponse = await axios.post(TRADE_CONFIG.JUPITER_SWAP_API, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 1000, // 優先手数料
    }, { timeout: 10000 });

    const { swapTransaction } = swapResponse.data;

    // Step3: トランザクションに署名して送信
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const txid = await connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: true, maxRetries: 3 }
    );

    console.log(`✅ 買い注文成功! TX: ${txid}`);

    // 購入情報を返す
    return {
      txid,
      tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: parseFloat(quote.inAmount) / parseFloat(quote.outAmount),
      tokenAmount: parseFloat(quote.outAmount),
      timestamp: Date.now(),
    };

  } catch (error) {
    console.error("❌ 買い注文エラー:", error.message);
    return null;
  }
}

// ============================================================
// 💸 トークンを売る関数
// ============================================================
async function sellToken(position, currentPrice, reason) {
  console.log(`💸 売り注文開始: ${position.tokenMint} (理由: ${reason})`);

  try {
    const wallet = getWallet();
    const connection = getConnection();

    // Step1: クォートを取得（トークン→SOL）
    const quoteResponse = await axios.get(TRADE_CONFIG.JUPITER_QUOTE_API, {
      params: {
        inputMint: position.tokenMint,
        outputMint: TRADE_CONFIG.SOL_MINT,
        amount: Math.floor(position.tokenAmount),
        slippageBps: TRADE_CONFIG.SLIPPAGE_BPS,
      },
      timeout: 10000,
    });

    const quote = quoteResponse.data;
    if (!quote || quote.error) {
      console.error("❌ 売りクォート取得失敗:", quote?.error);
      return null;
    }

    // Step2: スワップトランザクション作成
    const swapResponse = await axios.post(TRADE_CONFIG.JUPITER_SWAP_API, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 1000,
    }, { timeout: 10000 });

    const { swapTransaction } = swapResponse.data;

    // Step3: 署名して送信
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const txid = await connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: true, maxRetries: 3 }
    );

    console.log(`✅ 売り注文成功! TX: ${txid}`);

    return { txid, reason, currentPrice };

  } catch (error) {
    console.error("❌ 売り注文エラー:", error.message);
    return null;
  }
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
