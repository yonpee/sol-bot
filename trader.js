const axios = require("axios");
const {
  Connection, Keypair, VersionedTransaction,
  PublicKey, Transaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const bs58 = require("bs58");

const TRADE_CONFIG = {
  BUY_AMOUNT_USD: 10,
  TAKE_PROFIT_PERCENT: 8,
  STOP_LOSS_PERCENT: -4,
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

async function ensureTokenAccount(connection, wallet, mintAddress) {
  try {
    const mint = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(
      mint, wallet.publicKey, false,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const info = await connection.getAccountInfo(ata);
    if (info) {
      console.log("トークンアカウントOK");
      return ata;
    }
    console.log("トークンアカウント作成中...");
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey, ata, wallet.publicKey, mint,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey });
    tx.add(ix);
    tx.sign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    console.log("トークンアカウント作成完了!");
    return ata;
  } catch (error) {
    console.error("トークンアカウント作成エラー:", error.message);
    return null;
  }
}

async function checkRaydiumRoute(tokenMint, lamports) {
  try {
    const quoteRes = await axios.get(TRADE_CONFIG.RAYDIUM_SWAP_API, {
      params: {
        inputMint: TRADE_CONFIG.SOL_MINT,
        outputMint: tokenMint,
        amount: lamports,
        slippageBps: TRADE_CONFIG.SLIPPAGE * 100,
        txVersion: "V0",
      },
      timeout: 10000,
    });
    const quote = quoteRes.data;
    if (!quote?.success) {
      console.log("Raydiumルートなし: " + quote?.msg);
      return null;
    }
    console.log("Raydiumルート確認OK outputAmount:" + quote?.data?.outputAmount + " decimals:" + quote?.data?.outputDecimals);
    return quote;
  } catch (error) {
    console.error("ルートチェックエラー:", error.message);
    return null;
  }
}

async function buyToken(tokenMint, solPriceUsd, isPumpFun = false) {
  console.log("SOL購入開始:", tokenMint);
  try {
    const wallet = getWallet();
    const connection = getConnection();
    const lamports = await usdToLamports(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);
    console.log("買い金額: $" + TRADE_CONFIG.BUY_AMOUNT_USD + " = " + lamports + " lamports");

    await ensureTokenAccount(connection, wallet, tokenMint);

    const quote = await checkRaydiumRoute(tokenMint, lamports);
    if (!quote) {
      console.log("Raydiumルートなし → 購入スキップ");
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

    // デシマルを考慮したbuyPrice計算
    const outputAmountRaw = parseFloat(quote?.data?.outputAmount || 1);
    const outputDecimals = parseFloat(quote?.data?.outputDecimals || 6);
    const outputAmount = outputAmountRaw / Math.pow(10, outputDecimals);
    const inputAmountSol = lamports / LAMPORTS_PER_SOL;
    const buyPriceInSol = inputAmountSol / outputAmount;
    const buyPriceUsd = buyPriceInSol * solPriceUsd;

    console.log("購入数量: " + outputAmount.toFixed(4) + " tokens");
    console.log("購入価格: $" + buyPriceUsd.toFixed(6) + " per token");

    return {
      txid, tokenMint,
      buyAmountUsd: TRADE_CONFIG.BUY_AMOUNT_USD,
      buyPrice: buyPriceUsd,
      tokenAmount: outputAmountRaw,
      timestamp: Date.now(),
      isPumpFun: false,
    };
  } catch (error) {
    console.error("SOL購入エラー:", error.message);
    return null;
  }
}

async function sellToken(position, currentPrice, reason) {
  console.log("売り注文: " + position.tokenMint + " (" + reason + ")");
  try {
    const wallet = getWallet();
    const connection = getConnection();

    await ensureTokenAccount(connection, wallet, position.tokenMint);

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
