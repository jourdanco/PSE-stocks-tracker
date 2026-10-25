'use strict';
/** Checks your Firebase settings WITHOUT printing secrets, then tries one tiny read.   npm run check-firebase */
require('dotenv').config();
const { loadFirebase, diagnose } = require('../src/db/firebaseKey');

(async () => {
  const fb = loadFirebase(process.env);
  const d = diagnose(fb);
  console.log('Credential source :', d.info.source);
  console.log('Project ID        :', d.info.projectId);
  console.log('Client email      :', d.info.clientEmail);
  console.log('Key length/lines  :', d.info.keyLength, '/', d.info.keyLines, '(a normal key is ~1700 chars, ~28 lines)');
  console.log('Starts/ends right :', d.info.startsWithBegin, '/', d.info.endsWithEnd);
  if (!d.ok) {
    console.log('\nPROBLEMS:'); d.problems.forEach((p) => console.log(' -', p));
    console.log('\nFix: see "Fixing the Firebase key" in docs/TROUBLESHOOTING.md');
    return process.exit(1);
  }
  console.log('\nKey format OK. Trying one read from Firestore...');
  try {
    const { createFirestoreRepo } = require('../src/db/firestoreRepo');
    const repo = createFirestoreRepo(fb);
    await repo.getLatest('connection-test');
    console.log('SUCCESS: connected to Firestore.');
  } catch (e) {
    console.log('FAILED:', e.message);
    if (/NOT_FOUND|5 NOT_FOUND/.test(e.message)) console.log('Hint: create the Firestore database (Build -> Firestore Database -> Create database).');
    if (/PERMISSION_DENIED|7 PERMISSION/.test(e.message)) console.log('Hint: the key belongs to a different project, or the Cloud Firestore API is disabled.');
    process.exit(1);
  }
})();
