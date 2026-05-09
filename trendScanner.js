const axios = require("axios");
const { buyToken } = require("./trader");
const { addPosition, positions } = require("./portfolio");
const { analyzeWithClaude, getAiMarketSentiment } = require("./aiAnalyzer");

const WATCH_TOKENS = [
  { symbol: "JUP",     address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY",     address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "PYTH",    address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "ORCA",    address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "DRIFT",   address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7" },
  { symbol: "RENDER",  address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  { symbol: "BONK",    address: "DezXAZ8z7PnrnRJjz3wXBoRgiqCmbVeDbroIkLbCk5" },
  { symbol: "WIF",     address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT",  address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "MEW",     address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "BOME",    address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "AI16Z",   address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC​​​​​​​​​​​​​​​​
