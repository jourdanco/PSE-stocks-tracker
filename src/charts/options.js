'use strict';
/** Pure functions that build ECharts option objects (easy to test; no rendering here). */
const { minutesOfDayManila, fmtClock, fmtManila } = require('../time');

const FONT = 'DejaVu Sans';
const GREEN = '#16a34a', RED = '#dc2626', GREY = '#6b7280', BLUE = '#2563eb';
const LUNCH = [12 * 60, 13 * 60 + 30]; // PSE midday break (verify against PSE's official trading hours)
const px2 = (v) => Number(v).toFixed(2);

function placeholder(title, message, height = 300) {
  return {
    animation: false, backgroundColor: '#ffffff', textStyle: { fontFamily: FONT },
    title: { text: title, left: 12, top: 8, textStyle: { fontSize: 16 } },
    graphic: [{ type: 'text', left: 'center', top: height / 2 - 10, style: { text: message, fontSize: 14, fill: GREY, textAlign: 'center' } }]
  };
}

function gapMinutes(a, b) {
  const overlap = Math.max(0, Math.min(b, LUNCH[1]) - Math.max(a, LUNCH[0]));
  return b - a - overlap;
}

function buildLineOption({ ticker, name, tradingDate, observations, gapThresholdMin = 45 }) {
  const title = `${ticker} — ${name}`;
  if (!observations || observations.length === 0) {
    return placeholder(title, `No price observations recorded for ${tradingDate || 'this session'}`);
  }
  const pts = observations
    .map((o) => ({ m: minutesOfDayManila(o.observedAt), p: o.price, verified: o.timeVerified !== false }))
    .sort((a, b) => a.m - b.m);

  const prices = pts.map((p) => p.p);
  const hi = Math.max(...prices), lo = Math.min(...prices);
  const pad = Math.max((hi - lo) * 0.25, hi * 0.005);
  const yMin = Math.floor((lo - pad) * 100) / 100, yMax = Math.ceil((hi + pad) * 100) / 100;
  const xMin = Math.floor(Math.min(pts[0].m, 9 * 60 + 30) / 60) * 60;
  const xMax = Math.ceil(Math.max(pts[pts.length - 1].m, 15 * 60) / 60) * 60;

  const labelIdx = new Set([0, pts.length - 1, prices.indexOf(hi), prices.indexOf(lo)]);
  const last = pts[pts.length - 1];
  const data = pts.map((p, i) => {
    const item = { value: [p.m, p.p] };
    if (labelIdx.has(i)) {
      item.label = { show: true, position: 'top', fontSize: 11, color: '#111',
        formatter: i === pts.length - 1 ? `Last ${px2(p.p)} (${fmtClock(p.m)})` : px2(p.p) };
    }
    if (!p.verified) item.itemStyle = { color: '#f59e0b' };
    return item;
  });

  const gaps = [];
  for (let i = 1; i < pts.length; i++) {
    if (gapMinutes(pts[i - 1].m, pts[i].m) > gapThresholdMin) {
      gaps.push([{ xAxis: pts[i - 1].m, name: 'no change recorded' }, { xAxis: pts[i].m }]);
    }
  }

  return {
    animation: false, backgroundColor: '#ffffff', textStyle: { fontFamily: FONT },
    title: {
      text: title, subtext: `Session ${tradingDate} · price changes observed by this tracker (steps hold the last price; not every trade)`,
      left: 12, top: 6, textStyle: { fontSize: 16 }, subtextStyle: { fontSize: 10, color: '#555' }
    },
    grid: { left: 54, right: 24, top: 74, bottom: 40 },
    xAxis: { type: 'value', min: xMin, max: xMax, interval: 60, axisLabel: { fontSize: 11, formatter: (v) => fmtClock(v) }, splitLine: { show: true, lineStyle: { color: '#eee' } } },
    yAxis: { type: 'value', min: yMin, max: yMax, axisLabel: { fontSize: 11, formatter: (v) => px2(v) }, splitLine: { lineStyle: { color: '#eee' } } },
    series: [{
      type: 'line', step: 'end', data, symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE },
      markArea: gaps.length ? { silent: true, itemStyle: { color: 'rgba(120,120,120,0.12)' }, label: { fontSize: 9, color: '#666' }, data: gaps } : undefined
    }],
    _meta: { gaps: gaps.length, points: pts.length, lastClock: fmtClock(last.m) }
  };
}

const candleColor = (r) => (r.close > r.open ? GREEN : r.close < r.open ? RED : GREY);

function buildCandleOption({ ticker, name, rows, periodLabel }) {
  const title = `${ticker} — ${name}`;
  const usable = (rows || []).filter((r) => [r.open, r.high, r.low, r.close].every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (usable.length === 0) return placeholder(title, 'No daily OHLC data available for this period', 420);

  const provisional = usable.filter((r) => r.status !== 'finalized').length;
  const skipped = (rows || []).length - usable.length;
  const cats = usable.map((r) => r.tradingDate.slice(5) + (r.status !== 'finalized' ? '*' : ''));
  const candles = usable.map((r) => {
    const c = candleColor(r);
    return { value: [r.open, r.close, r.low, r.high], itemStyle: { color: c, color0: c, borderColor: c, borderColor0: c, opacity: r.status === 'finalized' ? 1 : 0.55 } };
  });
  const bars = usable.map((r) => ({ value: r.value != null ? Math.round(r.value / 1e4) / 100 : '-', itemStyle: { color: candleColor(r), opacity: 0.6 } }));

  const notes = [periodLabel, `${usable.length} sessions`];
  if (provisional) notes.push(`* provisional (${provisional}): not yet confirmed by PSE history`);
  if (skipped) notes.push(`${skipped} session(s) missing OHLC, not drawn`);

  return {
    animation: false, backgroundColor: '#ffffff', textStyle: { fontFamily: FONT },
    title: { text: title, subtext: notes.join(' · '), left: 12, top: 6, textStyle: { fontSize: 16 }, subtextStyle: { fontSize: 10, color: '#555' } },
    grid: [{ left: 54, right: 24, top: 74, height: '50%' }, { left: 54, right: 24, top: '74%', height: '12%' }],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { fontSize: 10, rotate: cats.length > 10 ? 60 : 0, hideOverlap: true } }
    ],
    yAxis: [
      { type: 'value', scale: true, gridIndex: 0, axisLabel: { fontSize: 11, formatter: (v) => px2(v) }, splitLine: { lineStyle: { color: '#eee' } } },
      { type: 'value', gridIndex: 1, name: 'Value ₱M', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { show: false } }
    ],
    series: [
      { type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: candles },
      { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: bars }
    ],
    _meta: { sessions: usable.length, provisional, skipped }
  };
}

module.exports = { buildLineOption, buildCandleOption, candleColor, gapMinutes, FONT, GREEN, RED, GREY };
