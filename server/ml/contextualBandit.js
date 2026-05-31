// Thompson Sampling Contextual Bandit for strategy selection
// Each arm (strategy) has a Beta(alpha, beta) distribution over win probability.
// On each pull, we sample and pick the arm with the highest sample.

function gammaSample(a) {
  if (a < 1) return gammaSample(1 + a) * Math.pow(Math.random(), 1 / a);
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = normalSample();
      v = Math.pow(1 + c * x, 3);
    } while (v <= 0);
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normalSample() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-15)) * Math.cos(2 * Math.PI * Math.random());
}

function betaSample(a, b) {
  const x = gammaSample(Math.max(0.1, a));
  const y = gammaSample(Math.max(0.1, b));
  return x / (x + y + 1e-15);
}

export class ContextualBandit {
  constructor(arms = ['ensemble', 'momentum', 'mean-reversion', 'technical']) {
    this.arms = arms;
    this.alpha = {};
    this.beta = {};
    this.counts = {};
    this.rewards = {};
    this.trained = false;

    for (const arm of arms) {
      this.alpha[arm] = 1;
      this.beta[arm] = 1;
      this.counts[arm] = 0;
      this.rewards[arm] = 0;
    }
  }

  selectArm() {
    const samples = {};
    for (const arm of this.arms) samples[arm] = betaSample(this.alpha[arm], this.beta[arm]);
    return this.arms.reduce((best, arm) => samples[arm] > samples[best] ? arm : best, this.arms[0]);
  }

  // reward: 1 = win, 0 = loss (or partial [0,1])
  update(arm, reward) {
    if (!this.arms.includes(arm)) return;
    this.counts[arm]++;
    this.rewards[arm] += reward;
    this.alpha[arm] += reward;
    this.beta[arm] += (1 - reward);
    this.trained = true;
  }

  updateFromTrade(strategy, pnl) {
    const reward = pnl > 0 ? 1 : 0;
    this.update(strategy, reward);
  }

  getArmStats() {
    return this.arms.map(arm => {
      const total = this.alpha[arm] + this.beta[arm] - 2;
      return {
        arm,
        winRate: this.alpha[arm] / (this.alpha[arm] + this.beta[arm]),
        confidence: this.alpha[arm] + this.beta[arm] - 2,
        trades: this.counts[arm],
        totalReward: this.rewards[arm],
      };
    }).sort((a, b) => b.winRate - a.winRate);
  }

  // Reset a single arm (if strategy is performing badly)
  resetArm(arm) {
    if (!this.arms.includes(arm)) return;
    this.alpha[arm] = 1;
    this.beta[arm] = 1;
  }

  serialize() {
    return { arms: this.arms, alpha: this.alpha, beta: this.beta, counts: this.counts, rewards: this.rewards };
  }

  static deserialize(data) {
    const bandit = new ContextualBandit(data.arms);
    bandit.alpha = data.alpha;
    bandit.beta = data.beta;
    bandit.counts = data.counts;
    bandit.rewards = data.rewards;
    bandit.trained = true;
    return bandit;
  }

  getStatus() {
    return { trained: this.trained, arms: this.getArmStats() };
  }
}
