import crypto from 'node:crypto';

const BASE_URL = 'https://api.bybit.com';
const TEST_URL = 'https://api-testnet.bybit.com';

function base(testnet) { return testnet ? TEST_URL : BASE_URL; }

// Bybit V5 signature: HMAC-SHA256 of "{timestamp}{apiKey}{recvWindow}{payload}"
function sign(timestamp, apiKey, recvWindow, payload, secret) {
  const str = `${timestamp}${apiKey}${recvWindow}${payload}`;
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

async function pub(path, params = {}, testnet = false) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base(testnet)}${path}?${qs}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit ${path}`);
  return data.result;
}

async function priv(method, path, params, apiKey, secret, testnet = false) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const payload = method === 'GET'
    ? new URLSearchParams(params).toString()
    : JSON.stringify(params);
  const sig = sign(timestamp, apiKey, recvWindow, payload, secret);

  const headers = {
    'X-BAPI-API-KEY':      apiKey,
    'X-BAPI-SIGN':         sig,
    'X-BAPI-SIGN-TYPE':    '2',
    'X-BAPI-TIMESTAMP':    timestamp,
    'X-BAPI-RECV-WINDOW':  recvWindow,
    'Content-Type':        'application/json',
  };

  const url  = method === 'GET' ? `${base(testnet)}${path}?${payload}` : `${base(testnet)}${path}`;
  const opts = method === 'GET' ? { method, headers } : { method, headers, body: payload };

  const res  = await fetch(url, opts);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit ${path}`);
  return data.result;
}

// Our interval strings → Bybit interval param
const INTERVAL_MAP = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': 'D',
};

export function mapInterval(interval) { return INTERVAL_MAP[interval] ?? '1'; }

// ── Market data ───────────────────────────────────────────────────────────────

export async function getKlines(symbol, interval, limit = 200, testnet = false) {
  const data = await pub('/v5/market/kline', {
    category: 'spot', symbol, interval: mapInterval(interval), limit,
  }, testnet);
  // Bybit returns newest-first — reverse for chronological order
  return (data.list ?? []).reverse().map(k => ({
    ts:     parseInt(k[0]),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function get24h(symbol, testnet = false) {
  const data = await pub('/v5/market/tickers', { category: 'spot', symbol }, testnet);
  const t = data.list?.[0] ?? {};
  return {
    priceChangePercent: parseFloat(t.price24hPcnt ?? 0) * 100,
    lastPrice:          parseFloat(t.lastPrice ?? 0),
  };
}

export async function getPrice(symbol, testnet = false) {
  return (await get24h(symbol, testnet)).lastPrice;
}

// ── Instruments info ──────────────────────────────────────────────────────────

export async function getLotSize(symbol, testnet = false) {
  const data = await pub('/v5/market/instruments-info', { category: 'spot', symbol }, testnet);
  const f = data.list?.[0]?.lotSizeFilter ?? {};
  return {
    stepSize:    parseFloat(f.basePrecision ?? '0.00001'),
    minQty:      parseFloat(f.minOrderQty   ?? '0.00001'),
    minNotional: parseFloat(f.minOrderAmt   ?? '1'),
  };
}

export function floorQty(qty, stepSize) {
  if (!stepSize || stepSize <= 0) return qty;
  const precision = Math.round(-Math.log10(stepSize));
  const factor    = Math.pow(10, precision);
  return Math.floor(qty * factor) / factor;
}

// ── Account ───────────────────────────────────────────────────────────────────

export async function getBalance(coin, apiKey, secret, testnet = false) {
  const data     = await priv('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED', coin }, apiKey, secret, testnet);
  const coinData = data.list?.[0]?.coin?.find(c => c.coin === coin);
  return parseFloat(coinData?.walletBalance ?? 0);
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function waitForFill(orderId, apiKey, secret, testnet) {
  await new Promise(r => setTimeout(r, 600));
  try {
    const data = await priv('GET', '/v5/execution/list', {
      category: 'spot', orderId, limit: '5',
    }, apiKey, secret, testnet);
    const execs = data.list ?? [];
    const execQty   = execs.reduce((s, e) => s + parseFloat(e.execQty   ?? 0), 0);
    const execValue = execs.reduce((s, e) => s + parseFloat(e.execValue ?? 0), 0);
    return { executedQty: String(execQty), cummulativeQuoteQty: String(execValue) };
  } catch {
    return { executedQty: '0', cummulativeQuoteQty: '0' };
  }
}

// Spend quote currency (e.g. 100 USDT) — compatible with Binance quoteOrderQty
export async function marketBuy(symbol, quoteQty, apiKey, secret, testnet = false) {
  const result = await priv('POST', '/v5/order/create', {
    category: 'spot', symbol,
    side: 'Buy', orderType: 'Market',
    qty: Number(quoteQty).toFixed(2),
    marketUnit: 'quoteCoin',
    timeInForce: 'IOC',
  }, apiKey, secret, testnet);
  return waitForFill(result.orderId, apiKey, secret, testnet);
}

// Sell base asset quantity (e.g. 0.05 ETH)
export async function marketSell(symbol, quantity, apiKey, secret, testnet = false) {
  const result = await priv('POST', '/v5/order/create', {
    category: 'spot', symbol,
    side: 'Sell', orderType: 'Market',
    qty: String(quantity),
    timeInForce: 'IOC',
  }, apiKey, secret, testnet);
  return waitForFill(result.orderId, apiKey, secret, testnet);
}

// ── Symbol helpers ────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
  ETH: 'ETHUSDT', BTC: 'BTCUSDT', SOL: 'SOLUSDT',
  ARB: 'ARBUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT',
};

export function getBybitSymbol(basePair) { return SYMBOL_MAP[basePair] ?? null; }
export function getBaseAsset(symbol)     { return symbol.replace(/USDT$|USDC$/, ''); }
export function getQuoteAsset(symbol)    { return symbol.endsWith('USDC') ? 'USDC' : 'USDT'; }
