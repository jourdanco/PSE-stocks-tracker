'use strict';
/** In-memory database with the same methods as the Firestore one. Used for tests and `npm run preview`. */
const { evaluateClaim } = require('./claim');
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function createMemoryRepo() {
  const s = { latest: new Map(), obs: new Map(), daily: new Map(), psei: new Map(), jobStatus: new Map(), jobRuns: new Map(), reports: new Map() };
  return {
    kind: 'memory',
    _state: s,
    async getLatest(t) { return clone(s.latest.get(t)) || null; },
    async setLatest(t, v) { s.latest.set(t, clone(v)); },

    async createObservation(o) {
      if (s.obs.has(o.id)) return false;
      s.obs.set(o.id, clone(o));
      return true;
    },
    async listObservations(ticker, date) {
      const prefix = `${ticker}_${date}_`;
      return [...s.obs.values()].filter((o) => o.id.startsWith(prefix))
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(clone);
    },

    async getDaily(t, d) { return clone(s.daily.get(`${t}_${d}`)) || null; },
    async upsertDaily(rec) { s.daily.set(rec.id, { ...(s.daily.get(rec.id) || {}), ...clone(rec) }); },
    async listDaily(t, from, to) {
      return [...s.daily.values()].filter((r) => r.ticker === t && r.tradingDate >= from && r.tradingDate <= to)
        .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate)).map(clone);
    },

    async savePsei(snap) { if (s.psei.has(snap.id)) return false; s.psei.set(snap.id, clone(snap)); return true; },
    async getLatestPsei() {
      const all = [...s.psei.values()].sort((a, b) => b.asOfEpoch - a.asOfEpoch);
      return clone(all[0]) || null;
    },

    async setJobStatus(name, v) { s.jobStatus.set(name, { ...(s.jobStatus.get(name) || {}), ...clone(v) }); },
    async getJobStatus(name) { return clone(s.jobStatus.get(name)) || null; },
    async setJobRun(id, v) { s.jobRuns.set(id, { ...(s.jobRuns.get(id) || {}), ...clone(v) }); },
    async getJobRun(id) { return clone(s.jobRuns.get(id)) || null; },

    async getReport(date) { return clone(s.reports.get(date)) || null; },
    async claimReport(date, nowMs, opts) {
      const r = evaluateClaim(s.reports.get(date), nowMs, opts);
      if (r.ok) s.reports.set(date, { ...(s.reports.get(date) || {}), ...r.next, date });
      return r;
    },
    async markReportSent(date, info) {
      const prev = s.reports.get(date) || {};
      s.reports.set(date, { ...prev, ...clone(info), status: 'sent', sentAt: new Date().toISOString(), leaseUntilMs: 0, sendCount: (prev.sendCount || 0) + 1 });
    },
    async markReportFailed(date, error) {
      s.reports.set(date, { ...(s.reports.get(date) || {}), status: 'failed', lastError: String(error).slice(0, 500), leaseUntilMs: 0 });
    },

    async pruneObservations(beforeDate) {
      let n = 0;
      for (const [k, o] of s.obs) if (o.tradingDate < beforeDate) { s.obs.delete(k); n++; }
      return n;
    }
  };
}
module.exports = { createMemoryRepo };
