'use strict';
/** Pure rule used by both repos: may this process start sending the report for a date? */
function evaluateClaim(existing, nowMs, { leaseMs = 10 * 60 * 1000, maxAttempts = 5, force = false } = {}) {
  // A send that is running right now is never overridden, even by force (prevents two emails at once).
  if (existing && existing.status === 'sending' && existing.leaseUntilMs > nowMs) return { ok: false, reason: 'in_progress' };
  if (!force && existing && existing.status === 'sent') return { ok: false, reason: 'already_sent' };
  if (!force && existing && (existing.attempts || 0) >= maxAttempts) return { ok: false, reason: 'max_attempts' };
  return {
    ok: true,
    next: { status: 'sending', attempts: ((existing && existing.attempts) || 0) + 1, leaseUntilMs: nowMs + leaseMs, startedAt: new Date(nowMs).toISOString(), forced: Boolean(force) }
  };
}
module.exports = { evaluateClaim };
