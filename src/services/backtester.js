import { extractFeatures, mlPredict } from './mlEngine';
import {
  aggregateCandles,
  fetchHistoricalKlines,
  getBinanceSymbol,
  getTimeframeConfig,
} from './priceService';

export const BACKTEST_STRATEGIES = ['ensemble', 'momentum', 'mean-reversion', 'technical'];

const DEFAULT_FEE_PCT = 0.10;
const DEFAULT_SLIPPAGE_PCT = 0.03;

function round(value, decimals = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;
}

function calcMaxDrawdown(equityCurve) {
  let peak = 0;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak - point.equity);
  }

  return maxDrawdown;
}

export function summarizeBacktest(trades, initialCapital = 1000) {
  const pnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl >= 0).length;
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const equityCurve = [];
  let equity = initialCapital;

  for (const trade of trades) {
    equity += trade.pnl;
    equityCurve.push({ ts: trade.exitTs, equity });
  }

  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    pnl: round(pnl, 2),
    roiPct: round((pnl / initialCapital) * 100, 2),
    winRate: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? Infinity : 0,
    avgPnl: trades.length ? round(pnl / trades.length, 2) : 0,
    maxDrawdown: round(calcMaxDrawdown(equityCurve), 2),
    equityCurve,
  };
}

export function runBacktest(candles, params) {
  const {
    strategy,
    stopLoss,
    takeProfit,
    minConfidence,
    tradeAmount = 100,
    initialCapital = 1000,
    feePct = DEFAULT_FEE_PCT,
    slippagePct = DEFAULT_SLIPPAGE_PCT,
  } = params;

  const costRate = (feePct + slippagePct) / 100;
  const trades = [];
  let cash = initialCapital;
  let position = null;

  for (let i = 60; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close;

    if (position) {
      const stopPrice = position.entryPrice * (1 - stopLoss / 100);
      const takePrice = position.entryPrice * (1 + takeProfit / 100);
      let exitPrice = null;
      let exitReason = null;

      if (candle.low <= stopPrice) {
        exitPrice = stopPrice;
        exitReason = 'Stop Loss';
      } else if (candle.high >= takePrice) {
        exitPrice = takePrice;
        exitReason = 'Take Profit';
      }

      if (exitPrice != null) {
        const netExitPrice = exitPrice * (1 - costRate);
        const exitValue = position.qty * netExitPrice;
        const pnl = exitValue - position.entryValue;
        cash += exitValue;
        trades.push({
          ...position,
          exitTs: candle.ts,
          exitPrice,
          exitValue,
          pnl,
          pnlPct: (pnl / position.entryValue) * 100,
          durationCandles: i - position.entryIndex,
          exitReason,
        });
        position = null;
      }

      continue;
    }

    if (cash < tradeAmount) continue;

    const features = extractFeatures(candles.slice(0, i + 1));
    const prediction = mlPredict(features, strategy, { randomness: 0 });

    if (prediction.signal === 'buy' && prediction.confidence >= minConfidence) {
      const entryPrice = price * (1 + costRate);
      const qty = tradeAmount / entryPrice;
      cash -= tradeAmount;
      position = {
        entryIndex: i,
        entryTs: candle.ts,
        entryPrice,
        entryValue: tradeAmount,
        qty,
        strategy,
        stopLoss,
        takeProfit,
        minConfidence,
        entryConfidence: prediction.confidence,
        entryScore: prediction.score,
        entrySignals: prediction.signals,
      };
    }
  }

  return {
    params,
    trades,
    summary: summarizeBacktest(trades, initialCapital),
    openPosition: position,
  };
}

function scoreResult(result) {
  const s = result.summary;
  if (s.trades === 0) return -Infinity;
  const tradePenalty = s.trades < 3 ? 25 : 0;
  return s.pnl + s.profitFactor * 8 + s.winRate * 0.15 - s.maxDrawdown * 0.5 - tradePenalty;
}

export async function loadBacktestCandles({ basePair, timeframe }) {
  const symbol = getBinanceSymbol(basePair);
  if (!symbol) throw new Error(`Ativo ${basePair} nao tem par Binance mapeado.`);

  const tf = getTimeframeConfig(timeframe);
  const raw = await fetchHistoricalKlines(symbol, 1000, tf.binanceInterval);
  const candles = aggregateCandles(raw, tf.aggregateMs).slice(-900);
  if (candles.length < 80) throw new Error('Historico insuficiente para backtest.');

  return { symbol, timeframeConfig: tf, candles };
}

export async function runSingleBacktest({ basePair, timeframe, params }) {
  const loaded = await loadBacktestCandles({ basePair, timeframe });
  const result = runBacktest(loaded.candles, params);
  return { ...loaded, result };
}

export async function optimizeStrategy({ basePair, timeframe, tradeAmount = 100 }) {
  const loaded = await loadBacktestCandles({ basePair, timeframe });
  const stopLosses = [0.8, 1.2, 1.8, 2.5, 3.5, 5];
  const takeProfits = [1.5, 2.5, 4, 5, 7.5, 10];
  const confidences = [20, 30, 40, 50, 60];
  const results = [];

  for (const strategy of BACKTEST_STRATEGIES) {
    for (const stopLoss of stopLosses) {
      for (const takeProfit of takeProfits) {
        if (takeProfit <= stopLoss) continue;

        for (const minConfidence of confidences) {
          const result = runBacktest(loaded.candles, {
            strategy,
            stopLoss,
            takeProfit,
            minConfidence,
            tradeAmount,
          });
          results.push({
            ...result,
            score: round(scoreResult(result), 2),
          });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);

  return {
    ...loaded,
    best: results[0] ?? null,
    results: results.slice(0, 8),
    tested: results.length,
  };
}
