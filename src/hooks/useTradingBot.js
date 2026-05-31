/**
 * useTradingBot — polling version.
 *
 * The trading loop now runs on the backend (server/bot/tradingLoop.js).
 * This hook polls /api/bot/state every 2s and exposes the same interface
 * that App.jsx already expects, so the UI needs no structural changes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787') + '/api';
const POLL_MS = 2000;
const CANDLE_POLL_MS = 5000;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

const EMPTY_STATE = {
  botState:     'idle',
  candles:      [],
  prediction:   null,
  trades:       [],
  portfolio:    { usd: 1000, crypto: 0, buyPrice: 0, costBasis: 0 },
  stats:        { wins: 0, losses: 0, totalPnl: 0, maxDrawdown: 0, peakValue: 1000 },
  currentPrice: null,
  priceChange24h: 0,
  logs:         [],
  pendingTx:    null,
  adaptiveModel: null,
  riskState:    {},
  dexQuotes:    null,
};

export function useTradingBot({ chain, basePair, quotePair, strategy, timeframe, config }) {
  const [snap,     setSnap]     = useState(EMPTY_STATE);
  const [candles,  setCandles]  = useState([]);
  const pollRef   = useRef(null);
  const candleRef = useRef(null);

  // ── Poll state ──────────────────────────────────────────────────────────────
  const pollState = useCallback(async () => {
    try {
      const data = await apiFetch('/bot/state');
      setSnap(prev => ({
        ...prev,
        botState:     data.state ?? 'idle',
        prediction:   data.prediction ?? null,
        trades:       data.trades ?? [],
        portfolio:    data.portfolio ?? prev.portfolio,
        stats:        data.stats ?? prev.stats,
        currentPrice: data.currentPrice ?? prev.currentPrice,
        priceChange24h: data.change24h ?? 0,
        logs:         data.logs ?? [],
        adaptiveModel: data.adaptiveModel ?? null,
        riskState:    data.riskState ?? {},
      }));
    } catch {}
  }, []);

  const pollCandles = useCallback(async () => {
    try {
      const data = await apiFetch('/bot/candles');
      if (Array.isArray(data) && data.length > 0) setCandles(data);
    } catch {}
  }, []);

  useEffect(() => {
    pollState();
    pollCandles();
    pollRef.current   = setInterval(pollState,   POLL_MS);
    candleRef.current = setInterval(pollCandles, CANDLE_POLL_MS);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(candleRef.current);
    };
  }, [pollState, pollCandles]);

  // ── Controls ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    const cfg = {
      basePair, quotePair: 'USDT', strategy, timeframe,
      executionMode: config.executionMode,
      tradeAmount: config.tradeAmount,
      stopLoss: config.stopLoss,
      takeProfit: config.takeProfit,
      minConfidence: config.minConfidence,
      paper: config.paper,
    };
    try {
      await apiFetch('/bot/start', { method: 'POST', body: JSON.stringify(cfg) });
      await pollState();
    } catch {}
  }, [basePair, strategy, timeframe, config, pollState]);

  const pause = useCallback(async () => {
    try { await apiFetch('/bot/pause', { method: 'POST' }); await pollState(); } catch {}
  }, [pollState]);

  const resume = useCallback(async () => {
    try { await apiFetch('/bot/resume', { method: 'POST' }); await pollState(); } catch {}
  }, [pollState]);

  const stop = useCallback(async () => {
    try { await apiFetch('/bot/stop', { method: 'POST' }); await pollState(); } catch {}
  }, [pollState]);

  // Push config changes to backend while bot is running
  useEffect(() => {
    if (snap.botState !== 'running' && snap.botState !== 'paused') return;
    apiFetch('/bot/config', {
      method: 'POST',
      body: JSON.stringify({
        strategy, timeframe,
        executionMode: config.executionMode,
        tradeAmount: config.tradeAmount,
        stopLoss: config.stopLoss,
        takeProfit: config.takeProfit,
        minConfidence: config.minConfidence,
        paper: config.paper,
      }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, timeframe, config.stopLoss, config.takeProfit, config.minConfidence, config.tradeAmount]);

  return {
    botState:     snap.botState,
    candles,
    prediction:   snap.prediction,
    trades:       snap.trades,
    portfolio:    snap.portfolio,
    stats:        snap.stats,
    currentPrice: snap.currentPrice,
    priceChange24h: snap.priceChange24h,
    logs:         snap.logs,
    pendingTx:    null,
    adaptiveModel: snap.adaptiveModel,
    riskState:    snap.riskState,
    dexQuotes:    null,
    start, pause, resume, stop,
  };
}
