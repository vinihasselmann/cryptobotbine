import WebSocket from 'ws';

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const WS_TEST = 'wss://testnet.binance.vision/ws';

export class BinanceKlineStream {
  constructor({ symbol, interval, onCandle, onConnect, onDisconnect, testnet = false }) {
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.onCandle = onCandle;
    this.onConnect = onConnect ?? (() => {});
    this.onDisconnect = onDisconnect ?? (() => {});
    this.testnet = testnet;
    this.ws = null;
    this.timer = null;
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
      this.onDisconnect();
      if (!this.closed) {
        this.timer = setTimeout(() => this._connect(), 3000);
      }
    });
  }

  stop() {
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
  }

  isConnected() { return this.ws?.readyState === WebSocket.OPEN; }
}
