import assert from 'node:assert/strict';
import { createRepositoryCredentials } from '../src/main/repository-credentials.js';

let session = { token: 'session', user: { id: 'account-one' } };
let saved = null;
let releaseRemoval;
let removalStarted;
const removing = new Promise((resolve) => { removalStarted = resolve; });
const removalGate = new Promise((resolve) => { releaseRemoval = resolve; });
let creations = 0;
const manager = createRepositoryCredentials({
  readSession: async () => session,
  readStored: async () => saved,
  writeStored: async (value) => { saved = value; },
  removeStored: async () => { removalStarted(); await removalGate; saved = null; },
  origin: () => 'https://orion.test',
  deviceName: 'test',
  fetchImpl: async (_url, options) => {
    if (options.method === 'POST') creations++;
    return Response.json({ token: `orion_pat_${'a'.repeat(64)}` });
  },
});

// Sign-out has invalidated access, but the old session remains readable on
// disk until the asynchronous credential cleanup has finished.
const clearing = manager.clear();
await removing;
const requestDuringSignout = assert.rejects(manager.get(), /Sign in/);
releaseRemoval();
await clearing;
session = null;
await requestDuringSignout;
await assert.rejects(manager.get(), /Sign in/);
assert.equal(creations, 0);
assert.equal(saved, null);

// A successfully persisted sign-in is the only operation that re-enables it.
session = { token: 'new-session', user: { id: 'account-two' } };
manager.resume();
const next = await manager.get();
assert.equal(creations, 1);
assert.equal(next.user.id, 'account-two');
assert.equal(saved.user.id, 'account-two');
console.log('ok  sign-out blocks new token creation until a completed sign-in');
