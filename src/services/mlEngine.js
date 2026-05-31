// ─── HELPERS ───────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ─── INDICATORS ────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * @param {number[]} prices
 * @param {number}   period
 * @returns {number | null}
 */
export function calcEMA(prices, period) {
  if (prices.length < period) return null;

  // Seed: simple mean of first `period` values
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  const k = 2 / (period + 1);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Relative Strength Index.
 * @param {number[]} prices
 * @param {number}   period
 * @returns {number}
 */
export function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;

  const slice = prices.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains  += diff;
    else          losses += Math.abs(diff);
  }

  const avgGain = gains  / period;
  const avgLoss = losses / period;
  const rs = avgGain / (avgLoss || 0.0001);
  return 100 - 100 / (1 + rs);
}

/**
 * MACD with signal-line approximation.
 * @param {number[]} prices
 * @returns {{ macd: number, signal: number, histogram: number }}
 */
export function calcMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);

  if (ema12 === null || ema26 === null) return { macd: 0, signal: 0, histogram: 0 };

  const macd      = ema12 - ema26;
  const signal    = macd * 0.85;
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Bollinger Bands with sample standard deviation.
 * @param {number[]} prices
 * @param {number}   period
 * @returns {{ upper: number, mid: number, lower: number, bandwidth: number }}
 */
export function calcBollinger(prices, period = 20) {
  const currentPrice = prices[prices.length - 1];

  if (prices.length < period) {
    return {
      upper:     currentPrice * 1.02,
      mid:       currentPrice,
      lower:     currentPrice * 0.98,
      bandwidth: 4,
    };
  }

  const slice   = prices.slice(-period);
  const mid     = slice.reduce((sum, p) => sum + p, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - mid, 2), 0) / (period - 1);
  const std     = Math.sqrt(variance);
  const upper   = mid + 2 * std;
  const lower   = mid - 2 * std;
  const bandwidth = ((upper - lower) / mid) * 100;

  return { upper, mid, lower, bandwidth };
}

/**
 * Stochastic Oscillator.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   k
 * @returns {{ k: number, d: number }}
 */
export function calcStochastic(highs, lows, closes, k = 14) {
  if (highs.length < k || lows.length < k || closes.length < k) {
    return { k: 50, d: 50 };
  }

  const recentHighs = highs.slice(-k);
  const recentLows  = lows.slice(-k);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow   = Math.min(...recentLows);
  const lastClose   = closes[closes.length - 1];

  const range = highestHigh - lowestLow;
  const kVal  = range === 0 ? 50 : (lastClose - lowestLow) / range * 100;
  const dVal  = kVal * 0.9;

  return { k: kVal, d: dVal };
}

/**
 * Average True Range.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   period
 * @returns {number}
 */
export function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < 2) return 0;

  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i]  - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1])
    );
    trs.push(tr);
  }

  if (trs.length === 0) return 0;

  const slice = trs.slice(-period);
  return slice.reduce((sum, tr) => sum + tr, 0) / slice.length;
}

/**
 * Volume-Weighted Average Price (last 20 candles).
 * @param {{ high: number, low: number, close: number, volume: number }[]} candles
 * @returns {number}
 */
export function calcVWAP(candles) {
  if (!candles || candles.length === 0) return 0;

  const slice  = candles.slice(-20);
  let sumTPV   = 0;
  let sumVol   = 0;

  for (const c of slice) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    sumTPV += typicalPrice * c.volume;
    sumVol += c.volume;
  }

  return sumVol === 0 ? 0 : sumTPV / sumVol;
}

// ─── FEATURE EXTRACTION ────────────────────────────────────────────────────────

/**
 * Extracts a flat feature object from an OHLCV candle array.
 * @param {{ open: number, high: number, low: number, close: number, volume: number }[]} candles
 * @returns {object | null}
 */
export function extractFeatures(candles) {
  if (candles.length < 30) return null;

  const closes  = candles.map((c) => c.close);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const price = closes[closes.length - 1];
  const rsi   = calcRSI(closes);
  const macd  = calcMACD(closes);
  const bb    = calcBollinger(closes);
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const stoch = calcStochastic(highs, lows, closes);
  const atr   = calcATR(highs, lows, closes);
  const vwap  = calcVWAP(candles);

  const lastVolume  = volumes[volumes.length - 1];
  const avg20Volume = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
  const volumeRatio = avg20Volume > 0 ? lastVolume / avg20Volume : 1;

  const momentum5  = closes[closes.length - 6]  > 0
    ? closes[closes.length - 1] / closes[closes.length - 6]  - 1
    : 0;
  const momentum10 = closes[closes.length - 11] > 0
    ? closes[closes.length - 1] / closes[closes.length - 11] - 1
    : 0;

  const priceToVWAP = vwap  > 0 ? (price - vwap)  / vwap  : 0;
  const priceToEMA9 = ema9  != null ? (price - ema9) / ema9  : 0;

  const bbRange    = bb.upper - bb.lower;
  const bbPosition = bbRange > 0 ? (price - bb.lower) / bbRange : 0.5;

  return {
    price,
    rsi,
    macd,
    bb,
    ema9,
    ema21,
    ema50,
    stoch,
    atr,
    vwap,
    volumeRatio,
    momentum5,
    momentum10,
    priceToVWAP,
    priceToEMA9,
    bbPosition,
  };
}

// ─── INTERNAL MODELS ───────────────────────────────────────────────────────────

