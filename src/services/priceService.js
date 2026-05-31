// ─── SYMBOL MAP ────────────────────────────────────────────────────────────────
// Maps our token names → Binance trading pair (vs USDT, the most liquid)

export const TOKEN_TO_BINANCE = {
  ETH:   'ETHUSDT',
  WETH:  'ETHUSDT',
  WBTC:  'BTCUSDT',
  cbBTC: 'BTCUSDT',
  ARB:   'ARBUSDT',
  SOL:   'SOLUSDT',
  JUP:   'JUPUSDT',
  AERO:  null,   // não listada na Binance — usa simulação
  USDC:  null,   // stablecoin — sem sentido em trades
  USDT:  null,
};

/**
 * Retorna o símbolo Binance para um token, ou null se não suportado.
 * @param {string} basePair
 * @returns {string | null}
 */
export function getBinanceSymbol(basePair) {
  return TOKEN_TO_BINANCE[basePair] ?? null;
}

export const TIMEFRAMES = [
  { value: '1s',  label: '1s',   binanceInterval: '1s', aggregateMs: 1000,  historyLimit: 300 },
  { value: '5s',  label: '5s',   binanceInterval: '1s', aggregateMs: 5000,  historyLimit: 600 },
  { value: '15s', label: '15s',  binanceInterval: '1s', aggregateMs: 15000, historyLimit: 900 },
  { value: '30s', label: '30s',  binanceInterval: '1s', aggregateMs: 30000, historyLimit: 900 },
  { value: '1m',  label: '1min', binanceInterval: '1m', aggregateMs: 60000, historyLimit: 200 },
  { value: '3m',  label: '3min', binanceInterval: '3m', aggregateMs: 180000, historyLimit: 200 },
  { value: '5m',  label: '5min', binanceInterval: '5m', aggregateMs: 300000, historyLimit: 200 },
];

export function getTimeframeConfig(timeframe = '1m') {
  return TIMEFRAMES.find((t) => t.value === timeframe) ?? TIMEFRAMES.find((t) => t.value === '1m');
}

// ─── REST API ──────────────────────────────────────────────────────────────────

const REST = 'https://api.binance.com/api/v3';

/**
 * Busca candles históricos de 1 minuto na Binance.
 * @param {string} symbol   ex: 'ETHUSDT'
 * @param {number} limit    número de candles (max 1000)
 * @returns {Promise<Array<{open,high,low,close,volume,ts}>>}
 */
export async function fetchHistoricalKlines(symbol, limit = 200, interval = '1m') {
  const url = `${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Binance REST ${resp.status}`);
  const raw = await resp.json();

  return raw.map((k) => ({
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
    ts:     k[0],             // open time em ms
  }));
}

export function aggregateCandles(candles, aggregateMs) {
  if (!candles?.length || aggregateMs <= 1000) return candles ?? [];

  const buckets = new Map();
  for (const candle of candles) {
    const bucketTs = Math.floor(candle.ts / aggregateMs) * aggregateMs;
    const current = buckets.get(bucketTs);

    if (!current) {
      buckets.set(bucketTs, {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        ts: bucketTs,
        closed: candle.closed,
      });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.closed = candle.closed;
  }

  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Busca estatisticas de 24h na Binance.
 * @param {string} symbol ex: 'ETHUSDT'
 * @returns {Promise<{ priceChangePercent: number }>}
 */
export async function fetch24hTicker(symbol) {
  const url = `${REST}/ticker/24hr?symbol=${symbol}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Binance ticker ${resp.status}`);
  const data = await resp.json();
  return {
    priceChangePercent: parseFloat(data.priceChangePercent ?? 0),
  };
}

// ─── WEBSOCKET ─────────────────────────────────────────────────────────────────

const WS_BASE = 'wss://stream.binance.com:9443/ws';

/**
 * Abre um stream de aggTrade da Binance e entrega cada trade via callback.
 * Reconecta automaticamente em caso de queda.
 *
 * @param {string}   symbol    ex: 'ETHUSDT'
 * @param {Function} onTick    ({ price: number, qty: number }) => void
 * @returns {Function}         close() — encerra o WebSocket definitivamente
 */
export function openTradeStream(symbol, onTick) {
  let ws;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@aggTrade`);

    ws.onmessage = (e) => {
      if (closed) return;
      try {
        const d = JSON.parse(e.data);
        onTick({ price: parseFloat(d.p), qty: parseFloat(d.q) });
      } catch {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3000); // reconnect após 3s
    };
  }

  connect();

  return () => {
    closed = true;
    try { ws?.close(); } catch {}
  };
}

/**
 * Abre um stream de candles de 1 minuto da Binance.
 * Entrega candles OHLCV reais em tempo real, incluindo o candle em formacao.
 *
 * @param {string}   symbol    ex: 'ETHUSDT'
 * @param {Function} onCandle  ({ open, high, low, close, volume, ts, closed }) => void
 * @param {Function} onStatus  opcional: ('open' | 'reconnect' | 'error') => void
 * @returns {Function}         close() encerra o WebSocket definitivamente
 */
export function openKlineStream(symbol, interval = '1m', onCandle, onStatus) {
  let ws;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@kline_${interval}`);

    ws.onopen = () => {
      if (!closed) onStatus?.('open');
    };

    ws.onmessage = (e) => {
      if (closed) return;
      try {
        const data = JSON.parse(e.data);
        const k = data.k;
        if (!k) return;

        onCandle({
          open:   parseFloat(k.o),
          high:   parseFloat(k.h),
          low:    parseFloat(k.l),
          close:  parseFloat(k.c),
          volume: parseFloat(k.v),
          ts:     k.t,
          closed: Boolean(k.x),
        });
      } catch {}
    };

    ws.onerror = () => {
      if (!closed) onStatus?.('error');
    };

    ws.onclose = () => {
      if (!closed) {
        onStatus?.('reconnect');
        setTimeout(connect, 3000);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    try { ws?.close(); } catch {}
  };
}
