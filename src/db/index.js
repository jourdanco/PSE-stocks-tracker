'use strict';
const { createMemoryRepo } = require('./memoryRepo');

function createRepo(config) {
  if (config.useMemoryDb) return createMemoryRepo();
  const { createFirestoreRepo } = require('./firestoreRepo'); // loaded lazily so tests don't need firebase-admin
  return createFirestoreRepo(config.firebase);
}
module.exports = { createRepo };
