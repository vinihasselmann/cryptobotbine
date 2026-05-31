import { useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';

// ─── PALETTE ───────────────────────────────────────────────────────────────────

const C = {
  bg:     '#04080d',
  bg2:    '#0d1520',
  grid:   '#1a2235',
  border: '#1e2e42',
  text:   '#4a5568',
  green:  '#00e676',
  red:    '#ff3d57',
  yellow: '#ffd740',
  cyan:   '#00e5ff',
  purple: '#b388ff',
};

// Fixed base so timestamps never shift when the candles array grows
// Chart times come from the candle timestamps supplied by the market feed.

// ─── DATA COMPUTATION ──────────────────────────────────────────────────────────

function computeData(candles) {
  if (!candles || candles.length < 2) return null;

  const n      = candles.length;
  const closes = candles.map((c) => c.close);

  const fallbackStart = Math.floor(Date.now() / 1000) - n * 60;
  const t = (c, i) => c.ts ? Math.floor(c.ts / 1000) : fallbackStart + i * 60;

  // ── Candles & Volume ──────────────────────────────────────────────────────
  const candleData = candles.map((c, i) => ({
    time:  t(c, i),
    open:  +c.open.toFixed(2),
    high:  +c.high.toFixed(2),
    low:   +c.low.toFixed(2),
    close: +c.close.toFixed(2),
  }));

  const volData = candles.map((c, i) => ({
    time:  t(c, i),
    value: +c.volume.toFixed(0),
    color: c.close >= c.open ? 'rgba(0,230,118,0.35)' : 'rgba(255,61,87,0.35)',
  }));

  // ── EMA9 & EMA21 — O(n) running ───────────────────────────────────────────
  const ema9Data = [], ema21Data = [];
  let e9 = 0, e21 = 0;
  const k9 = 2 / 10, k21 = 2 / 22;

  for (let i = 0; i < n; i++) {
    const p = closes[i];

    if (i === 8)     e9  = closes.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    else if (i > 8)  e9  = p * k9  + e9  * (1 - k9);
    if (i >= 8)      ema9Data.push({ time: t(candles[i], i), value: +e9.toFixed(2) });

    if (i === 20)    e21 = closes.slice(0, 21).reduce((a, b) => a + b, 0) / 21;
    else if (i > 20) e21 = p * k21 + e21 * (1 - k21);
    if (i >= 20)     ema21Data.push({ time: t(candles[i], i), value: +e21.toFixed(2) });
  }

  // ── Bollinger Bands (20, 2) ────────────────────────────────────────────────
  const bbU = [], bbM = [], bbL = [];
  for (let i = 19; i < n; i++) {
    const sl  = closes.slice(i - 19, i + 1);
    const mid = sl.reduce((a, b) => a + b, 0) / 20;
    const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / 19);
    bbU.push({ time: t(candles[i], i), value: +(mid + 2 * std).toFixed(2) });
    bbM.push({ time: t(candles[i], i), value: +mid.toFixed(2) });
    bbL.push({ time: t(candles[i], i), value: +(mid - 2 * std).toFixed(2) });
  }

  // ── RSI (14) ──────────────────────────────────────────────────────────────
  const rsiData = [];
  for (let i = 14; i < n; i++) {
    const sl = closes.slice(i - 14, i + 1);
    let g = 0, l = 0;
    for (let j = 1; j < sl.length; j++) {
      const d = sl[j] - sl[j - 1];
      if (d > 0) g += d; else l -= d;
    }
    const rs = (g / 14) / ((l / 14) || 0.0001);
    rsiData.push({ time: t(candles[i], i), value: +(100 - 100 / (1 + rs)).toFixed(2) });
  }

  return { candleData, volData, ema9Data, ema21Data, bbU, bbM, bbL, rsiData };
}

// ─── COMPONENT ─────────────────────────────────────────────────────────────────

