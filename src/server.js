'use strict';
const crypto = require('crypto');
const express = require('express');
const { buildApp } = require('./app');
const { runReport } = require('./services/report');
const { manilaParts } = require('./time');

const ctx = buildApp();
const { config, repo, deps, scheduler } = ctx;
const app = express();
const startedAt = Date.now();

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function auth(req, res, next) {
  if (!config.cronSecret) return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  const key = req.get('x-cron-key') || req.query.key || '';
  if (!safeEqual(key, config.cronSecret)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

// Public, minimal: used by Render's health check. Reveals nothing sensitive.
app.get('/health', (req, res) => res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));

// cron-job.org calls this every ~10 minutes. It wakes the service and runs whatever is due.
app.get('/api/tick', auth, wrap(async (req, res) => res.json(await scheduler.tick({ source: 'http' }))));

// Report trigger (idempotent). ?force=1 resends even if already sent. In test mode it only builds a preview.
app.get('/api/report', auth, wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : manilaParts(new Date()).date;
  const force = ['1', 'true'].includes(String(req.query.force || '').toLowerCase());
  if (force) console.warn(`[report] FORCE send requested for ${date}`);
  res.json(await runReport({ repo, config, deps, date, force }));
}));

app.get('/api/ohlc', auth, wrap(async (req, res) => res.json(await deps.refreshHistory())));

app.get('/api/status', auth, wrap(async (req, res) => {
  const today = manilaParts(new Date()).date;
  res.json({
    now: new Date().toISOString(), manila: manilaParts(new Date()), emailTestMode: config.email.testMode,
    db: repo.kind, collector: await repo.getJobStatus('collector'), ohlcToday: await repo.getJobRun(`ohlc_${today}`),
    reportToday: await repo.getReport(today),
    latest: Object.fromEntries(await Promise.all(config.getWatchlist().map(async (s) => [s.ticker, await repo.getLatest(s.ticker)])))
  });
}));

app.listen(config.port, () => {
  console.log(`PSE tracker listening on :${config.port} | db=${repo.kind} | emailTestMode=${config.email.testMode} | watchlist=${config.getWatchlist().map((s) => s.ticker).join(',')}`);
  if (!config.cronSecret) console.warn('WARNING: CRON_SECRET is empty; /api endpoints will refuse all requests.');
  // In-app timer. It only works while the service is awake; cron-job.org pings cover wake-ups and catch-up.
  setInterval(() => scheduler.tick({ source: 'timer' }).catch((e) => console.error('tick failed:', e.message)), config.collectionIntervalSec * 1000);
  setTimeout(() => scheduler.tick({ source: 'startup' }).catch((e) => console.error('startup tick failed:', e.message)), 3000);
});
