// ML strategy models — ported from src/services/mlEngine.js

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function modelTechnical(f) {
  let score = 0;
  const signals = [];
  if      (f.rsi < 32) { score += 35; signals.push('RSI oversold'); }
  else if (f.rsi < 42) { score += 18; signals.push('RSI near oversold'); }
  else if (f.rsi > 68) { score -= 35; signals.push('RSI overbought'); }
  else if (f.rsi > 58) { score -= 18; signals.push('RSI near overbought'); }
  if      (f.macd.histogram > 0 && f.macd.macd > 0) { score += 25; signals.push('MACD bullish'); }
  else if (f.macd.histogram < 0 && f.macd.macd < 0) { score -= 25; signals.push('MACD bearish'); }
  else if (f.macd.histogram > 0) score += 10;
  else score -= 10;
  if (f.ema9 != null && f.ema21 != null) {
    if (f.ema9 > f.ema21) { score += 20; signals.push('EMA9>EMA21 uptrend'); }
    else score -= 20;
  }
  if      (f.bbPosition < 0.20) { score += 20; signals.push('BB lower bounce'); }
  else if (f.bbPosition > 0.80) { score -= 20; signals.push('BB upper rejection'); }
  if (f.volumeRatio > 1.5) { score += score > 0 ? 10 : -10; signals.push('High volume'); }
  if      (f.priceToVWAP < -0.003) { score += 10; signals.push('Below VWAP'); }
  else if (f.priceToVWAP >  0.003) { score -= 10; signals.push('Above VWAP'); }
  return { score: clamp(score, -100, 100), signals, model: 'Technical Rules' };
}

function modelMomentum(f) {
  let score = 0;
  const signals = [];
  if      (f.momentum5 >  0.006) { score += 30; signals.push('Strong 5p momentum'); }
  else if (f.momentum5 >  0.001) { score += 12; signals.push('Positive 5p momentum'); }
  else if (f.momentum5 < -0.006) { score -= 30; signals.push('Negative 5p momentum'); }
  else if (f.momentum5 < -0.001) { score -= 12; signals.push('Weak 5p momentum'); }
  if      (f.momentum10 >  0.008) { score += 25; signals.push('10p uptrend'); }
  else if (f.momentum10 < -0.008) { score -= 25; signals.push('10p downtrend'); }
  if      (f.stoch.k < 20) { score += 20; signals.push('Stoch oversold'); }
  else if (f.stoch.k > 80) { score -= 20; signals.push('Stoch overbought'); }
  return { score: clamp(score, -100, 100), signals, model: 'Momentum' };
}

function modelMeanReversion(f) {
  let score = 0;
  const signals = [];
  if      (f.priceToEMA9 < -0.004) { score += 35; signals.push('Oversold vs EMA9'); }
  else if (f.priceToEMA9 >  0.004) { score -= 35; signals.push('Overbought vs EMA9'); }
  if (f.bb.bandwidth < 2) { score += 15; signals.push('BB squeeze'); }
  if      (f.bbPosition < 0.25) { score += 25; signals.push('Near BB lower'); }
  else if (f.bbPosition > 0.75) { score -= 25; signals.push('Near BB upper'); }
  if      (f.rsi < 42) score += 20;
  else if (f.rsi > 58) score -= 20;
  return { score: clamp(score, -100, 100), signals, model: 'Mean Reversion' };
}

const WEIGHTS = {
  'ensemble':       [0.40, 0.35, 0.25],
  'momentum':       [0.20, 0.60, 0.20],
  'mean-reversion': [0.30, 0.10, 0.60],
  'technical':      [0.70, 0.15, 0.15],
};

export function mlPredict(features, strategy = 'ensemble') {
  if (!features) return { signal: 'hold', confidence: 0, score: 0, signals: [], breakdown: [] };
  const w = WEIGHTS[strategy] ?? WEIGHTS.ensemble;
  const m1 = modelTechnical(features);
  const m2 = modelMomentum(features);
  const m3 = modelMeanReversion(features);
  let score = m1.score * w[0] + m2.score * w[1] + m3.score * w[2];
  score += (Math.random() - 0.5) * 8;
  score = clamp(score, -100, 100);
  const abs = Math.abs(score);
  const THRESHOLD = 18;
  const signal = score > THRESHOLD ? 'buy' : score < -THRESHOLD ? 'sell' : 'hold';
  const confidence = signal === 'hold'
    ? Math.min(45, abs * 1.5)
    : Math.min(98, 42 + (abs - THRESHOLD) * 1.45);
  return {
    signal, confidence, score,
    signals: [...new Set([...m1.signals, ...m2.signals, ...m3.signals])].slice(0, 4),
    breakdown: [
      { model: m1.model, score: m1.score, weight: w[0] },
      { model: m2.model, score: m2.score, weight: w[1] },
      { model: m3.model, score: m3.score, weight: w[2] },
    ],
    indicators: features,
  };
}
