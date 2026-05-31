import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export class AlertService {
  constructor() {
    this.config = {
      telegram: { enabled: false, botToken: '', chatId: '' },
      discord: { enabled: false, webhookUrl: '' },
    };
    this.history = [];
    this.maxHistory = 500;
  }

  configure(cfg) {
    if (cfg.telegram) this.config.telegram = { ...this.config.telegram, ...cfg.telegram };
    if (cfg.discord) this.config.discord = { ...this.config.discord, ...cfg.discord };
  }

  async sendTelegram(text) {
    const { enabled, botToken, chatId } = this.config.telegram;
    if (!enabled || !botToken || !chatId) return { skipped: true };
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    return postJson(url, JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }));
  }

  async sendDiscord(content) {
    const { enabled, webhookUrl } = this.config.discord;
    if (!enabled || !webhookUrl) return { skipped: true };
    return postJson(webhookUrl, JSON.stringify({ content }));
  }

  formatMessage(type, data) {
    const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    switch (type) {
      case 'trade_open':
        return `🟢 *TRADE ABERTO* | ${ts}\nPar: ${data.symbol}\nEstratégia: ${data.strategy}\nPreço: $${Number(data.price).toFixed(4)}\nConfiança: ${(data.confidence * 100).toFixed(1)}%\nSL: ${data.sl}% | TP: ${data.tp}%`;
      case 'trade_close': {
        const e = data.pnl >= 0 ? '💰' : '🔴';
        return `${e} *TRADE FECHADO* | ${ts}\nPar: ${data.symbol}\nP&L: ${data.pnl >= 0 ? '+' : ''}$${Number(data.pnl).toFixed(2)} (${Number(data.pnlPct).toFixed(2)}%)\nMotivo: ${data.reason}\nDuração: ${data.duration}`;
      }
      case 'daily_loss':
        return `⚠️ *LIMITE DIÁRIO ATINGIDO* | ${ts}\nPerda: $${Number(data.loss).toFixed(2)}\nLimite: ${data.limit}%\nBot pausado automaticamente.`;
      case 'daily_report':
        return `📊 *RELATÓRIO DIÁRIO* | ${ts}\nTrades: ${data.totalTrades} (${data.wins}W/${data.losses}L)\nWin Rate: ${Number(data.winRate).toFixed(1)}%\nP&L: ${data.pnl >= 0 ? '+' : ''}$${Number(data.pnl).toFixed(2)}\nMelhor estratégia: ${data.bestStrategy}\nMax Drawdown: ${Number(data.maxDrawdown).toFixed(2)}%`;
      case 'error':
        return `🚨 *ERRO* | ${ts}\n${data.message}\nComponente: ${data.component}`;
      case 'kill_switch':
        return `🛑 *KILL SWITCH ATIVADO* | ${ts}\nBot parado imediatamente.\nMotivo: ${data.reason || 'Manual'}`;
      case 'bot_started':
        return `▶️ *BOT INICIADO* | ${ts}\nModo: ${data.mode}\nPar: ${data.symbol}\nEstratégia: ${data.strategy}`;
      case 'bot_stopped':
        return `⏹ *BOT PARADO* | ${ts}\nMotivo: ${data.reason || 'Manual'}`;
      default:
        return `ℹ️ *${type}* | ${ts}\n${JSON.stringify(data).slice(0, 400)}`;
    }
  }

  async sendAlert(type, data = {}) {
    const ts = new Date().toISOString();
    const entry = { type, data, ts, results: {} };
    const text = this.formatMessage(type, data);

    const [tg, dc] = await Promise.allSettled([
      this.sendTelegram(text),
      this.sendDiscord(text),
    ]);
    entry.results.telegram = tg.status === 'fulfilled' ? tg.value : { error: tg.reason?.message };
    entry.results.discord = dc.status === 'fulfilled' ? dc.value : { error: dc.reason?.message };

    this.history.unshift(entry);
    if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
    return entry;
  }

  getHistory(limit = 50) { return this.history.slice(0, limit); }
  getConfig() {
    // Don't expose tokens in status
    return {
      telegram: { enabled: this.config.telegram.enabled, chatId: this.config.telegram.chatId, hasToken: !!this.config.telegram.botToken },
      discord: { enabled: this.config.discord.enabled, hasWebhook: !!this.config.discord.webhookUrl },
    };
  }
}
