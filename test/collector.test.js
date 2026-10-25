'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMemoryRepo } = require('../src/db/memoryRepo');
const { createCollector } = require('../src/services/collector');

const STOCK = { ticker: 'GCASH', name: 'Mynt', cmpyId: 709 };
const silent = { error() {}, log() {} };
const mkQuote = (o = {}) => ({ ok: true, last: 6.56, change: -0.03, changePct: -0.46, open: 6.59, high: 6.6, low: 6.55, prevClose: 6.59,
  volume: 1000, value: 6560, tradingDate: '2026-10-22', asOf: '2026-10-22T10:00:00+08:00', status: 'Open', warnings: [], ...o });

function harness(script, repo = createMemoryRepo()) {
  let i = 0, clock = new Date('2026-10-22T02:00:00Z').getTime();
  const col = createCollector({
    repo, log: silent, now: () => new Date(clock),
    fetchStockPage: async () => { const s = script[Math.min(i, script.length - 1)]; i++; if (s instanceof Error) throw s; return { html: s }; },
    parseStockHtml: (html) => html
  });
  return { repo, col, run: async () => { const r = await col.collectOnce([STOCK]); clock += 60000; return r[0]; } };
}
const obsCount = (repo) => repo._state.obs.size;

test('stores an observation only when the price changes', async () => {
  const h = harness([
    mkQuote(),                                                                        // baseline
    mkQuote({ asOf: '2026-10-22T10:01:00+08:00' }),                                   // heartbeat
    mkQuote({ asOf: '2026-10-22T10:02:00+08:00', last: 6.57, volume: 1100 }),         // change
    mkQuote({ asOf: '2026-10-22T10:02:00+08:00', last: 6.57, volume: 1100 }),         // stale
    mkQuote({ asOf: '2026-10-22T10:03:00+08:00', last: 6.57, volume: 1200 })          // heartbeat
  ]);
  const outcomes = [];
  for (let n = 0; n < 5; n++) outcomes.push((await h.run()).outcome);
  assert.deepStrictEqual(outcomes, ['baseline', 'heartbeat', 'price_change', 'stale', 'heartbeat']);
  assert.strictEqual(obsCount(h.repo), 2); // baseline + the one change
});

test('failed fetches never create observations or change state', async () => {
  const h = harness([mkQuote(), new Error('timeout'), new Error('HTTP 503'), mkQuote({ asOf: '2026-10-22T10:03:00+08:00' })]);
  const o = [];
  for (let n = 0; n < 4; n++) o.push((await h.run()).outcome);
  assert.deepStrictEqual(o, ['baseline', 'fetch_error', 'fetch_error', 'heartbeat']);
  assert.strictEqual(obsCount(h.repo), 1);
});

test('restart (new collector, same database) does not duplicate observations', async () => {
  const repo = createMemoryRepo();
  const a = harness([mkQuote()], repo);
  assert.strictEqual((await a.run()).outcome, 'baseline');
  const b = harness([mkQuote()], repo); // "restart": empty memory, same DB
  assert.strictEqual((await b.run()).outcome, 'stale');
  assert.strictEqual(obsCount(repo), 1);
});

test('restart before "latest" was saved: same observation ID is not stored twice', async () => {
  const repo = createMemoryRepo();
  const failing = { ...repo, setLatest: async () => { throw new Error('write failed'); } };
  const a = harness([mkQuote()], failing);
  assert.strictEqual((await a.run()).outcome, 'db_error');
  assert.strictEqual(obsCount(repo), 1);              // observation was saved
  assert.strictEqual(await repo.getLatest('GCASH'), null); // but state was not advanced
  const b = harness([mkQuote()], repo);               // retry with healthy DB
  const r = await b.run();
  assert.strictEqual(r.outcome, 'baseline'); assert.strictEqual(r.observationCreated, false);
  assert.strictEqual(obsCount(repo), 1);              // still exactly one
  assert.ok(await repo.getLatest('GCASH'));
});

test('daily OHLC is upserted into ONE record per ticker/date', async () => {
  const h = harness([mkQuote(), mkQuote({ asOf: '2026-10-22T10:02:00+08:00', last: 6.57, high: 6.61, volume: 1100 })]);
  await h.run(); await h.run();
  const days = await h.repo.listDaily('GCASH', '2026-10-01', '2026-10-31');
  assert.strictEqual(days.length, 1);
  assert.strictEqual(days[0].high, 6.61); assert.strictEqual(days[0].close, 6.57); assert.strictEqual(days[0].status, 'provisional');
});

test('unparseable page is reported and stores nothing', async () => {
  const h = harness([{ ok: false, warnings: ['x'] }]);
  assert.strictEqual((await h.run()).outcome, 'parse_error');
  assert.strictEqual(obsCount(h.repo), 0);
});

test('new trading day creates a new baseline and a new daily record', async () => {
  const h = harness([mkQuote(), mkQuote({ tradingDate: '2026-10-23', asOf: '2026-10-23T10:00:00+08:00', last: 6.6, high: 6.6, low: 6.58 })]);
  await h.run(); const r = await h.run();
  assert.strictEqual(r.outcome, 'baseline');
  assert.strictEqual((await h.repo.listDaily('GCASH', '2026-10-01', '2026-10-31')).length, 2);
});
