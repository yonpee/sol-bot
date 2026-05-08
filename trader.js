const axios = require("axios");
const {
  Connection, Keypair, VersionedTransaction,
  LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const bs58 = require("bs58");

const TRADE_CONFIG = {
  BUY_AMOUNT_USD: 3,
  TAKE_PROFIT_PERCENT: 3,
  STOP_LOSS_PERCENT: -5,
  SLIPPAGE: 1,
  SOL_MINT: "So11111111111111111111111111111111111111112",
  RAYDIUM_SWAP_API: "https://transaction-v1.raydium.io/compute/swap-base-in",
  RAYDIUM_TX_API: "https://transaction-v1.raydium.io/transaction/swap-base-in",
  PUMPFUN_API: "https://pumpportal.fun/api/trade-local",
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
  return Math.floor(solAmount * LAMPORTS_PER_SOL);
}

async function usdToSol(usdAmount, solPriceUsd) {
  return usdAmount / solPriceUsd;
}

async function buyTokenPumpFun(tokenMint, solPriceUsd) {
  console.log(`PumpFun購入開始: ${tokenMint}`);
  try {
    const wallet = getWallet();
    const connection = getConnection();
    const solAmount = await usdToSol(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);

    const response = await axios.post(TRADE_CONFIG.PUMPFUN_API, {
      publicKey: wallet.publicKey.toString(),
      action: "buy",
      mint: tokenMint,
      denominatedInSol: "true",
      amount: solAmount,
      slippage: TRADE_CONFIG.SLIPPAGE,
      priorityFee: 0.001,
      pool: "pump",
    }, {
      headers: { "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: 15000,
    });

    if (response.data.byteLength === 0) return null;

    const transaction = VersionedTransaction.deserialize(new Uint8Array(response.data));
    transaction.sign([wallet]);

    const txid = await connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: true, maxRetries: 3 }
    );

    console.log(`✅ PumpFun購入成功! TX: ${txid}`);
    return {
      txid, tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: 0, tokenAmount: 0,
      timestamp: Date.now(), isPumpFun: true,
    };
  } catch (error) {
    console.error("PumpFun購入エラー:", error.message);
    return null;
  }
}

async function buyTokenRaydium(tokenMint, solPriceUsd) {
  console.log(`Raydium購入開始: ${tokenMint}`);
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
      console.error("Raydiumクォート失敗:", quote?.msg);
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

    if (!txRes.data?.success) return null;

    const transactions = txRes.data?.data;
    if (!transactions || transactions.length === 0) return null;

    let txid = null;
    for (const txData of transactions) {
      const txBuffer = Buffer.from(txData.transaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([wallet]);
      txid = await connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: true, maxRetries: 3 }
      );
      console.log(`✅ Raydium購入成功! TX: ${txid}`);
    }

    return {
      txid, tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: lamports / parseFloat(quote?.data?.outputAmount || 1),
      tokenAmount: parseFloat(quote?.data?.outputAmount || 0),
      timestamp: Date.now(), isPumpFun: false,
    };
  } catch (error) {
    console.error("Raydium購入エラー:", error.message);
    return null;
  }
}

async function buyToken(tokenMint, solPriceUsd, isPumpFun = false) {
  if (isPumpFun) {
    return await buyTokenPumpFun(tokenMint, solPriceUsd);
  }
  const result = await buyTokenRaydium(tokenMint, solPriceUsd);
  if (!result) {
    return await buyTokenPumpFun(tokenMint, solPriceUsd);
  }
  return result;
}

async function sellToken(position, currentPrice, reason) {
  console.log(`売り注文開始: ${position.tokenMint} (${reason})`);
  try {
    const wallet = getWallet();
    const connection = getConnection();

    if (position.isPumpFun) {
      const response = await axios.post(TRADE_CONFIG.PUMPFUN_API, {
        publicKey: wallet.publicKey.toString(),
        action: "sell",
        mint: position.tokenMint,
        denominatedInSol: "false",
        amount: position.tokenAmount || "100%",
        slippage: TRADE_CONFIG.SLIPPAGE,
        priorityFee: 0.001,
        pool: "pump",
      }, {
        headers: { "Content-Type": "application/json" },
        responseType: "arraybuffer",
        timeout: 15000,
      });

      if (response.data.byteLength === 0) return null;

      const transaction = VersionedTransaction.deserialize(new Uint8Array(response.data));
      transaction.sign([wallet]);
      const txid = await connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: true, maxRetries: 3 }
      );
      console.log(`✅ PumpFun売却成功! TX: ${txid}`);
      return { txid, reason, currentPrice };
    }

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

    if (!txRes.data?.success) return null;

    const transactions = txRes.data?.data;
    let txid = null;

    for (const txData of transactions) {
      const txBuffer = Buffer.from(txData.transaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([wallet]);
      txid = await connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: true, maxRetries: 3 }
      );
      console.log(`✅ 売り注文成功! TX: ${txid}`);
    }

    return { txid, reason, currentPrice };
  } catch (error) {
    console.error("売り注文エラー:", error.message);
    return null;
  }
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
