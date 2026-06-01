import { useEffect, useRef } from 'react';

const PAIR_MAP = {
  ETH: 'BYBIT:ETHUSDT',
  BTC: 'BYBIT:BTCUSDT',
  SOL: 'BYBIT:SOLUSDT',
  ARB: 'BYBIT:ARBUSDT',
};

const TF_MAP = {
  '1s': '1',  '5s': '1',  '15s': '1',  '30s': '1',
  '1m': '1',  '3m': '3',  '5m': '5',
  '15m': '15', '1h': '60',
};

function loadTvScript() {
  return new Promise((resolve) => {
    if (window.TradingView) { resolve(); return; }
    const existing = document.getElementById('tv-script');
    if (existing) { existing.addEventListener('load', resolve); return; }
    const script = document.createElement('script');
    script.id = 'tv-script';
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

export function TradingChart({ portfolio, basePair = 'ETH', timeframe = '1m' }) {
  const containerRef = useRef(null);
  const widgetRef    = useRef(null);

  const symbol   = PAIR_MAP[basePair] ?? 'BYBIT:ETHUSDT';
  const interval = TF_MAP[timeframe] ?? '1';

  useEffect(() => {
    if (!containerRef.current) return;

    const containerId = `tv_${basePair}_${timeframe}`;
    containerRef.current.id = containerId;
    containerRef.current.innerHTML = '';

    let cancelled = false;

    loadTvScript().then(() => {
      if (cancelled || !window.TradingView || !containerRef.current) return;
      widgetRef.current = new window.TradingView.widget({
        autosize:            true,
        symbol,
        interval,
        container_id:        containerId,
        timezone:            'America/Sao_Paulo',
        theme:               'dark',
        style:               '1',
        locale:              'pt',
        toolbar_bg:          '#04080d',
        enable_publishing:   false,
        hide_top_toolbar:    false,
        hide_legend:         false,
        save_image:          false,
        studies:             ['RSI@tv-basicstudies', 'MASimple@tv-basicstudies'],
        show_popup_button:   false,
        withdateranges:      true,
        allow_symbol_change: false,
        details:             false,
        hotlist:             false,
        calendar:            false,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
    />
  );
}
