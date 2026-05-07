const axios = require("axios");
const {
  Connection, Keypair, VersionedTransaction,
  PublicKey, Transaction, SystemProgram,
  LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const bs58 = require("bs58");

const TRADE_CONFIG = {
  BUY_AMOUNT_USD: 5,
  TAKE_PROFIT_PERCENT: 50,
  STOP_LOSS_PERCENT: -30,
  SLIPPAGE: 0.5,
  SOL_MINT: "So11111111111111111111111111111111111111112",
  USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  RAYDIUM_SWAP_API: "https://transaction-v1.raydium.io/compute/swap-base-in",
  RAYDIUM_TX_API: "https://transaction-v1.raydium.io/transaction​​​​​​​​​​​​​​​​
