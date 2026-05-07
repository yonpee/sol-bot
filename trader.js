const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const https = require("https");
const http = require("http");

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

function fetchWithIP(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const client = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Host": urlObj.hostname,
        ...options.headers,
      },
      lookup: (hostname, options, callback) => {
        callback(null, "104.21.0.1", 4);
      },
    };

    const req = client.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: () => JSON.parse(data), status: res.statusCode });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function buyToken(tokenMint, solPriceUsd) {
  console.log(`買い注文開始: ${tokenMint}`);
  try {
    const wallet = getWallet();
    const connection = getConnection();
    const lamports = await usdToLamports(TRADE_CONFIG.BUY_AMOUNT_USD, solPriceUsd);
    console.log(`買い金額: $${TRADE_CONFIG.BUY_AMOUNT_USD} = ${lamports} lamports`);

    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${TRADE_CONFIG.SOL_MINT}&outputMint=${tokenMint}&amount=${lamports}&slippageBps=${TRADE_CONFIG.SLIPPAGE_BPS}`;

    const axios = require("axios");
    const quoteRes = await axios.get(quoteUrl, {
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
      httpsAgent: new (require("https").Agent)({
        lookup: (hostname, options, callback) => {
          console.log(`DNS解決試行: ${hostname}`);
          require("dns").resolve4(hostname, (err, addresses) => {
            if (err) {
              console.error(`DNS解決失敗: ${err.message}`);
              callback(err);
            } else {
              console.log(`DNS解決成功: ${addresses[0]}`);
              callback(null, addresses[0], 4);
            }
          });
        },
      }),
    });

    const quote = quoteRes.data;
    if (!quote || quote.error) {
      console.error("クォートエラー:", quote?.error);
      return null;
    }

    console.log(`取得予定数量: ${quote.outAmount}`);

    const swapRes = await axios.post("https://quote-api.jup.ag/v6/swap", {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 1000,
    }, {
      timeout: 15000,
      httpsAgent: new (require("https").Agent)({
        lookup: (hostname, options, callback) => {
          require("dns").resolve4(hostname, (err, addresses) => {
            if (err) callback(err);
            else callback(null, addresses[0], 4);
          });
        },
      }),
    });

    const { swapTransaction } = swapRes.data;
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
    const axios = require("axios");
    const wallet = getWallet();
    const connection = getConnection();

    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${position.tokenMint}&outputMint=${TRADE_CONFIG.SOL_MINT}&amount=${Math.floor(position.tokenAmount)}&slippageBps=${TRADE_CONFIG.SLIPPAGE_BPS}`;

    const quoteRes = await axios.get(quoteUrl, { timeout: 15000 });
    const quote = quoteRes.data;
    if (!quote || quote.error) {
      console.error("売りクォートエラー:", quote?.error);
      return null;
    }

    const swapRes = await axios.post("https://quote-api.jup.ag/v6/swap", {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 1000,
    }, { timeout: 15000 });

    const { swapTransaction } = swapRes.data;
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
