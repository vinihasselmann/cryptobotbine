import { createServer } from 'node:http';
import { AdvancedMLEngine } from './ml/advancedEngine.js';
import { AlertService } from './alerts/alertService.js';
import { ReportGenerator } from './reports/reportGenerator.js';
import { db } from './db.js';
import { bot } from './bot/tradingLoop.js';

const PORT = Number(process.env.PORT || 8787);

// ─── Singletons ─────────────────────────────────────────────────────────────
const mlEngine = new AdvancedMLEngine();
const alertService = new AlertService();
const reportGen = new ReportGenerator();

// Health monitor state
const health = {
  startedAt: Date.now(),
  feedConnected: false,
  lastFeedUpdate: null,
  feedLatency: [],
  errors: [],
  requestCount: 0,
  errorCount: 0,
};

function recordHealth(latencyMs) {
  health.feedConnected = true;
  health.lastFeedUpdate = Date.now();
  health.feedLatency.push(latencyMs);
  if (health.feedLatency.length > 60) health.feedLatency.shift();
}

function recordError(component, message, severity = 'error') {
  health.errorCount++;
  health.errors.unshift({ component, message, severity, ts: new Date().toISOString() });
  if (health.errors.length > 100) health.errors.length = 100;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendCsv(res, csv, filename) {
  res.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(csv);
}

// ─── Load persisted alert config on startup ──────────────────────────────────
async function loadPersistedConfig() {
  const cfg = await db.getAlertConfig();
  if (cfg) alertService.configure(cfg);
}

// ─── Router ──────────────────────────────────────────────────────────────────
async function handle(req, res) {
  health.requestCount++;

  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // ── Original endpoints ──────────────────────────────────────────────────────

  if (pathname === '/api/health' && req.method === 'GET') {
    const latencies = health.feedLatency;
    const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const feedAge = health.lastFeedUpdate ? Date.now() - health.lastFeedUpdate : null;
    send(res, 200, {
      ok: true,
      service: 'cryptobot-backend',
      ts: Date.now(),
      uptime: Math.floor((Date.now() - health.startedAt) / 1000),
      feed: {
        connected: health.feedConnected,
        stale: feedAge !== null && feedAge > 30000,
        ageMs: feedAge,
        avgLatencyMs: avg,
        latencyHistory: latencies.slice(-20),
      },
      errors: { total: health.errorCount, recent: health.errors.slice(0, 10) },
      requests: health.requestCount,
      ml: mlEngine.getStatus(),
      alerts: alertService.getConfig(),
    });
    return;
  }

  if (pathname === '/api/journal' && req.method === 'GET') {
    send(res, 200, await db.getJournal());
    return;
  }

  if (pathname === '/api/journal' && req.method === 'POST') {
    const journal = await readBody(req);
    await db.setJournal(journal ?? { signals: [], trades: [] });
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/events' && req.method === 'POST') {
    const event = await readBody(req);
    await db.appendEvent(event);
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/candles' && req.method === 'POST') {
    const payload = await readBody(req);
    const key = `${payload?.symbol ?? 'unknown'}:${payload?.timeframe ?? 'unknown'}`;
    await db.setCandles(key, payload?.candles ?? []);
    send(res, 200, { ok: true, key, count: (payload?.candles ?? []).length });
    return;
  }

  // ── Phase 9: Advanced ML endpoints ─────────────────────────────────────────

  // Train models on closed trades from journal
  if (pathname === '/api/ml/train' && req.method === 'POST') {
    const body = await readBody(req);
    const trades = body?.trades ?? (await db.getJournal()).trades;
    try {
      const result = mlEngine.train(trades);
      send(res, 200, result);
    } catch (e) {
      recordError('ml.train', e.message);
      send(res, 500, { error: e.message });
    }
    return;
  }

  // Predict for a given indicators snapshot
  if (pathname === '/api/ml/predict' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const result = mlEngine.predict(body?.indicators ?? {});
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // Get model status / feature importance
  if (pathname === '/api/ml/status' && req.method === 'GET') {
    send(res, 200, mlEngine.getStatus());
    return;
  }

  // Run walk-forward validation explicitly
  if (pathname === '/api/ml/validate' && req.method === 'POST') {
    const body = await readBody(req);
    const trades = body?.trades ?? (await db.getJournal()).trades;
    const modelType = body?.modelType ?? 'rf';
    try {
      const closed = trades.filter(t => t.indicators && t.pnl !== undefined && t.closed);
      if (closed.length < 20) { send(res, 200, { error: `Need 20+ closed trades (have ${closed.length})` }); return; }
      const X = closed.map(t => mlEngine.extractFeatures(t.indicators));
      const y = closed.map(t => t.pnl > 0 ? 1 : 0);
      const result = mlEngine.validator.validate(X, y, modelType);
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // Report feed latency (called by frontend on each price update)
  if (pathname === '/api/health/feed' && req.method === 'POST') {
    const body = await readBody(req);
    recordHealth(body?.latencyMs ?? 0);
    send(res, 200, { ok: true });
    return;
  }

  // Report a client-side error
  if (pathname === '/api/health/error' && req.method === 'POST') {
    const body = await readBody(req);
    recordError(body?.component ?? 'frontend', body?.message ?? 'unknown', body?.severity ?? 'error');
    send(res, 200, { ok: true });
    return;
  }

  // ── Phase 10: Alert endpoints ───────────────────────────────────────────────

  if (pathname === '/api/alerts/config' && req.method === 'GET') {
    send(res, 200, alertService.getConfig());
    return;
  }

  if (pathname === '/api/alerts/config' && req.method === 'POST') {
    const cfg = await readBody(req);
    alertService.configure(cfg);
    await db.setAlertConfig(cfg);
    send(res, 200, { ok: true, config: alertService.getConfig() });
    return;
  }

  if (pathname === '/api/alerts/test' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await alertService.sendAlert('test', { message: body?.message || 'Teste de alerta do CryptoBot!' });
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  if (pathname === '/api/alerts/send' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await alertService.sendAlert(body.type, body.data || {});
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  if (pathname === '/api/alerts/history' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 50);
    send(res, 200, alertService.getHistory(limit));
    return;
  }

  // ── Phase 10: Report endpoints ──────────────────────────────────────────────

  if (pathname === '/api/report/daily' && req.method === 'POST') {
    const body = await readBody(req);
    const trades = body?.trades ?? (await db.getJournal()).trades;
    const date = body?.date ?? null;
    const report = reportGen.generate(trades, date);
    // Auto-send daily report alert if configured
    if (!report.empty) {
      alertService.sendAlert('daily_report', {
        totalTrades: report.summary.totalTrades,
        wins: report.summary.wins,
        losses: report.summary.losses,
        winRate: report.summary.winRate,
        pnl: report.summary.totalPnl,
        bestStrategy: report.bestStrategy,
        maxDrawdown: report.summary.maxDrawdown,
      }).catch(() => {});
    }
    send(res, 200, report);
    return;
  }

  if (pathname === '/api/report/history' && req.method === 'GET') {
    const n = Number(url.searchParams.get('n') || 30);
    send(res, 200, reportGen.getLatest(n));
    return;
  }

  // Export trades as CSV
  if (pathname === '/api/export/csv' && req.method === 'GET') {
    const journal = await db.getJournal();
    const csv = reportGen.exportCsv(journal.trades || []);
    const date = new Date().toISOString().split('T')[0];
    sendCsv(res, csv, `cryptobot-trades-${date}.csv`);
    return;
  }

  // Export full journal as JSON
  if (pathname === '/api/export/json' && req.method === 'GET') {
    const journal = await db.getJournal();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="cryptobot-journal-${Date.now()}.json"`,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(journal, null, 2));
    return;
  }

  // ── Bot control endpoints ───────────────────────────────────────────────────

  if (pathname === '/api/bot/state' && req.method === 'GET') {
    send(res, 200, bot.getSnapshot());
    return;
  }

  if (pathname === '/api/bot/candles' && req.method === 'GET') {
    send(res, 200, bot.getCandles());
    return;
  }

  if (pathname === '/api/bot/start' && req.method === 'POST') {
    const cfg = await readBody(req);
    await bot.start(cfg ?? {});
    send(res, 200, { ok: true, state: bot.getSnapshot().state });
    return;
  }

  if (pathname === '/api/bot/stop' && req.method === 'POST') {
    bot.stop();
    alertService.sendAlert('bot_stopped', { reason: 'Remote stop' }).catch(() => {});
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/bot/pause' && req.method === 'POST') {
    bot.pause();
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/bot/resume' && req.method === 'POST') {
    bot.resume();
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/bot/config' && req.method === 'POST') {
    const cfg = await readBody(req);
    bot.updateConfig(cfg ?? {});
    send(res, 200, { ok: true, config: bot.config });
    return;
  }

  if (pathname === '/api/bot/kill' && req.method === 'POST') {
    bot.stop();
    alertService.sendAlert('kill_switch', { reason: 'Remote kill switch' }).catch(() => {});
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { error: 'not_found' });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
await loadPersistedConfig();

// Attempt to warm-start ML from saved journal
try {
  const journal = await db.getJournal();
  if ((journal.trades || []).length >= 10) {
    mlEngine.train(journal.trades);
    console.log(`ML warm-started on ${journal.trades.length} trades`);
  }
} catch (e) {
  console.warn('ML warm-start failed:', e.message);
}

// Bind to 0.0.0.0 in production so Railway/Render can reach the port
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

createServer((req, res) => {
  handle(req, res).catch(err => {
    recordError('server', err.message);
    send(res, 500, { error: err.message });
  });
}).listen(PORT, HOST, () => {
  console.log(`cryptobot backend v2 listening on http://127.0.0.1:${PORT}`);
  console.log(`  ML endpoints: /api/ml/{train,predict,status,validate}`);
  console.log(`  Alerts: /api/alerts/{config,test,send,history}`);
  console.log(`  Reports: /api/report/{daily,history}`);
  console.log(`  Export: /api/export/{csv,json}`);
});
