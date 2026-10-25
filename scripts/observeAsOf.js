'use strict';
/**
 * OBSERVER: polls ONE stock about once a minute and logs whether PSE Edge's
 * "As of" timestamp and last price changed. Saves a CSV in ./debug/ so we can
 * learn how often PSE Edge really updates. Nothing goes to a database or email.
 *
 *   npm run observe -- --ticker=GCASH              (stop with Ctrl+C)
 *   npm run observe -- --ticker=GCASH --until=15:45   (stops itself, Manila time)
 *   npm run observe -- --ticker=GCASH --every=60      (seconds; minimum 30)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { fetchStockPage } = require('../src/pse/fetchPage');
const { parseStockHtml } = require('../src/pse/parseHtml');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'watchlist.json'), 'utf8'));
const stock = watchlist.find((w) => w.ticker === args.ticker) || watchlist.find((w) => w.cmpyId);
if (!stock || !stock.cmpyId) {
  console.log('Pick a stock that has a cmpyId: npm run observe -- --ticker=GCASH');
  process.exit(1);
}
const everySec = Math.max(30, Number(args.every || 60)); // never faster than 30s
const manilaTime = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());

fs.mkdirSync('debug', { recursive: true });
const file = path.join('debug', `observe_${stock.ticker}_${new Date().toISOString().slice(0, 10)}.csv`);
if (!fs.existsSync(file)) fs.writeFileSync(file, 'manila_time,fetched_at_utc,as_of,last,volume,asof_changed,price_changed,error\n');

let prev = null;
async function poll() {
  const now = manilaTime();
  if (args.until && now.slice(0, 5) >= args.until) {
    console.log(`Reached ${args.until} Manila time. Stopping. Results: ${file}`);
    process.exit(0);
  }
  let row;
  try {
    const page = await fetchStockPage(stock.cmpyId);
    const q = parseStockHtml(page.html, { expectedTicker: stock.ticker });
    const asofChanged = prev ? q.asOf !== prev.asOf : '';
    const priceChanged = prev ? q.last !== prev.last : '';
    row = [now, page.fetchedAt, q.asOf, q.last, q.volume, asofChanged, priceChanged, q.ok ? '' : 'parse not ok'];
    console.log(`${now}  as_of=${q.asOf}  last=${q.last}  vol=${q.volume}  asOfChanged=${asofChanged}  priceChanged=${priceChanged}`);
    if (q.ok) prev = q;
  } catch (err) {
    row = [now, new Date().toISOString(), '', '', '', '', '', err.message.replace(/,/g, ';')];
    console.log(`${now}  ERROR: ${err.message}`);
  }
  fs.appendFileSync(file, row.join(',') + '\n');
}

console.log(`Observing ${stock.ticker} every ${everySec}s. Writing ${file}. Press Ctrl+C to stop.`);
poll();
setInterval(poll, everySec * 1000);
