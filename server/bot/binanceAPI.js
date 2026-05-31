import crypto from 'node:crypto';

const PROD_PUBLIC  = 'https://api.binance.com';   // dados públicos (klines, ticker)
const PROD_PRIVATE = 'https://api.binance.us';    // ordens reais (autenticadas)
const TEST = 'https://testnet.binance.vision';

function basePublic(testnet)  { return testnet ? TEST : PROD_PUBLIC; }
function basePrivate(testnet) { return testnet ? TEST : PROD_PRIVATE; }

function sign(params, secret) {
  const qs = new URLSearchParams(params).toString();
  const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

async function pub(path, params = {}, testnet = false) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${basePublic(testnet)}${path}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || `Binance ${res.status} ${path}`);
  return data;
}

async function priv(method, path, params, apiKey, secret, testnet = false) {
  const signed = sign({ ...params, timestamp: Date.now() }, secret);
  const url = method === 'GET' ? `${basePrivate(testnet)}${path}?${signed}` : `${basePrivate(testnet)}${path}`;
  const opts = { method, headers: { 'X-MBX-APIKEY': apiKey } };
  if (method === 'POST') { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = signed; }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || `Binance ${res.status} ${path}`);
  return data;
}

// ── Symbol info ───────────────────────────────────────────────────────────────

export async function getExchangeInfo(symbol, testnet = false) {
  const data = await pub('/api/v3/exchangeInfo', { symbol }, testnet);
  return data.symbols?.[0] ?? null;
}

export async function getLotSize(symbol, testnet = false) {
  const info = await getExchangeInfo(symbol, testnet);
  if (!info) return { stepSize: 0.001, minQty: 0.001, minNotional: 10 };
  const lot = info.filters.find(f => f.filterType === 'LOT_SIZE') ?? {};
  const notional = info.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL') ?? {};
  return {
    stepSize: parseFloat(lot.stepSize || 0.001),
    minQty: parseFloat(lot.minQty || 0.001),
    minNotional: parseFloat(notional.minNotional || 10),
  };
}

export function floorQty(qty, stepSize) {
  if (!stepSize || stepSize <= 0) return qty;
  const precision = Math.round(-Math.log10(stepSize));
  const factor = Math.pow(10, precision);
  return Math.floor(qty * factor) / factor;
}

// ── Market data ───────────────────────────────────────────────────────────────

export async function getPrice(symbol, testnet = false) {
  const d = await pub('/api/v3/ticker/price', { symbol }, testnet);
  return parseFloat(d.price);
}

export async function get24h(symbol, testnet = false) {
  return pub('/api/v3/ticker/24hr', { symbol }, testnet);
}

export async function getKlines(symbol, interval, limit = 500, testnet = false) {
  const raw = await pub('/api/v3/klines', { symbol, interval, limit }, testnet);
  return raw.map(k => ({
    ts: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

// ── Account ───────────────────────────────────────────────────────────────────

export async function getAccount(apiKey, secret, testnet = false) {
  return priv('GET', '/api/v3/account', {}, apiKey, secret, testnet);
}

export async function getBalance(asset, apiKey, secret, testnet = false) {
  const acc = await getAccount(apiKey, secret, testnet);
  const b = acc.balances.find(b => b.asset === asset);
  return b ? parseFloat(b.free) : 0;
}

// ── Orders ────────────────────────────────────────────────────────────────────

// Buy with quote currency (e.g. spend 100 USDT)
export async function marketBuy(symbol, quoteQty, apiKey, secret, testnet = false) {
  return priv('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'MARKET',
    quoteOrderQty: Number(quoteQty).toFixed(2),
  }, apiKey, secret, testnet);
}

// Sell base asset quantity (e.g. sell 0.05 ETH)
export async function marketSell(symbol, quantity, apiKey, secret, testnet = false) {
  return priv('POST', '/api/v3/order', {
    symbol, side: 'SELL', type: 'MARKET',
    quantity: String(quantity),
  }, apiKey, secret, testnet);
}

// ── Symbol mapping ────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
  ETH: 'ETHUSDT', BTC: 'BTCUSDT', SOL: 'SOLUSDT',
  ARB: 'ARBUSDT', AERO: null, cbBTC: 'BTCUSDT', WBTC: 'BTCUSDT', WETH: 'ETHUSDT',
};

export function getBinanceSymbol(basePair) { return SYMBOL_MAP[basePair] ?? null; }

// Base asset from Binance symbol (e.g. ETHUSDT → ETH)
export function getBaseAsset(binanceSymbol) { return binanceSymbol.replace(/USDT$|USDC$/, ''); }
export function getQuoteAsset(binanceSymbol) { return binanceSymbol.endsWith('USDC') ? 'USDC' : 'USDT'; }
