import React, { useEffect, useState, useMemo } from 'react';
import { useWallet }       from './hooks/useWallet';
import { useTradingBot }   from './hooks/useTradingBot';
import { TIMEFRAMES }      from './services/priceService';
import {
  clearJournal,
  getJournal,
  getLearningSummary,
  subscribeJournal,
} from './services/tradeJournal';
import { optimizeStrategy } from './services/backtester';
import { getBackendHealth } from './services/backendClient';
import { TradingChart }    from './components/TradingChart';
import { HealthDashboard } from './components/HealthDashboard';

// ─── UTILITIES ─────────────────────────────────────────────────────────────────

const fmt    = (n, d = 2) => n?.toFixed(d) ?? '—';
const fmtUSD = (n) =>
  n != null
    ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v));

// ─── STRATEGY OPTIONS ──────────────────────────────────────────────────────────

const STRATEGY_OPTIONS = [
  { value: 'ensemble',       label: 'Ensemble Híbrido', desc: 'Rules + Momentum + MR' },
  { value: 'momentum',       label: 'Momentum',         desc: 'Trend following'        },
  { value: 'mean-reversion', label: 'Mean Reversion',   desc: 'Buy dips, sell rips'    },
  { value: 'technical',      label: 'Técnica Pura',     desc: 'RSI + MACD + BB'        },
];

// ─── COMPONENT 1: WalletButton ─────────────────────────────────────────────────

