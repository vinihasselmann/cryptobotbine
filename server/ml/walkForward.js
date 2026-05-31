import { RandomForest } from './randomForest.js';
import { GradientBoosting } from './gradientBoosting.js';

// Walk-forward validation: train on expanding window, test on next fold
export class WalkForwardValidator {
  constructor({ folds = 5 } = {}) {
    this.folds = folds;
    this.lastResults = null;
  }

  validate(X, y, modelType = 'rf') {
    const n = X.length;
    if (n < 20) return { error: 'Need at least 20 samples', folds: [] };

    const foldSize = Math.floor(n / (this.folds + 1));
    const results = [];

    for (let fold = 0; fold < this.folds; fold++) {
      const trainEnd = foldSize * (fold + 2);
      const testStart = trainEnd;
      const testEnd = Math.min(testStart + foldSize, n);
      if (testStart >= n) break;

      const trainX = X.slice(0, trainEnd);
      const trainY = y.slice(0, trainEnd);
      const testX = X.slice(testStart, testEnd);
      const testY = y.slice(testStart, testEnd);

      try {
        let model;
        if (modelType === 'rf') {
          model = new RandomForest({ nTrees: 20, maxDepth: 5 });
          model.fit(trainX, trainY.map(String));
        } else {
          model = new GradientBoosting({ nEstimators: 30, learningRate: 0.1, maxDepth: 3 });
          model.fit(trainX, trainY);
        }

        let correct = 0, tp = 0, fp = 0, fn = 0;
        const predictions = [];

        for (let i = 0; i < testX.length; i++) {
          const prob = modelType === 'rf' ? model.predictBinary(testX[i]) : model.predict(testX[i]);
          const pred = prob >= 0.5 ? 1 : 0;
          const actual = testY[i];
          predictions.push({ prob, pred, actual });
          if (pred === actual) correct++;
          if (pred === 1 && actual === 1) tp++;
          if (pred === 1 && actual === 0) fp++;
          if (pred === 0 && actual === 1) fn++;
        }

        const accuracy = correct / testX.length;
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

        results.push({ fold: fold + 1, trainSize: trainX.length, testSize: testX.length, accuracy, precision, recall, f1 });
      } catch (e) {
        results.push({ fold: fold + 1, error: e.message });
      }
    }

    const valid = results.filter(r => !r.error);
    if (valid.length === 0) return { error: 'All folds failed', folds: results };

    const avg = key => valid.reduce((s, r) => s + r[key], 0) / valid.length;
    const spread = key => {
      const vals = valid.map(r => r[key]);
      return Math.max(...vals) - Math.min(...vals);
    };

    this.lastResults = {
      folds: results,
      avgAccuracy: avg('accuracy'),
      avgPrecision: avg('precision'),
      avgRecall: avg('recall'),
      avgF1: avg('f1'),
      stable: spread('accuracy') < 0.20,
      modelType,
      validatedAt: new Date().toISOString(),
    };
    return this.lastResults;
  }
}
