'use strict';
/** Loads up to a year of official daily OHLC into Firestore (needed for 3-month/6-month/1-year charts).   npm run backfill -- --days=370 */
require('dotenv').config();
const config = require('../src/config');
const { buildApp } = require('../src/app');
const { refreshHistory } = require('../src/services/ohlcJob');
const { fetchHistory } = require('../src/pse/history');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
(async () => {
  const { repo } = buildApp();
  const r = await refreshHistory({ repo, watchlist: config.getWatchlist(), fetchHistory, days: Number(args.days || 370), tradingEnd: config.tradingWindow.end });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
