'use strict';
/**
 * Firestore implementation. Document IDs are designed so every query is a single-field
 * query (no composite indexes needed):
 *   observations/{TICKER}_{YYYY-MM-DD}_{asOfEpoch}      -> range on document ID by prefix
 *   dailyOhlc/{TICKER}_{YYYY-MM-DD}                     -> range on document ID
 */
const admin = require('firebase-admin');
const { evaluateClaim } = require('./claim');
const { diagnose } = require('./firebaseKey');

function createFirestoreRepo(cfg) {
  const check = diagnose(cfg);
  if (!check.ok) {
    throw new Error(`Firebase credentials problem:\n - ${check.problems.join('\n - ')}\nRun "npm run check-firebase" for details.`);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert({ projectId: cfg.projectId, clientEmail: cfg.clientEmail, privateKey: cfg.privateKey }) });
  }
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const DOC_ID = admin.firestore.FieldPath.documentId();
  const data = (snap) => (snap.exists ? snap.data() : null);

  return {
    kind: 'firestore',

    async getLatest(t) { return data(await db.collection('latest').doc(t).get()); },
    async setLatest(t, v) { await db.collection('latest').doc(t).set(v); },

    async createObservation(o) {
      try { await db.collection('observations').doc(o.id).create(o); return true; }
      catch (e) {
        if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || '')) return false; // already saved (e.g. after a restart)
        throw e;
      }
    },
    async listObservations(ticker, date) {
      const prefix = `${ticker}_${date}_`;
      const snap = await db.collection('observations').where(DOC_ID, '>=', prefix).where(DOC_ID, '<=', `${prefix}\uf8ff`).get();
      return snap.docs.map((d) => d.data()).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    },

    async getDaily(t, d) { return data(await db.collection('dailyOhlc').doc(`${t}_${d}`).get()); },
    async upsertDaily(rec) { await db.collection('dailyOhlc').doc(rec.id).set(rec, { merge: true }); },
    async listDaily(t, from, to) {
      const snap = await db.collection('dailyOhlc').where(DOC_ID, '>=', `${t}_${from}`).where(DOC_ID, '<=', `${t}_${to}`).get();
      return snap.docs.map((d) => d.data()).sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
    },

    async savePsei(snap) {
      try { await db.collection('pseiSnapshots').doc(snap.id).create(snap); return true; }
      catch (e) { if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || '')) return false; throw e; }
    },
    async getLatestPsei() {
      const q = await db.collection('pseiSnapshots').orderBy('asOfEpoch', 'desc').limit(1).get();
      return q.empty ? null : q.docs[0].data();
    },

    async setJobStatus(name, v) { await db.collection('jobStatus').doc(name).set(v, { merge: true }); },
    async getJobStatus(name) { return data(await db.collection('jobStatus').doc(name).get()); },
    async setJobRun(id, v) { await db.collection('jobRuns').doc(id).set(v, { merge: true }); },
    async getJobRun(id) { return data(await db.collection('jobRuns').doc(id).get()); },

    async getReport(date) { return data(await db.collection('emailReports').doc(date).get()); },
    async claimReport(date, nowMs, opts) {
      const ref = db.collection('emailReports').doc(date);
      return db.runTransaction(async (tx) => {
        const r = evaluateClaim(data(await tx.get(ref)), nowMs, opts);
        if (r.ok) tx.set(ref, { ...r.next, date }, { merge: true });
        return r;
      });
    },
    async markReportSent(date, info) {
      await db.collection('emailReports').doc(date).set({ ...info, status: 'sent', sentAt: new Date().toISOString(), leaseUntilMs: 0 }, { merge: true });
    },
    async markReportFailed(date, error) {
      await db.collection('emailReports').doc(date).set({ status: 'failed', lastError: String(error).slice(0, 500), leaseUntilMs: 0 }, { merge: true });
    },

    async pruneObservations(beforeDate) {
      let total = 0;
      for (;;) {
        const snap = await db.collection('observations').where('tradingDate', '<', beforeDate).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        total += snap.size;
      }
      return total;
    }
  };
}
module.exports = { createFirestoreRepo };
