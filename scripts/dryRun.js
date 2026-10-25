'use strict';
/**
 * DRY RUN: fetch + parse PSE Edge pages and PRINT the result.
 * Saves nothing to a database and sends no email.
 *
 *   npm run dry-run                              -> every watchlist stock that has a cmpyId
 *   npm run dry-run -- --ticker=SM               -> one stock from the watchlist
 *   npm run dry-run -- --cmpy=599 --ticker=SM    -> any company id
 *   npm run dry-run -- --file=debug/SM.html --ticker=SM   -> parse a saved HTML file (no internet)
 *   add --save-html to keep the raw page in ./debug/ for troubleshooting
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delayMs = Number(process.env.PSE_DELAY_BETWEEN_STOCKS_MS || 1500);

function show(ticker, q, extra = '') {
  console.log(`\n=== ${ticker} ${extra}`);
  console.log(JSON.stringify(q, null, 2));
  if (!q.ok) console.log('!! Parse is NOT ok - read the warnings above.');
}

async function main() {
  if (args.file) {
    const html = fs.readFileSync(args.file, 'utf8');
    show(args.ticker || '(file)', parseStockHtml(html, { expectedTicker: args.ticker }), `(from ${args.file})`);
    return;
  }

  const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'watchlist.json'), 'utf8'));
  let targets = watchlist;
  if (args.cmpy) targets = [{ ticker: args.ticker || `ID${args.cmpy}`, cmpyId: Number(args.cmpy) }];
  else if (args.ticker) targets = watchlist.filter((w) => w.ticker === args.ticker);

  if (targets.length === 0) return console.log('No matching stock in config/watchlist.json');

  for (const [i, s] of targets.entries()) {
    if (!s.cmpyId) {
      console.log(`\n--- ${s.ticker}: no cmpyId yet in config/watchlist.json (see README, step 4). Skipped.`);
      continue;
    }
    if (i > 0) await sleep(delayMs); // be gentle with PSE Edge
    try {
      const page = await fetchStockPage(s.cmpyId);
      if (args['save-html']) {
        fs.mkdirSync('debug', { recursive: true });
        fs.writeFileSync(path.join('debug', `${s.ticker}.html`), page.html);
      }
      const quote = parseStockHtml(page.html, { expectedTicker: s.ticker });
      show(s.ticker, quote, `(fetched ${page.fetchedAt})`);
    } catch (err) {
      console.log(`\n=== ${s.ticker}: FAILED - ${err.message}`);
    }
  }
}

main();
