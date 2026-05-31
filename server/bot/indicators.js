// Indicator calculations — ported from src/services/mlEngine.js (browser → Node.js)

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function calcEMA(prices, period) {
  if (prices.length < period) return null;
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

export function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const slice = prices.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  const rs = (gains / period) / ((losses / period) || 0.0001);
  return 100 - 100 / (1 + rs);
}

export function calcMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (ema12 == null || ema26 == null) return { macd: 0, signal: 0, histogram: 0 };
  const macd = ema12 - ema26;
  const signal = macd * 0.85;
  return { macd, signal, histogram: macd - signal };
}

export function calcBollinger(prices, period = 20) {
  const cur = prices[prices.length - 1];
  if (prices.length < period) return { upper: cur * 1.02, mid: cur, lower: cur * 0.98, bandwidth: 4 };
  const slice = prices.slice(-period);
  const mid = slice.reduce((s, p) => s + p, 0) / period;
  const std = Math.sqrt(slice.reduce((s, p) => s + (p - mid) ** 2, 0) / (period - 1));
  const upper = mid + 2 * std, lower = mid - 2 * std;
  return { upper, mid, lower, bandwidth: ((upper - lower) / mid) * 100 };
}

export function calcStochastic(highs, lows, closes, k = 14) {
  if (highs.length < k) return { k: 50, d: 50 };
  const hh = Math.max(...highs.slice(-k));
  const ll = Math.min(...lows.slice(-k));
  const last = closes[closes.length - 1];
  const range = hh - ll;
  const kVal = range === 0 ? 50 : (last - ll) / range * 100;
  return { k: kVal, d: kVal * 0.9 };
}

export function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, t) => s + t, 0) / slice.length;
}

export function calcVWAP(candles) {
  if (!candles?.length) return 0;
  const slice = candles.slice(-20);
  let sumTPV = 0, sumVol = 0;
  for (const c of slice) { const tp = (c.high + c.low + c.close) / 3; sumTPV += tp * c.volume; sumVol += c.volume; }
  return sumVol === 0 ? 0 : sumTPV / sumVol;
}

export function extractFeatures(candles) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const price = closes[closes.length - 1];
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const stoch = calcStochastic(highs, lows, closes);
  const atr = calcATR(highs, lows, closes);
  const vwap = calcVWAP(candles);
  const lastVol = volumes[volumes.length - 1];
  const avg20Vol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const volumeRatio = avg20Vol > 0 ? lastVol / avg20Vol : 1;
  const momentum5 = closes[closes.length - 6] > 0 ? closes[closes.length - 1] / closes[closes.length - 6] - 1 : 0;
  const momentum10 = closes[closes.length - 11] > 0 ? closes[closes.length - 1] / closes[closes.length - 11] - 1 : 0;
  const priceToVWAP = vwap > 0 ? (price - vwap) / vwap : 0;
  const priceToEMA9 = ema9 != null ? (price - ema9) / ema9 : 0;
  const bbRange = bb.upper - bb.lower;
  const bbPosition = bbRange > 0 ? (price - bb.lower) / bbRange : 0.5;
  return { price, rsi, macd, bb, ema9, ema21, ema50, stoch, atr, vwap, volumeRatio, momentum5, momentum10, priceToVWAP, priceToEMA9, bbPosition };
}
