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
}​​​​​​​​​​​​​​​​
