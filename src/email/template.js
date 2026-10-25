'use strict';
const { fmtManila } = require('../time');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const num = (n, d = 2) => (isNum(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
const int = (n) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : 'n/a');
const money = (n) => (!isNum(n) ? 'n/a' : n >= 1e9 ? `₱${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `₱${(n / 1e6).toFixed(2)}M` : `₱${int(n)}`);
const arrow = (c) => (c > 0 ? '▲' : c < 0 ? '▼' : '■');
const color = (c) => (c > 0 ? '#16a34a' : c < 0 ? '#dc2626' : '#6b7280');
const signed = (n, d = 2) => (isNum(n) ? `${n > 0 ? '+' : ''}${num(n, d)}` : 'n/a');
const move = (change, pct) => `${arrow(change)} ${signed(change)} (${signed(pct)}%)`;

function chartBlock(label, cid, error) {
  if (cid) return `<div style="margin:10px 0;"><img src="cid:${esc(cid)}" alt="${esc(label)}" width="600" style="width:100%;max-width:600px;height:auto;border:1px solid #e5e7eb;border-radius:6px;display:block;"></div>`;
  return `<div style="margin:10px 0;padding:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:13px;color:#92400e;">${esc(label)} unavailable${error ? `: ${esc(error)}` : ''}. The figures above are unaffected.</div>`;
}

function row(label, value) {
  return `<tr><td style="padding:4px 8px;color:#6b7280;font-size:13px;">${esc(label)}</td><td style="padding:4px 8px;font-size:13px;text-align:right;">${value}</td></tr>`;
}

function stockBlock(s) {
  const l = s.latest;
  if (!l) {
    return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:14px 0;"><h3 style="margin:0;font-size:16px;">${esc(s.ticker)} — ${esc(s.name)}</h3><p style="color:#92400e;">No valid data collected yet for this stock.</p></div>`;
  }
  return `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:14px 0;">
    <h3 style="margin:0 0 2px 0;font-size:17px;">${esc(s.ticker)} — ${esc(s.name)}</h3>
    <div style="font-size:26px;font-weight:bold;color:${color(l.change)};">₱${num(l.last)} <span style="font-size:15px;">${esc(move(l.change, l.changePct))}</span></div>
    ${l.changeSource === 'calculated' ? '<div style="font-size:11px;color:#92400e;">Change calculated by this app from last price and previous close.</div>' : ''}
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px;">
      ${row('Trading date', esc(l.tradingDate))}
      ${row('Source timestamp (PSE Edge)', esc(fmtManila(l.asOf)))}
      ${row('Open / High / Low', `${num(l.open)} / ${num(l.high)} / ${num(l.low)}`)}
      ${row('Volume', int(l.volume))}
      ${row('Value', money(l.value))}
    </table>
    ${chartBlock('Intraday price chart', s.lineCid, s.lineError)}
    ${chartBlock('Monthly candlestick chart', s.candleCid, s.candleError)}
  </div>`;
}

function pseiBlock(p) {
  if (!p || !p.psei) return `<div style="padding:12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;">PSEi data unavailable.</div>`;
  const i = p.psei;
  return `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:14px 0;">
    <h3 style="margin:0 0 4px 0;font-size:16px;">PSEi</h3>
    <div style="font-size:26px;font-weight:bold;color:${color(i.change)};">${num(i.value)} <span style="font-size:15px;">${esc(move(i.change, i.changePct))}</span></div>
    <div style="font-size:13px;color:#6b7280;">Market status: <b>${esc(p.marketStatus || 'n/a')}</b> · Trading date ${esc(p.tradingDate)} · As of ${esc(fmtManila(p.asOf))}</div>
  </div>`;
}

function buildEmail({ date, psei, stocks, notes = [] }) {
  const first = stocks.find((s) => s.latest);
  const subject = `PSE Daily Report ${date}` +
    (psei && psei.psei ? ` · PSEi ${num(psei.psei.value)} (${signed(psei.psei.changePct)}%)` : '') +
    (first ? ` · ${first.ticker} ${num(first.latest.last)}` : '');

  const noteHtml = notes.length ? `<div style="padding:10px 12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;margin:10px 0;">${notes.map(esc).join('<br>')}</div>` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:640px;margin:0 auto;padding:16px;">
  <h2 style="margin:0 0 2px 0;">PSE Daily Report</h2>
  <div style="color:#6b7280;font-size:13px;">Report date ${esc(date)} · generated ${esc(fmtManila(new Date().toISOString()))} (Manila)</div>
  ${noteHtml}
  ${pseiBlock(psei)}
  ${stocks.map(stockBlock).join('')}
  <div style="font-size:11px;color:#6b7280;margin-top:16px;line-height:1.5;">
   
  </div>
</div></body></html>`;

  const text = [
    `PSE Daily Report ${date}`,
    psei && psei.psei ? `PSEi ${num(psei.psei.value)} ${move(psei.psei.change, psei.psei.changePct)} | ${psei.marketStatus || 'n/a'} | as of ${fmtManila(psei.asOf)}` : 'PSEi data unavailable',
    ...stocks.map((s) => s.latest
      ? `${s.ticker} ${num(s.latest.last)} ${move(s.latest.change, s.latest.changePct)} | vol ${int(s.latest.volume)} | value ${money(s.latest.value)} | PSE as of ${fmtManila(s.latest.asOf)} | charts: ${s.lineCid ? 'ok' : 'missing'}/${s.candleCid ? 'ok' : 'missing'}`
      : `${s.ticker}: no valid data yet`),
    ...notes
  ].join('\n');

  return { subject, html, text };
}

module.exports = { buildEmail, esc, num, int, money, move };
