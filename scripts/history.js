'use strict';
/** Prints official daily OHLC from PSE's history endpoint. Saves nothing.   npm run history -- --ticker=GCASH --days=60 */
require('dotenv').config();
const config = require('../src/config');
const { fetchHistory } = require('../src/pse/history');
const { manilaParts, addDays } = require('../src/time');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
(async () => {
  const stock = config.getWatchlist().find((s) => s.ticker === args.ticker) || config.getWatchlist()[0];
  if (!stock || !stock.securityId) return console.log('Stock needs "cmpyId" and "securityId" in config/watchlist.json');
  const today = manilaParts(new Date()).date;
  const { rows, warnings, sentAs } = await fetchHistory({ cmpyId: stock.cmpyId, securityId: stock.securityId, startDate: addDays(today, -Number(args.days || 60)), endDate: today });
  console.table(rows);
  console.log(`Request format that worked: ${sentAs}`);
  if (warnings.length) console.log('Warnings:', warnings);
})().catch((e) => console.log('FAILED:', e.message));
