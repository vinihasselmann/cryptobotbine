import { DecisionTree } from './decisionTree.js';

export class RandomForest {
  constructor({ nTrees = 50, maxDepth = 6, minSamples = 5 } = {}) {
    this.nTrees = nTrees;
    this.maxDepth = maxDepth;
    this.minSamples = minSamples;
    this.trees = [];
    this.featureImportance = {};
    this.oobScore = null;
    this.trained = false;
  }

  _bootstrap(X, y) {
    const n = X.length;
    const inBag = new Set();
    const trainX = [], trainY = [];
    for (let i = 0; i < n; i++) {
      const j = Math.floor(Math.random() * n);
      trainX.push(X[j]); trainY.push(y[j]); inBag.add(j);
    }
    const oobIndices = Array.from({ length: n }, (_, i) => i).filter(i => !inBag.has(i));
    return { trainX, trainY, oobX: oobIndices.map(i => X[i]), oobY: oobIndices.map(i => y[i]), oobIndices };
  }

  fit(X, y) {
    if (X.length < 4) throw new Error('Need at least 4 samples');
    this.trees = [];
    this.featureImportance = {};

    // OOB vote accumulator: index → { class → score }
    const oobVotes = Array.from({ length: X.length }, () => ({}));

    for (let t = 0; t < this.nTrees; t++) {
      const { trainX, trainY, oobX, oobY, oobIndices } = this._bootstrap(X, y);
      const tree = new DecisionTree({ maxDepth: this.maxDepth, minSamples: this.minSamples });
      tree.fit(trainX, trainY);
      this.trees.push(tree);

      // Accumulate OOB predictions
      for (let j = 0; j < oobX.length; j++) {
        const probs = tree.predict(oobX[j]);
        const idx = oobIndices[j];
        for (const [cls, p] of Object.entries(probs)) {
          oobVotes[idx][cls] = (oobVotes[idx][cls] || 0) + p;
        }
      }

      // Accumulate feature importance
      for (const [k, v] of Object.entries(tree.featureImportance)) {
        this.featureImportance[k] = (this.featureImportance[k] || 0) + v;
      }
    }

    // Normalize feature importance
    const total = Object.values(this.featureImportance).reduce((a, b) => a + b, 0);
    if (total > 0) for (const k of Object.keys(this.featureImportance)) this.featureImportance[k] /= total;

    // Compute OOB score
    let correct = 0, evaluated = 0;
    for (let i = 0; i < X.length; i++) {
      if (Object.keys(oobVotes[i]).length === 0) continue;
      const pred = Object.entries(oobVotes[i]).sort((a, b) => b[1] - a[1])[0][0];
      if (String(pred) === String(y[i])) correct++;
      evaluated++;
    }
    this.oobScore = evaluated > 0 ? correct / evaluated : null;
    this.trained = true;
    return this;
  }

  predict(x) {
    const votes = {};
    for (const tree of this.trees) {
      for (const [cls, p] of Object.entries(tree.predict(x))) {
        votes[cls] = (votes[cls] || 0) + p;
      }
    }
    const n = this.trees.length;
    for (const k of Object.keys(votes)) votes[k] /= n;
    return votes;
  }

  predictBinary(x) {
    const p = this.predict(x);
    return p['1'] || p[1] || 0;
  }

  getStatus() {
    const sorted = Object.entries(this.featureImportance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([idx, val]) => ({ feature: Number(idx), importance: parseFloat(val.toFixed(4)) }));
    return { trained: this.trained, nTrees: this.nTrees, oobScore: this.oobScore, topFeatures: sorted };
  }
}
