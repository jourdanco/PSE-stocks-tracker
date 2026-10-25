'use strict';
try { require('dotenv').config(); } catch { /* dotenv not installed: fine on Render, env vars come from the dashboard */ }
const fs = require('fs');
const { loadFirebase } = require('./db/firebaseKey');
const path = require('path');

const env = process.env;
const root = path.join(__dirname, '..');
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

function loadJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return fallback; }
}

const config = {
  root,
  tz: 'Asia/Manila',
  port: num(env.PORT, 3000),
  useMemoryDb: bool(env.USE_MEMORY_DB, false),

  pse: {
    baseUrl: env.PSE_BASE_URL || 'https://edge.pse.com.ph',
    userAgent: env.PSE_USER_AGENT || 'PersonalStockTracker/0.1 (personal use)',
    timeoutMs: num(env.PSE_REQUEST_TIMEOUT_MS, 15000),
    delayBetweenStocksMs: num(env.PSE_DELAY_BETWEEN_STOCKS_MS, 1500)
  },

  collectionIntervalSec: Math.max(30, num(env.COLLECTION_INTERVAL_SECONDS, 60)),
  tradingWindow: { start: env.TRADING_WINDOW_START || '09:25', end: env.TRADING_WINDOW_END || '15:45' },
  ohlcTime: env.OHLC_TIME || '16:00',
  historyRefreshDays: num(env.HISTORY_REFRESH_DAYS, 45),
  retentionDays: num(env.RETENTION_DAYS, 400),
  pseiEveryMinutes: num(env.PSEI_EVERY_MINUTES, 10),

  report: {
    time: env.REPORT_TIME || '18:00',
    catchupMinutes: num(env.REPORT_CATCHUP_WINDOW_MINUTES, 180),
    maxAttempts: num(env.REPORT_MAX_ATTEMPTS, 5),
    chartPeriodDays: num(env.CHART_PERIOD_DAYS, 31)
  },

  email: {
    testMode: bool(env.EMAIL_TEST_MODE, true), // SAFE DEFAULT: never sends unless explicitly set to false
    apiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'Stock Tracker <onboarding@resend.dev>',
    to: env.EMAIL_TO || ''
  },

  cronSecret: env.CRON_SECRET || '',

  firebase: loadFirebase(env),

  getWatchlist: () => loadJson('config/watchlist.json', []),
  getHolidays: () => new Set(loadJson('config/holidays.json', []))
};

module.exports = config;
