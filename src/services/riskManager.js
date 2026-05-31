const RISK_KEY = 'cryptobot.riskState.v1';

export const DEFAULT_RISK_CONFIG = {
  enabled: true,
  maxDailyLossPct: 3,
  maxTradesPerHour: 8,
  cooldownAfterLossMs: 5 * 60 * 1000,
  maxConsecutiveLosses: 3,
  riskPerTradePct: 1,
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function defaultState() {
  return {
    day: todayKey(),
    realizedPnl: 0,
    trades: [],
    consecutiveLosses: 0,
    cooldownUntil: 0,
    blockedReason: null,
  };
}

function readState() {
  if (typeof window === 'undefined') return defaultState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RISK_KEY) || 'null');
    if (!parsed || parsed.day !== todayKey()) return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  if (typeof window === 'undefined') return state;
  window.localStorage.setItem(RISK_KEY, JSON.stringify(state));
  return state;
}

export function getRiskState() {
  const state = readState();
  const now = Date.now();
  return {
    ...state,
    tradesLastHour: state.trades.filter((ts) => now - ts < 60 * 60 * 1000).length,
    cooldownActive: state.cooldownUntil > now,
  };
}

export function canOpenTrade({ portfolioValue, tradeAmount, stopLoss, config = DEFAULT_RISK_CONFIG }) {
  const riskConfig = { ...DEFAULT_RISK_CONFIG, ...config };
  const state = getRiskState();
  const now = Date.now();

  if (!riskConfig.enabled) {
    return { allowed: true, amount: tradeAmount, reason: null, state };
  }

  const maxDailyLoss = portfolioValue * (riskConfig.maxDailyLossPct / 100);
  if (state.realizedPnl <= -maxDailyLoss) {
    return { allowed: false, amount: 0, reason: `Perda diaria limite atingida (${riskConfig.maxDailyLossPct}%)`, state };
  }

  if (state.cooldownUntil > now) {
    const minutes = Math.ceil((state.cooldownUntil - now) / 60000);
    return { allowed: false, amount: 0, reason: `Cooldown ativo por ${minutes}min`, state };
  }

  const tradesLastHour = state.trades.filter((ts) => now - ts < 60 * 60 * 1000);
  if (tradesLastHour.length >= riskConfig.maxTradesPerHour) {
    return { allowed: false, amount: 0, reason: `Limite de ${riskConfig.maxTradesPerHour} trades/h atingido`, state };
  }

  if (state.consecutiveLosses >= riskConfig.maxConsecutiveLosses) {
    return { allowed: false, amount: 0, reason: `${state.consecutiveLosses} perdas seguidas`, state };
  }

  const riskBudget = portfolioValue * (riskConfig.riskPerTradePct / 100);
  const maxByRisk = stopLoss > 0 ? riskBudget / (stopLoss / 100) : tradeAmount;
  const amount = Math.max(10, Math.min(tradeAmount, maxByRisk, portfolioValue));

  return { allowed: true, amount, reason: null, state };
}

export function recordTradeOpened() {
  const state = readState();
  const now = Date.now();
  return writeState({
    ...state,
    trades: [...state.trades.filter((ts) => now - ts < 24 * 60 * 60 * 1000), now],
    blockedReason: null,
  });
}

export function recordTradeClosed({ pnl, config = DEFAULT_RISK_CONFIG }) {
  const riskConfig = { ...DEFAULT_RISK_CONFIG, ...config };
  const state = readState();
  const isLoss = pnl < 0;
  const consecutiveLosses = isLoss ? state.consecutiveLosses + 1 : 0;
  return writeState({
    ...state,
    realizedPnl: state.realizedPnl + pnl,
    consecutiveLosses,
    cooldownUntil: isLoss ? Date.now() + riskConfig.cooldownAfterLossMs : state.cooldownUntil,
    blockedReason: null,
  });
}

export function resetRiskState() {
  return writeState(defaultState());
}
