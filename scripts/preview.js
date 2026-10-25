'use strict';
/**
 * LOCAL END-TO-END PREVIEW. Uses a throw-away in-memory database (no Firebase needed).
 * Fetches live data, renders the charts, and writes debug/report-preview-<date>.html
 *   npm run preview             -> preview only (sends nothing)
 *   npm run preview -- --send   -> ALSO sends one real email (needs EMAIL_TEST_MODE=false, RESEND_API_KEY, EMAIL_TO)
 */
require('dotenv').config();
process.env.USE_MEMORY_DB = 'true';
const config = require('../src/config');
const { buildApp } = require('../src/app');
const { createMemoryRepo } = require('../src/db/memoryRepo');
const { runReport } = require('../src/services/report');

const send = process.argv.includes('--send');
(async () => {
  const { repo, collector, deps } = buildApp({ repo: createMemoryRepo() });
  config.email.testMode = !send || config.email.testMode;
  if (send && config.email.testMode) console.log('--send ignored: set EMAIL_TEST_MODE=false in .env to allow real emails.');

  console.log('1/4 collecting current quotes...');
  console.log((await collector.collectOnce(config.getWatchlist())).map((r) => `${r.ticker}: ${r.outcome}${r.error ? ' ' + r.error : ''}`).join('\n'));
  console.log('2/4 official daily history...');
  console.log(JSON.stringify((await deps.refreshHistory()).summary, null, 1));
  console.log('3/4 PSEi...');
  try { console.log((await deps.collectPsei()).outcome); } catch (e) { console.log('PSEi failed:', e.message); }
  console.log('4/4 building report...');
  const r = await runReport({ repo, config, deps });
  console.log(r);
  if (r.file) console.log(`\nOpen this file in your browser:\n${r.file}`);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
