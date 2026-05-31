// Classification Decision Tree (used by Random Forest)
export class DecisionTree {
  constructor({ maxDepth = 6, minSamples = 5, maxFeatures = null } = {}) {
    this.maxDepth = maxDepth;
    this.minSamples = minSamples;
    this.maxFeatures = maxFeatures;
    this.tree = null;
    this.featureImportance = {};
  }

  _gini(labels) {
    const n = labels.length;
    if (n === 0) return 0;
    const counts = {};
    for (const l of labels) counts[l] = (counts[l] || 0) + 1;
    let imp = 1;
    for (const c of Object.values(counts)) imp -= (c / n) ** 2;
    return imp;
  }

  _sampleFeatureIndices(total) {
    const n = this.maxFeatures || Math.ceil(Math.sqrt(total));
    const indices = Array.from({ length: total }, (_, i) => i);
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, Math.min(n, total));
  }

  _bestSplit(X, y) {
    const n = y.length;
    const parentGini = this._gini(y);
    let bestGain = -Infinity, bestFeature = null, bestThreshold = null;
    const featureIndices = this._sampleFeatureIndices(X[0].length);

    for (const fi of featureIndices) {
      const vals = X.map(x => x[fi]).sort((a, b) => a - b);
      const unique = [...new Set(vals)];
      for (let i = 0; i < unique.length - 1; i++) {
        const threshold = (unique[i] + unique[i + 1]) / 2;
        const leftY = [], rightY = [];
        for (let k = 0; k < n; k++) {
          (X[k][fi] <= threshold ? leftY : rightY).push(y[k]);
        }
        if (leftY.length < this.minSamples || rightY.length < this.minSamples) continue;
        const gain = parentGini
          - (leftY.length / n) * this._gini(leftY)
          - (rightY.length / n) * this._gini(rightY);
        if (gain > bestGain) { bestGain = gain; bestFeature = fi; bestThreshold = threshold; }
      }
    }
    return { feature: bestFeature, threshold: bestThreshold, gain: bestGain };
  }

  _leaf(y) {
    const counts = {};
    for (const l of y) counts[l] = (counts[l] || 0) + 1;
    const total = y.length;
    const probs = {};
    for (const [cls, cnt] of Object.entries(counts)) probs[cls] = cnt / total;
    return { isLeaf: true, probs };
  }

  _buildNode(X, y, depth) {
    if (y.length < this.minSamples || depth >= this.maxDepth) return this._leaf(y);
    const { feature, threshold, gain } = this._bestSplit(X, y);
    if (feature === null || gain <= 0) return this._leaf(y);

    this.featureImportance[feature] = (this.featureImportance[feature] || 0) + gain * y.length;

    const leftX = [], leftY = [], rightX = [], rightY = [];
    for (let i = 0; i < y.length; i++) {
      if (X[i][feature] <= threshold) { leftX.push(X[i]); leftY.push(y[i]); }
      else { rightX.push(X[i]); rightY.push(y[i]); }
    }
    return { feature, threshold, left: this._buildNode(leftX, leftY, depth + 1), right: this._buildNode(rightX, rightY, depth + 1) };
  }

  fit(X, y) {
    this.featureImportance = {};
    this.tree = this._buildNode(X, y, 0);
    const total = Object.values(this.featureImportance).reduce((a, b) => a + b, 0);
    if (total > 0) for (const k of Object.keys(this.featureImportance)) this.featureImportance[k] /= total;
    return this;
  }

  _predictNode(node, x) {
    if (node.isLeaf) return node.probs;
    return x[node.feature] <= node.threshold ? this._predictNode(node.left, x) : this._predictNode(node.right, x);
  }

  predict(x) { return this._predictNode(this.tree, x); }
  predictBinary(x) { const p = this.predict(x); return p['1'] || p[1] || 0; }
}

// Regression Decision Tree (used by Gradient Boosting)
export class RegressionTree {
  constructor({ maxDepth = 4, minSamples = 5 } = {}) {
    this.maxDepth = maxDepth;
    this.minSamples = minSamples;
    this.tree = null;
  }

  _mse(y) {
    if (y.length === 0) return 0;
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    return y.reduce((s, v) => s + (v - mean) ** 2, 0) / y.length;
  }

  _bestSplit(X, y) {
    const n = y.length;
    const nFeatures = X[0].length;
    const nSample = Math.ceil(Math.sqrt(nFeatures));
    const features = Array.from({ length: nFeatures }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, nSample);
    let bestMse = Infinity, bestFeature = null, bestThreshold = null;

    for (const fi of features) {
      const unique = [...new Set(X.map(x => x[fi]))].sort((a, b) => a - b);
      for (let i = 0; i < unique.length - 1; i++) {
        const threshold = (unique[i] + unique[i + 1]) / 2;
        const leftY = [], rightY = [];
        for (let k = 0; k < n; k++) (X[k][fi] <= threshold ? leftY : rightY).push(y[k]);
        if (leftY.length < 2 || rightY.length < 2) continue;
        const mse = (leftY.length * this._mse(leftY) + rightY.length * this._mse(rightY)) / n;
        if (mse < bestMse) { bestMse = mse; bestFeature = fi; bestThreshold = threshold; }
      }
    }
    return { feature: bestFeature, threshold: bestThreshold };
  }

  _buildNode(X, y, depth) {
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    if (y.length < this.minSamples || depth >= this.maxDepth) return { isLeaf: true, value: mean };
    const { feature, threshold } = this._bestSplit(X, y);
    if (feature === null) return { isLeaf: true, value: mean };
    const leftX = [], leftY = [], rightX = [], rightY = [];
    for (let i = 0; i < y.length; i++) {
      if (X[i][feature] <= threshold) { leftX.push(X[i]); leftY.push(y[i]); }
      else { rightX.push(X[i]); rightY.push(y[i]); }
    }
    return { feature, threshold, left: this._buildNode(leftX, leftY, depth + 1), right: this._buildNode(rightX, rightY, depth + 1) };
  }

  fit(X, y) { this.tree = this._buildNode(X, y, 0); return this; }

  _predictNode(node, x) {
    if (node.isLeaf) return node.value;
    return x[node.feature] <= node.threshold ? this._predictNode(node.left, x) : this._predictNode(node.right, x);
  }

  predict(x) { return this._predictNode(this.tree, x); }
}
