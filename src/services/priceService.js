const REST = 'https://api.bybit.com/v5';

// Our interval strings → Bybit interval param
const INTERVAL_MAP = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '4h': '240', '1d': 'D',
};

export const TIMEFRAMES = [
  { value: '1m',  label: '1min',  binanceInterval: '1m',  bybitInterval: '1',  aggregateMs: 60_000,    historyLimit: 200 },
  { value: '3m',  label: '3min',  binanceInterval: '3m',  bybitInterval: '3',  aggregateMs: 180_000,   historyLimit: 200 },
  { value: '5m',  label: '5min',  binanceInterval: '5m',  bybitInterval: '5',  aggregateMs: 300_000,   historyLimit: 200 },
  { value: '15m', label: '15min', binanceInterval: '15m', bybitInterval: '15', aggregateMs: 900_000,   historyLimit: 200 },
  { value: '1h',  label: '1h',    binanceInterval: '1h',  bybitInterval: '60', aggregateMs: 3_600_000, historyLimit: 200 },
];

export function getTimeframeConfig(timeframe = '1m') {
  return TIMEFRAMES.find(t => t.value === timeframe) ?? TIMEFRAMES.find(t => t.value === '1m');
}

const SYMBOL_MAP = {
  ETH: 'ETHUSDT', BTC: 'BTCUSDT', SOL: 'SOLUSDT',
  ARB: 'ARBUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT',
};

export function getBybitSymbol(basePair) { return SYMBOL_MAP[basePair] ?? null; }

// Keep alias for backtester imports that still reference getBinanceSymbol
export { getBybitSymbol as getBinanceSymbol };

export async function fetchHistoricalKlines(symbol, limit = 200, interval = '1m') {
  const bybitInterval = INTERVAL_MAP[interval] ?? '1';
  const url = `${REST}/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Bybit REST ${resp.status}`);
  const data = await resp.json();
  if (data.retCode !== 0) throw new Error(data.retMsg || 'Bybit kline error');
  // Bybit returns newest-first — reverse for chronological order
  const list = (data.result?.list ?? []).reverse();
  return list.map(k => ({
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
    ts:     parseInt(k[0]),
  }));
}

export function aggregateCandles(candles, aggregateMs) {
  if (!candles?.length || aggregateMs <= 60_000) return candles ?? [];

  const buckets = new Map();
  for (const candle of candles) {
    const bucketTs = Math.floor(candle.ts / aggregateMs) * aggregateMs;
    const current  = buckets.get(bucketTs);

    if (!current) {
      buckets.set(bucketTs, { ...candle, ts: bucketTs });
      continue;
    }

    current.high   = Math.max(current.high, candle.high);
    current.low    = Math.min(current.low,  candle.low);
    current.close  = candle.close;
    current.volume += candle.volume;
    current.closed  = candle.closed;
  }

  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}