export function TradingChart({ candles, portfolio }) {
  const mainRef      = useRef(null);
  const rsiRef       = useRef(null);
  const refs         = useRef({});       // { mc, rc, series... }
  const entryLineRef = useRef(null);
  const syncingRef   = useRef(false);    // prevents sync loop

  const data = useMemo(() => computeData(candles), [candles]);

  // ── Create charts once ───────────────────────────────────────────────────

  useEffect(() => {
    if (!mainRef.current || !rsiRef.current) return;

    const shared = {
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor:  C.text,
        fontSize:   10,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: '#2a3a52', style: LineStyle.Solid,  width: 1, labelBackgroundColor: C.bg2 },
        horzLine: { color: '#2a3a52', style: LineStyle.Solid,  width: 1, labelBackgroundColor: C.bg2 },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    };

    const mc = createChart(mainRef.current, {
      ...shared,
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.06, bottom: 0.22 } },
      timeScale:       { borderColor: C.border, visible: false },
    });

    const rc = createChart(rsiRef.current, {
      ...shared,
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale:       { borderColor: C.border, visible: true, timeVisible: true, secondsVisible: true },
    });

    // ── Series ──────────────────────────────────────────────────────────────
    const cSer = mc.addSeries(CandlestickSeries, {
      upColor:         C.green,  downColor:       C.red,
      borderUpColor:   C.green,  borderDownColor: C.red,
      wickUpColor:     '#00b856', wickDownColor:  '#cc3048',
    });

    const bbUSer = mc.addSeries(LineSeries, { color: 'rgba(255,215,64,0.5)',  lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbMSer = mc.addSeries(LineSeries, { color: 'rgba(255,215,64,0.22)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    const bbLSer = mc.addSeries(LineSeries, { color: 'rgba(255,215,64,0.5)',  lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    const e9Ser  = mc.addSeries(LineSeries, { color: C.green,  lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    const e21Ser = mc.addSeries(LineSeries, { color: C.purple, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false });

    const vSer = mc.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    mc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const rSer = rc.addSeries(LineSeries, { color: C.cyan, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    rSer.createPriceLine({ price: 70, color: 'rgba(255,61,87,0.65)',  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,  title: '' });
    rSer.createPriceLine({ price: 50, color: 'rgba(80,105,140,0.3)',  lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    rSer.createPriceLine({ price: 30, color: 'rgba(0,230,118,0.65)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,  title: '' });

    // ── Sync time scale (with loop guard) ────────────────────────────────
    mc.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRef.current || !range) return;
      syncingRef.current = true;
      try { rc.timeScale().setVisibleLogicalRange(range); } catch {}
      syncingRef.current = false;
    });
    rc.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRef.current || !range) return;
      syncingRef.current = true;
      try { mc.timeScale().setVisibleLogicalRange(range); } catch {}
      syncingRef.current = false;
    });

    // ── Auto-resize ────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      try {
        if (mainRef.current) mc.applyOptions({ width: mainRef.current.clientWidth });
        if (rsiRef.current)  rc.applyOptions({ width: rsiRef.current.clientWidth  });
      } catch {}
    });
    if (mainRef.current) ro.observe(mainRef.current);
    if (rsiRef.current)  ro.observe(rsiRef.current);

    refs.current = { mc, rc, cSer, bbUSer, bbMSer, bbLSer, e9Ser, e21Ser, vSer, rSer };

    return () => {
      ro.disconnect();
      try { mc.remove(); } catch {}
      try { rc.remove(); } catch {}
      refs.current = {};
    };
  }, []);

  // ── Update series data ────────────────────────────────────────────────────

  useEffect(() => {
    const { cSer, bbUSer, bbMSer, bbLSer, e9Ser, e21Ser, vSer, rSer, mc, rc } = refs.current;
    if (!cSer || !data) return;

    try {
      cSer.setData(data.candleData);
      vSer.setData(data.volData);
      e9Ser.setData(data.ema9Data);
      e21Ser.setData(data.ema21Data);
      bbUSer.setData(data.bbU);
      bbMSer.setData(data.bbM);
      bbLSer.setData(data.bbL);
      rSer.setData(data.rsiData);
      // Scroll to latest without triggering the sync handler
      syncingRef.current = true;
      mc.timeScale().scrollToRealTime();
      rc.timeScale().scrollToRealTime();
      syncingRef.current = false;
    } catch (e) {
      syncingRef.current = false;
      console.warn('TradingChart update error:', e.message);
    }
  }, [data]);

  // ── Entry price line ──────────────────────────────────────────────────────

  useEffect(() => {
    const { cSer } = refs.current;
    if (!cSer) return;
    try {
      if (entryLineRef.current) { cSer.removePriceLine(entryLineRef.current); entryLineRef.current = null; }
      if ((portfolio?.crypto ?? 0) > 0 && (portfolio?.buyPrice ?? 0) > 0) {
        entryLineRef.current = cSer.createPriceLine({
          price: portfolio.buyPrice, color: C.yellow,
          lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: 'Entrada',
        });
      }
    } catch {}
  }, [portfolio?.buyPrice, portfolio?.crypto]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="trading-chart-wrap">
      <div className="chart-legend">
        <span><span style={{ color: C.green  }}>━ ━</span> EMA9</span>
        <span><span style={{ color: C.purple }}>···</span> EMA21</span>
        <span><span style={{ color: 'rgba(255,215,64,0.85)' }}>──</span> BB(20,2)</span>
        <span style={{ color: '#354e62' }}>Vol (barras)</span>
      </div>
      <div ref={mainRef} className="chart-main-pane" />
      <div className="chart-rsi-label">
        RSI(14)
        <span style={{ color: C.red,   marginLeft: 10 }}>─── 70</span>
        <span style={{ color: C.green, marginLeft: 10 }}>─── 30</span>
      </div>
      <div ref={rsiRef} className="chart-rsi-pane" />
    </div>
  );
}
