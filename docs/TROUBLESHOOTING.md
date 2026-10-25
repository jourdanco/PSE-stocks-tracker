# Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `npm run dry-run` says `"ok": false` | PSE changed the page, or wrong `cmpyId` | Run with `--save-html`, send me `debug/<TICKER>.html`. Check `warnings`. |
| Warning "Ticker not found on the page" | Wrong `cmpyId` | Re-copy the number from the browser address bar. |
| `npm run history` says "History endpoint returned HTTP ..." or "did not return JSON" | Endpoint needs extra headers/cookies, or `securityId` is wrong | Re-capture the request in Chrome DevTools; check `securityId` in `config/watchlist.json`. |
| Chart missing in preview | `echarts` / `@resvg/resvg-js` not installed | Re-run `npm install`; read the note in the report. The email still sends. |
| Chart text shows empty squares | Font files missing | Make sure `assets/fonts/DejaVuSans.ttf` exists. |
| `Firebase credentials missing` | `.env` not filled | Fill the 3 `FIREBASE_*` values. Keep quotes and `\n` in the private key. |
| `PERMISSION_DENIED` / `NOT_FOUND` from Firestore | Firestore not created, or wrong project | Create the database (Part B) and check `FIREBASE_PROJECT_ID`. |
| `/api/...` returns `unauthorized` | Wrong/missing secret | Header `x-cron-key` must equal `CRON_SECRET` exactly. |
| `503 CRON_SECRET is not configured` | Env var missing on Render | Add it and redeploy. |
| No email | Still in test mode, or Resend rejected | `/api/status` -> `emailTestMode`. Check `reportToday.lastError`. |
| Email arrives but images missing | Client blocks images | The numbers are in the HTML text. Allow images. |
| Report not at 6:00 PM | Service asleep / cron late | Check cron-job.org history and timezone (Asia/Manila). |
| Duplicate emails | Should not happen | Check `emailReports/<date>`. A crash between "sent" and "recorded" is the only known gap. Tell me. |
| No observations all day | PSE page not updating, holiday, or collector outside window | Check `jobStatus/collector` and `TRADING_WINDOW_*`. |
| Holiday treated as trading day | `config/holidays.json` is empty | Add dates ("YYYY-MM-DD") from PSE's Market Calendar. The stale-data check means nothing wrong is recorded anyway. |

## Fixing the Firebase key
Error `DECODER routines::unsupported` (or "Getting metadata from plugin failed") means Node cannot read the private key. First run:
```
npm run check-firebase
```
It tells you what is wrong without showing the secret. The most reliable fix is to give the app the **whole JSON file as one line** instead of three separate values:

**Windows (PowerShell)**, replace the path with your downloaded key file:
```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your-key.json"))
```
Copy the long output and put it in `.env` as ONE line (no quotes):
```
FIREBASE_SERVICE_ACCOUNT_BASE64=PASTE_THE_LONG_TEXT_HERE
```
Delete or empty the three `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` lines. On Render, add the same single variable instead. Never paste the key or this text into a chat or commit it.

**Mac/Linux:** `base64 -w0 your-key.json` (Mac: `base64 -i your-key.json`).
