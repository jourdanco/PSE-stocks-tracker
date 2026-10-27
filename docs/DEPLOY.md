# Deployment (free Render + cron-job.org + Resend)

Do these **in order**. Everything has a test mode, so nothing sends real email until you say so.

## A. Local checks (no accounts needed)
1. `npm install`
2. `npm test`  -> all tests pass
3. `npm run dry-run -- --ticker=GCASH`  -> `"ok": true`
4. `npm run history -- --ticker=GCASH --days=60`  -> a table of official daily OHLC
5. `npm run preview`  -> open `debug/report-preview-<date>.html` in your browser. Check the numbers and both charts.
   - If a chart is missing, the preview tells you why (see TROUBLESHOOTING).

## B. Firebase
1. Follow Part B of README (project, Firestore, service account key). Put the 3 values in `.env`.
2. `npm run collect-once`  -> prints `database: firestore` and an outcome per stock.
3. Firebase console -> Firestore -> check that `latest`, `observations`, `dailyOhlc` appeared.
4. `npm run backfill -- --days=370`  -> loads history so longer chart periods work (GCASH only has a few days).

## C. Resend (email)
1. Create an account at https://resend.com, then **API Keys -> Create**. Copy the key into `RESEND_API_KEY`.
2. Without a verified domain you can usually only send from `onboarding@resend.dev` to **your own account email**. Set `EMAIL_TO` to that address. (Please confirm current rules in Resend's docs; to email other people you must verify a domain.)
3. Keep `EMAIL_TEST_MODE=true`. When ready for one real test: set it to `false` in `.env`, run `npm run preview -- --send`, check your inbox, set it back.
   Note: Resend's dashboard preview does not show inline images; check them in your real inbox.

## D. Render (free web service)
1. Put the project on GitHub (private repo). Confirm `.env` and the Firebase JSON are NOT in it.
2. Render -> **New -> Blueprint** (uses `render.yaml`) or **New -> Web Service** (build `npm install`, start `npm start`, plan Free).
3. Environment tab: fill every `sync: false` variable. `FIREBASE_PRIVATE_KEY` must keep its `\n` characters. Keep `EMAIL_TEST_MODE=true` for now.
4. Deploy, then open `https://<your-app>.onrender.com/health`. You should see `{"ok":true,...}`.
5. Test auth: `https://<your-app>.onrender.com/api/status` without a key must say `unauthorized`.

## E. cron-job.org (report at 3:00 PM, weekdays)
Set each job's timezone to **Asia/Manila**. Free plan: each request times out after 30 seconds (cron-job.org's own limit), and a sleeping Render service needs about a minute to wake. So the first ping of the day can time out even though it does wake the service. Use a separate warm-up job so that never affects the real jobs.

1. **Warm-up** (`/health`, tiny reply): URL `https://<your-app>.onrender.com/health`, Monday-Friday, hours 8, minutes 40, 45, 50. A timeout here is expected and harmless.
2. **Tick**: URL `https://<your-app>.onrender.com/api/tick`, Monday-Friday, hours 9 to 15, minutes 0, 10, 20, 30, 40, 50. Header `x-cron-key: <CRON_SECRET>`. The 3:00 PM tick sends the report. The 3:10 and 3:20 ticks are retries and also run the daily OHLC check and cleanup.
3. No weekend jobs: nothing runs on Saturday/Sunday, so no weekend report.

Replies are now tiny (for example `{"ok":true,"did":"collector,psei"}`). Add `?verbose=1` to see full details when debugging.

PSE schedule (from PSE/BDO Securities pages): open 9:30 AM, recess 12:00-1:00 PM, pre-close 2:45, run-off 2:50, close 3:00 PM. PSE Edge's "As of 2:50 PM" is the end of price data.

## F. Go live (after at least one good day in test mode)
1. Render -> Environment -> `EMAIL_TEST_MODE=false`, save (redeploys).
2. Open `/api/status` with your key: `emailTestMode` must be `false`, `db` must be `firestore`.

## Verify the 3:00 PM email
- At about 3:00-3:05 PM Manila you should receive it. If the service was asleep it can take ~1 minute longer.
- `/api/status` -> `reportToday.status` should be `sent` with a `messageId`.
- Calling `/api/report` again does NOT send a second email (it answers `skipped: already_sent`).

## Verify the collection job
- During market hours `/api/status` -> `collector.lastRunAt` should be recent and `latest.<TICKER>.asOf` should move when PSE updates.
- Firebase `observations` should grow only when prices change.

## Can 3:00 PM be guaranteed?
No. On free hosting the service may be asleep or restarting. Design: the report is *due* from 3:00 PM; each later tick retries until it is sent once (database lock). Expect 3:00-3:10 PM normally. A paid always-on instance narrows this but still cannot promise to-the-second delivery (email delivery itself has delays).

## Force-resend the report
Normal triggers send at most one report per date. To deliberately resend (live mode only; test mode never sends):
```
curl.exe -H "x-cron-key: YOUR_SECRET" "https://YOUR-APP.onrender.com/api/report?force=1"
```
It sends immediately, even if today's report was already sent. It still refuses while another send is running (answer `in_progress`). Never put `force=1` in a cron job. `emailReports/<date>.sendCount` shows how many times it was sent.
