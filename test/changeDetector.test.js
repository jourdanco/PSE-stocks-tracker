'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../src/logic/changeDetector');

const q = (o = {}) => ({ ok: true, last: 6.56, asOf: '2026-10-22T10:00:00+08:00', tradingDate: '2026-10-22', volume: 1000, value: 6560, ...o });
const prevOf = (o = {}) => ({ tradingDate: '2026-10-22', asOfEpoch: Math.floor(new Date('2026-10-22T10:00:00+08:00') / 1000), last: 6.56, volume: 1000, ...o });
const run = (prev, quote) => decide({ prev, quote, collectedAt: '2026-10-22T02:05:00Z', ticker: 'GCASH' });

test('first ever quote -> baseline observation', () => {
  const d = run(null, q());
  assert.strictEqual(d.action, 'baseline');
  assert.strictEqual(d.observation.id, 'GCASH_2026-10-22_' + Math.floor(new Date('2026-10-22T10:00:00+08:00') / 1000));
});
test('new trading day -> baseline even if price equals yesterday', () => {
  const d = run(prevOf({ tradingDate: '2026-10-21' }), q());
  assert.strictEqual(d.action, 'baseline');
});
test('same asOf, same price -> stale (no observation)', () => {
  assert.strictEqual(run(prevOf(), q()).action, 'stale');
});
test('newer asOf, same price -> heartbeat, NOT an observation', () => {
  const d = run(prevOf(), q({ asOf: '2026-10-22T10:01:00+08:00' }));
  assert.strictEqual(d.action, 'heartbeat');
  assert.strictEqual(d.observation, undefined);
});
test('newer asOf, new price -> price_change with verified time', () => {
  const d = run(prevOf(), q({ asOf: '2026-10-22T10:02:00+08:00', last: 6.57, volume: 1200 }));
  assert.strictEqual(d.action, 'price_change');
  assert.strictEqual(d.observation.timeVerified, true);
  assert.strictEqual(d.observation.previousPrice, 6.56);
  assert.strictEqual(d.observation.changeFromPrevious, 0.01);
});
test('same asOf but price+volume moved -> recorded, flagged unverified time', () => {
  const d = run(prevOf(), q({ last: 6.58, volume: 1500 }));
  assert.strictEqual(d.action, 'price_change');
  assert.strictEqual(d.observation.timeVerified, false);
  assert.match(d.observation.id, /_u\d+$/);
  assert.strictEqual(d.observation.observedAt, '2026-10-22T02:05:00Z'); // uses collection time, not source time
});
test('same asOf, price differs but volume did not rise -> stale (cached/odd data ignored)', () => {
  assert.strictEqual(run(prevOf(), q({ last: 6.6 })).action, 'stale');
});
test('older asOf -> out_of_order (cached page)', () => {
  assert.strictEqual(run(prevOf(), q({ asOf: '2026-10-22T09:59:00+08:00', last: 6.9 })).action, 'out_of_order');
});
test('older trading date than stored -> out_of_order', () => {
  assert.strictEqual(run(prevOf({ tradingDate: '2026-10-23' }), q()).action, 'out_of_order');
});
test('invalid quote -> invalid (a failure is never a price change)', () => {
  assert.strictEqual(run(prevOf(), { ok: false }).action, 'invalid');
  assert.strictEqual(run(prevOf(), q({ last: 0 })).action, 'invalid');
});
