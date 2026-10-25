'use strict';
/** Loads, cleans and checks Firebase credentials. Never prints the secret itself. */
const crypto = require('crypto');

/** Fixes the usual copy/paste damage: wrapping quotes, trailing comma, literal "\n", Windows CRLF. */
function normalizeKey(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^["']+/, '').replace(/["',]+$/, '');
  s = s.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  return s.trim() ? `${s.trim()}\n` : '';
}

function loadFirebase(env = process.env) {
  const b64 = (env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (b64) {
    try {
      const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return { projectId: j.project_id || '', clientEmail: j.client_email || '', privateKey: normalizeKey(j.private_key), source: 'base64-json' };
    } catch {
      return { projectId: '', clientEmail: '', privateKey: '', source: 'base64-json', error: 'FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64-encoded JSON' };
    }
  }
  const clean = (v) => String(v || '').trim().replace(/^["']+|["',]+$/g, '');
  return { projectId: clean(env.FIREBASE_PROJECT_ID), clientEmail: clean(env.FIREBASE_CLIENT_EMAIL), privateKey: normalizeKey(env.FIREBASE_PRIVATE_KEY), source: 'separate-vars' };
}

function diagnose(fb) {
  const problems = [];
  if (fb.error) problems.push(fb.error);
  if (!fb.projectId) problems.push('Project ID is empty (FIREBASE_PROJECT_ID).');
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(fb.clientEmail || '')) {
    problems.push('Client email should look like firebase-adminsdk-xxxxx@<project>.iam.gserviceaccount.com');
  }
  const k = fb.privateKey || '';
  const info = {
    source: fb.source, projectId: fb.projectId || '(empty)', clientEmail: fb.clientEmail || '(empty)',
    keyLength: k.length, keyLines: k.split('\n').filter(Boolean).length,
    startsWithBegin: k.startsWith('-----BEGIN PRIVATE KEY-----'), endsWithEnd: k.trim().endsWith('-----END PRIVATE KEY-----')
  };
  if (!k) problems.push('Private key is empty.');
  else {
    if (!info.startsWithBegin) problems.push('Private key must start with -----BEGIN PRIVATE KEY-----');
    if (!info.endsWithEnd) problems.push('Private key must end with -----END PRIVATE KEY----- (it may be cut off).');
    if (info.keyLines < 5) problems.push('Private key has too few lines: its \\n line breaks were probably lost.');
    try { crypto.createPrivateKey(k); } catch (e) { problems.push(`Node cannot read this private key (${e.code || e.message}). Re-copy it, or use FIREBASE_SERVICE_ACCOUNT_BASE64.`); }
  }
  return { ok: problems.length === 0, problems, info };
}

module.exports = { normalizeKey, loadFirebase, diagnose };
