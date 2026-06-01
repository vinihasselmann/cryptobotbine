import { extractFeatures } from './indicators.js';
import { mlPredict } from './strategies.js';
import { AdaptiveModel } from './adaptiveModel.js';
import { RiskManager } from './riskManager.js';
import { BybitKlineStream } from './bybitWS.js';
import {
  getBybitSymbol, getBaseAsset, getQuoteAsset,
  getKlines, get24h, marketBuy, marketSell,
  getLotSize, floorQty, getBalance,
} from './bybitAPI.js';
import { db } from '../db.js';

// ── Candle aggregation (1m → 5m, 15m, etc.) ──────────────────────────────────

function aggregateCandles(candles, targetMs) {
  if (!targetMs || targetMs <= 60000) return candles;
  const grouped = {};
  for (const c of candles) {
    const bucket = Math.floor(c.ts / targetMs) * targetMs;
    if (!grouped[bucket]) grouped[bucket] = { ts: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    else {
      grouped[bucket].high = Math.max(grouped[bucket].high, c.high);
      grouped[bucket].low = Math.min(grouped[bucket].low, c.low);
      grouped[bucket].close = c.close;
      grouped[bucket].volume += c.volume;
    }
  }
  return Object.values(grouped).sort((a, b) => a.ts - b.ts);
}

const TF_CONFIG = {
  '1m':  { interval: '1m',  aggregateMs: 60_000 },
  '3m':  { interval: '3m',  aggregateMs: 180_000 },
  '5m':  { interval: '5m',  aggregateMs: 300_000 },
  '15m': { interval: '15m', aggregateMs: 900_000 },
  '1h':  { interval: '1h',  aggregateMs: 3_600_000 },
};

// ── Paper execution ───────────────────────────────────────────────────────────

function paperFill(side, price, { feePct = 0.10, slippagePct = 0.03, latencyMs = 450 }) {
  const slip = slippagePct / 100;
  const fee = feePct / 100;
  const fill = side === 'buy' ? price * (1 + slip) : price * (1 - slip);
  return { fill, fee, latencyMs };
}

// ── Main class ────────────────────────────────────────────────────────────────

export class TradingLoop {
  constructor() {
    this.state     = 'idle';  // idle | running | paused | stopped
    this.config    = {
      basePair: 'ETH', strategy: 'ensemble', timeframe: '1m',
      executionMode: 'paper', tradeAmount: 100,
      stopLoss: 2.5, takeProfit: 5.0, minConfidence: 35,
      paper: { feePct: 0.10, slippagePct: 0.03, latencyMs: 450 },
    };
    this.apiKey    = process.env.BYBIT_API_KEY    || process.env.BINANCE_API_KEY    || '';
    this.apiSecret = process.env.BYBIT_API_SECRET || process.env.BINANCE_API_SECRET || '';
    this.testnet   = process.env.BYBIT_TESTNET === 'true';

    this.candles      = [];
    this.prediction   = null;
    this.currentPrice = null;
    this.change24h    = 0;
    this.portfolio    = { usd: 1000, crypto: 0, buyPrice: 0, costBasis: 0 };
    this.stats        = { wins: 0, losses: 0, totalPnl: 0, maxDrawdown: 0, peakValue: 1000 };
    this.trades       = [];
    this.logs         = [];
    this.openTradeId  = null;
    this.tradeInFlight = false;

    this.adaptive  = new AdaptiveModel();
    this.risk      = new RiskManager();
    this.ws        = null;
    this._lastSig  = null;
  }

  // ── Public controls ─────────────────────────────────────────────────────────

  async start(cfg = {}) {
    if (this.state === 'running') return;
    Object.assign(this.config, cfg);
    this.state = 'running';

    const symbol = getBybitSymbol(this.config.basePair);
    if (!symbol) { this._log('error', `Sem par Bybit para ${this.config.basePair}`); this.state = 'idle'; return; }

    const tf = TF_CONFIG[this.config.timeframe] ?? TF_CONFIG['1m'];

    // Load historical candles
    try {
      const raw = await getKlines(symbol, tf.interval, 500, this.testnet);
      this.candles = aggregateCandles(raw, tf.aggregateMs).slice(-200);
      this._log('info', `${this.candles.length} candles históricos carregados (${symbol})`);
    } catch (e) {
      this._log('warn', `Falha ao carregar histórico: ${e.message}`);
    }

    // Load 24h change
    try {
      const t = await get24h(symbol, this.testnet);
      this.change24h = parseFloat(t.priceChangePercent);
    } catch {}

    // Load portfolio from journal for real mode
    if (this.config.executionMode === 'real') {
      await this._syncPortfolioFromBybit(symbol);
    }

    // Train adaptive model from saved journal
    try {
      const journal = await db.getJournal();
      this.adaptive.train({ basePair: this.config.basePair, quotePair: 'USDT', timeframe: this.config.timeframe, strategy: this.config.strategy }, journal.trades || []);
    } catch {}

    // Start WebSocket
    this.ws = new BybitKlineStream({
      symbol, interval: tf.interval, testnet: this.testnet,
      onCandle: c => this._onCandle(c, tf.aggregateMs),
      onConnect: () => this._log('info', `WebSocket Bybit conectado: ${symbol} ${tf.interval}`),
      onDisconnect: () => { if (this.state === 'running') this._log('warn', 'WebSocket desconectado — reconectando...'); },
    });
    this.ws.start();
    this._log('info', `Bot iniciado | ${this.config.basePair} | ${this.config.strategy} | ${this.config.executionMode} | Bybit`);
  }

  pause()  { if (this.state === 'running') { this.state = 'paused';  this._log('info', 'Bot pausado'); } }
  resume() { if (this.state === 'paused')  { this.state = 'running'; this._log('info', 'Bot retomado'); } }

  stop() {
    this.state = 'stopped';
    this.ws?.stop();
    this.ws = null;
    this._log('info', 'Bot parado');
  }

  updateConfig(cfg) {
    const needsRestart = cfg.basePair !== this.config.basePair || cfg.timeframe !== this.config.timeframe;
    Object.assign(this.config, cfg);
    if (needsRestart && this.state === 'running') {
      this.ws?.stop();
      this.start(this.config);
    }
  }

  getSnapshot() {
    return {
      state:        this.state,
      config:       this.config,
      currentPrice: this.currentPrice,
      change24h:    this.change24h,
      portfolio:    this.portfolio,
      stats:        this.stats,
      prediction:   this.prediction,
      trades:       this.trades.slice(0, 50),
      logs:         this.logs.slice(0, 80),
      riskState:    this.risk.getState(),
      adaptiveModel: this.adaptive.getStatus({ basePair: this.config.basePair, quotePair: 'USDT', timeframe: this.config.timeframe, strategy: this.config.strategy }),
      wsConnected:  this.ws?.isConnected() ?? false,
    };
  }

  getCandles() { return this.candles; }

  // ── Candle handler ──────────────────────────────────────────────────────────

  _onCandle(raw, aggregateMs) {
    // Merge into candle array
    const bucket = Math.floor(raw.ts / aggregateMs) * aggregateMs;
    const last = this.candles[this.candles.length - 1];
    if (last?.ts === bucket) {
      this.candles[this.candles.length - 1] = {
        ...last, high: Math.max(last.high, raw.high), low: Math.min(last.low, raw.low),
        close: raw.close, volume: last.volume + (raw.isClosed ? raw.volume : 0),
      };
    } else if (raw.isClosed || !last || raw.ts > last.ts) {
      this.candles = [...this.candles.slice(-199), { ...raw, ts: bucket }];
    }

    this.currentPrice = raw.close;

    // Only act on closed candles (or every tick in paper/sim)
    if (!raw.isClosed && this.config.executionMode !== 'paper' && this.config.executionMode !== 'simulated') return;

    this._processTick(raw.close);
  }

  async _processTick(price) {
    if (this.state !== 'running') return;
    if (this.tradeInFlight) return;

    const features = extractFeatures(this.candles);
    const context = { basePair: this.config.basePair, quotePair: 'USDT', timeframe: this.config.timeframe, strategy: this.config.strategy };
    let pred = mlPredict(features, this.config.strategy);
    const adaptivePred = this.adaptive.predict(context, features);
    pred = this.adaptive.blend(pred, adaptivePred);
    this.prediction = pred;

    const pf = this.portfolio;

    // ── Stop Loss / Take Profit ──
    if (pf.crypto > 0 && pf.buyPrice > 0) {
      const pnlPct = (price - pf.buyPrice) / pf.buyPrice * 100;
      if (price <= pf.buyPrice * (1 - this.config.stopLoss / 100)) {
        await this._sell(price, `Stop Loss (${pnlPct.toFixed(2)}%)`, pred); return;
      }
      if (price >= pf.buyPrice * (1 + this.config.takeProfit / 100)) {
        await this._sell(price, `Take Profit (+${pnlPct.toFixed(2)}%)`, pred); return;
      }
      // Hold — don't override SL/TP with sell signal
      return;
    }

    // ── Buy signal ──
    if (pred.signal === 'buy' && pred.confidence >= this.config.minConfidence && pf.usd >= 10 && pf.crypto === 0) {
      const portfolioValue = pf.usd;
      const riskDecision = this.risk.canOpen({ portfolioValue, tradeAmount: this.config.tradeAmount, stopLoss: this.config.stopLoss });
      if (!riskDecision.allowed) {
        this._log('warn', `Bloqueado pelo risco: ${riskDecision.reason}`);
        return;
      }
      await this._buy(price, pred.signals.slice(0, 2).join(' + '), pred, riskDecision.amount);
    }
  }

  // ── Buy execution ───────────────────────────────────────────────────────────

  async _buy(price, reason, pred, amount) {
    this.tradeInFlight = true;
    const mode = this.config.executionMode;
    let fillPrice = price, qty = amount / price;

    try {
      if (mode === 'real') {
        const symbol = getBybitSymbol(this.config.basePair);
        const { stepSize, minNotional } = await getLotSize(symbol, this.testnet);
        if (amount < minNotional) { this._log('warn', `Valor mínimo Bybit: $${minNotional}`); return; }
        const order = await marketBuy(symbol, amount, this.apiKey, this.apiSecret, this.testnet);
        qty = parseFloat(order.executedQty);
        const spent = parseFloat(order.cummulativeQuoteQty);
        fillPrice = qty > 0 ? spent / qty : price;
        this._log('info', `Bybit BUY executado: ${qty} ${this.config.basePair} @ $${fillPrice.toFixed(4)}`);
      } else if (mode === 'paper') {
        const { fill, fee } = paperFill('buy', price, this.config.paper);
        fillPrice = fill;
        qty = (amount * (1 - fee / 100)) / fill;
        await new Promise(r => setTimeout(r, this.config.paper.latencyMs));
      }

      this.portfolio = { ...this.portfolio, usd: this.portfolio.usd - amount, crypto: qty, buyPrice: fillPrice, costBasis: amount };
      this.risk.recordOpened();

      const tradeId = await this._journalOpen(fillPrice, qty, amount, reason, pred);
      this.openTradeId = tradeId;

      this._log('buy', `BUY ${qty.toFixed(6)} ${this.config.basePair} @ $${fillPrice.toFixed(2)} | ${reason}`);
      this._log('info', `SL $${(fillPrice * (1 - this.config.stopLoss / 100)).toFixed(2)} | TP $${(fillPrice * (1 + this.config.takeProfit / 100)).toFixed(2)}`);
    } catch (e) {
      this._log('error', `Erro na compra: ${e.message}`);
    } finally {
      this.tradeInFlight = false;
    }
  }

  // ── Sell execution ──────────────────────────────────────────────────────────

  async _sell(price, reason, pred) {
    this.tradeInFlight = true;
    const pf = this.portfolio;
    const mode = this.config.executionMode;
    let fillPrice = price, sellValue = pf.crypto * price;

    try {
      if (mode === 'real') {
        const symbol = getBybitSymbol(this.config.basePair);
        const { stepSize } = await getLotSize(symbol, this.testnet);
        const qty = floorQty(pf.crypto, stepSize);
        const order = await marketSell(symbol, qty, this.apiKey, this.apiSecret, this.testnet);
        sellValue = parseFloat(order.cummulativeQuoteQty);
        fillPrice = qty > 0 ? sellValue / qty : price;
        this._log('info', `Bybit SELL executado: ${qty} ${this.config.basePair} @ $${fillPrice.toFixed(4)}`);
      } else if (mode === 'paper') {
        const { fill, fee } = paperFill('sell', price, this.config.paper);
        fillPrice = fill;
        sellValue = pf.crypto * fill * (1 - fee / 100);
        await new Promise(r => setTimeout(r, this.config.paper.latencyMs));
      }

      const pnl = sellValue - (pf.costBasis || pf.buyPrice * pf.crypto);
      const newTotal = pf.usd + sellValue;
      const newPeak = Math.max(this.stats.peakValue, newTotal);
      const drawdown = newPeak > 0 ? (newPeak - newTotal) / newPeak * 100 : 0;

      this.portfolio = { ...pf, usd: newTotal, crypto: 0, buyPrice: 0, costBasis: 0 };
      this.stats = {
        wins: this.stats.wins + (pnl >= 0 ? 1 : 0),
        losses: this.stats.losses + (pnl < 0 ? 1 : 0),
        totalPnl: this.stats.totalPnl + pnl,
        maxDrawdown: Math.max(this.stats.maxDrawdown, drawdown),
        peakValue: newPeak,
      };

      this.trades = [{ id: Date.now(), time: new Date().toLocaleTimeString('pt-BR'), type: 'SELL', price: fillPrice, qty: pf.crypto, total: sellValue, pnl, reason }, ...this.trades].slice(0, 200);
      this.risk.recordClosed(pnl);

      if (this.openTradeId) {
        await this._journalClose(this.openTradeId, fillPrice, sellValue, pnl, reason);
        this.openTradeId = null;
      }

      // Retrain adaptive after each closed trade
      const journal = await db.getJournal();
      this.adaptive.train({ basePair: this.config.basePair, quotePair: 'USDT', timeframe: this.config.timeframe, strategy: this.config.strategy }, journal.trades || []);

      this._log('sell', `SELL ${pf.crypto.toFixed(6)} ${this.config.basePair} @ $${fillPrice.toFixed(2)} | P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | ${reason}`);
    } catch (e) {
      this._log('error', `Erro na venda: ${e.message}`);
    } finally {
      this.tradeInFlight = false;
    }
  }

  // ── Journal helpers ─────────────────────────────────────────────────────────

  async _journalOpen(entryPrice, qty, amountUsd, reason, pred) {
    const tradeId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const journal = await db.getJournal();
    const trade = {
      id: tradeId, status: 'open',
      openedAt: new Date().toISOString(), closedAt: null,
      basePair: this.config.basePair, quotePair: 'USDT',
      pair: `${this.config.basePair}/USDT`,
      timeframe: this.config.timeframe, strategy: this.config.strategy,
      source: this.config.executionMode,
      entryPrice, qty, amountUsd, exitPrice: null, pnl: null, pnlPct: null,
      durationMs: null, exitReason: null, entryReason: reason,
      entryConfidence: pred?.confidence ?? null,
      entryIndicators: pred?.indicators ?? null,
    };
    journal.trades = [...(journal.trades || []), trade];
    await db.setJournal(journal);
    return tradeId;
  }

  async _journalClose(tradeId, exitPrice, exitValue, pnl, exitReason) {
    const journal = await db.getJournal();
    const idx = (journal.trades || []).findIndex(t => t.id === tradeId);
    if (idx < 0) return;
    const trade = journal.trades[idx];
    const closedAt = new Date().toISOString();
    journal.trades[idx] = { ...trade, status: 'closed', closedAt, exitPrice, exitValue, pnl, pnlPct: trade.amountUsd ? pnl / trade.amountUsd * 100 : null, durationMs: new Date(closedAt) - new Date(trade.openedAt), exitReason };
    await db.setJournal(journal);
  }

  // ── Real mode: sync portfolio from Binance ──────────────────────────────────

  async _syncPortfolioFromBybit(symbol) {
    if (!this.apiKey || !this.apiSecret) return;
    try {
      const quote = getQuoteAsset(symbol);
      const base  = getBaseAsset(symbol);
      const [usd, crypto] = await Promise.all([
        getBalance(quote, this.apiKey, this.apiSecret, this.testnet),
        getBalance(base,  this.apiKey, this.apiSecret, this.testnet),
      ]);
      this.portfolio = { usd, crypto, buyPrice: 0, costBasis: 0 };
      this._log('info', `Saldo Bybit: ${usd.toFixed(2)} ${quote} | ${crypto.toFixed(6)} ${base}`);
    } catch (e) {
      this._log('warn', `Falha ao carregar saldo Bybit: ${e.message}`);
    }
  }

  // ── Logging ─────────────────────────────────────────────────────────────────

  _log(type, msg) {
    const entry = { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString('pt-BR'), type, msg };
    this.logs = [entry, ...this.logs].slice(0, 200);
  }
}

// Singleton exported for use in server/index.js
export const bot = new TradingLoop();
