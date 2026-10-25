'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/time');

test('Manila date/time is computed from UTC correctly (UTC+8)', () => {
  const p = T.manilaParts(new Date('2026-10-22T10:00:00Z')); // 6:00 PM Manila
  assert.strictEqual(p.date, '2026-10-22'); assert.strictEqual(p.time, '18:00');
  const q = T.manilaParts(new Date('2026-10-22T17:30:00Z')); // 1:30 AM next day in Manila
  assert.strictEqual(q.date, '2026-10-23'); assert.strictEqual(q.time, '01:30');
  assert.strictEqual(T.manilaParts(new Date('2026-10-21T16:00:00Z')).time, '00:00'); // midnight is 00:00 not 24:00
});
test('weekends and holidays are not trading days', () => {
  assert.strictEqual(T.isTradingDay('2026-10-22'), true);  // Thursday
  assert.strictEqual(T.isTradingDay('2026-10-24'), false); // Saturday
  assert.strictEqual(T.isTradingDay('2026-10-23', new Set(['2026-10-23'])), false);
});
test('trading window uses Manila time', () => {
  const w = { start: '09:25', end: '15:45' };
  assert.strictEqual(T.inTradingWindow(new Date('2026-10-22T02:00:00Z'), w), true);  // 10:00 AM Manila
  assert.strictEqual(T.inTradingWindow(new Date('2026-10-22T10:00:00Z'), w), false); // 6:00 PM Manila
  assert.strictEqual(T.inTradingWindow(new Date('2026-10-24T02:00:00Z'), w), false); // Saturday
});
test('report is due from 6:00 PM Manila for the catch-up window only', () => {
  const c = { reportTime: '18:00', catchupMinutes: 180 };
  assert.strictEqual(T.reportDue(new Date('2026-10-22T09:59:00Z'), c), false); // 5:59 PM
  assert.strictEqual(T.reportDue(new Date('2026-10-22T10:00:00Z'), c), true);  // 6:00 PM
  assert.strictEqual(T.reportDue(new Date('2026-10-22T12:59:00Z'), c), true);  // 8:59 PM
  assert.strictEqual(T.reportDue(new Date('2026-10-22T13:00:00Z'), c), false); // 9:00 PM
  assert.strictEqual(T.reportDue(new Date('2026-10-24T10:05:00Z'), c), true);  // Saturday still reports
});
test('date helpers', () => {
  assert.strictEqual(T.addDays('2026-10-22', -31), '2026-09-21');
  assert.strictEqual(T.toMDY('2026-10-22'), '10-22-2026');
  assert.strictEqual(T.fmtClock(14 * 60 + 50), '2:50 PM');
  assert.strictEqual(T.fmtManila('2026-10-22T14:50:00+08:00'), 'Oct 22, 2026 2:50 PM');
});
