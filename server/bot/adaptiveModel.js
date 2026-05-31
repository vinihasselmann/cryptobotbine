// Logistic regression adaptive model — in-memory (no localStorage)
// Ported from src/services/adaptiveModel.js

const MIN_SAMPLES = 6;

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function safeNum(v, f = 0) { return Number.isFinite(v) ? v : f; }

function toVector(ind = {}) {
  const price = safeNum(ind.price, 1) || 1;
  return [
    clamp((50 - safeNum(ind.rsi, 50)) / 50, -1, 1),
    clamp(safeNum(ind.macdHist) / price * 250, -1, 1),
    clamp(-safeNum(ind.priceToEMA9) * 80, -1, 1),
    clamp((0.5 - safeNum(ind.bbPosition, 0.5)) * 2, -1, 1),
    clamp((safeNum(ind.volumeRatio, 1) - 1) / 2, -1, 1),
    clamp(safeNum(ind.momentum5) * 80, -1, 1),
    clamp(safeNum(ind.momentum10) * 60, -1, 1),
    clamp(-safeNum(ind.priceToVWAP) * 80, -1, 1),
    clamp(safeNum(ind.atr) / price * 100, 0, 1),
  ];
}

function dot(w, x) { return w.reduce((s, wi, i) => s + wi * x[i], 0); }

export class AdaptiveModel {
  constructor() {
    this.models = {};  // key → { weights, bias, samples, accuracy, active }
  }

  _key(context) {
    return [context.basePair, context.quotePair, context.timeframe, context.strategy].join(':');
  }

  train(context, trades) {
    const key = this._key(context);
    const examples = trades
      .filter(t => t.status === 'closed' && t.basePair === context.basePair && t.strategy === context.strategy && t.entryIndicators)
      .map(t => ({ x: toVector(t.entryIndicators), y: (t.pnl ?? 0) > 0 ? 1 : 0 }));

    const weights = Array(9).fill(0);
    let bias = 0;

    for (let epoch = 0; epoch < 80; epoch++) {
      const lr = 0.08 * (1 - epoch / 100);
      for (const { x, y } of examples) {
        const p = sigmoid(dot(weights, x) + bias);
        const err = y - p;
        for (let i = 0; i < weights.length; i++) weights[i] += lr * err * x[i];
        bias += lr * err;
      }
    }

    let correct = 0;
    for (const { x, y } of examples) {
      if ((sigmoid(dot(weights, x) + bias) >= 0.5 ? 1 : 0) === y) correct++;
    }

    this.models[key] = {
      weights, bias,
      samples: examples.length,
      accuracy: examples.length ? correct / examples.length * 100 : 0,
      trainedAt: Date.now(),
      active: examples.length >= MIN_SAMPLES,
    };
    return this.models[key];
  }

  predict(context, features) {
    const model = this.models[this._key(context)];
    if (!model?.active || !features) return null;
    const prob = sigmoid(dot(model.weights, toVector(features)) + model.bias);
    const score = clamp((prob - 0.5) * 200, -100, 100);
    return { probability: prob, score, confidence: clamp(Math.abs(score), 0, 98) };
  }

  blend(base, adaptive) {
    if (!adaptive) return base;
    const score = base.score * 0.7 + adaptive.score * 0.3;
    const signal = score > 18 ? 'buy' : score < -18 ? 'sell' : 'hold';
    const confidence = signal === 'hold'
      ? Math.min(45, Math.abs(score) * 1.5)
      : Math.min(98, 42 + (Math.abs(score) - 18) * 1.45);
    return { ...base, signal, confidence, score, adaptive,
      signals: [...(base.signals ?? []), `Adaptive ${(adaptive.probability * 100).toFixed(0)}%`].slice(0, 4) };
  }

  getStatus(context) {
    const key = this._key(context);
    return this.models[key] ?? null;
  }
}
