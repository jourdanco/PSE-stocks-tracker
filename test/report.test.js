'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createMemoryRepo } = require('../src/db/memoryRepo');
const { runReport } = require('../src/services/report');
const { sendEmail, withRetry } = require('../src/email/sender');
const { buildEmail } = require('../src/email/template');
const { buildLineOption, buildCandleOption } = require('../src/charts/options');
const { evaluateClaim } = require('../src/db/claim');

const silent = { error() {}, log() {} };
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const mkConfig = (over = {}) => ({
  root: fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')),
  email: { testMode: false, apiKey: 'k', from: 'a@b.c', to: 'me@x.y', ...(over.email || {}) },
  report: { chartPeriodDays: 31, maxAttempts: 5 },
  getWatchlist: () => [{ ticker: 'GCASH', name: 'Mynt', cmpyId: 709 }, { ticker: 'SM', name: 'SM Inv', cmpyId: 599 }]
});
async function seed(repo) {
  await repo.setLatest('GCASH', { ticker: 'GCASH', name: 'Mynt', tradingDate: '2026-10-22', asOf: '2026-10-22T14:50:00+08:00', last: 6.56, change: -0.03, changePct: -0.46, open: 6.59, high: 6.6, low: 6.55, prevClose: 6.59, volume: 574376600, value: 3780199786 });
  await repo.createObservation({ id: 'GCASH_2026-10-22_1', ticker: 'GCASH', tradingDate: '2026-10-22', price: 6.59, observedAt: '2026-10-22T09:30:00+08:00', timeVerified: true });
  await repo.createObservation({ id: 'GCASH_2026-10-22_2', ticker: 'GCASH', tradingDate: '2026-10-22', price: 6.56, observedAt: '2026-10-22T14:50:00+08:00', timeVerified: true });
  await repo.upsertDaily({ id: 'GCASH_2026-10-21', ticker: 'GCASH', tradingDate: '2026-10-21', open: 6.61, high: 6.62, low: 6.59, close: 6.59, value: 1.29e9, status: 'finalized' });
  await repo.upsertDaily({ id: 'GCASH_2026-10-22', ticker: 'GCASH', tradingDate: '2026-10-22', open: 6.59, high: 6.6, low: 6.55, close: 6.56, value: 3.78e9, status: 'provisional' });
}
const psei = { psei: { value: 5779.73, change: -41.78, changePct: -0.72 }, marketStatus: 'CLOSED', tradingDate: '2026-10-22', asOf: '2026-10-22T16:37:00+08:00', totals: { volume: 1, value: 2, trades: 3, advances: 64, declines: 108, unchanged: 62 }, indices: {} };
const mkDeps = (over = {}) => ({ collectPsei: async () => ({ snapshot: psei }), refreshHistory: async () => ({ ok: true }), renderPng: () => PNG, sendEmail: async () => ({ id: 'msg_1' }), ...over });
const NOW = () => new Date('2026-10-22T10:00:00Z');

test('claim rules', () => {
  assert.strictEqual(evaluateClaim({ status: 'sent' }, 1).reason, 'already_sent');
  assert.strictEqual(evaluateClaim({ status: 'sending', leaseUntilMs: 10 }, 5).reason, 'in_progress');
  assert.strictEqual(evaluateClaim({ status: 'sending', leaseUntilMs: 10 }, 20).ok, true); // crashed worker: lease expired
  assert.strictEqual(evaluateClaim({ status: 'failed', attempts: 5 }, 1, { maxAttempts: 5 }).reason, 'max_attempts');
});

