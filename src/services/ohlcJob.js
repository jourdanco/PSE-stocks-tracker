'use strict';
/** Refresh official daily OHLC from PSE's history endpoint and finalize provisional records. */
const { applyOfficial } = require('../logic/ohlc');
const { manilaParts, addDays, hhmmToMinutes } = require('../time');

async function refreshHistory({ repo, watchlist, fetchHistory, now = () => new Date(), days = 45, tradingEnd = '15:45', log = console }) {
  const p = manilaParts(now());
  const today = p.date;
  const sessionOver = p.minutes >= hhmmToMinutes(tradingEnd);
  const summary = [];

  for (const stock of watchlist.filter((s) => s.cmpyId)) {
    if (!stock.securityId) {
      summary.push({ ticker: stock.ticker, outcome: 'skipped', reason: 'no securityId in config/watchlist.json' });
      continue;
    }
    try {
      const { rows, warnings } = await fetchHistory({ cmpyId: stock.cmpyId, securityId: stock.securityId, startDate: addDays(today, -days), endDate: today });
      let written = 0, finalizedNow = 0;
      const discrepancies = [];
      for (const row of rows) {
        const canFinalize = row.tradingDate < today || sessionOver;
        const existing = await repo.getDaily(stock.ticker, row.tradingDate);
        if (existing && existing.status === 'finalized' && !(existing.open !== row.open || existing.close !== row.close)) continue; // nothing new
        const { record, changed, discrepancy } = applyOfficial({ ticker: stock.ticker, row, existing, now: now(), canFinalize });
        if (changed && record) {
          await repo.upsertDaily(record); written++;
          if (record.status === 'finalized' && (!existing || existing.status !== 'finalized')) finalizedNow++;
        }
        if (discrepancy) discrepancies.push(`${row.tradingDate}: ${discrepancy}`);
      }
      summary.push({ ticker: stock.ticker, outcome: 'ok', rows: rows.length, written, finalizedNow, warnings, discrepancies });
    } catch (e) {
      log.error(`[ohlc] ${stock.ticker}: ${e.message}`);
      summary.push({ ticker: stock.ticker, outcome: 'error', error: e.message });
    }
  }
  const ok = summary.every((s) => s.outcome !== 'error');
  await repo.setJobRun(`ohlc_${today}`, { date: today, ranAt: now().toISOString(), ok, summary });
  return { ok, summary };
}
module.exports = { refreshHistory };
