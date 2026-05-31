const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787') + '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) throw new Error(`Backend ${response.status}`);
  return response.json();
}

export async function getBackendHealth() {
  return request('/health');
}

export async function syncJournalToBackend(journal) {
  return request('/journal', {
    method: 'POST',
    body: JSON.stringify(journal),
  });
}

export async function getBackendJournal() {
  return request('/journal');
}

export async function syncCandlesToBackend({ symbol, timeframe, candles }) {
  return request('/candles', {
    method: 'POST',
    body: JSON.stringify({ symbol, timeframe, candles }),
  });
}
