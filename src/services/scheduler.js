'use strict';
/**
 * One tick = "look at the clock and do whatever is due".
 * It is called by BOTH an in-app timer and cron-job.org. Because every job is idempotent
 * (deterministic IDs, durable claims, in-process locks), extra or late calls are harmless.
 */
const { manilaParts, inTradingWindow, isTradingDay, reportDue, hhmmToMinutes, addDays } = require('../time');
const { runReport } = require('./report');

function createScheduler({ repo, config, deps, collector, now = () => new Date(), log = console }) {
  const busy = { collector: false, report: false, ohlc: false };
  const st = { lastCollectAt: 0, lastPseiAt: 0, ohlcDoneDate: null, reportDoneDate: null, reportRetryAt: 0, pruneDoneDate: null };

  async function tick({ source = 'timer' } = {}) {
    const t = now();
    const p = manilaParts(t);
    const holidays = config.getHolidays();
    const out = { source, at: t.toISOString(), manilaTime: `${p.date} ${p.time}`, actions: [] };

    // 1) Price collection (trading days, trading window only)
    const minGap = config.collectionIntervalSec * 800; // allow ~80% of the interval, so cron + timer don't double-fetch
    if (inTradingWindow(t, config.tradingWindow, holidays) && !busy.collector && t.getTime() - st.lastCollectAt >= minGap) {
      busy.collector = true;
      try {
        st.lastCollectAt = t.getTime();
        const results = await collector.collectOnce(config.getWatchlist());
        out.actions.push({ job: 'collector', results: results.map((r) => ({ ticker: r.ticker, outcome: r.outcome })) });
        if (t.getTime() - st.lastPseiAt >= config.pseiEveryMinutes * 60000) {
          st.lastPseiAt = t.getTime();
          try { const r = await deps.collectPsei(); out.actions.push({ job: 'psei', outcome: r.outcome }); }
          catch (e) { out.actions.push({ job: 'psei', outcome: 'error', error: e.message }); }
        }
      } finally { busy.collector = false; }
    }

    // 2) Official daily OHLC after the close (once per trading day, durable record)
    if (isTradingDay(p.date, holidays) && p.minutes >= hhmmToMinutes(config.ohlcTime) && st.ohlcDoneDate !== p.date && !busy.ohlc) {
      busy.ohlc = true;
      try {
        const run = await repo.getJobRun(`ohlc_${p.date}`);
        if (run && run.ok) st.ohlcDoneDate = p.date;
        else { const r = await deps.refreshHistory(); out.actions.push({ job: 'ohlc', ok: r.ok }); if (r.ok) st.ohlcDoneDate = p.date; }
      } catch (e) { out.actions.push({ job: 'ohlc', ok: false, error: e.message }); }
      finally { busy.ohlc = false; }
    }

    // 3) Daily report (every day; claim in the database prevents duplicates)
    if (reportDue(t, { reportTime: config.report.time, catchupMinutes: config.report.catchupMinutes }) &&
        st.reportDoneDate !== p.date && !busy.report && t.getTime() >= st.reportRetryAt) {
      busy.report = true;
      try {
        const r = await runReport({ repo, config, deps, date: p.date, now, log });
        out.actions.push({ job: 'report', status: r.status, reason: r.reason, error: r.error });
        log.log(`[report] ${r.date} status=${r.status}${r.reason ? ' reason=' + r.reason : ''}${r.error ? ' error=' + String(r.error).slice(0, 80) : ''}${r.charts !== undefined ? ' charts=' + r.charts : ''}`);
        if (r.status === 'failed') st.reportRetryAt = t.getTime() + 2 * 60000;
        else st.reportDoneDate = p.date; // sent, preview, or skipped (already sent / max attempts)
      } finally { busy.report = false; }
    }

    // 4) Housekeeping: delete observations older than the retention period (once a day, after close)
    if (p.minutes >= hhmmToMinutes(config.ohlcTime) && st.pruneDoneDate !== p.date) {
      try {
        const n = await repo.pruneObservations(addDays(p.date, -config.retentionDays));
        await repo.setJobRun(`prune_${p.date}`, { date: p.date, deleted: n, ranAt: t.toISOString() });
        st.pruneDoneDate = p.date;
        if (n) out.actions.push({ job: 'prune', deleted: n });
      } catch (e) { out.actions.push({ job: 'prune', error: e.message }); }
    }
    return out;
  }

  return { tick, _state: st };
}
module.exports = { createScheduler };
