# Firestore schema

All document IDs are built so every query is a simple ID-range or single-field query. **No composite indexes are needed.**

| Collection | Document ID | Purpose | Key fields |
|---|---|---|---|
| `latest` | `GCASH` | Most recent valid state per stock (one doc each) | last, change, changePct, open, high, low, prevClose, volume, value, tradingDate, asOf, asOfEpoch |
| `observations` | `GCASH_2026-10-22_1792650600` | One doc per **price change** (ID = ticker, trading date, source timestamp). `create()` fails if it exists, which prevents duplicates after restarts. | price, previousPrice, observedAt, timeVerified, sourceAsOf, collectedAt, volume |
| `dailyOhlc` | `GCASH_2026-10-22` | One doc per stock per trading date, upserted | open, high, low, close, volume, value, status (`provisional`/`finalized`), ohlcSource, volumeSource, lastVerifiedAt, notes |
| `pseiSnapshots` | `2026-10-22_<asOfEpoch>` | PSEi, sector indices, market totals/breadth | psei, indices, totals, marketStatus, asOf |
| `jobStatus` | `collector` | Latest polling health (written only on errors or every ~10 min) | lastRunAt, consecutiveFailures, results |
| `jobRuns` | `ohlc_2026-10-22`, `prune_2026-10-22` | Durable "did this job run today" records | ok, ranAt, summary |
| `emailReports` | `2026-10-22` | Report delivery record and lock | status (`sending`/`sent`/`failed`), attempts, leaseUntilMs, messageId, sentAt, lastError |

Watchlist: `config/watchlist.json` (`ticker`, `name`, `cmpyId`, `securityId`). It is configuration, not scraping logic.

## Queries
- One stock, one date: ID range `GCASH_2026-10-22_` ... `\uf8ff` on `observations`.
- Date range of daily OHLC: ID range `GCASH_2026-09-21` ... `GCASH_2026-10-22` on `dailyOhlc`.
- Latest PSEi: `orderBy asOfEpoch desc limit 1`.

## Estimated usage (1 to 5 stocks)
These are estimates, not measurements. Verify after a few days in the Firebase console (Usage tab).
- Writes/day, per stock: ~50-400 (price changes + throttled daily/latest updates). Plus ~100 shared.
- Reads/day: ~1 per stock per tick only after a restart (state is cached in memory); the 6 PM report reads ~(35 + observations) per stock.
- Storage: roughly 100-150k small documents per year per active stock.
- Firestore's free quota (please confirm current numbers at https://firebase.google.com/pricing) was 20,000 writes and 50,000 reads per day, and 1 GiB storage.
- Retention: observations older than `RETENTION_DAYS` (400) are deleted nightly. `dailyOhlc` is kept forever (about 250 small documents per stock per year).
