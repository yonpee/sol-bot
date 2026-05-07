const { Connection, Keypair, VersionedTransaction, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");
const cross_fetch = require("cross-fetch");

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

async function buyToken(tokenMint, solPriceUsd) {
  console.log(`買い注文開始: ${tokenMint}`);
  try {
    const wallet = getWallet();
    const connection = getConnection();
    const lamports = await usdToLamports(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);
    console.log(`買い金額: $${TRADE_CONFIG.BUY_AMOUNT_USD} = ${lamports} lamports`);

    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${TRADE_CONFIG.SOL_MINT}&outputMint=${tokenMint}&amount=${lamports}&slippageBps=${TRADE_CONFIG.SLIPPAGE_BPS}`;

    const quoteRes = await cross_fetch.fetch(quoteUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!quoteRes.ok) {
      console.error("クォート取得失敗:", quoteRes.status);
      return null;
    }

    const quote = await quoteRes.json();
    if (!quote || quote.error) {
      console.error("クォートエラー:", quote?.error);
      return null;
    }

    console.log(`取得予定数量: ${quote.outAmount}`);

    const swapRes = await cross_fetch.fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 1000,
      }),
    });

    if (!swapRes.ok) {
      console.error("スワップ取得失敗:", swapRes.status);
      return null;
    }

    const swapData = await swapRes.json();
    const { swapTransaction } = swapData;

    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const txid = await connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: true, maxRetries: 3 }
    );

    console.log(`✅ 買い注文成功! TX: ${txid}`);
    return {
      txid,
      tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: parseFloat(quote.inAmount) / parseFloat(quote.outAmount),
      tokenAmount: parseFloat(quote.outAmount),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("買い注文エラー:", error.message);
    return null;
  }
}

async function sellToken(position, currentPrice, reason) {
  console.log(`売り注文開始: ${position.tokenMint} (${reason})`);
  try {
    const wallet = getWallet();
    const connection = getConnection();

    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${position.tokenMint}&outputMint=${TRADE_CONFIG.SOL_MINT}&amount=${Math.floor(position.tokenAmount)}&slippageBps=${TRADE_CONFIG.SLIPPAGE_BPS}`;

    const quoteRes = await cross_fetch.fetch(quoteUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!quoteRes.ok) {
      console.error("売りクォート取得失敗:", quoteRes.status);
      return null;
    }

    const quote = await quoteRes.json();
    if (!quote || quote.error) {
      console.error("売りクォートエラー:", quote?.error);
      return null;
    }

    const swapRes = await cross_fetch.fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 1000,
      }),
    });

    if (!swapRes.ok) {
      console.error("売りスワップ取得失敗:", swapRes.status);
      return null;
    }

    const swapData = await swapRes.json();
    const { swapTransaction } = swapData;

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
    console.error("売り注文エラー:", error.message);
    return null;
  }
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
