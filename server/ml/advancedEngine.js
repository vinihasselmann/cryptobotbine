import { RandomForest } from './randomForest.js';
import { GradientBoosting } from './gradientBoosting.js';
import { ContextualBandit } from './contextualBandit.js';
import { WalkForwardValidator } from './walkForward.js';

export const FEATURE_NAMES = [
  'rsi',           // normalized RSI: (rsi - 50) / 50
  'macdHist',      // MACD histogram / ATR
  'ema9Dist',      // EMA9 distance %
  'bbPos',         // Bollinger position [-1,1]
  'volRatio',      // volume / avg volume, capped
  'momentum5',     // 5-period momentum %
  'stochK',        // stochastic K, normalized
  'atrPct',        // ATR / close
  'vwapDist',      // VWAP distance %
  'priceSlope',    // price slope over 5 periods
  'volatility',    // rolling std of returns
  'bbWidth',       // Bollinger band width (squeeze indicator)
];

const STRATEGIES = ['ensemble', 'momentum', 'mean-reversion', 'technical'];

export class AdvancedMLEngine {
  constructor() {
    this.rf = new RandomForest({ nTrees: 50, maxDepth: 6 });
    this.gb = new GradientBoosting({ nEstimators: 60, learningRate: 0.08, maxDepth: 3 });
    this.bandit = new ContextualBandit(STRATEGIES);
    this.validator = new WalkForwardValidator({ folds: 5 });
    this.sampleCount = 0;
    this.lastTrained = null;
    this.lastValidation = null;
  }

  extractFeatures(indicators = {}) {
    const {
      rsi = 50,
      macdHistogram = 0,
      ema9 = 0,
      close = 0,
      bbUpper = 0,
      bbLower = 0,
      bbMiddle = 0,
      volume = 0,
      avgVolume = 1,
      momentum5 = 0,
      stochasticK = 50,
      atr = 0,
      vwap = 0,
      prices = [],
    } = indicators;

    const safeDiv = (a, b) => b !== 0 ? a / b : 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const bbRange = bbUpper - bbLower;
    const bbPos = bbRange > 0 ? clamp((close - bbLower) / bbRange * 2 - 1, -1, 1) : 0;
    const bbWidth = bbMiddle > 0 ? clamp(bbRange / bbMiddle * 10, 0, 1) : 0;
    const ema9Dist = clamp(safeDiv(close - ema9, ema9) * 100, -1, 1);
    const volRatio = clamp(safeDiv(volume, avgVolume), 0, 3) / 3 * 2 - 1;
    const atrPct = clamp(safeDiv(atr, close) * 100, 0, 1);
    const vwapDist = clamp(safeDiv(close - vwap, vwap) * 100, -1, 1);

    const priceSlope = prices.length >= 5
      ? clamp(safeDiv(prices[prices.length - 1] - prices[prices.length - 5], prices[prices.length - 5]) * 100, -1, 1)
      : 0;

    const returns = prices.length >= 10
      ? prices.slice(-10).map((p, i, arr) => i > 0 ? safeDiv(p - arr[i - 1], arr[i - 1]) : 0).slice(1)
      : [];
    const volatility = returns.length > 0
      ? clamp(Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * 100, 0, 1)
      : 0;

    return [
      clamp((rsi - 50) / 50, -1, 1),
      clamp(safeDiv(macdHistogram, atr || 1), -1, 1),
      ema9Dist,
      bbPos,
      volRatio,
      clamp((momentum5 || 0) * 100, -1, 1),
      (stochasticK - 50) / 50,
      atrPct,
      vwapDist,
      priceSlope,
      volatility,
      bbWidth,
    ];
  }

  train(trades) {
    const closed = trades.filter(t => t.indicators && t.pnl !== undefined && t.closed);
    if (closed.length < 10) return { error: `Need 10+ closed trades (have ${closed.length})` };

    const X = closed.map(t => this.extractFeatures(t.indicators));
    const y = closed.map(t => t.pnl > 0 ? 1 : 0);

    this.rf.fit(X, y.map(String));
    this.gb.fit(X, y);

    for (const trade of closed) {
      if (trade.strategy) this.bandit.updateFromTrade(trade.strategy, trade.pnl);
    }

    this.sampleCount = closed.length;
    this.lastTrained = new Date().toISOString();

    if (closed.length >= 20) {
      this.lastValidation = this.validator.validate(X, y, 'rf');
    }

    return this.getStatus();
  }

  predict(indicators) {
    const features = this.extractFeatures(indicators);
    const rfTrained = this.rf.trained;
    const gbTrained = this.gb.trained;

    let rfProb = 0.5, gbProb = 0.5;
    if (rfTrained) rfProb = this.rf.predictBinary(features);
    if (gbTrained) gbProb = this.gb.predict(features);

    const ensemble = rfTrained && gbTrained
      ? (this.sampleCount >= 30 ? 0.5 * rfProb + 0.5 * gbProb : 0.65 * rfProb + 0.35 * gbProb)
      : (rfTrained ? rfProb : gbProb);

    const suggestedStrategy = this.bandit.selectArm();

    // Dynamic SL/TP based on ATR and ML confidence
    const { atr = 0, close = 1 } = indicators;
    const atrPct = close > 0 ? (atr / close) * 100 : 1;
    const dynamicSL = parseFloat(Math.max(0.5, Math.min(5, atrPct * 1.5)).toFixed(2));
    const dynamicTP = parseFloat(Math.max(1, Math.min(10, atrPct * (2 + ensemble * 3))).toFixed(2));
    const expectedReturn = parseFloat((ensemble * dynamicTP - (1 - ensemble) * dynamicSL).toFixed(3));
    const riskScore = parseFloat((1 - ensemble).toFixed(3));

    return {
      probability: ensemble,
      rfProbability: rfTrained ? rfProb : null,
      gbProbability: gbTrained ? gbProb : null,
      suggestedStrategy,
      dynamicSL,
      dynamicTP,
      expectedReturn,
      riskScore,
      trained: rfTrained || gbTrained,
    };
  }

  getStatus() {
    return {
      rf: this.rf.getStatus(),
      gb: this.gb.getStatus(),
      bandit: this.bandit.getStatus(),
      validation: this.lastValidation,
      sampleCount: this.sampleCount,
      lastTrained: this.lastTrained,
      featureNames: FEATURE_NAMES,
    };
  }

  serialize() {
    return {
      sampleCount: this.sampleCount,
      lastTrained: this.lastTrained,
      bandit: this.bandit.serialize(),
    };
  }
}
