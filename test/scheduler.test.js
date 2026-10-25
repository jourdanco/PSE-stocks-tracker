'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMemoryRepo } = require('../src/db/memoryRepo');
const { createScheduler } = require('../src/services/scheduler');

const silent = { error() {}, log() {} };
const cfg = (testMode = false) => ({
  root: require('os').tmpdir(), collectionIntervalSec: 60, tradingWindow: { start: '09:25', end: '15:45' }, ohlcTime: '16:00',
  retentionDays: 400, pseiEveryMinutes: 10, email: { testMode, apiKey: 'k', from: 'f', to: 't' },
  report: { time: '18:00', catchupMinutes: 180, maxAttempts: 5, chartPeriodDays: 31 },
  getWatchlist: () => [{ ticker: 'GCASH', name: 'Mynt', cmpyId: 709, securityId: 754 }], getHolidays: () => new Set()
});

function make(nowIso, testMode = false) {
  let t = new Date(nowIso).getTime();
  const calls = { collect: 0, psei: 0, ohlc: 0, send: 0 };
  const repo = createMemoryRepo();
  const deps = {
    collectPsei: async () => { calls.psei++; return { outcome: 'saved', snapshot: null }; },
    refreshHistory: async () => { calls.ohlc++; await repo.setJobRun('ohlc_2026-10-22', { ok: true }); return { ok: true }; },
    renderPng: () => Buffer.from('x'), sendEmail: async () => { calls.send++; return { id: 'm' }; }
  };
  const collector = { collectOnce: async () => { calls.collect++; return [{ ticker: 'GCASH', outcome: 'heartbeat' }]; } };
  const s = createScheduler({ repo, config: cfg(testMode), deps, collector, now: () => new Date(t), log: silent });
  return { s, calls, repo, advance: (ms) => { t += ms; } };
}

test('collects during trading hours, not at night or on weekends', async () => {
  const a = make('2026-10-22T02:00:00Z'); await a.s.tick(); assert.strictEqual(a.calls.collect, 1); // 10:00 AM Thu
  const b = make('2026-10-22T10:00:00Z', true); await b.s.tick(); assert.strictEqual(b.calls.collect, 0); // 6 PM
  const c = make('2026-10-24T02:00:00Z'); await c.s.tick(); assert.strictEqual(c.calls.collect, 0); // Saturday
});
test('cron + timer firing together does not double-collect', async () => {
  const a = make('2026-10-22T02:00:00Z'); await a.s.tick(); a.advance(5000); await a.s.tick();
  assert.strictEqual(a.calls.collect, 1);
  a.advance(60000); await a.s.tick(); assert.strictEqual(a.calls.collect, 2);
});
test('report sends once at 6 PM and not again on later ticks', async () => {
  const a = make('2026-10-22T10:00:00Z'); // 6:00 PM Manila
  await a.s.tick(); a.advance(60000); await a.s.tick(); a.advance(600000); await a.s.tick();
  assert.strictEqual(a.calls.send, 1);
});
test('missed 6 PM (service asleep) still sends at the first tick inside the catch-up window', async () => {
  const a = make('2026-10-22T10:07:00Z'); await a.s.tick(); assert.strictEqual(a.calls.send, 1); // 6:07 PM
  const late = make('2026-10-22T13:30:00Z'); await late.s.tick(); assert.strictEqual(late.calls.send, 0); // 9:30 PM: too late
});
test('weekend still gets a report', async () => {
  const a = make('2026-10-24T10:00:00Z'); await a.s.tick(); assert.strictEqual(a.calls.send, 1);
});
test('a second scheduler instance (e.g. after restart) will not resend', async () => {
  const a = make('2026-10-22T10:00:00Z'); await a.s.tick();
  const t = new Date('2026-10-22T10:05:00Z');
  const s2 = createScheduler({ repo: a.repo, config: cfg(false), deps: { collectPsei: async () => ({}), refreshHistory: async () => ({ ok: true }), renderPng: () => Buffer.from('x'), sendEmail: async () => { a.calls.send++; return { id: 'm2' }; } }, collector: { collectOnce: async () => [] }, now: () => t, log: silent });
  await s2.tick(); assert.strictEqual(a.calls.send, 1);
});
test('daily OHLC refresh runs once after 4 PM on a trading day', async () => {
  const a = make('2026-10-22T08:10:00Z'); // 4:10 PM
  await a.s.tick(); a.advance(60000); await a.s.tick();
  assert.strictEqual(a.calls.ohlc, 1);
});
test('test mode: preview is built once, nothing sent', async () => {
  const a = make('2026-10-22T10:00:00Z', true); await a.s.tick(); a.advance(60000); await a.s.tick();
  assert.strictEqual(a.calls.send, 0);
});
