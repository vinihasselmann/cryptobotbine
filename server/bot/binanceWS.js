import WebSocket from 'ws';

// Binance.com is reachable from AWS for public market data streams.
// Binance.US blocks AWS IPs on WebSocket connections.
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const WS_TEST = 'wss://testnet.binance.vision/ws';

const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 min — Binance drops idle streams after 24h; ping keeps it alive

export class BinanceKlineStream {
  constructor({ symbol, interval, onCandle, onConnect, onDisconnect, testnet = false }) {
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.onCandle = onCandle;
    this.onConnect = onConnect ?? (() => {});
    this.onDisconnect = onDisconnect ?? (() => {});
    this.testnet = testnet;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.closed = false;
    this.connectedAt = null;
  }

  start() {
    this.closed = false;
    this._connect();
  }

  _connect() {
    if (this.closed) return;
    const base = this.testnet ? WS_TEST : WS_BASE;
    const url = `${base}/${this.symbol}@kline_${this.interval}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connectedAt = Date.now();
      this._startPing();
      this.onConnect();
    });

    this.ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        const k = msg.k;
        if (!k) return;
        this.onCandle({
          ts: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        });
      } catch {}
    });

    this.ws.on('error', () => {}); // swallow — close triggers reconnect

    this.ws.on('close', () => {
      this._stopPing();
      this.onDisconnect();
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this._connect(), 3000);
      }
    });
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  stop() {
    this.closed = true;
    this._stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
  }

  isConnected() { return this.ws?.readyState === WebSocket.OPEN; }
}
