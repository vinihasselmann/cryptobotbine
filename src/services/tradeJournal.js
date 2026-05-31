import { syncJournalToBackend } from './backendClient';

const JOURNAL_KEY = 'cryptobot.learningJournal.v1';
const JOURNAL_EVENT = 'cryptobot:journal-updated';
const MAX_SIGNALS = 2500;
const MAX_TRADES = 1000;

const EMPTY_JOURNAL = {
  signals: [],
  trades: [],
};

function safeRead() {
  if (typeof window === 'undefined') return EMPTY_JOURNAL;

  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return { ...EMPTY_JOURNAL };
    const parsed = JSON.parse(raw);
    return {
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      trades:  Array.isArray(parsed.trades)  ? parsed.trades  : [],
    };
  } catch {
    return { ...EMPTY_JOURNAL };
  }
}

function writeJournal(journal) {
  if (typeof window === 'undefined') return;

  const next = {
    signals: journal.signals.slice(-MAX_SIGNALS),
    trades:  journal.trades.slice(-MAX_TRADES),
  };

  window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(JOURNAL_EVENT, { detail: next }));
  syncJournalToBackend(next).catch(() => {});
}

function round(value, decimals = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function compactIndicators(indicators = {}) {
  return {
    price:        round(indicators.price, 4),
    rsi:          round(indicators.rsi, 2),
    macd:         round(indicators.macd?.macd, 6),
    macdSignal:   round(indicators.macd?.signal, 6),
    macdHist:     round(indicators.macd?.histogram, 6),
    ema9:         round(indicators.ema9, 4),
    ema21:        round(indicators.ema21, 4),
    ema50:        round(indicators.ema50, 4),
    bbPosition:   round(indicators.bbPosition, 4),
    bbBandwidth:  round(indicators.bb?.bandwidth, 4),
    stochK:       round(indicators.stoch?.k, 2),
    atr:          round(indicators.atr, 6),
    vwap:         round(indicators.vwap, 4),
    volumeRatio:  round(indicators.volumeRatio, 4),
    momentum5:    round(indicators.momentum5, 6),
    momentum10:   round(indicators.momentum10, 6),
    priceToVWAP:  round(indicators.priceToVWAP, 6),
    priceToEMA9:  round(indicators.priceToEMA9, 6),
  };
}

function makeContext(context) {
  return {
    chain:     context.chain,
    pair:      `${context.basePair}/${context.quotePair}`,
    basePair:  context.basePair,
    quotePair: context.quotePair,
    timeframe: context.timeframe,
    strategy:  context.strategy,
    source:    context.source,
  };
}

export function getJournal() {
  return safeRead();
}

export function subscribeJournal(callback) {
  if (typeof window === 'undefined') return () => {};

  const handler = (event) => callback(event.detail ?? safeRead());
  window.addEventListener(JOURNAL_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(JOURNAL_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function recordSignal({ context, candle, prediction, actionTaken = 'none', note = '' }) {
  const journal = safeRead();
  const signal = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    recordedAt: Date.now(),
    candleTs: candle?.ts ?? Date.now(),
    ...makeContext(context),
    price: round(candle?.close, 6),
    signal: prediction?.signal ?? 'hold',
    confidence: round(prediction?.confidence, 2),
    score: round(prediction?.score, 2),
    actionTaken,
    note,
    signals: prediction?.signals ?? [],
    indicators: compactIndicators(prediction?.indicators),
  };

  writeJournal({
    ...journal,
    signals: [...journal.signals, signal],
  });
}

export function recordTradeOpen({ context, entryPrice, qty, amountUsd, reason, prediction }) {
  const journal = safeRead();
  const tradeId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const trade = {
    id: tradeId,
    status: 'open',
    openedAt: Date.now(),
    closedAt: null,
    ...makeContext(context),
    entryPrice: round(entryPrice, 6),
    exitPrice: null,
    qty: round(qty, 12),
    amountUsd: round(amountUsd, 2),
    exitValue: null,
    pnl: null,
    pnlPct: null,
    durationMs: null,
    exitReason: null,
    entryReason: reason,
    entrySignal: prediction?.signal ?? null,
    entryConfidence: round(prediction?.confidence, 2),
    entryScore: round(prediction?.score, 2),
    entryIndicators: compactIndicators(prediction?.indicators),
  };

  writeJournal({
    ...journal,
    trades: [...journal.trades, trade],
  });

  return tradeId;
}

export function recordTradeClose({ tradeId, exitPrice, exitValue, pnl, exitReason }) {
  const journal = safeRead();
  const idx = journal.trades.findIndex((t) => t.id === tradeId);
  if (idx < 0) return null;

  const trade = journal.trades[idx];
  const closedAt = Date.now();
  const closed = {
    ...trade,
    status: 'closed',
    closedAt,
    exitPrice: round(exitPrice, 6),
    exitValue: round(exitValue, 2),
    pnl: round(pnl, 2),
    pnlPct: trade.amountUsd ? round((pnl / trade.amountUsd) * 100, 4) : null,
    durationMs: closedAt - trade.openedAt,
    exitReason,
  };

  const trades = [...journal.trades];
  trades[idx] = closed;
  writeJournal({ ...journal, trades });
  return closed;
}

export function clearJournal() {
  writeJournal({ ...EMPTY_JOURNAL });
}

function emptyMetrics(key = 'Total') {
  return {
    key,
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    winRate: 0,
    profitFactor: 0,
    avgPnl: 0,
    maxDrawdown: 0,
    avgDurationMs: 0,
  };
}

function finalizeMetrics(metrics) {
  metrics.losses = metrics.trades - metrics.wins;
  metrics.winRate = metrics.trades ? (metrics.wins / metrics.trades) * 100 : 0;
  metrics.profitFactor = metrics.grossLoss > 0
    ? metrics.grossProfit / metrics.grossLoss
    : metrics.grossProfit > 0 ? Infinity : 0;
  metrics.avgPnl = metrics.trades ? metrics.pnl / metrics.trades : 0;
  return metrics;
}

function addTrade(metrics, trade) {
  metrics.trades += 1;
  metrics.pnl += trade.pnl ?? 0;
  if ((trade.pnl ?? 0) >= 0) {
    metrics.wins += 1;
    metrics.grossProfit += trade.pnl ?? 0;
  } else {
    metrics.grossLoss += Math.abs(trade.pnl ?? 0);
  }
  metrics.avgDurationMs += trade.durationMs ?? 0;
}

function buildGroupedMetrics(trades, getKey) {
  const groups = new Map();
  for (const trade of trades) {
    const key = getKey(trade);
    if (!groups.has(key)) groups.set(key, emptyMetrics(key));
    addTrade(groups.get(key), trade);
  }

  return [...groups.values()]
    .map((metrics) => {
      metrics.avgDurationMs = metrics.trades ? metrics.avgDurationMs / metrics.trades : 0;
      return finalizeMetrics(metrics);
    })
    .sort((a, b) => b.trades - a.trades || b.pnl - a.pnl);
}

function calcMaxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    equity += trade.pnl ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return maxDrawdown;
}

export function getLearningSummary(journal = safeRead()) {
  const closedTrades = journal.trades
    .filter((t) => t.status === 'closed')
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

  const openTrades = journal.trades.filter((t) => t.status === 'open');
  const total = emptyMetrics('Total');
  for (const trade of closedTrades) addTrade(total, trade);
  total.avgDurationMs = total.trades ? total.avgDurationMs / total.trades : 0;
  finalizeMetrics(total);
  total.maxDrawdown = calcMaxDrawdown(closedTrades);

  return {
    total,
    openTrades: openTrades.length,
    signalCount: journal.signals.length,
    recentSignals: journal.signals.slice(-8).reverse(),
    recentTrades: journal.trades.slice(-8).reverse(),
    byStrategy: buildGroupedMetrics(closedTrades, (t) => t.strategy ?? 'unknown'),
    byTimeframe: buildGroupedMetrics(closedTrades, (t) => t.timeframe ?? 'unknown'),
    byPair: buildGroupedMetrics(closedTrades, (t) => t.pair ?? 'unknown'),
  };
}

export { JOURNAL_EVENT };
