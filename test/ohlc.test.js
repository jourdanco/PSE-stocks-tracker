'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { provisionalFromQuote, applyOfficial } = require('../src/logic/ohlc');
const { parseHistory } = require('../src/pse/history');

const NOW = new Date('2026-10-22T10:30:00Z');
const quote = (o = {}) => ({ tradingDate: '2026-10-22', open: 6.59, high: 6.6, low: 6.55, last: 6.56, volume: 574376600, value: 3780199786, asOf: '2026-10-22T14:50:00+08:00', ...o });

test('provisional record from page: close = last price, status provisional', () => {
  const r = provisionalFromQuote({ ticker: 'GCASH', quote: quote(), existing: null, now: NOW });
  assert.strictEqual(r.id, 'GCASH_2026-10-22');
  assert.deepStrictEqual([r.open, r.high, r.low, r.close], [6.59, 6.6, 6.55, 6.56]);
  assert.strictEqual(r.status, 'provisional');
  assert.strictEqual(r.volumeSource, 'pse-stock-page');
});
test('high only rises, low only falls, open is kept (glitchy page values cannot shrink the range)', () => {
  const a = provisionalFromQuote({ ticker: 'GCASH', quote: quote(), existing: null, now: NOW });
  const b = provisionalFromQuote({ ticker: 'GCASH', quote: quote({ open: 9, high: 6.5, low: 6.57, last: 6.58 }), existing: a, now: NOW });
  assert.strictEqual(b.open, 6.59); assert.strictEqual(b.high, 6.6); assert.strictEqual(b.low, 6.55); assert.strictEqual(b.close, 6.58);
});
test('missing values are never invented', () => {
  const r = provisionalFromQuote({ ticker: 'X', quote: quote({ open: null, high: null, low: null }), existing: null, now: NOW });
  assert.strictEqual(r.open, null); assert.strictEqual(r.incomplete, true);
});
test('upsert is idempotent: same input twice -> same record', () => {
  const a = provisionalFromQuote({ ticker: 'GCASH', quote: quote(), existing: null, now: NOW });
  const b = provisionalFromQuote({ ticker: 'GCASH', quote: quote(), existing: a, now: NOW });
  assert.deepStrictEqual({ ...a, lastVerifiedAt: 0 }, { ...b, lastVerifiedAt: 0 });
});
test('official history finalizes the record and flags a close discrepancy', () => {
  const prov = provisionalFromQuote({ ticker: 'GCASH', quote: quote({ last: 6.56 }), existing: null, now: NOW });
  const { record, changed, discrepancy } = applyOfficial({ ticker: 'GCASH', row: { tradingDate: '2026-10-22', open: 6.59, high: 6.6, low: 6.55, close: 6.57, value: 3.7e9 }, existing: prov, now: NOW });
  assert.strictEqual(record.status, 'finalized'); assert.strictEqual(record.close, 6.57); assert.strictEqual(record.ohlcSource, 'pse-history-endpoint');
  assert.strictEqual(record.volume, 574376600); // volume kept from page
  assert.ok(changed); assert.ok(discrepancy);
});
test('official row for a still-open session is ignored', () => {
  const r = applyOfficial({ ticker: 'GCASH', row: { tradingDate: '2026-10-22', open: 1, high: 1, low: 1, close: 1, value: 1 }, existing: null, now: NOW, canFinalize: false });
  assert.strictEqual(r.changed, false);
});
test('finalized records are not overwritten by later page snapshots', () => {
  const fin = applyOfficial({ ticker: 'GCASH', row: { tradingDate: '2026-10-22', open: 6.59, high: 6.6, low: 6.55, close: 6.57, value: 1 }, existing: null, now: NOW }).record;
  const after = provisionalFromQuote({ ticker: 'GCASH', quote: quote({ last: 9.99, high: 9.99 }), existing: fin, now: NOW });
  assert.strictEqual(after.close, 6.57); assert.strictEqual(after.high, 6.6); assert.strictEqual(after.status, 'finalized');
});

test('parseHistory reads the real response shape you captured', () => {
  const json = { chartData: [
    { OPEN: 6.6, VALUE: 4.326600639E9, CLOSE: 6.6, CHART_DATE: 'Oct 20, 2026 00:00:00', HIGH: 6.76, LOW: 6.6 },
    { OPEN: 6.61, VALUE: 1.294110916E9, CLOSE: 6.59, CHART_DATE: 'Oct 21, 2026 00:00:00', HIGH: 6.62, LOW: 6.59 }
  ], tableData: [] };
  const { rows, warnings } = parseHistory(json);
  assert.strictEqual(rows.length, 2); assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(rows[1], { tradingDate: '2026-10-21', open: 6.61, high: 6.62, low: 6.59, close: 6.59, value: 1294110916 });
});
test('parseHistory skips impossible bars instead of repairing them', () => {
  const { rows, warnings } = parseHistory({ chartData: [{ OPEN: 5, HIGH: 4, LOW: 3, CLOSE: 5, VALUE: 1, CHART_DATE: 'Oct 20, 2026 00:00:00' }, { OPEN: null, HIGH: 1, LOW: 1, CLOSE: 1, CHART_DATE: 'Oct 21, 2026 00:00:00' }] });
  assert.strictEqual(rows.length, 0); assert.strictEqual(warnings.length, 2);
});
test('parseHistory handles a bad response', () => {
  assert.strictEqual(parseHistory({}).rows.length, 0);
});

const { fetchHistory } = require('../src/pse/history');
test('fetchHistory sends JSON first; falls back to form if PSE answers 415', async () => {
  const calls = [];
  const ok = { ok: true, status: 200, json: async () => ({ chartData: [{ OPEN: 6.6, HIGH: 6.7, LOW: 6.5, CLOSE: 6.6, VALUE: 1, CHART_DATE: 'Oct 20, 2026 00:00:00' }] }) };
  const fakeFetch = async (url, opts) => { calls.push(opts); return opts.headers['Content-Type'].startsWith('application/json') ? { ok: false, status: 415 } : ok; };
  const r = await fetchHistory({ cmpyId: 709, securityId: 754, startDate: '2025-10-22', endDate: '2026-10-22' }, { fetchImpl: fakeFetch });
  assert.strictEqual(calls.length, 2); assert.strictEqual(r.sentAs, 'form'); assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual(JSON.parse(calls[0].body), { cmpy_id: '709', endDate: '10-22-2026', security_id: '754', startDate: '10-22-2025' });
});
test('fetchHistory: JSON accepted -> single request', async () => {
  let n = 0;
  const fakeFetch = async () => { n++; return { ok: true, status: 200, json: async () => ({ chartData: [] }) }; };
  const r = await fetchHistory({ cmpyId: 709, securityId: 754, startDate: '2026-10-01', endDate: '2026-10-22' }, { fetchImpl: fakeFetch });
  assert.strictEqual(n, 1); assert.strictEqual(r.sentAs, 'json');
});
test('fetchHistory: both formats rejected -> clear error', async () => {
  await assert.rejects(fetchHistory({ cmpyId: 1, securityId: 2, startDate: '2026-10-01', endDate: '2026-10-22' }, { fetchImpl: async () => ({ ok: false, status: 415 }) }), /rejected both/);
});