function modelRuleBased(f) {
  let score = 0;
  const signals = [];

  // RSI
  if      (f.rsi < 32) { score += 35; signals.push('RSI oversold'); }
  else if (f.rsi < 42) { score += 18; signals.push('RSI near oversold'); }
  else if (f.rsi > 68) { score -= 35; signals.push('RSI overbought'); }
  else if (f.rsi > 58) { score -= 18; signals.push('RSI near overbought'); }

  // MACD
  if      (f.macd.histogram > 0 && f.macd.macd > 0) { score += 25; signals.push('MACD bullish crossover'); }
  else if (f.macd.histogram < 0 && f.macd.macd < 0) { score -= 25; signals.push('MACD bearish crossover'); }
  else if (f.macd.histogram > 0)                     { score += 10; }
  else                                               { score -= 10; }

  // EMA trend
  if (f.ema9 != null && f.ema21 != null) {
    if (f.ema9 > f.ema21) { score += 20; signals.push('EMA9 > EMA21 uptrend'); }
    else                  { score -= 20; }
  }

  // Bollinger position
  if      (f.bbPosition < 0.20) { score += 20; signals.push('BB lower bounce'); }
  else if (f.bbPosition > 0.80) { score -= 20; signals.push('BB upper rejection'); }

  // Volume confirmation
  if (f.volumeRatio > 1.5) {
    const vol = score > 0 ? 10 : -10;
    score += vol;
    signals.push('High volume confirm');
  }

  // VWAP bias
  if      (f.priceToVWAP < -0.003) { score += 10; signals.push('Below VWAP'); }
  else if (f.priceToVWAP >  0.003) { score -= 10; signals.push('Above VWAP'); }

  return { score: clamp(score, -100, 100), signals, model: 'Technical Rules' };
}

function modelMomentum(f) {
  let score = 0;
  const signals = [];

  // 5-period momentum
  if      (f.momentum5 >  0.006) { score += 30; signals.push('Strong 5-period momentum'); }
  else if (f.momentum5 >  0.001) { score += 12; signals.push('Positive 5-period momentum'); }
  else if (f.momentum5 < -0.006) { score -= 30; signals.push('Negative 5-period momentum'); }
  else if (f.momentum5 < -0.001) { score -= 12; signals.push('Weak 5-period momentum'); }

  // 10-period momentum
  if      (f.momentum10 >  0.008) { score += 25; signals.push('10-period uptrend'); }
  else if (f.momentum10 < -0.008) { score -= 25; signals.push('10-period downtrend'); }

  // Stochastic
  if      (f.stoch.k < 20) { score += 20; signals.push('Stoch oversold'); }
  else if (f.stoch.k > 80) { score -= 20; signals.push('Stoch overbought'); }

  return { score: clamp(score, -100, 100), signals, model: 'Momentum' };
}

function modelMeanReversion(f) {
  let score = 0;
  const signals = [];

  // Price vs EMA9
  if      (f.priceToEMA9 < -0.004) { score += 35; signals.push('Price oversold vs EMA9'); }
  else if (f.priceToEMA9 >  0.004) { score -= 35; signals.push('Price overbought vs EMA9'); }

  // Volatility squeeze
  if (f.bb.bandwidth < 2) { score += 15; signals.push('Low BB bandwidth squeeze'); }

  // Bollinger extremes
  if      (f.bbPosition < 0.25) { score += 25; signals.push('Near BB lower'); }
  else if (f.bbPosition > 0.75) { score -= 25; signals.push('Near BB upper'); }

  // RSI extremes
  if      (f.rsi < 42) { score += 20; }
  else if (f.rsi > 58) { score -= 20; }

  return { score: clamp(score, -100, 100), signals, model: 'Mean Reversion' };
}

// ─── ENSEMBLE ──────────────────────────────────────────────────────────────────

const STRATEGY_WEIGHTS = {
  'ensemble':       [0.40, 0.35, 0.25],
  'momentum':       [0.20, 0.60, 0.20],
  'mean-reversion': [0.30, 0.10, 0.60],
  'technical':      [0.70, 0.15, 0.15],
};

/**
 * Runs all internal models and returns a weighted ensemble prediction.
 * @param {object | null} features  Output of extractFeatures()
 * @param {string}        strategy  'ensemble' | 'momentum' | 'mean-reversion' | 'technical'
 * @returns {{ signal: string, confidence: number, score: number, signals: string[], breakdown: object[], indicators: object }}
 */
export function mlPredict(features, strategy = 'ensemble', options = {}) {
  if (!features) {
    return { signal: 'hold', confidence: 0, score: 0, signals: [], breakdown: [] };
  }

  const w = STRATEGY_WEIGHTS[strategy] ?? STRATEGY_WEIGHTS['ensemble'];

  const m1 = modelRuleBased(features);
  const m2 = modelMomentum(features);
  const m3 = modelMeanReversion(features);

  const randomness = options.randomness ?? 12;
  let finalScore = m1.score * w[0] + m2.score * w[1] + m3.score * w[2];
  finalScore    += (Math.random() - 0.5) * randomness;
  finalScore     = clamp(finalScore, -100, 100);

  const absScore = Math.abs(finalScore);

  const signalThreshold = 18;
  const signal = finalScore >  signalThreshold ? 'buy'
               : finalScore < -signalThreshold ? 'sell'
               :                                 'hold';

  const confidence = signal === 'hold'
    ? Math.min(45, absScore * 1.5)
    : Math.min(98, 42 + (absScore - signalThreshold) * 1.45);

  const allSignals = [
    ...new Set([...m1.signals, ...m2.signals, ...m3.signals]),
  ].slice(0, 4);

  return {
    signal,
    confidence,
    score: finalScore,
    signals: allSignals,
    breakdown: [
      { model: m1.model, score: m1.score, weight: w[0] },
      { model: m2.model, score: m2.score, weight: w[1] },
      { model: m3.model, score: m3.score, weight: w[2] },
    ],
    indicators: features,
  };
}
