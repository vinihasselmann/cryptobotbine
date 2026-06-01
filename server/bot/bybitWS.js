import WebSocket from 'ws';

const WS_PUBLIC = 'wss://stream.bybit.com/v5/public/spot';
const WS_TEST   = 'wss://stream-testnet.bybit.com/v5/public/spot';

// Bybit requires a ping every 20s or the server drops the connection
const PING_INTERVAL_MS = 20_000;

const INTERVAL_MAP = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': 'D',
};

export class BybitKlineStream {
  constructor({ symbol, interval, onCandle, onConnect, onDisconnect, testnet = false }) {
    this.symbol    = symbol.toUpperCase();
    this.interval  = INTERVAL_MAP[interval] ?? '1';
    this.onCandle  = onCandle;
    this.onConnect = onConnect    ?? (() => {});
    this.onDisconnect = onDisconnect ?? (() => {});
    this.testnet   = testnet;
    this.ws        = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.closed    = false;
  }

  start() {
    this.closed = false;
    this._connect();
  }

  _connect() {
    if (this.closed) return;
    this.ws = new WebSocket(this.testnet ? WS_TEST : WS_PUBLIC);

    this.ws.on('open', () => {
      // Subscribe to the kline topic
      this.ws.send(JSON.stringify({
        op:   'subscribe',
        args: [`kline.${this.interval}.${this.symbol}`],
      }));
      this._startPing();
      this.onConnect();
    });

    this.ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        // Skip subscription acks and pongs
        if (msg.op === 'pong' || msg.op === 'subscribe' || msg.ret_msg === 'pong') return;
        if (!Array.isArray(msg.data) || !msg.data.length) return;

        const k = msg.data[0];
        this.onCandle({
          ts:       parseInt(k.start),
          open:     parseFloat(k.open),
          high:     parseFloat(k.high),
          low:      parseFloat(k.low),
          close:    parseFloat(k.close),
          volume:   parseFloat(k.volume),
          isClosed: Boolean(k.confirm),
        });
      } catch {}
    });

    this.ws.on('error', () => {});

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
        this.ws.send(JSON.stringify({ op: 'ping' }));
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
