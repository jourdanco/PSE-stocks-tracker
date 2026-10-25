'use strict';
/** Pure rule used by both repos: may this process start sending the report for a date? */
function evaluateClaim(existing, nowMs, { leaseMs = 10 * 60 * 1000, maxAttempts = 5 } = {}) {
  if (existing && existing.status === 'sent') return { ok: false, reason: 'already_sent' };
  if (existing && existing.status === 'sending' && existing.leaseUntilMs > nowMs) return { ok: false, reason: 'in_progress' };
  if (existing && (existing.attempts || 0) >= maxAttempts) return { ok: false, reason: 'max_attempts' };
  return {
    ok: true,
    next: { status: 'sending', attempts: ((existing && existing.attempts) || 0) + 1, leaseUntilMs: nowMs + leaseMs, startedAt: new Date(nowMs).toISOString() }
  };
}
module.exports = { evaluateClaim };
