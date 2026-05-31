// In-memory risk manager — ported from src/services/riskManager.js (no localStorage)

export const DEFAULT_CONFIG = {
  maxDailyLossPct: 3,
  maxTradesPerHour: 8,
  cooldownAfterLossMs: 5 * 60 * 1000,
  maxConsecutiveLosses: 3,
  riskPerTradePct: 1,
};

function todayKey() { return new Date().toISOString().slice(0, 10); }

export class RiskManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._state = this._default();
  }

  _default() {
    return { day: todayKey(), realizedPnl: 0, trades: [], consecutiveLosses: 0, cooldownUntil: 0 };
  }

  _refresh() {
    if (this._state.day !== todayKey()) this._state = this._default();
  }

  getState() {
    this._refresh();
    const now = Date.now();
    return {
      ...this._state,
      tradesLastHour: this._state.trades.filter(ts => now - ts < 3_600_000).length,
      cooldownActive: this._state.cooldownUntil > now,
    };
  }

  canOpen({ portfolioValue, tradeAmount, stopLoss }) {
    this._refresh();
    const cfg = this.config;
    const state = this._state;
    const now = Date.now();

    const maxLoss = portfolioValue * (cfg.maxDailyLossPct / 100);
    if (state.realizedPnl <= -maxLoss)
      return { allowed: false, amount: 0, reason: `Perda diária (${cfg.maxDailyLossPct}%) atingida` };

    if (state.cooldownUntil > now) {
      const min = Math.ceil((state.cooldownUntil - now) / 60000);
      return { allowed: false, amount: 0, reason: `Cooldown ativo por ${min}min` };
    }

    const tradesLastHour = state.trades.filter(ts => now - ts < 3_600_000).length;
    if (tradesLastHour >= cfg.maxTradesPerHour)
      return { allowed: false, amount: 0, reason: `Limite ${cfg.maxTradesPerHour} trades/h atingido` };

    if (state.consecutiveLosses >= cfg.maxConsecutiveLosses)
      return { allowed: false, amount: 0, reason: `${state.consecutiveLosses} perdas seguidas` };

    const riskBudget = portfolioValue * (cfg.riskPerTradePct / 100);
    const maxByRisk = stopLoss > 0 ? riskBudget / (stopLoss / 100) : tradeAmount;
    const amount = Math.max(10, Math.min(tradeAmount, maxByRisk, portfolioValue * 0.9));
    return { allowed: true, amount, reason: null };
  }

  recordOpened() {
    this._refresh();
    const now = Date.now();
    this._state.trades = [...this._state.trades.filter(ts => now - ts < 86_400_000), now];
  }

  recordClosed(pnl) {
    this._refresh();
    const isLoss = pnl < 0;
    this._state.realizedPnl += pnl;
    this._state.consecutiveLosses = isLoss ? this._state.consecutiveLosses + 1 : 0;
    if (isLoss) this._state.cooldownUntil = Date.now() + this.config.cooldownAfterLossMs;
  }

  reset() { this._state = this._default(); }
}
