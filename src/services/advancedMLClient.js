const BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787') + '/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}: ${path}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Backend ${res.status}: ${path}`);
  return res.json();
}

// ── ML ────────────────────────────────────────────────────────────────────────

export async function trainAdvancedML(trades) {
  return post('/ml/train', { trades });
}

export async function predictAdvancedML(indicators) {
  return post('/ml/predict', { indicators });
}

export async function getMLStatus() {
  return get('/ml/status');
}

export async function runWalkForward(trades, modelType = 'rf') {
  return post('/ml/validate', { trades, modelType });
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function getFullHealth() {
  return get('/health');
}

export async function reportFeedLatency(latencyMs) {
  return post('/health/feed', { latencyMs });
}

export async function reportClientError(component, message, severity = 'error') {
  return post('/health/error', { component, message, severity }).catch(() => {});
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function getAlertConfig() {
  return get('/alerts/config');
}

export async function saveAlertConfig(config) {
  return post('/alerts/config', config);
}

export async function testAlert(message = 'Teste de alerta CryptoBot!') {
  return post('/alerts/test', { message });
}

export async function sendAlert(type, data) {
  return post('/alerts/send', { type, data }).catch(() => {});
}

export async function getAlertHistory(limit = 50) {
  return get(`/alerts/history?limit=${limit}`);
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function generateDailyReport(trades, date = null) {
  return post('/report/daily', { trades, date });
}

export async function getReportHistory(n = 30) {
  return get(`/report/history?n=${n}`);
}

// ── Export ────────────────────────────────────────────────────────────────────

export function downloadCsv() {
  window.open(`${BASE}/export/csv`, '_blank');
}

export function downloadJson() {
  window.open(`${BASE}/export/json`, '_blank');
}
