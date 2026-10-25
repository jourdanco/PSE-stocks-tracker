'use strict';
/**
 * Official daily OHLC from PSE Edge's chart endpoint (verified by you in Chrome DevTools):
 *   POST /common/DisclosureCht.ax   body fields: cmpy_id, security_id, startDate, endDate  (MM-DD-YYYY); sent as JSON (form-encoded fallback)
 *   response: { chartData: [{ OPEN, HIGH, LOW, CLOSE, VALUE, CHART_DATE: "Oct 20, 2026 00:00:00" }], ... }
 * No volume field is provided, only VALUE (traded value in PHP).
 */
const { toMDY } = require('../time');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseChartDate(text) {
  const m = String(text || '').match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Pure: JSON -> clean rows. Rows with impossible numbers are skipped, never repaired. */
function parseHistory(json) {
  const warnings = [];
  const rows = [];
  const list = json && Array.isArray(json.chartData) ? json.chartData : null;
  if (!list) return { rows, warnings: ['Response has no chartData array.'] };

  for (const r of list) {
    const tradingDate = parseChartDate(r.CHART_DATE);
    const open = Number(r.OPEN), high = Number(r.HIGH), low = Number(r.LOW), close = Number(r.CLOSE);
    const value = r.VALUE === null || r.VALUE === undefined ? null : Number(r.VALUE);
    if (!tradingDate) { warnings.push(`Unreadable date: ${r.CHART_DATE}`); continue; }
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) {
      warnings.push(`${tradingDate}: missing/invalid OHLC, skipped.`); continue;
    }
    if (high < Math.max(open, close, low) - 1e-9 || low > Math.min(open, close, high) + 1e-9) {
      warnings.push(`${tradingDate}: inconsistent OHLC (high/low do not bracket open/close), skipped.`); continue;
    }
    rows.push({ tradingDate, open, high, low, close, value: Number.isFinite(value) ? value : null });
  }
  rows.sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  return { rows, warnings };
}

async function fetchHistory({ cmpyId, securityId, startDate, endDate }, options = {}) {
  const baseUrl = options.baseUrl || process.env.PSE_BASE_URL || 'https://edge.pse.com.ph';
  const userAgent = options.userAgent || process.env.PSE_USER_AGENT || 'PersonalStockTracker/0.1 (personal use)';
  const timeoutMs = options.timeoutMs || Number(process.env.PSE_REQUEST_TIMEOUT_MS || 15000);
  const fetchImpl = options.fetchImpl || fetch;

  const fields = { cmpy_id: String(cmpyId), endDate: toMDY(endDate), security_id: String(securityId), startDate: toMDY(startDate) };
  // Chrome showed the payload with quoted string values, which is how JSON bodies appear.
  // So JSON is tried first; form-encoding is a fallback in case PSE expects that instead.
  const attempts = [
    { name: 'json', type: 'application/json; charset=UTF-8', body: JSON.stringify(fields) },
    { name: 'form', type: 'application/x-www-form-urlencoded; charset=UTF-8', body: new URLSearchParams(fields).toString() }
  ];
  if (options.format) attempts.sort((a) => (a.name === options.format ? -1 : 1));

  let lastStatus = null;
  for (const a of attempts) {
    const res = await fetchImpl(`${baseUrl}/common/DisclosureCht.ax`, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Content-Type': a.type,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: `${baseUrl}/companyPage/stockData.do?cmpy_id=${cmpyId}`
      },
      body: a.body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.status === 415 || res.status === 400) { lastStatus = res.status; continue; } // wrong body format: try the next one
    if (!res.ok) throw new Error(`History endpoint returned HTTP ${res.status} (sent as ${a.name})`);
    let json;
    try { json = await res.json(); } catch { throw new Error(`History endpoint did not return JSON (sent as ${a.name})`); }
    const parsed = parseHistory(json);
    parsed.sentAs = a.name;
    return parsed;
  }
  throw new Error(`History endpoint rejected both JSON and form formats (last HTTP ${lastStatus}). Please send me the request's Content-Type header from Chrome DevTools.`);
}

module.exports = { parseChartDate, parseHistory, fetchHistory };