function WalletButton({ wallet, connecting, connect, disconnect, switchChain }) {
  const [showMenu, setShowMenu] = useState(false);

  if (!wallet.connected) {
    const noMetaMask = wallet.error === 'MetaMask não encontrado.';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        {noMetaMask ? (
          <a
            className="btn btn-connect"
            href="https://metamask.io/download/"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            📥 Instalar MetaMask
          </a>
        ) : (
          <button className="btn btn-connect" onClick={connect} disabled={connecting}>
            {connecting ? '⏳ Conectando...' : '🦊 Conectar MetaMask'}
          </button>
        )}
        {wallet.error && !noMetaMask && (
          <span style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>
            {wallet.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-wallet" onClick={() => setShowMenu((v) => !v)}>
        <span className="wallet-dot" />
        {wallet.shortAddress}
        {wallet.chainName && (
          <span
            className="chain-badge"
            style={{
              background:   (CHAINS[wallet.chainName]?.color ?? '#888') + '22',
              color:        CHAINS[wallet.chainName]?.color ?? '#888',
              borderColor:  CHAINS[wallet.chainName]?.color ?? '#888',
            }}
          >
            {CHAINS[wallet.chainName]?.shortName}
          </span>
        )}
        <span>▾</span>
      </button>

      {showMenu && (
        <div className="wallet-menu">
          <div className="wallet-menu-addr">{wallet.address}</div>
          <div className="wallet-menu-section">Trocar Rede</div>
          {Object.entries(CHAINS)
            .filter(([key]) => key !== 'solana')
            .map(([key, c]) => (
              <button
                key={key}
                className={'wallet-menu-item' + (wallet.chainName === key ? ' active' : '')}
                onClick={() => { switchChain(key); setShowMenu(false); }}
              >
                <span style={{ color: c.color }}>●</span> {c.name}
              </button>
            ))}
          <hr />
          <button
            className="wallet-menu-item danger"
            onClick={() => { disconnect(); setShowMenu(false); }}
          >
            ⏏ Desconectar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── COMPONENT 2: SignalMeter ──────────────────────────────────────────────────

function SignalMeter({ score }) {
  const pct   = clamp((score + 100) / 2, 0, 100);
  const color = score > 30 ? '#00e676' : score < -30 ? '#ff3d57' : '#ffd740';

  return (
    <div className="signal-meter">
      <div className="signal-meter-track">
        <div
          className="signal-meter-fill"
          style={{
            width:      pct + '%',
            background: 'linear-gradient(90deg, #ff3d57, #ffd740 50%, #00e676)',
          }}
        />
        <div
          className="signal-meter-thumb"
          style={{
            left:       pct + '%',
            background: color,
            boxShadow:  '0 0 8px ' + color,
            transition: 'left 0.5s ease',
          }}
        />
      </div>
      <div className="signal-meter-labels">
        <span>VENDER</span>
        <span>NEUTRO</span>
        <span>COMPRAR</span>
      </div>
    </div>
  );
}

// ─── COMPONENT 3: DEXQuoteRow ──────────────────────────────────────────────────

function DEXQuoteRow({ quote, isBest }) {
  if (!quote) return null;

  return (
    <div className={'dex-row' + (isBest ? ' dex-best' : '')}>
      {isBest && <span className="dex-best-tag">MELHOR</span>}
      <span className="dex-name">{quote.dex || quote.source}</span>
      <span className="dex-impact">{quote.priceImpact || '< 0.1%'}</span>
      <span className="dex-gas">
        gas ~{quote.gasEstimate ? Number(quote.gasEstimate).toLocaleString() : '—'}
      </span>
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────────────────────

function formatProfitFactor(value) {
  if (value === Infinity) return '∞';
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function LearningPanel({ summary, onClear }) {
  const topStrategies = summary.byStrategy.slice(0, 3);
  const topTimeframes = summary.byTimeframe.slice(0, 3);

  return (
    <div className="card learning-card">
      <div className="card-title learning-title">
        Aprendizado
        <button className="mini-action" onClick={onClear}>limpar</button>
      </div>
      <div className="learn-summary-grid">
        <div className="learn-stat">
          <span>Sinais</span>
          <strong>{summary.signalCount}</strong>
        </div>
        <div className="learn-stat">
          <span>Trades</span>
          <strong>{summary.total.trades}</strong>
        </div>
        <div className="learn-stat">
          <span>Win</span>
          <strong style={{ color: summary.total.winRate >= 50 ? '#00e676' : '#ff3d57' }}>
            {fmt(summary.total.winRate, 0)}%
          </strong>
        </div>
        <div className="learn-stat">
          <span>PF</span>
          <strong>{formatProfitFactor(summary.total.profitFactor)}</strong>
        </div>
      </div>

      <div className="learn-pnl-row">
        <span>P&L aprendido</span>
        <strong style={{ color: summary.total.pnl >= 0 ? '#00e676' : '#ff3d57' }}>
          {summary.total.pnl >= 0 ? '+' : ''}{fmtUSD(summary.total.pnl)}
        </strong>
      </div>

      <div className="learn-section-label">Estratégias</div>
      {topStrategies.length === 0 ? (
        <div className="learn-empty">Sem trades fechados.</div>
      ) : (
        topStrategies.map((m) => (
          <div key={m.key} className="learn-row">
            <span>{m.key}</span>
            <strong>{m.trades} · {fmt(m.winRate, 0)}% · {m.pnl >= 0 ? '+' : ''}{fmtUSD(m.pnl)}</strong>
          </div>
        ))
      )}

      <div className="learn-section-label">Timeframes</div>
      {topTimeframes.length === 0 ? (
        <div className="learn-empty">Aguardando saídas.</div>
      ) : (
        topTimeframes.map((m) => (
          <div key={m.key} className="learn-row">
            <span>{m.key}</span>
            <strong>{m.trades} · PF {formatProfitFactor(m.profitFactor)}</strong>
          </div>
        ))
      )}
    </div>
  );
}

function OptimizerPanel({ optimizer, onRun, onApply }) {
  const best = optimizer.result?.best;

  return (
    <div className="card optimizer-card">
      <div className="card-title learning-title">
        Backtest & Otimizador
        <button className="mini-action" onClick={onRun} disabled={optimizer.running}>
          {optimizer.running ? 'rodando' : 'rodar'}
        </button>
      </div>

      {optimizer.error && (
        <div className="optimizer-error">{optimizer.error}</div>
      )}

      {!best && !optimizer.error && (
        <div className="optimizer-empty">
          Testa combinações de estratégia, SL, TP e confiança no histórico Binance do timeframe atual.
        </div>
      )}

      {best && (
        <>
          <div className="optimizer-best">
            <div>
              <span>Melhor preset</span>
              <strong>{best.params.strategy} · SL {best.params.stopLoss}% · TP {best.params.takeProfit}%</strong>
            </div>
            <button className="btn-apply-preset" onClick={() => onApply(best)}>
              aplicar
            </button>
          </div>

          <div className="learn-summary-grid">
            <div className="learn-stat">
              <span>P&L</span>
              <strong style={{ color: best.summary.pnl >= 0 ? '#00e676' : '#ff3d57' }}>
                {best.summary.pnl >= 0 ? '+' : ''}{fmtUSD(best.summary.pnl)}
              </strong>
            </div>
            <div className="learn-stat">
              <span>ROI</span>
              <strong>{best.summary.roiPct >= 0 ? '+' : ''}{fmt(best.summary.roiPct, 1)}%</strong>
            </div>
            <div className="learn-stat">
              <span>Win</span>
              <strong>{fmt(best.summary.winRate, 0)}%</strong>
            </div>
            <div className="learn-stat">
              <span>Trades</span>
              <strong>{best.summary.trades}</strong>
            </div>
          </div>

          <div className="learn-section-label">Top resultados</div>
          {optimizer.result.results.slice(0, 4).map((r, i) => (
            <div key={`${r.params.strategy}-${i}`} className="learn-row">
              <span>{i + 1}. {r.params.strategy}</span>
              <strong>
                SL {r.params.stopLoss}% · TP {r.params.takeProfit}% · {r.summary.pnl >= 0 ? '+' : ''}{fmtUSD(r.summary.pnl)}
              </strong>
            </div>
          ))}

          <div className="optimizer-meta">
            {optimizer.result.symbol} · {optimizer.result.timeframeConfig.label} · {optimizer.result.tested} testes
          </div>
        </>
      )}
    </div>
  );
}

function IntelligencePanel({ adaptiveModel, riskState, backendOnline }) {
  const modelActive = adaptiveModel?.active;

  return (
    <div className="card intelligence-card">
      <div className="card-title">Inteligência & Risco</div>
      <div className="intel-row">
        <span>Modelo adaptativo</span>
        <strong style={{ color: modelActive ? '#00e676' : '#ffd740' }}>
          {modelActive ? 'ativo' : 'coletando'}
        </strong>
      </div>
      <div className="intel-row">
        <span>Amostras</span>
        <strong>{adaptiveModel?.samples ?? 0}</strong>
      </div>
      <div className="intel-row">
        <span>Acurácia treino</span>
        <strong>{adaptiveModel?.samples ? fmt(adaptiveModel.accuracy, 0) + '%' : '—'}</strong>
      </div>
      <div className="intel-sep" />
      <div className="intel-row">
        <span>P&L diário</span>
        <strong style={{ color: (riskState?.realizedPnl ?? 0) >= 0 ? '#00e676' : '#ff3d57' }}>
          {(riskState?.realizedPnl ?? 0) >= 0 ? '+' : ''}{fmtUSD(riskState?.realizedPnl ?? 0)}
        </strong>
      </div>
      <div className="intel-row">
        <span>Trades/h</span>
        <strong>{riskState?.tradesLastHour ?? 0}</strong>
      </div>
      <div className="intel-row">
        <span>Perdas seguidas</span>
        <strong>{riskState?.consecutiveLosses ?? 0}</strong>
      </div>
      {riskState?.cooldownActive && (
        <div className="risk-warning">Cooldown de risco ativo</div>
      )}
      <div className="intel-sep" />
      <div className="intel-row">
        <span>Backend local</span>
        <strong style={{ color: backendOnline ? '#00e676' : '#ffd740' }}>
          {backendOnline ? 'online' : 'offline'}
        </strong>
      </div>
    </div>
  );
}

const BINANCE_PAIRS = ['ETH', 'BTC', 'SOL', 'ARB'];

export default function App() {
  const [basePair, setBasePair] = useState('ETH');
  const quotePair = 'USDT';
  const [timeframe, setTimeframe] = useState('1m');
  const [strategy, setStrategy] = useState('ensemble');
  const [learningSummary, setLearningSummary] = useState(() => getLearningSummary(getJournal()));
  const [optimizer, setOptimizer] = useState({ running: false, error: null, result: null });
  const [backendOnline, setBackendOnline] = useState(false);
  const [config,   setConfig]   = useState({
    tradeAmount:   100,
    stopLoss:      2.5,
    takeProfit:    5.0,
    minConfidence: 35,
    executionMode: 'paper',
    paper: {
      feePct: 0.10,
      slippagePct: 0.03,
      latencyMs: 450,
    },
  });

  const {
    botState, candles, prediction, trades, portfolio, stats,
    currentPrice, priceChange24h, logs,
    adaptiveModel, riskState,
    start, pause, resume, stop,
  } = useTradingBot({ basePair, quotePair, strategy, timeframe, config });

  // ── Computed ──────────────────────────────────────────────────────────────

  const totalValue   = portfolio.usd + portfolio.crypto * (currentPrice || 0);
  const pnl          = totalValue - 1000;
  const pnlPct       = (pnl / 1000) * 100;
  const winRate      = (stats.wins + stats.losses) > 0
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0)
    : '0';

  const isBotRunning = botState === 'running';
  const isBotActive  = botState === 'running' || botState === 'paused';
  const sig          = prediction?.signal || 'hold';
  const sigColor     = sig === 'buy' ? '#00e676' : sig === 'sell' ? '#ff3d57' : '#ffd740';
  const sigLabel     = sig === 'buy' ? '▲ COMPRAR' : sig === 'sell' ? '▼ VENDER' : '— AGUARDAR';

  const handleConfigChange = (key, val) =>
    setConfig((prev) => ({ ...prev, [key]: val }));

  const handlePaperConfigChange = (key, val) =>
    setConfig((prev) => ({ ...prev, paper: { ...prev.paper, [key]: val } }));

  useEffect(() => {
    return subscribeJournal((journal) => {
      setLearningSummary(getLearningSummary(journal));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkBackend() {
      try {
        await getBackendHealth();
        if (!cancelled) setBackendOnline(true);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    }
    checkBackend();
    const id = setInterval(checkBackend, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleClearLearning = () => {
    clearJournal();
    setLearningSummary(getLearningSummary());
  };

  const handleRunOptimizer = async () => {
    setOptimizer((prev) => ({ ...prev, running: true, error: null }));
    try {
      const result = await optimizeStrategy({
        basePair,
        timeframe,
        tradeAmount: config.tradeAmount,
      });
      setOptimizer({ running: false, error: null, result });
    } catch (e) {
      setOptimizer({ running: false, error: e.message, result: null });
    }
  };

  const handleApplyOptimizedPreset = (best) => {
    setStrategy(best.params.strategy);
    setConfig((prev) => ({
      ...prev,
      stopLoss: best.params.stopLoss,
      takeProfit: best.params.takeProfit,
      minConfidence: best.params.minConfidence,
    }));
  };

  const handleKillSwitch = () => { stop(); };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <div>
            <div className="logo-title">DEFI BOT ML</div>
            <div className="logo-sub">Binance · AI · 24/7</div>
          </div>
        </div>

        <div className="header-center">
          {currentPrice && (
            <div className="header-price">
              <span className="hp-pair">{basePair}/{quotePair}</span>
              <span
                className="hp-price"
                style={{ color: priceChange24h >= 0 ? '#00e676' : '#ff3d57' }}
              >
                {fmtUSD(currentPrice)}
              </span>
              <span
                className="hp-change"
                style={{ color: priceChange24h >= 0 ? '#00e676' : '#ff3d57' }}
              >
                {priceChange24h >= 0 ? '+' : ''}{fmt(priceChange24h, 2)}%
              </span>
            </div>
          )}
        </div>

        <div className="header-right">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {backendOnline ? (
              <span style={{ color: 'var(--green)' }}>● EC2 online</span>
            ) : (
              <span style={{ color: 'var(--red)' }}>● EC2 offline</span>
            )}
          </div>
        </div>
      </header>

      {/* ── LAYOUT ───────────────────────────────────────────────────────── */}
      <div className="layout">

        {/* ── SIDEBAR LEFT ───────────────────────────────────────────────── */}
        <aside className="sidebar-left">

          {/* Portfolio card */}
          <div className="card">
            <div className="portfolio-hero">
              <div className="pf-label">Valor Total</div>
              <div className="pf-value">{fmtUSD(totalValue)}</div>
              <div className={'pf-pnl ' + (pnl >= 0 ? 'pos' : 'neg')}>
                {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)} ({pnl >= 0 ? '+' : ''}{fmt(pnlPct, 2)}%)
              </div>
            </div>
            <div className="pf-rows">
              <div className="pf-row">
                <span>USDC</span>
                <span>{fmtUSD(portfolio.usd)}</span>
              </div>
              {portfolio.crypto > 0 && (
                <div className="pf-row">
                  <span>{basePair}</span>
                  <span style={{
                    color: (currentPrice || 0) >= portfolio.buyPrice ? '#00e676' : '#ff3d57',
                  }}>
                    {fmt(portfolio.crypto, 6)} ≈ {fmtUSD(portfolio.crypto * (currentPrice || 0))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Stats card */}
          <div className="card">
            <div className="card-title">Estatísticas</div>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-label">Trades</div>
                <div className="stat-val">{stats.wins + stats.losses}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Win Rate</div>
                <div className="stat-val"
                  style={{ color: Number(winRate) >= 50 ? '#00e676' : '#ff3d57' }}>
                  {winRate}%
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">P&L Total</div>
                <div className="stat-val"
                  style={{ color: pnl >= 0 ? '#00e676' : '#ff3d57' }}>
                  {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Drawdown</div>
                <div className="stat-val" style={{ color: '#ffd740' }}>
                  {stats.maxDrawdown > 0 ? fmt(stats.maxDrawdown, 1) + '%' : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* DEX Aggregator card */}

          <LearningPanel
            summary={learningSummary}
            onClear={handleClearLearning}
          />

          <IntelligencePanel
            adaptiveModel={adaptiveModel}
            riskState={riskState}
            backendOnline={backendOnline}
          />

          <OptimizerPanel
            optimizer={optimizer}
            onRun={handleRunOptimizer}
            onApply={handleApplyOptimizedPreset}
          />

          <HealthDashboard
            onKillSwitch={handleKillSwitch}
            botState={botState}
          />
        </aside>

        {/* ── MAIN CENTER ────────────────────────────────────────────────── */}
        <main className="center">

          {/* Signal bar */}
          <div className="signal-bar">
            <div className="signal-main">
              <span className="signal-badge"
                style={{ color: sigColor, borderColor: sigColor }}>
                {sigLabel}
              </span>
              <span className="signal-conf">
                Confiança: {fmt(prediction?.confidence, 1)}%
              </span>
              <SignalMeter score={prediction?.score || 0} />
            </div>
            {prediction?.signals?.length > 0 && (
              <div className="signal-tags">
                {prediction.signals.map((s, i) => (
                  <span key={i} className="signal-tag">{s}</span>
                ))}
              </div>
            )}
            {prediction?.breakdown && (
              <div className="model-breakdown">
                {prediction.breakdown.map((b) => (
                  <div key={b.model} className="mb-row">
                    <span className="mb-name">{b.model}</span>
                    <div className="mb-bar-wrap">
                      <div
                        className="mb-bar"
                        style={{
                          width:      clamp(Math.abs(b.score), 0, 100) + '%',
                          background: b.score > 0 ? '#00e676' : '#ff3d57',
                          marginLeft: b.score < 0 ? 'auto' : 0,
                        }}
                      />
                    </div>
                    <span className="mb-score"
                      style={{ color: b.score > 0 ? '#00e676' : b.score < 0 ? '#ff3d57' : '#8b9bc8' }}>
                      {b.score > 0 ? '+' : ''}{fmt(b.score, 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="chart-container">
            <div className="chart-toolbar">
              <div className="chart-market-label">
                <span>{basePair}/{quotePair}</span>
                <span>{timeframe}</span>
              </div>
              <div className="timeframe-tabs" aria-label="Timeframe do gráfico">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    className={'timeframe-tab' + (timeframe === tf.value ? ' active' : '')}
                    onClick={() => setTimeframe(tf.value)}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-stage">
              {candles.length > 0 ? (
                <TradingChart candles={candles} portfolio={portfolio} />
              ) : (
                <div className="chart-empty">Configure e inicie o bot</div>
              )}
            </div>
          </div>

          {/* Indicators bar */}
          {prediction?.indicators && (
            <div className="ind-bar">
              {[
                {
                  label: 'RSI',
                  val:   fmt(prediction.indicators.rsi, 1),
                  color: prediction.indicators.rsi < 35 ? '#00e676'
                       : prediction.indicators.rsi > 70 ? '#ff3d57'
                       : '#12AAFF',
                },
                {
                  label: 'MACD',
                  val:   fmt(prediction.indicators.macd?.macd, 2),
                  color: (prediction.indicators.macd?.macd ?? 0) > 0 ? '#00e676' : '#ff3d57',
                },
                {
                  label: 'EMA9',
                  val:   fmtUSD(prediction.indicators.ema9),
                  color: '#8b9bc8',
                },
                {
                  label: 'EMA21',
                  val:   fmtUSD(prediction.indicators.ema21),
                  color: '#8b9bc8',
                },
                {
                  label: 'BB%',
                  val:   fmt((prediction.indicators.bbPosition ?? 0) * 100, 1),
                  color: prediction.indicators.bbPosition < 0.2 ? '#00e676'
                       : prediction.indicators.bbPosition > 0.8 ? '#ff3d57'
                       : '#8b9bc8',
                },
                {
                  label: 'Vol',
                  val:   fmt(prediction.indicators.volumeRatio, 2) + 'x',
                  color: prediction.indicators.volumeRatio > 1.5 ? '#ffd740' : '#8b9bc8',
                },
                {
                  label: 'ATR',
                  val:   fmt(prediction.indicators.atr, 2),
                  color: '#8b9bc8',
                },
              ].map(({ label, val, color }) => (
                <div key={label} className="ind-item">
                  <div className="ind-label">{label}</div>
                  <div className="ind-val" style={{ color }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Trades panel */}
          <div className="trades-panel">
            <div className="trades-header">
              Trades
              <span className="trades-count">{trades.length}</span>
            </div>
            <div className="trades-scroll">
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>Hora</th><th>Tipo</th><th>Preço</th><th>Qtd</th>
                    <th>Total</th><th>P&L</th><th>Sinal</th><th>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="td-empty">Aguardando...</td>
                    </tr>
                  ) : (
                    trades.slice(0, 50).map((t) => (
                      <tr key={t.id} className={'row-' + t.type.toLowerCase()}>
                        <td className="td-mono">{t.time}</td>
                        <td>
                          <span className={'td-type ' + t.type.toLowerCase()}>{t.type}</span>
                        </td>
                        <td className="td-mono">{fmtUSD(t.price)}</td>
                        <td className="td-mono">{fmt(t.qty, 5)}</td>
                        <td className="td-mono">{fmtUSD(t.total)}</td>
                        <td>
                          {t.pnl != null ? (
                            <span className={'pnl-' + (t.pnl >= 0 ? 'pos' : 'neg')}>
                              {t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="td-reason">{t.reason}</td>
                        <td className="td-mono">{fmt(t.confidence, 0)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {/* ── SIDEBAR RIGHT ──────────────────────────────────────────────── */}
        <aside className="sidebar-right">

          {/* Bot control card */}
          <div className="card">
            <div className="card-title">Controle do Bot</div>
            <div className="bot-controls">
              <div className={'bot-status ' + botState}>
                <span className="bot-dot" />
                {botState.toUpperCase()}
              </div>
              {!isBotActive ? (
                <button
                  className="btn-start"
                  onClick={start}
                  disabled={false}
                >
                  ▶ Iniciar Bot
                </button>
              ) : (
                <>
                  <button
                    className={isBotRunning ? 'btn-pause' : 'btn-start'}
                    onClick={isBotRunning ? pause : resume}
                  >
                    {isBotRunning ? '⏸ Pausar' : '▶ Retomar'}
                  </button>
                  <button className="btn-stop" onClick={stop}>⏹ Parar</button>
                </>
              )}
            </div>
            <div className="execution-modes">
              {[
                ['paper', 'Paper'],
                ['simulated', 'Sim'],
                ['real', 'Real'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={'execution-mode' + (config.executionMode === mode ? ' active' : '')}
                  onClick={() => handleConfigChange('executionMode', mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {config.executionMode === 'real' && (
              <div className="warning-box">
                ⚠️ Modo real usa Binance API Key configurada no servidor.
              </div>
            )}
            {config.executionMode === 'paper' && (
              <div className="paper-settings">
                <span>fee {config.paper.feePct}%</span>
                <span>slip {config.paper.slippagePct}%</span>
                <span>{config.paper.latencyMs}ms</span>
              </div>
            )}
          </div>

          {/* Pair selector */}
          <div className="card">
            <div className="card-title">Par (Binance.US)</div>
            <div className="chain-options">
              {BINANCE_PAIRS.map(pair => (
                <button
                  key={pair}
                  className={'chain-opt' + (basePair === pair ? ' active' : '')}
                  onClick={() => setBasePair(pair)}
                >
                  {pair}/USDT
                </button>
              ))}
            </div>
          </div>

          {/* Strategy card */}
          <div className="card">
            <div className="card-title">Estratégia ML</div>
            {STRATEGY_OPTIONS.map((s) => (
              <label
                key={s.value}
                className={'strategy-option' + (strategy === s.value ? ' active' : '')}
              >
                <input
                  type="radio"
                  name="strategy"
                  value={s.value}
                  checked={strategy === s.value}
                  onChange={() => setStrategy(s.value)}
                />
                <span className="so-label">{s.label}</span>
                <span className="so-desc">{s.desc}</span>
              </label>
            ))}
          </div>

          {/* Parameters card */}
          <div className="card">
            <div className="card-title">Parâmetros</div>
            <div className="form-group">
              <label className="form-label">Valor por Trade (USD)</label>
              <input
                type="number"
                className="form-input"
                min={10}
                max={10000}
                step={10}
                value={config.tradeAmount}
                onChange={(e) => handleConfigChange('tradeAmount', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Stop Loss (%)</label>
              <input
                type="number"
                className="form-input"
                min={0.1}
                max={50}
                step={0.1}
                value={config.stopLoss}
                onChange={(e) => handleConfigChange('stopLoss', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Take Profit (%)</label>
              <input
                type="number"
                className="form-input"
                min={0.1}
                max={100}
                step={0.1}
                value={config.takeProfit}
                onChange={(e) => handleConfigChange('takeProfit', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Confiança: {config.minConfidence}%
              </label>
              <input
                type="range"
                className="form-range"
                min={20}
                max={95}
                step={1}
                value={config.minConfidence}
                onChange={(e) => handleConfigChange('minConfidence', Number(e.target.value))}
              />
              <div className="range-labels">
                <span>20% (mais trades)</span>
                <span>95% (seletivo)</span>
              </div>
            </div>
            {config.executionMode === 'paper' && (
              <>
                <div className="form-group">
                  <label className="form-label">Paper Fee (%)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    max={2}
                    step={0.01}
                    value={config.paper.feePct}
                    onChange={(e) => handlePaperConfigChange('feePct', Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Paper Slippage (%)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    max={2}
                    step={0.01}
                    value={config.paper.slippagePct}
                    onChange={(e) => handlePaperConfigChange('slippagePct', Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Latência Paper (ms)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    max={5000}
                    step={50}
                    value={config.paper.latencyMs}
                    onChange={(e) => handlePaperConfigChange('latencyMs', Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          {/* Log card */}
          <div className="card">
            <div className="card-title">Log</div>
            <div className="log-area">
              {logs.length === 0 ? (
                <div className="log-empty">Aguardando...</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className={'log-line log-' + l.type}>
                    <span className="log-time">{l.time}</span>
                    <span>{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
