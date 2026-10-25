'use strict';
/**
 * Daily OHLC record rules.
 *  - From the stock page (source-provided session figures): status "provisional".
 *      open = first valid open seen, high = highest seen, low = lowest seen,
 *      close = latest traded price (NOT official until PSE's history confirms it).
 *  - From PSE's history endpoint (official daily bars): status "finalized".
 *      Overwrites O/H/L/C/value. Volume is kept from the stock page (history has none).
 *  - Nothing is invented: missing values stay null.
 */
const closeTo = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;

function baseRecord(ticker, tradingDate) {
  return {
    id: `${ticker}_${tradingDate}`, ticker, tradingDate,
    open: null, high: null, low: null, close: null, volume: null, value: null,
    status: 'provisional', ohlcSource: 'pse-stock-page-snapshot', volumeSource: null,
    lastAsOf: null, lastVerifiedAt: null, notes: []
  };
}

function provisionalFromQuote({ ticker, quote, existing, now }) {
  const rec = existing ? { ...existing, notes: [...(existing.notes || [])] } : baseRecord(ticker, quote.tradingDate);
  const nowIso = new Date(now).toISOString();

  if (rec.status === 'finalized') {
    // Official numbers are never overwritten by page snapshots. Only fill in missing volume.
    if (rec.volume == null && quote.volume != null) { rec.volume = quote.volume; rec.volumeSource = 'pse-stock-page'; }
    rec.lastVerifiedAt = nowIso;
    return rec;
  }

  if (rec.open == null && quote.open != null) rec.open = quote.open;
  if (quote.high != null) rec.high = rec.high == null ? quote.high : Math.max(rec.high, quote.high);
  if (quote.low != null) rec.low = rec.low == null ? quote.low : Math.min(rec.low, quote.low);
  if (quote.last != null) rec.close = quote.last;
  if (quote.volume != null) { rec.volume = quote.volume; rec.volumeSource = 'pse-stock-page'; }
  if (quote.value != null) rec.value = quote.value;
  rec.lastAsOf = quote.asOf;
  rec.lastVerifiedAt = nowIso;
  rec.status = 'provisional';
  rec.incomplete = [rec.open, rec.high, rec.low, rec.close].some((v) => v == null);
  return rec;
}

/**
 * Merge an official history row into the stored record.
 * canFinalize=false (today's session still open): the row is ignored so a mid-session bar can't be called final.
 * Returns { record, changed, discrepancy }.
 */
function applyOfficial({ ticker, row, existing, now, canFinalize = true }) {
  if (!canFinalize) return { record: existing || null, changed: false, discrepancy: null };
  const nowIso = new Date(now).toISOString();
  const before = existing ? { ...existing } : null;
  const rec = existing ? { ...existing, notes: [...(existing.notes || [])] } : baseRecord(ticker, row.tradingDate);

  let discrepancy = null;
  if (before && before.status !== 'finalized' && before.close != null && !closeTo(before.close, row.close)) {
    discrepancy = `Page last price ${before.close} differed from official close ${row.close}; official value used.`;
    rec.notes.push(discrepancy);
  }
  rec.open = row.open; rec.high = row.high; rec.low = row.low; rec.close = row.close;
  rec.value = row.value ?? rec.value;
  rec.status = 'finalized';
  rec.ohlcSource = 'pse-history-endpoint';
  rec.incomplete = false;
  rec.lastVerifiedAt = nowIso;

  const sig = (r) => r && [r.open, r.high, r.low, r.close, r.value, r.status].join('|');
  const changed = sig(before) !== sig(rec);
  return { record: rec, changed, discrepancy };
}

module.exports = { provisionalFromQuote, applyOfficial, baseRecord };
