import { RegressionTree } from './decisionTree.js';

export class GradientBoosting {
  constructor({ nEstimators = 60, learningRate = 0.1, maxDepth = 3, subsample = 0.8 } = {}) {
    this.nEstimators = nEstimators;
    this.learningRate = learningRate;
    this.maxDepth = maxDepth;
    this.subsample = subsample;
    this.trees = [];
    this.F0 = 0;
    this.trained = false;
    this.trainLoss = [];
  }

  _sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, x)))) }

  _logLoss(y, F) {
    const eps = 1e-15;
    return -y.reduce((s, yi, i) => {
      const p = Math.max(eps, Math.min(1 - eps, this._sigmoid(F[i])));
      return s + yi * Math.log(p) + (1 - yi) * Math.log(1 - p);
    }, 0) / y.length;
  }

  _subsample(X, y) {
    if (this.subsample >= 1) return { X, y };
    const n = Math.floor(X.length * this.subsample);
    const indices = Array.from({ length: X.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, n);
    return { X: indices.map(i => X[i]), y: indices.map(i => y[i]) };
  }

  fit(X, y) {
    const yNum = y.map(Number);
    const n = yNum.length;

    // Initial prediction: log-odds of mean
    const mean = yNum.reduce((a, b) => a + b, 0) / n;
    const clipped = Math.max(1e-6, Math.min(1 - 1e-6, mean));
    this.F0 = Math.log(clipped / (1 - clipped));

    let F = Array(n).fill(this.F0);
    this.trees = [];
    this.trainLoss = [];

    for (let t = 0; t < this.nEstimators; t++) {
      // Pseudo-residuals (negative gradient of log-loss)
      const probs = F.map(f => this._sigmoid(f));
      const residuals = yNum.map((yi, i) => yi - probs[i]);

      // Subsample for this iteration
      const { X: subX, y: subR } = this._subsample(X, residuals);

      const tree = new RegressionTree({ maxDepth: this.maxDepth, minSamples: 4 });
      tree.fit(subX, subR);
      this.trees.push(tree);

      // Update F for all samples
      for (let i = 0; i < n; i++) F[i] += this.learningRate * tree.predict(X[i]);

      if (t % 10 === 0) this.trainLoss.push({ iter: t, loss: this._logLoss(yNum, F) });
    }

    this.trained = true;
    return this;
  }

  predict(x) {
    let F = this.F0;
    for (const tree of this.trees) F += this.learningRate * tree.predict(x);
    return this._sigmoid(F);
  }

  getStatus() {
    return {
      trained: this.trained,
      nEstimators: this.nEstimators,
      learningRate: this.learningRate,
      finalLoss: this.trainLoss.at(-1)?.loss ?? null,
      trainLoss: this.trainLoss,
    };
  }
}
