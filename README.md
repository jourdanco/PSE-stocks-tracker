# PSE Stock Tracker

A personal tracker for Philippine stocks (starts with GCASH). It polls PSE Edge during market hours, saves price changes, keeps official daily OHLC, draws charts, and emails a report at 6:00 PM Manila time.

**Status:** all logic is covered by 61 automated tests (`npm test`) using simulated PSE data. The following have **not** been verified end-to-end against live services: live PSE downloads from this code (your dry-run proved the stock page), the history download, the PSEi parser on raw HTML, chart rendering, Firestore, Resend, Render and cron-job.org. Follow `docs/DEPLOY.md` in order. Each step tells you what a good result looks like.

## What it does
- **Collector**: checks each stock about every minute (trading hours). Stores a price observation only when the price changes and PSE's "As of" time is new. Failures are logged and never counted as price changes.
- **Daily OHLC**: official open/high/low/close come from PSE's history endpoint (`finalized`). While a day is in progress it is `provisional`, built from the stock page (close = last traded price).
- **Report (6:00 PM)**: PSEi, market totals, per-stock figures, an intraday line chart and a candlestick chart per stock, as inline PNG images, with all numbers also readable as text.
- **Safe by default**: `EMAIL_TEST_MODE=true` sends nothing and writes a preview file.

## Quick start (local, no accounts)
```
npm install
npm test
npm run dry-run -- --ticker=GCASH
npm run history -- --ticker=GCASH --days=60
npm run preview
```
Then open `debug/report-preview-<date>.html`. Next: `docs/DEPLOY.md`.

## Adding stocks
Edit `config/watchlist.json`. For each stock you need:
- `cmpyId`: the number in the address bar of its Stock Data page on PSE Edge (`...stockData.do?cmpy_id=NNN`).
- `securityId`: open that page in Chrome, F12 -> Network -> Fetch/XHR, click the **1 month** chart button, open the `DisclosureCht.ax` request -> Payload -> `security_id`.
Without `securityId` the stock still gets quotes, but no official daily OHLC.

## Price-change rules
| Situation | Result |
|---|---|
| First quote of a trading day | saved as the session's first observation |
| New "As of" time and different price | saved as a price change |
| New "As of" time, same price | fresh data; nothing saved |
| Same "As of" time | stale; nothing saved |
| Same "As of" but price AND volume moved | saved, marked unverified time (chart uses collection time, orange dot) |
| Older "As of" than stored | ignored (cached page) |
| Fetch/parse/database failure | logged; no price change recorded; state not advanced |

## Files
```
src/pse/         fetch + parse PSE Edge pages, history endpoint
src/logic/       changeDetector.js (price-change rules), ohlc.js (daily record rules)
src/db/          Firestore + in-memory repositories, report lock
src/services/    collector, ohlcJob, report, scheduler
src/charts/      ECharts option builders + PNG renderer
src/email/       HTML template, Resend sender with retries
src/server.js    Express app (/health, /api/tick, /api/report, /api/ohlc, /api/status)
scripts/         dry-run, history, preview, collect-once, backfill, observe
docs/            FIRESTORE_SCHEMA, DEPLOY, TROUBLESHOOTING
```

## Part B: Firebase setup
1. https://console.firebase.google.com -> Add project (Analytics off).
2. Build -> Firestore Database -> Create database. Choose the nearest location (e.g. `asia-southeast1`); it cannot be changed later.
3. Project settings (gear) -> Service accounts -> Generate new private key (downloads a `.json`).
4. Copy `project_id`, `client_email`, `private_key` into `.env` as `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
5. Never commit or share that JSON or `.env`.

## Known limits (honest list)
- Prices between checks are missed; the intraday chart says so and is never interpolated.
- The PSE page's "As of" has been 2:50 PM after the close on days I checked; the official close comes from the history endpoint, so today's candle stays `provisional` until history confirms it.
- Volume is not in PSE's history data; daily volume comes from the stock page and is labelled as such. The candlestick's lower bars show traded **value** (official).
- Holidays: `config/holidays.json` starts empty (I could not verify PSE's 2026 calendar). Stale-data detection protects you meanwhile.
- If the service crashes after Resend accepts an email but before the record is saved, a retry could send a second copy.
- PSE Edge terms: personal, non-commercial use only. Keep the delays; do not redistribute data.
- Font: DejaVu Sans is bundled for chart text (free license in `assets/fonts/`).
"# PSE-stocks-tracker" 
