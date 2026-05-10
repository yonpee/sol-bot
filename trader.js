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
  SLIPPAGE: 3,
  SOL_MINT: "So11111111111111111111111111111111111111112",
  RAYDIUM_SWAP_API: "https://transaction-v1.raydium.io/compute/swap-base-in",
  RAYDIUM_TX_API: "https://transaction-v1.raydium.io/transaction/swap-base-in",
};

const TOKEN_DECIMALS = {
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": 6,
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": 6,
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": 6,
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE": 6,
  "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7": 6,
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof": 8,
  "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5": 5,
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": 6,
  "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5": 6,
  "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82": 6,
  "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3": 9,
  "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC": 6,
  "8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn": 6,
};

async function getTokenPriceUsd(tokenMint) {
  try {
    const response = await axios.get(
      "https://api.dexscreener.com/latest/dex/tokens/" + tokenMint,
      { timeout: 10000 }
    );
    const pairs = response.data?.pairs?.filter(p => p.chainId === "solana") || [];
    if (pairs.length === 0) return null;
    const best = pairs.reduce((a, b) =>
      parseFloat(b.liquidity?.usd || 0) > parseFloat(a.liquidity?.usd || 0) ? b : a
    );
    return parseFloat(best.priceUsd || 0);
  } catch (error) {
    return null;
  }
}

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

async function getOrCreateTokenAccount(connection, wallet, mintAddress) {
  try {
    const mint = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(
      mint, wallet.publicKey, false,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const info = await connection.getAccountInfo(ata);
    if (info) {
      console.log("トークンアカウントOK: " + ata.toString());
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
    console.log("トークンアカウント作成完了: " + ata.toString());
    await new Promise(r => setTimeout(r, 3000));
    return ata;
  } catch (error) {
    console.error("トークンアカウントエラー:", error.message);
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
    console.log("Raydiumルート確認OK: " + quote?.data?.outputAmount);
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

    const ata = await getOrCreateTokenAccount(connection, wallet, tokenMint);
    if (!ata) {
      console.error("トークンアカウント取得失敗");
      return null;
    }

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
    let confirmed = false;

    for (const txData of transactions) {
      const buf = Buffer.from(txData.transaction, "base64");
      const tx = VersionedTransaction.deserialize(buf);
      tx.sign([wallet]);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

      txid = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      console.log("TX送信: " + txid);

      // トランザクション確認を待つ
      try {
        const result = await connection.confirmTransaction({
          signature: txid,
          blockhash: blockhash,
          lastValidBlockHeight: lastValidBlockHeight,
        }, "confirmed");

        if (result.value.err) {
          console.error("TX確認エラー:", result.value.err);
          return null;
        }
        confirmed = true;
        console.log("購入確認完了! TX:", txid);
      } catch (confirmError) {
        console.error("TX確認タイムアウト:", confirmError.message);
        return null;
      }
    }

    if (!confirmed) return null;

    const outputAmountRaw = parseFloat(quote?.data?.outputAmount || 1);
    const decimals = TOKEN_DECIMALS[tokenMint] || 6;
    const outputAmount = outputAmountRaw / Math.pow(10, decimals);

    let buyPriceUsd = await getTokenPriceUsd(tokenMint);
    if (!buyPriceUsd) {
      const inputAmountSol = lamports / LAMPORTS_PER_SOL;
      buyPriceUsd = (inputAmountSol * solPriceUsd) / outputAmount;
    }

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

    const ata = await getOrCreateTokenAccount(connection, wallet, position.tokenMint);
    if (!ata) {
      console.error("トークンアカウント取得失敗");
      return null;
    }

    console.log("売却元ATA: " + ata.toString());

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await new Promise(r => setTimeout(r, 1000));

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
          console.error("売りクォート失敗(" + attempt + "):", quote?.msg);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const txRes = await axios.post(TRADE_CONFIG.RAYDIUM_TX_API, {
          computeUnitPriceMicroLamports: "100000",
          swapResponse: quote,
          txVersion: "V0",
          wallet: wallet.publicKey.toString(),
          inputAccount: ata.toString(),
          wrapSol: true,
          unwrapSol: true,
        }, { timeout: 15000 });

        if (!txRes.data?.success) {
          console.error("売りトランザクション失敗(" + attempt + "):", txRes.data?.msg);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const transactions = txRes.data?.data;
        if (!transactions || transactions.length === 0) continue;

        let txid = null;
        for (const txData of transactions) {
          const buf = Buffer.from(txData.transaction, "base64");
          const tx = VersionedTransaction.deserialize(buf);
          tx.sign([wallet]);

          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

          txid = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true, maxRetries: 3,
          });
          console.log("売却TX送信: " + txid);

          try {
            const result = await connection.confirmTransaction({
              signature: txid,
              blockhash: blockhash,
              lastValidBlockHeight: lastValidBlockHeight,
            }, "confirmed");

            if (result.value.err) {
              console.error("売却TX確認エラー:", result.value.err);
              continue;
            }
            console.log("売却確認完了! TX:", txid);
            return { txid, reason, currentPrice };
          } catch (confirmError) {
            console.error("売却TX確認タイムアウト:", confirmError.message);
            continue;
          }
        }

      } catch (e) {
        console.error("売却試行" + attempt + "エラー:", e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.error("3回試行して売却失敗");
    return null;

  } catch (error) {
    console.error("売り注文エラー:", error.message);
    return null;
  }
}

module.exports = { buyToken, sellToken, TRADE_CONFIG };
