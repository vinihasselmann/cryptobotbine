export class ReportGenerator {
  constructor() {
    this.reports = [];
    this.maxReports = 90;
  }

  generate(trades, date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const dayTrades = trades.filter(t => {
      if (!t.closed) return false;
      const d = (t.closedAt || t.openedAt || '').split('T')[0];
      return d === targetDate;
    });

    if (dayTrades.length === 0) {
      return { date: targetDate, empty: true, generatedAt: new Date().toISOString() };
    }

    const wins = dayTrades.filter(t => t.pnl > 0);
    const losses = dayTrades.filter(t => t.pnl <= 0);
    const totalPnl = dayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const avgTrade = totalPnl / dayTrades.length;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    // Strategy breakdown
    const byStrategy = {};
    for (const t of dayTrades) {
      const s = t.strategy || 'unknown';
      if (!byStrategy[s]) byStrategy[s] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
      byStrategy[s].trades++;
      if (t.pnl > 0) byStrategy[s].wins++; else byStrategy[s].losses++;
      byStrategy[s].pnl += t.pnl || 0;
    }
    for (const s of Object.values(byStrategy)) {
      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
      s.pnl = parseFloat(s.pnl.toFixed(2));
    }

    // Best strategy by P&L
    const bestStrategy = Object.entries(byStrategy).sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0] || 'N/A';
    const worstStrategy = Object.entries(byStrategy).sort((a, b) => a[1].pnl - b[1].pnl)[0]?.[0] || 'N/A';

    // Best / worst trades
    const sorted = [...dayTrades].sort((a, b) => b.pnl - a.pnl);
    const bestTrade = sorted[0] ? { pnl: sorted[0].pnl, symbol: sorted[0].symbol, strategy: sorted[0].strategy } : null;
    const worstTrade = sorted.at(-1) ? { pnl: sorted.at(-1).pnl, symbol: sorted.at(-1).symbol, strategy: sorted.at(-1).strategy } : null;

    // Max drawdown of the day (sequential trade order)
    let peak = 0, equity = 0, maxDrawdown = 0;
    for (const t of [...dayTrades].sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0))) {
      equity += t.pnl || 0;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Consecutive loss streak
    let maxLossStreak = 0, streak = 0;
    for (const t of dayTrades.sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0))) {
      if (t.pnl <= 0) { streak++; if (streak > maxLossStreak) maxLossStreak = streak; }
      else streak = 0;
    }

    // Hourly distribution
    const byHour = {};
    for (const t of dayTrades) {
      const h = new Date(t.closedAt || t.openedAt || Date.now()).getHours();
      if (!byHour[h]) byHour[h] = { trades: 0, pnl: 0 };
      byHour[h].trades++;
      byHour[h].pnl += t.pnl || 0;
    }
    const bestHour = Object.entries(byHour).sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0];

    const recommendations = this._recommendations(wins.length / dayTrades.length * 100, profitFactor, maxDrawdown, byStrategy);

    const report = {
      date: targetDate,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTrades: dayTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: parseFloat((wins.length / dayTrades.length * 100).toFixed(1)),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        grossLoss: parseFloat(grossLoss.toFixed(2)),
        profitFactor: parseFloat(Math.min(profitFactor, 999).toFixed(2)),
        avgTrade: parseFloat(avgTrade.toFixed(2)),
        avgWin: parseFloat(avgWin.toFixed(2)),
        avgLoss: parseFloat(avgLoss.toFixed(2)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
        maxLossStreak,
      },
      byStrategy,
      bestStrategy,
      worstStrategy,
      bestTrade,
      worstTrade,
      byHour,
      bestHour: bestHour ? { hour: Number(bestHour), ...byHour[bestHour] } : null,
      recommendations,
    };

    this.reports.unshift(report);
    if (this.reports.length > this.maxReports) this.reports.length = this.maxReports;
    return report;
  }

  _recommendations(winRate, profitFactor, maxDrawdown, byStrategy) {
    const recs = [];
    if (winRate < 40) recs.push(`Win rate baixo (${winRate.toFixed(1)}%) — aumente o threshold de confiança.`);
    if (profitFactor < 1.2) recs.push(`Profit factor (${Math.min(profitFactor, 99).toFixed(2)}) abaixo do esperado — revise SL/TP.`);
    if (maxDrawdown > 10) recs.push(`Drawdown alto (${maxDrawdown.toFixed(1)}%) — reduza o risco por trade.`);
    for (const [name, s] of Object.entries(byStrategy)) {
      if (s.trades >= 5 && s.winRate < 30) recs.push(`Estratégia "${name}" com win rate de ${s.winRate.toFixed(1)}% — considere desativar.`);
    }
    if (recs.length === 0) recs.push('Performance dentro dos parâmetros normais. Continue monitorando.');
    return recs;
  }

  getLatest(n = 30) { return this.reports.slice(0, n); }

  // Generate CSV string from trades list
  exportCsv(trades) {
    const headers = ['openedAt', 'closedAt', 'symbol', 'strategy', 'timeframe', 'entryPrice', 'exitPrice', 'pnl', 'pnlPct', 'duration', 'reason', 'confidence'];
    const rows = trades.filter(t => t.closed).map(t => headers.map(h => {
      const v = t[h];
      if (v == null) return '';
      if (typeof v === 'number') return v.toFixed(4);
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
    return [headers.join(','), ...rows].join('\n');
  }
}
