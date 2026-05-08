const axios = require("axios");
const {
  Connection, Keypair, VersionedTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const bs58 = require("bs58");

const TRADE_CONFIG = {
  BUY_AMOUNT_USD: 10,
  TAKE_PROFIT_PERCENT: 3,
  STOP_LOSS_PERCENT: -3,
  SLIPPAGE: 1,
  SOL_MINT: "So11111111111111111111111111111111111111112",
  RAYDIUM_SWAP_API: "https://transaction-v1.raydium.io/compute/swap-base-in",
  RAYDIUM_TX_API: "https://transaction-v1.raydium.io/transaction/swap-base-in",
};

function getWallet() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("WALLET_PRIVATE_KEY未設定");
  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

function getConnection() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl, "confirmed");
}

async function usdToLamports(usdAmount, solPriceUsd) {
  return Math.floor((usdAmount / solPriceUsd) * LAMPORTS_PER_SOL);
}

async function buyToken(tokenMint, solPriceUsd, isPumpFun = false) {
  console.log("SOL購入開始:", tokenMint);
  try {
    const wallet = getWallet();
    const connection = getConnection();
    const lamports = await usdToLamports(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);
    console.log(`買い金額: $${TRADE_CONFIG.BUY_AMOUNT_USD} = ${lamports} lamports`);

    const quoteRes = await axios.get(TRADE_CONFIG.RAYDIUM_SWAP_API, {
      params: {
        inputMint: TRADE_CONFIG.SOL_MINT,
        outputMint: tokenMint,
        amount: lamports,
        slippageBps: TRADE_CONFIG.SLIPPAGE * 100,
        txVersion: "V0",
      },
      timeout: 15000,
    });

    const quote = quoteRes.data;
    if (!quote?.success) {
      console.error("クォート失敗:", quote?.msg);
      return null;
    }

    console.log("取得予定数量:", quote?.data?.outputAmount);

    const txRes = await axios.post(TRADE_CONFIG.RAYDIUM_TX_API, {
      computeUnitPriceMicroLamports: "100000",
      swapResponse: quote,
      txVersion: "V0",
      wallet: wallet.publicKey.toString(),
      wrapSol: true,
      unwrapSol: true,
    }, { timeout: 15000 });

    if (!txRes.data?.success) {
      console.error("トランザクション失敗:", txRes.data?.msg);
      return null;
    }

    const transactions = txRes.data?.data;
    if (!transactions || transactions.length === 0) return null;

    let txid = null;
    for (const txData of transactions) {
      const buf = Buffer.from(txData.transaction, "base64");
      const tx = VersionedTransaction.deserialize(buf);
      tx.sign([wallet]);
      txid = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      console.log("購入成功! TX:", txid);
    }

    return {
      txid, tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: lamports / parseFloat(quote?.data?.outputAmount || 1),
      tokenAmount: parseFloat(quote?.data?.outputAmount || 0),
      timestamp: Date.now(),
      isPumpFun: false,
    };
  } catch (error) {
    console.error("SOL購入エラー:", error.message);
    return null;
  }
}

async function sellToken(position, currentPrice, reason) {
  console.log(`売り注文: ${position.tokenMint} (${reason})`);
  try {
    const wallet = getWallet();
    const connection = getConnection();

    const quoteRes = await axios.get(TRADE_CONFIG.RAYDIUM_SWAP_API, {
      params: {
        inputMint: position.tokenMint,
        outputMint: TRADE_CONFIG.SOL_MINT,
        amount: Math.floor(position.tokenAmount),
        slippageBps: TRADE_CONFIG.SLIPPAGE * 100,
        txVersion: "V0",
      },
      timeout: 15000,
    });

    const quote = quoteRes.data;
    if (!quote?.success) {
      console.error("売りクォート失敗:", quote?.msg);
      return null;
    }

    const txRes = await axios.post(TRADE_CONFIG.RAYDIUM_TX_API, {
      computeUnitPriceMicroLamports: "100000",
      swapResponse: quote,
      txVersion: "V0",
      wallet: wallet.publicKey.toString(),
      wrapSol: true,
      unwrapSol: true,
    }, { timeout: 15000 });

    if (!txRes.data?.success) {
      console.error("売りトランザクション失敗:", txRes.data?.msg);
      return null;
    }

    const transactions = txRes.data?.data;
    let txid = null;

    for (const txData of transactions) {
      const buf = Buffer.from(txData.transaction, "base64");
      const tx = VersionedTransaction.deserialize(buf);
      tx.sign([wallet]);
      txid = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      console.log("売却成功! TX:", txid);
    }

    return { txid, reason, currentPrice };
  } catch (error) {
    console.error("売り注文エラー:", error.message);
    return null;
  }
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
