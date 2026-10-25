'use strict';
/** One real collection pass that WRITES to Firestore. Use it to verify your Firebase setup.   npm run collect-once */
require('dotenv').config();
const config = require('../src/config');
const { buildApp } = require('../src/app');
(async () => {
  const { repo, collector } = buildApp();
  console.log(`database: ${repo.kind}`);
  console.log(await collector.collectOnce(config.getWatchlist()));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
