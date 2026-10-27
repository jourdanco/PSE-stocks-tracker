'use strict';
/** Tiny response bodies for cron-job.org (add ?verbose=1 to any endpoint to get the full details). */
const short = (s, n = 80) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, n);

const briefTick = (r) => ({ ok: true, did: short((r.actions || []).map((a) => a.job).join(',') || 'none', 60) });
const briefReport = (r) => ({ ok: r.status !== 'failed', report: short(r.status, 12), why: short(r.reason || r.error || '', 60) });
const briefOhlc = (r) => ({ ok: Boolean(r.ok), rows: (r.summary || []).reduce((n, x) => n + (x.rows || 0), 0) });
const briefError = (e) => ({ ok: false, error: short(e && e.message ? e.message : e, 80) });

module.exports = { short, briefTick, briefReport, briefOhlc, briefError };
