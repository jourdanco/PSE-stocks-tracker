'use strict';
/**
 * Pure parsing logic (no network, no libraries) so it is easy to test.
 *
 * Input: "tokens" = the text of every table cell on the PSE Edge "Stock Data"
 * page, in page order, e.g. ["Last Traded Price", "550.00", "Open", "555.00", ...]
 * Layout verified on https://edge.pse.com.ph/companyPage/stockData.do?cmpy_id=599
 * (labels and values sit in neighbouring cells).
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "1,234.50" -> 1234.5 ; "abc" -> null */
function toNumber(text) {
  if (text === null || text === undefined) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Find the value cell that follows a label cell.
 * numeric:true skips occurrences whose next cell is not a number. This matters
 * because "Open" appears twice on the page: once as the stock STATUS and once
 * as the day's opening PRICE.
 */
function findValue(tokens, label, { numeric = false } = {}) {
  const want = label.toLowerCase();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].toLowerCase() !== want) continue;
    const next = tokens[i + 1];
    if (!numeric || toNumber(next) !== null) return next;
  }
  return null;
}

/** "down   5.00  ( 0.90%)" -> { change: -5, changePct: -0.9 } */
function parseChange(text) {
  if (!text) return { change: null, changePct: null };
  const nums = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return { change: null, changePct: null };
  const negative = /down|▼/i.test(text) || /(^|\()\s*-\s*\d/.test(text);
  const sign = negative ? -1 : 1;
  const change = Number(nums[0]) * sign;
  const changePct = nums.length > 1 ? Number(nums[1]) * sign : null;
  return { change: change === 0 ? 0 : change, changePct: changePct === 0 ? 0 : changePct };
}

/** "555.00  (Oct 20, 2026)" -> { price: 555, date: "2026-10-20" } */
function parsePrevClose(text) {
  if (!text) return { price: null, date: null };
  const price = toNumber(text);
  const m = text.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})/);
  let date = null;
  if (m && MONTHS[m[1].toLowerCase()]) {
    date = `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return { price, date };
}

/** "As of Oct 21, 2026 02:50 PM" -> { asOfRaw, asOf: "2026-10-21T14:50:00+08:00", tradingDate: "2026-10-21" } */
function parseAsOf(fullText) {
  const m = (fullText || '').match(/As of\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return { asOfRaw: null, asOf: null, tradingDate: null };
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return { asOfRaw: m[0], asOf: null, tradingDate: null };
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  const date = `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const time = `${String(hour).padStart(2, '0')}:${m[5]}:00`;
  // The Philippines has no daylight saving time, so the offset is always +08:00.
  return { asOfRaw: m[0], asOf: `${date}T${time}+08:00`, tradingDate: date };
}

/**
 * Turn tokens + page text into one clean quote object.
 * Never invents values: anything missing stays null and a warning is added.
 */
function parseStockData(tokens, fullText, { expectedTicker } = {}) {
  const warnings = [];
  const { asOfRaw, asOf, tradingDate } = parseAsOf(fullText);
  if (!asOf) warnings.push('Could not read the "As of" timestamp - cannot judge freshness.');

  const last = toNumber(findValue(tokens, 'Last Traded Price', { numeric: true }));
  if (last === null) warnings.push('No last traded price found (stock may not have traded).');

  const prev = parsePrevClose(findValue(tokens, 'Previous Close and Date'));
  const sourceChange = parseChange(findValue(tokens, 'Change(% Change)'));

  let change = sourceChange.change;
  let changePct = sourceChange.changePct;
  let changeSource = change !== null ? 'source' : null;

  if (change === null && last !== null && prev.price) {
    change = Math.round((last - prev.price) * 10000) / 10000;
    changePct = Math.round(((last - prev.price) / prev.price) * 1000000) / 10000;
    changeSource = 'calculated'; // clearly marked: NOT provided by PSE
    warnings.push('Change was calculated from last price and previous close, not provided by PSE.');
  } else if (change !== null && last !== null && prev.price !== null) {
    if (Math.abs(last - prev.price - change) > 0.005) {
      warnings.push(`Source change (${change}) disagrees with last - previous close (${(last - prev.price).toFixed(4)}).`);
    }
  }

  if (expectedTicker && !new RegExp(`\\b${expectedTicker}\\b`).test(fullText || '')) {
    warnings.push(`Ticker "${expectedTicker}" not found on the page - is the cmpyId correct?`);
  }

  return {
    ok: last !== null && asOf !== null,
    source: 'pse-edge',
    asOfRaw,
    asOf,            // source timestamp (ISO, Manila time)
    tradingDate,     // date part of asOf
    status: findValue(tokens, 'Status'), // meaning not yet verified; stored as-is
    last,
    change,
    changePct,
    changeSource,    // 'source' | 'calculated' | null
    open: toNumber(findValue(tokens, 'Open', { numeric: true })),
    high: toNumber(findValue(tokens, 'High', { numeric: true })),
    low: toNumber(findValue(tokens, 'Low', { numeric: true })),
    prevClose: prev.price,
    prevCloseDate: prev.date,
    avgPrice: toNumber(findValue(tokens, 'Average Price', { numeric: true })),
    volume: toNumber(findValue(tokens, 'Volume', { numeric: true })),
    value: toNumber(findValue(tokens, 'Value', { numeric: true })),
    week52High: toNumber(findValue(tokens, '52-Week High', { numeric: true })),
    week52Low: toNumber(findValue(tokens, '52-Week Low', { numeric: true })),
    warnings
  };
}

module.exports = { toNumber, findValue, parseChange, parsePrevClose, parseAsOf, parseStockData };
