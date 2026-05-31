import React, { useEffect, useState, useCallback } from 'react';
import {
  getFullHealth,
  getAlertConfig,
  saveAlertConfig,
  testAlert,
  getAlertHistory,
  generateDailyReport,
  getReportHistory,
  getMLStatus,
  runWalkForward,
  downloadCsv,
  downloadJson,
  sendAlert,
} from '../services/advancedMLClient';
import { getJournal } from '../services/tradeJournal';

const REFRESH_INTERVAL = 8000;

function StatusDot({ ok, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: ok ? 'var(--green)' : 'var(--red)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'var(--green)' : 'var(--red)', display: 'inline-block', boxShadow: `0 0 4px ${ok ? 'var(--green)' : 'var(--red)'}` }} />
      {label}
    </span>
  );
}

function Metric({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 72 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

export function HealthDashboard({ onKillSwitch, botState }) {
  const [tab, setTab] = useState('health');
  const [health, setHealth] = useState(null);
  const [mlStatus, setMlStatus] = useState(null);
  const [alertCfg, setAlertCfg] = useState({ telegram: { enabled: false, botToken: '', chatId: '' }, discord: { enabled: false, webhookUrl: '' } });
  const [alertHistory, setAlertHistory] = useState([]);
  const [reports, setReports] = useState([]);
  const [validation, setValidation] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [h, ml] = await Promise.all([getFullHealth(), getMLStatus()]);
      setHealth(h);
      setMlStatus(ml);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (tab === 'alerts') {
      getAlertConfig().then(cfg => {
        if (cfg) setAlertCfg({
          telegram: { enabled: cfg.telegram?.enabled ?? false, botToken: '', chatId: cfg.telegram?.chatId ?? '', hasToken: cfg.telegram?.hasToken },
          discord: { enabled: cfg.discord?.enabled ?? false, webhookUrl: '', hasWebhook: cfg.discord?.hasWebhook },
        });
      }).catch(() => {});
      getAlertHistory(30).then(setAlertHistory).catch(() => {});
    }
    if (tab === 'reports') {
      getReportHistory(14).then(setReports).catch(() => {});
    }
    if (tab === 'ml') {
      getMLStatus().then(setMlStatus).catch(() => {});
    }
  }, [tab]);

  const handleSaveAlerts = async () => {
    setBusy(true);
    setAlertMsg('');
    try {
      await saveAlertConfig(alertCfg);
      setAlertMsg('Configuração salva com sucesso!');
    } catch (e) {
      setAlertMsg('Erro: ' + e.message);
    }
    setBusy(false);
  };

  const handleTestAlert = async () => {
    setBusy(true);
    setAlertMsg('');
    try {
      await testAlert();
      setAlertMsg('Alerta de teste enviado!');
    } catch (e) {
      setAlertMsg('Erro: ' + e.message);
    }
    setBusy(false);
  };

  const handleGenerateReport = async () => {
    setBusy(true);
    try {
      const journal = getJournal();
      const report = await generateDailyReport(journal.trades || []);
      setReports(prev => [report, ...prev].slice(0, 30));
    } catch {}
    setBusy(false);
  };

  const handleWalkForward = async (modelType) => {
    setBusy(true);
    setValidation(null);
    try {
      const journal = getJournal();
      const result = await runWalkForward(journal.trades || [], modelType);
      setValidation({ ...result, modelType });
    } catch (e) {
      setValidation({ error: e.message });
    }
    setBusy(false);
  };

  const handleKillSwitch = async () => {
    if (!window.confirm('KILL SWITCH: Parar o bot imediatamente? Esta ação não pode ser desfeita automaticamente.')) return;
    await sendAlert('kill_switch', { reason: 'Manual via dashboard' }).catch(() => {});
    onKillSwitch?.();
  };

  // ── Render health tab ───────────────────────────────────────────────────────
  const renderHealth = () => {
    const feed = health?.feed;
    const errs = health?.errors;
    const isActive = botState === 'running' || botState === 'paused';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Kill Switch */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(239,68,68,0.07)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.25)' }}>
          <button
            onClick={handleKillSwitch}
            style={{
              padding: '6px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: 11, letterSpacing: 0.5,
              opacity: isActive ? 1 : 0.5,
            }}
            disabled={!isActive}
          >
            KILL SWITCH
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Para o bot imediatamente + envia alerta</span>
        </div>

        {/* Status row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
          <StatusDot ok={health?.ok} label={health ? 'Backend online' : 'Backend offline'} />
          <StatusDot ok={feed?.connected && !feed?.stale} label={feed?.connected ? (feed?.stale ? 'Feed desatualizado' : 'Feed conectado') : 'Feed offline'} />
          <StatusDot ok={(errs?.total ?? 0) === 0} label={errs?.total ? `${errs.total} erros` : 'Sem erros'} />
        </div>

        {/* Metrics */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around', padding: '6px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <Metric label="Uptime" value={health ? formatUptime(health.uptime) : '—'} />
          <Metric label="Latência" value={feed?.avgLatencyMs != null ? `${feed.avgLatencyMs}ms` : '—'} color={feed?.avgLatencyMs > 500 ? 'var(--yellow)' : undefined} />
          <Metric label="Requests" value={health?.requests ?? '—'} />
          <Metric label="Erros" value={errs?.total ?? '—'} color={(errs?.total ?? 0) > 0 ? 'var(--red)' : undefined} />
        </div>

        {/* Latency sparkline */}
        {feed?.latencyHistory?.length > 1 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>LATÊNCIA FEED (últimas {feed.latencyHistory.length} medições)</div>
            <Sparkline values={feed.latencyHistory} color="var(--blue)" />
          </div>
        )}

        {/* Recent errors */}
        {errs?.recent?.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>ERROS RECENTES</div>
            <div style={{ maxHeight: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {errs.recent.map((e, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(239,68,68,0.05)', padding: '2px 6px', borderRadius: 3 }}>
                  [{e.component}] {e.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Export buttons */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>EXPORTAR DADOS</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" style={{ fontSize: 10, padding: '4px 10px' }} onClick={downloadCsv}>CSV Trades</button>
            <button className="btn" style={{ fontSize: 10, padding: '4px 10px' }} onClick={downloadJson}>JSON Completo</button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ML tab ───────────────────────────────────────────────────────────
  const renderML = () => {
    const rf = mlStatus?.rf;
    const gb = mlStatus?.gb;
    const bandit = mlStatus?.bandit;
    const val = mlStatus?.validation ?? validation;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* RF + GB status */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 5 }}>Random Forest</div>
            <StatusDot ok={rf?.trained} label={rf?.trained ? 'Treinado' : 'Não treinado'} />
            {rf?.trained && (
              <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                OOB: <span style={{ color: 'var(--text-primary)' }}>{rf.oobScore != null ? (rf.oobScore * 100).toFixed(1) + '%' : '—'}</span>{' '}
                / {rf.nTrees} árvores
              </div>
            )}
          </div>
          <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 5 }}>Gradient Boosting</div>
            <StatusDot ok={gb?.trained} label={gb?.trained ? 'Treinado' : 'Não treinado'} />
            {gb?.trained && (
              <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                Loss: <span style={{ color: 'var(--text-primary)' }}>{gb.finalLoss != null ? gb.finalLoss.toFixed(4) : '—'}</span>{' '}
                / {gb.nEstimators} iter
              </div>
            )}
          </div>
        </div>

        {/* Feature importance */}
        {rf?.topFeatures?.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>FEATURE IMPORTANCE (RF)</div>
            {rf.topFeatures.map(({ feature, importance }) => {
              const name = mlStatus?.featureNames?.[feature] ?? `feat_${feature}`;
              return (
                <div key={feature} style={{ marginBottom: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                    <span>{name}</span><span style={{ color: 'var(--blue)' }}>{(importance * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
                    <div style={{ height: 3, width: `${importance * 100}%`, background: 'var(--blue)', borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Contextual Bandit */}
        {bandit?.arms?.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>BANDIT (win rate por estratégia)</div>
            {bandit.arms.map(arm => (
              <div key={arm.arm} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, width: 110, color: 'var(--text-muted)' }}>{arm.arm}</span>
                <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ height: 5, width: `${arm.winRate * 100}%`, background: arm.winRate > 0.5 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: arm.winRate > 0.5 ? 'var(--green)' : 'var(--red)', width: 38, textAlign: 'right' }}>{(arm.winRate * 100).toFixed(0)}%</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 28 }}>n={arm.trades}</span>
              </div>
            ))}
          </div>
        )}

        {/* Walk-forward validation */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>WALK-FORWARD VALIDATION</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button className="btn" style={{ fontSize: 10, padding: '4px 10px' }} onClick={() => handleWalkForward('rf')} disabled={busy}>RF</button>
            <button className="btn" style={{ fontSize: 10, padding: '4px 10px' }} onClick={() => handleWalkForward('gb')} disabled={busy}>GB</button>
          </div>
          {val && !val.error && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Metric label="Acc média" value={(val.avgAccuracy * 100).toFixed(1) + '%'} color={val.avgAccuracy > 0.55 ? 'var(--green)' : 'var(--yellow)'} />
              <Metric label="Precisão" value={(val.avgPrecision * 100).toFixed(1) + '%'} />
              <Metric label="F1" value={(val.avgF1 * 100).toFixed(1) + '%'} />
              <Metric label="Estável" value={val.stable ? 'Sim' : 'Não'} color={val.stable ? 'var(--green)' : 'var(--yellow)'} />
            </div>
          )}
          {val?.error && <div style={{ fontSize: 10, color: 'var(--red)' }}>{val.error}</div>}
        </div>

        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          Amostras: {mlStatus?.sampleCount ?? 0} | Último treino: {mlStatus?.lastTrained ? new Date(mlStatus.lastTrained).toLocaleString('pt-BR') : 'Nunca'}
        </div>
      </div>
    );
  };

  // ── Render alerts tab ───────────────────────────────────────────────────────
  const renderAlerts = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Telegram */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Telegram</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={alertCfg.telegram.enabled} onChange={e => setAlertCfg(c => ({ ...c, telegram: { ...c.telegram, enabled: e.target.checked } }))} />
            Ativar
          </label>
        </div>
        <input className="form-input" style={{ fontSize: 11, marginBottom: 5 }} placeholder="Bot Token (ex: 123456:ABC...)" value={alertCfg.telegram.botToken} onChange={e => setAlertCfg(c => ({ ...c, telegram: { ...c.telegram, botToken: e.target.value } }))} />
        <input className="form-input" style={{ fontSize: 11 }} placeholder="Chat ID (ex: -100123456789)" value={alertCfg.telegram.chatId} onChange={e => setAlertCfg(c => ({ ...c, telegram: { ...c.telegram, chatId: e.target.value } }))} />
        {alertCfg.telegram.hasToken && !alertCfg.telegram.botToken && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>Token já salvo — deixe em branco para manter.</div>}
      </div>

      {/* Discord */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Discord Webhook</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={alertCfg.discord.enabled} onChange={e => setAlertCfg(c => ({ ...c, discord: { ...c.discord, enabled: e.target.checked } }))} />
            Ativar
          </label>
        </div>
        <input className="form-input" style={{ fontSize: 11 }} placeholder="Webhook URL" value={alertCfg.discord.webhookUrl} onChange={e => setAlertCfg(c => ({ ...c, discord: { ...c.discord, webhookUrl: e.target.value } }))} />
        {alertCfg.discord.hasWebhook && !alertCfg.discord.webhookUrl && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>Webhook já salvo — deixe em branco para manter.</div>}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn" style={{ flex: 1, fontSize: 10 }} onClick={handleSaveAlerts} disabled={busy}>Salvar</button>
        <button className="btn" style={{ flex: 1, fontSize: 10 }} onClick={handleTestAlert} disabled={busy}>Testar</button>
      </div>
      {alertMsg && <div style={{ fontSize: 10, color: alertMsg.startsWith('Erro') ? 'var(--red)' : 'var(--green)' }}>{alertMsg}</div>}

      {alertHistory.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>HISTÓRICO DE ALERTAS</div>
          <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {alertHistory.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '2px 4px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(a.ts).toLocaleTimeString('pt-BR')}</span>
                <span style={{ color: 'var(--blue)' }}>{a.type}</span>
                <StatusDot ok={!a.results?.telegram?.error && !a.results?.discord?.error} label={a.results?.telegram?.skipped && a.results?.discord?.skipped ? 'não configurado' : 'enviado'} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ── Render reports tab ──────────────────────────────────────────────────────
  const renderReports = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button className="btn" style={{ fontSize: 10 }} onClick={handleGenerateReport} disabled={busy}>
        Gerar Relatório do Dia
      </button>

      {reports.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Nenhum relatório gerado ainda.</div>}

      {reports.map((r, i) => (
        <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{r.date}</span>
            {r.empty ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Sem trades</span> : (
              <span style={{ fontSize: 10, color: r.summary.totalPnl >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>
                {r.summary.totalPnl >= 0 ? '+' : ''}${r.summary.totalPnl.toFixed(2)}
              </span>
            )}
          </div>
          {!r.empty && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <Metric label="Trades" value={r.summary.totalTrades} />
                <Metric label="Win Rate" value={r.summary.winRate + '%'} color={r.summary.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
                <Metric label="Profit F." value={r.summary.profitFactor === Infinity ? '∞' : r.summary.profitFactor.toFixed(2)} />
                <Metric label="Drawdown" value={r.summary.maxDrawdown.toFixed(1) + '%'} color={r.summary.maxDrawdown > 5 ? 'var(--red)' : undefined} />
              </div>
              {r.recommendations?.length > 0 && (
                <div style={{ fontSize: 9, color: 'var(--yellow)', borderTop: '1px solid var(--border)', paddingTop: 5 }}>
                  {r.recommendations.map((rec, j) => <div key={j}>• {rec}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'health', label: 'Saúde' },
    { id: 'ml', label: 'ML Avançado' },
    { id: 'alerts', label: 'Alertas' },
    { id: 'reports', label: 'Relatórios' },
  ];

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Observabilidade
        {health?.ok && <span style={{ float: 'right', fontSize: 9, color: 'var(--green)' }}>v2 online</span>}
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 10, background: 'var(--bg-secondary)', borderRadius: 6, padding: 3 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, fontSize: 9, padding: '4px 2px', border: 'none', borderRadius: 4, cursor: 'pointer',
              background: tab === t.id ? 'var(--blue)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'health' && renderHealth()}
      {tab === 'ml' && renderML()}
      {tab === 'alerts' && renderAlerts()}
      {tab === 'reports' && renderReports()}
    </div>
  );
}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Sparkline({ values, color = '#60a5fa', height = 28 }) {
  if (!values?.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 200, h = height;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