test('report is sent once per date even if triggered twice (timer + cron)', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  let sends = 0;
  const deps = mkDeps({ sendEmail: async () => { sends++; return { id: 'm' }; } });
  const [a, b] = await Promise.all([runReport({ repo, config: mkConfig(), deps, date: '2026-10-22', now: NOW, log: silent }), runReport({ repo, config: mkConfig(), deps, date: '2026-10-22', now: NOW, log: silent })]);
  assert.deepStrictEqual([a.status, b.status].sort(), ['sent', 'skipped']);
  assert.strictEqual(sends, 1);
  const c = await runReport({ repo, config: mkConfig(), deps, date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(c.reason, 'already_sent'); assert.strictEqual(sends, 1);
  assert.strictEqual((await repo.getReport('2026-10-22')).status, 'sent');
});

test('a failed chart does not stop the email; it is named in the report', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  let captured;
  const deps = mkDeps({ renderPng: (opt, o) => { if (o.height === 420) throw new Error('boom'); return PNG; }, sendEmail: async (m) => { captured = m; return { id: 'm' }; } });
  const r = await runReport({ repo, config: mkConfig(), deps, date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(r.status, 'sent');
  assert.match(captured.html, /Monthly candlestick chart unavailable/);
  assert.match(captured.html, /cid:line-GCASH/);       // line chart still embedded
  assert.ok(captured.attachments.some((a) => a.cid === 'line-GCASH'));
  assert.match(captured.html, /6\.56/);                // numbers present without images
});

test('email failure marks the report failed and allows a later retry', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  const bad = mkDeps({ sendEmail: async () => { throw Object.assign(new Error('Resend HTTP 401'), { retryable: false }); } });
  const r1 = await runReport({ repo, config: mkConfig(), deps: bad, date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(r1.status, 'failed');
  assert.strictEqual((await repo.getReport('2026-10-22')).status, 'failed');
  const r2 = await runReport({ repo, config: mkConfig(), deps: mkDeps(), date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(r2.status, 'sent'); // retried successfully
});

test('TEST MODE sends nothing, records nothing, writes a preview file', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  let sends = 0;
  const cfg = mkConfig({ email: { testMode: true } });
  const r = await runReport({ repo, config: cfg, deps: mkDeps({ sendEmail: async () => { sends++; return { id: 'x' }; } }), date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(r.status, 'preview'); assert.strictEqual(sends, 0);
  assert.strictEqual(await repo.getReport('2026-10-22'), null);
  const html = fs.readFileSync(r.file, 'utf8');
  assert.match(html, /preview-assets\/line-GCASH\.png/); assert.doesNotMatch(html, /cid:/);
});

test('stock with no data yet is shown, not crashed on; missing PSEi falls back with a note', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  const r = await runReport({ repo, config: mkConfig({ email: { testMode: true } }), deps: mkDeps({ collectPsei: async () => { throw new Error('down'); } }), date: '2026-10-22', now: NOW, log: silent });
  assert.strictEqual(r.status, 'preview');
  const html = fs.readFileSync(r.file, 'utf8');
  assert.match(html, /No valid data collected yet/); assert.match(html, /PSEi data unavailable/);
});

test('withRetry: retries transient errors only', async () => {
  let n = 0;
  const ok = await withRetry(async () => { n++; if (n < 3) throw Object.assign(new Error('503'), { retryable: true }); return 'ok'; }, { sleep: async () => {}, log: silent });
  assert.strictEqual(ok, 'ok'); assert.strictEqual(n, 3);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw Object.assign(new Error('401'), { retryable: false }); }, { sleep: async () => {}, log: silent }));
  assert.strictEqual(m, 1);
});

test('sendEmail builds the Resend request with content_id inline attachments', async () => {
  let req;
  const fake = async (url, opts) => { req = { url, opts }; return { ok: true, json: async () => ({ id: 'abc' }) }; };
  const r = await sendEmail({ apiKey: 'k', from: 'f', to: 't', subject: 's', html: '<img src="cid:a">', text: 't', attachments: [{ filename: 'a.png', content: PNG, cid: 'a' }] }, fake);
  assert.strictEqual(r.id, 'abc'); assert.strictEqual(req.url, 'https://api.resend.com/emails');
  const body = JSON.parse(req.opts.body);
  assert.strictEqual(body.attachments[0].content_id, 'a'); assert.strictEqual(body.attachments[0].content, PNG.toString('base64'));
  assert.deepStrictEqual(body.to, ['t']);
  assert.strictEqual(req.opts.headers.Authorization, 'Bearer k');
});
test('sendEmail marks 429/5xx retryable and 4xx not', async () => {
  const mk = (status) => async () => ({ ok: false, status, json: async () => ({ message: 'x' }) });
  await assert.rejects(sendEmail({ apiKey: 'k', to: 't' }, mk(503)), (e) => e.retryable === true);
  await assert.rejects(sendEmail({ apiKey: 'k', to: 't' }, mk(422)), (e) => e.retryable === false);
});

test('chart options: candlestick data order, colors, provisional marking, no fabricated rows', () => {
  const rows = [
    { tradingDate: '2026-10-20', open: 6.6, high: 6.76, low: 6.6, close: 6.7, value: 4e9, status: 'finalized' },   // up
    { tradingDate: '2026-10-21', open: 6.61, high: 6.62, low: 6.59, close: 6.59, value: 1e9, status: 'finalized' }, // down
    { tradingDate: '2026-10-22', open: 6.59, high: 6.6, low: 6.55, close: 6.59, value: 3e9, status: 'provisional' }, // doji, provisional
    { tradingDate: '2026-10-23', open: null, high: null, low: null, close: null, status: 'provisional' }            // missing: not drawn
  ];
  const o = buildCandleOption({ ticker: 'GCASH', name: 'Mynt', rows, periodLabel: 'x' });
  const c = o.series[0].data;
  assert.deepStrictEqual(c[0].value, [6.6, 6.7, 6.6, 6.76]);  // ECharts order: open, close, low, high
  assert.strictEqual(c[0].itemStyle.color, '#16a34a'); assert.strictEqual(c[1].itemStyle.color, '#dc2626'); assert.strictEqual(c[2].itemStyle.color, '#6b7280');
  assert.strictEqual(c.length, 3); assert.strictEqual(o.xAxis[0].data[2], '10-22*'); assert.match(o.title.subtext, /provisional/);
  assert.match(o.title.subtext, /1 session\(s\) missing/);
});
test('chart options: line chart steps, labels last point, flags gaps but not lunch break', () => {
  const times = ['09:30', '10:10', '10:50', '11:30', '11:55', '13:35', '14:50']; // 11:55 -> 13:35 spans lunch: NOT a gap; 13:35 -> 14:50 is 75 min: a gap
  const obs = times.map((t, i) => ({ price: 6.6 - i * 0.01, observedAt: `2026-10-22T${t}:00+08:00`, timeVerified: true }));
  const o = buildLineOption({ ticker: 'GCASH', name: 'Mynt', tradingDate: '2026-10-22', observations: obs });
  assert.strictEqual(o.series[0].step, 'end');
  assert.strictEqual(o._meta.gaps, 1);
  assert.strictEqual(o.series[0].data[6].label.formatter, 'Last 6.54 (2:50 PM)');
  assert.strictEqual(buildLineOption({ ticker: 'X', name: 'Y', tradingDate: 'd', observations: [] }).graphic[0].style.text.includes('No price observations'), true);
});
test('email: figures are readable without images; positive/negative indicators', () => {
  const e = buildEmail({ date: '2026-10-22', psei, stocks: [{ ticker: 'GCASH', name: 'Mynt', latest: { last: 6.56, change: -0.03, changePct: -0.46, asOf: '2026-10-22T14:50:00+08:00', tradingDate: '2026-10-22', volume: 574376600, value: 3780199786 } }] });
  assert.match(e.subject, /PSEi 5,779\.73/); assert.match(e.html, /▼/); assert.match(e.text, /GCASH 6\.56/);
  assert.match(e.html, /₱3\.78B/);
});

test('email no longer contains Previous close, Daily record or Market-wide', () => {
  const e = buildEmail({ date: '2026-10-22', psei, stocks: [{ ticker: 'GCASH', name: 'Mynt', latest: { last: 6.56, change: -0.03, changePct: -0.46, prevClose: 6.59, asOf: '2026-10-22T14:50:00+08:00', tradingDate: '2026-10-22', volume: 1, value: 1 }, dailyLatest: { status: 'provisional' } }] });
  assert.doesNotMatch(e.html, /Previous close|Daily record|Market-wide/);
  assert.match(e.html, /Source timestamp/); assert.match(e.html, /Volume/);
});

test('force=1 resends a report that was already sent; normal calls still skip', async () => {
  const repo = createMemoryRepo(); await seed(repo);
  let sends = 0;
  const deps = mkDeps({ sendEmail: async () => { sends++; return { id: 'm' + sends }; } });
  const run = (force) => runReport({ repo, config: mkConfig(), deps, date: '2026-10-22', now: NOW, log: silent, force });
  assert.strictEqual((await run(false)).status, 'sent');
  assert.strictEqual((await run(false)).reason, 'already_sent');
  const f = await run(true);
  assert.strictEqual(f.status, 'sent'); assert.strictEqual(f.forced, true);
  assert.strictEqual(sends, 2);
  assert.strictEqual((await repo.getReport('2026-10-22')).sendCount, 2);
  assert.strictEqual((await run(false)).reason, 'already_sent'); // back to normal protection
});
test('force never overrides a send that is in progress right now', () => {
  assert.strictEqual(evaluateClaim({ status: 'sending', leaseUntilMs: 99 }, 5, { force: true }).reason, 'in_progress');
  assert.strictEqual(evaluateClaim({ status: 'sent' }, 5, { force: true }).ok, true);
  assert.strictEqual(evaluateClaim({ status: 'failed', attempts: 9 }, 5, { force: true, maxAttempts: 5 }).ok, true);
});
