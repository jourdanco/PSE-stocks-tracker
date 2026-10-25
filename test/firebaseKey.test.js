'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { normalizeKey, loadFirebase, diagnose } = require('../src/db/firebaseKey');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const EMAIL = 'firebase-adminsdk-abc12@my-proj.iam.gserviceaccount.com';
const base = (key) => ({ projectId: 'my-proj', clientEmail: EMAIL, privateKey: normalizeKey(key), source: 'separate-vars' });

test('good key passes', () => assert.strictEqual(diagnose(base(privateKey)).ok, true));
test('literal \\n version (typical .env) is repaired', () => assert.strictEqual(diagnose(base(privateKey.trim().replace(/\n/g, '\\n'))).ok, true));
test('wrapping quotes + trailing comma (copied from JSON) are repaired', () => assert.strictEqual(diagnose(base(`"${privateKey.trim().replace(/\n/g, '\\n')}",`)).ok, true));
test('Windows CRLF is repaired', () => assert.strictEqual(diagnose(base(privateKey.replace(/\n/g, '\r\n'))).ok, true));
test('cut-off key is reported', () => {
  const d = diagnose(base(privateKey.slice(0, 900)));
  assert.strictEqual(d.ok, false); assert.ok(d.problems.some((p) => /cut off|cannot read/.test(p)));
});
test('lost line breaks are reported', () => {
  const d = diagnose(base(privateKey.replace(/\n/g, ' ')));
  assert.strictEqual(d.ok, false);
});
test('base64 JSON path works', () => {
  const json = JSON.stringify({ project_id: 'my-proj', client_email: EMAIL, private_key: privateKey });
  const fb = loadFirebase({ FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(json).toString('base64') });
  assert.strictEqual(diagnose(fb).ok, true); assert.strictEqual(fb.projectId, 'my-proj');
});
test('bad base64 gives a clear message', () => {
  assert.match(diagnose(loadFirebase({ FIREBASE_SERVICE_ACCOUNT_BASE64: '!!!' })).problems[0], /base64/);
});
test('diagnose never exposes the key', () => {
  const d = diagnose(base(privateKey));
  assert.ok(!JSON.stringify(d).includes('MII'));
});
