import { getJournal } from './tradeJournal';

const MODEL_KEY = 'cryptobot.adaptiveModels.v1';
const MIN_SAMPLES = 6;
const FEATURE_NAMES = [
  'rsiBias',
  'macdHist',
  'emaBias',
  'bbBias',
  'volumeRatio',
  'momentum5',
  'momentum10',
  'vwapBias',
  'atrPct',
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNum(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function modelKey(context) {
  return [
    context.basePair,
    context.quotePair,
    context.timeframe,
    context.strategy,
  ].join(':');
}

function readModels() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(MODEL_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeModels(models) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(models));
}

export function indicatorsToVector(indicators = {}) {
  const price = safeNum(indicators.price, 1) || 1;
  return [
    clamp((50 - safeNum(indicators.rsi, 50)) / 50, -1, 1),
    clamp(safeNum(indicators.macdHist) / price * 250, -1, 1),
    clamp(-safeNum(indicators.priceToEMA9) * 80, -1, 1),
    clamp((0.5 - safeNum(indicators.bbPosition, 0.5)) * 2, -1, 1),
    clamp((safeNum(indicators.volumeRatio, 1) - 1) / 2, -1, 1),
    clamp(safeNum(indicators.momentum5) * 80, -1, 1),
    clamp(safeNum(indicators.momentum10) * 60, -1, 1),
    clamp(-safeNum(indicators.priceToVWAP) * 80, -1, 1),
    clamp(safeNum(indicators.atr) / price * 100, 0, 1),
  ];
}

function dot(weights, vector) {
  return weights.reduce((sum, weight, index) => sum + weight * vector[index], 0);
}

export function getAdaptiveModel(context) {
  const models = readModels();
  return models[modelKey(context)] ?? null;
}

export function trainAdaptiveModel(context, journal = getJournal()) {
  const key = modelKey(context);
  const examples = journal.trades
    .filter((trade) =>
      trade.status === 'closed' &&
      trade.basePair === context.basePair &&
      trade.quotePair === context.quotePair &&
      trade.timeframe === context.timeframe &&
      trade.strategy === context.strategy &&
      trade.entryIndicators
    )
    .map((trade) => ({
      x: indicatorsToVector(trade.entryIndicators),
      y: (trade.pnl ?? 0) > 0 ? 1 : 0,
    }));

  const weights = Array(FEATURE_NAMES.length).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < 80; epoch++) {
    const lr = 0.08 * (1 - epoch / 100);
    for (const example of examples) {
      const p = sigmoid(dot(weights, example.x) + bias);
      const error = example.y - p;
      for (let i = 0; i < weights.length; i++) {
        weights[i] += lr * error * example.x[i];
      }
      bias += lr * error;
    }
  }

  let correct = 0;
  for (const example of examples) {
    const p = sigmoid(dot(weights, example.x) + bias);
    if ((p >= 0.5 ? 1 : 0) === example.y) correct++;
  }

  const model = {
    key,
    featureNames: FEATURE_NAMES,
    weights: weights.map((w) => Number(w.toFixed(6))),
    bias: Number(bias.toFixed(6)),
    samples: examples.length,
    accuracy: examples.length ? Number((correct / examples.length * 100).toFixed(2)) : 0,
    trainedAt: Date.now(),
    active: examples.length >= MIN_SAMPLES,
  };

  const models = readModels();
  models[key] = model;
  writeModels(models);
  return model;
}

export function predictAdaptive(indicators, model) {
  if (!model?.active) return null;
  const vector = indicatorsToVector(indicators);
  const probability = sigmoid(dot(model.weights, vector) + model.bias);
  const score = clamp((probability - 0.5) * 200, -100, 100);
  return {
    probability,
    score,
    confidence: clamp(Math.abs(score), 0, 98),
  };
}

export function blendAdaptivePrediction(prediction, adaptive) {
  if (!adaptive) return prediction;

  const blendedScore = prediction.score * 0.7 + adaptive.score * 0.3;
  const signal = blendedScore > 18 ? 'buy'
    : blendedScore < -18 ? 'sell'
    : 'hold';
  const confidence = signal === 'hold'
    ? Math.min(45, Math.abs(blendedScore) * 1.5)
    : Math.min(98, 42 + (Math.abs(blendedScore) - 18) * 1.45);

  return {
    ...prediction,
    signal,
    confidence,
    score: blendedScore,
    adaptive,
    signals: [
      ...(prediction.signals ?? []),
      `Adaptive ${(adaptive.probability * 100).toFixed(0)}%`,
    ].slice(0, 4),
  };
}

export { MIN_SAMPLES };
