'use strict';
/** Wires everything together. Used by the server and by the preview/CLI scripts. */
const config = require('./config');
const { createRepo } = require('./db');
const { fetchStockPage, fetchIndexPage } = require('./pse/fetchPage');
const { parseStockHtml } = require('./pse/parseHtml');
const { parseIndexHtml } = require('./pse/parseIndexHtml');
const { fetchHistory } = require('./pse/history');
const { createCollector, collectPsei } = require('./services/collector');
const { refreshHistory } = require('./services/ohlcJob');
const { createScheduler } = require('./services/scheduler');
const { renderPng } = require('./charts/render');
const { sendEmail } = require('./email/sender');

function buildApp({ repo = createRepo(config), log = console } = {}) {
  const collector = createCollector({ repo, fetchStockPage, parseStockHtml, delayMs: config.pse.delayBetweenStocksMs, log });
  const deps = {
    collectPsei: () => collectPsei({ repo, fetchIndexPage, parseIndexHtml }),
    refreshHistory: () => refreshHistory({ repo, watchlist: config.getWatchlist(), fetchHistory, days: config.historyRefreshDays, tradingEnd: config.marketCloseTime, log }),
    renderPng,
    sendEmail
  };
  const scheduler = createScheduler({ repo, config, deps, collector, log });
  return { config, repo, collector, deps, scheduler, log };
}
module.exports = { buildApp };
