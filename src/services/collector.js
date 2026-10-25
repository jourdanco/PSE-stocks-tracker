'use strict';
/**
 * One collection pass over the watchlist.
 * Everything important lives in the database, so a restart/sleep never loses state.
 * Write order for a price change: observation (idempotent by ID) -> daily OHLC -> latest state.
 * If a write fails, "latest" is NOT advanced, so the next pass retries safely without duplicates.
 */
const { decide } = require('../logic/changeDetector');
const { provisionalFromQuote } = require('../logic/ohlc');
const { epochSeconds } = require('../time');

const FIVE_MIN = 5 * 60 * 1000;
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

function createCollector({ repo, fetchStockPage, parseStockHtml, now = () => new Date(), delayMs = 0, sleep = sleepDefault, log = console }) {
  const mem = { latest: new Map(), daily: new Map(), lastLatestWrite: new Map(), lastDailyWrite: new Map(), lastStatusWrite: 0, consecutiveFailures: 0 };

  async function getPrev(ticker) {
    if (!mem.latest.has(ticker)) mem.latest.set(ticker, await repo.getLatest(ticker));
    return mem.latest.get(ticker);
  }

  async function writeDaily(stock, quote, force) {
    const key = `${stock.ticker}_${quote.tradingDate}`;
    const last = mem.lastDailyWrite.get(key) || 0;
    if (!force && now().getTime() - last < FIVE_MIN) return;
    let existing = mem.daily.get(key);
    if (existing === undefined) existing = await repo.getDaily(stock.ticker, quote.tradingDate);
    const rec = provisionalFromQuote({ ticker: stock.ticker, quote, existing, now: now() });
    await repo.upsertDaily(rec);
    mem.daily.set(key, rec);
    mem.lastDailyWrite.set(key, now().getTime());
  }

  function latestDoc(stock, quote) {
    return {
      ticker: stock.ticker, name: stock.name, tradingDate: quote.tradingDate, asOf: quote.asOf, asOfEpoch: epochSeconds(quote.asOf),
      last: quote.last, change: quote.change, changePct: quote.changePct, changeSource: quote.changeSource,
      open: quote.open, high: quote.high, low: quote.low, prevClose: quote.prevClose, volume: quote.volume, value: quote.value,
      status: quote.status, updatedAt: now().toISOString()
    };
  }

  async function collectStock(stock) {
    const out = { ticker: stock.ticker };
    let quote;
    try {
      const page = await fetchStockPage(stock.cmpyId);
      quote = parseStockHtml(page.html, { expectedTicker: stock.ticker });
    } catch (e) { return { ...out, outcome: 'fetch_error', error: e.message }; }
    if (!quote.ok) return { ...out, outcome: 'parse_error', warnings: quote.warnings };

    try {
      const prev = await getPrev(stock.ticker);
      const d = decide({ prev, quote, collectedAt: now().toISOString(), ticker: stock.ticker });
      out.outcome = d.action; out.reason = d.reason; out.asOf = quote.asOf; out.last = quote.last;

      if (d.action === 'baseline' || d.action === 'price_change') {
        out.observationCreated = await repo.createObservation(d.observation); // false = already stored (restart safe)
        await writeDaily(stock, quote, true);
        const doc = latestDoc(stock, quote);
        await repo.setLatest(stock.ticker, doc);
        mem.latest.set(stock.ticker, doc);
        mem.lastLatestWrite.set(stock.ticker, now().getTime());
      } else if (d.action === 'heartbeat') {
        await writeDaily(stock, quote, false);
        const doc = latestDoc(stock, quote);
        mem.latest.set(stock.ticker, doc); // memory always current
        if (now().getTime() - (mem.lastLatestWrite.get(stock.ticker) || 0) >= FIVE_MIN) {
          await repo.setLatest(stock.ticker, doc);
          mem.lastLatestWrite.set(stock.ticker, now().getTime());
        }
      }
      return out;
    } catch (e) { return { ...out, outcome: 'db_error', error: e.message }; }
  }

  async function collectOnce(watchlist) {
    const results = [];
    const stocks = watchlist.filter((s) => s.cmpyId);
    for (const [i, stock] of stocks.entries()) {
      if (i > 0 && delayMs) await sleep(delayMs);
      results.push(await collectStock(stock));
    }
    // Polling log is kept separate from price history; written only on problems or every 10 minutes.
    const problems = results.filter((r) => ['fetch_error', 'parse_error', 'db_error'].includes(r.outcome));
    mem.consecutiveFailures = problems.length === results.length && results.length ? mem.consecutiveFailures + 1 : 0;
    if (problems.length || now().getTime() - mem.lastStatusWrite >= 10 * 60 * 1000) {
      try {
        await repo.setJobStatus('collector', {
          lastRunAt: now().toISOString(), consecutiveFailures: mem.consecutiveFailures,
          results: Object.fromEntries(results.map((r) => [r.ticker, { outcome: r.outcome, asOf: r.asOf || null, error: r.error || null }]))
        });
        mem.lastStatusWrite = now().getTime();
      } catch (e) { log.error('Could not write job status:', e.message); }
    }
    for (const r of problems) log.error(`[collector] ${r.ticker}: ${r.outcome} ${r.error || (r.warnings || []).join('; ')}`);
    return results;
  }

  return { collectOnce, collectStock, _mem: mem };
}

/** PSEi + market totals snapshot. Same idempotent pattern. */
async function collectPsei({ repo, fetchIndexPage, parseIndexHtml, now = () => new Date() }) {
  const page = await fetchIndexPage();
  const idx = parseIndexHtml(page.html);
  if (!idx.ok) return { outcome: 'parse_error', warnings: idx.warnings };
  const asOfEpoch = epochSeconds(idx.asOf);
  const snap = { ...idx, id: `${idx.tradingDate}_${asOfEpoch}`, asOfEpoch, collectedAt: now().toISOString() };
  const created = await repo.savePsei(snap);
  return { outcome: created ? 'saved' : 'unchanged', snapshot: snap };
}

module.exports = { createCollector, collectPsei };
