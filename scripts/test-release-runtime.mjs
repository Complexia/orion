#!/usr/bin/env node

import assert from 'node:assert/strict';
import { relaunchWithPinnedNode, verifyReleaseRuntime } from './check-release-runtime.mjs';

assert.equal(relaunchWithPinnedNode({
  nodeVersion: '24.18.1',
  rootDir: '/repo',
  pinnedNodeVersion: '24.18.1',
}), false);

assert.throws(
  () => relaunchWithPinnedNode({
    nodeVersion: '24.17.0',
    rootDir: '/repo',
    env: {},
    pinnedNodeVersion: '24.18.1',
    spawn: () => ({ status: 1, stdout: '' }),
    exit: () => {},
  }),
  /require Node\.js 24\.18\.1.*using Node\.js 24\.17\.0/,
);

const spawnCalls = [];
let exitCode = null;
assert.equal(relaunchWithPinnedNode({
  nodeVersion: '22.23.2',
  rootDir: '/repo',
  argv: ['--check-runtime'],
  env: { NVM_BIN: '/nvm/v24.18.1/bin' },
  pinnedNodeVersion: '24.18.1',
  spawn: (command, args, options) => {
    spawnCalls.push({ command, args, options });
    if (args[0] === '-p') return { status: 0, stdout: '24.18.1\n' };
    return { status: 0 };
  },
  exit: (code) => {
    exitCode = code;
  },
}), true);
assert.equal(spawnCalls.at(-1).command, '/nvm/v24.18.1/bin/node');
assert.deepEqual(spawnCalls.at(-1).args, ['/repo/scripts/deploy.mjs', '--check-runtime']);
assert.equal(spawnCalls.at(-1).options.stdio, 'inherit');
assert.equal(exitCode, 0);

assert.throws(
  () => relaunchWithPinnedNode({
    nodeVersion: '22.23.2',
    rootDir: '/repo',
    env: {},
    pinnedNodeVersion: '24.18.1',
    spawn: () => ({ status: 1, stdout: '' }),
    exit: () => {},
  }),
  /Install the pinned version with "nvm install"/,
);

assert.throws(
  () => verifyReleaseRuntime({ nodeVersion: '22.23.2', platform: 'linux' }),
  /require Node\.js 24\.x.*using Node\.js 22\.23\.2/,
);

assert.doesNotThrow(() => {
  verifyReleaseRuntime({ nodeVersion: '24.18.1', platform: 'linux' });
});

let nativeLoadCount = 0;
assert.doesNotThrow(() => {
  verifyReleaseRuntime({
    nodeVersion: '24.18.1',
    platform: 'darwin',
    loadMacosAlias: () => {
      nativeLoadCount += 1;
    },
  });
});
assert.equal(nativeLoadCount, 1);

assert.throws(
  () => verifyReleaseRuntime({
    nodeVersion: '24.18.1',
    platform: 'darwin',
    loadMacosAlias: () => {
      throw new Error('NODE_MODULE_VERSION 127 does not match 137');
    },
  }),
  /npm rebuild macos-alias.*NODE_MODULE_VERSION 127 does not match 137/s,
);

assert.doesNotThrow(() => {
  verifyReleaseRuntime({
    nodeVersion: '24.18.1',
    platform: 'darwin',
    requireNativePackaging: false,
    loadMacosAlias: () => {
      throw new Error('should not load while resuming');
    },
  });
});

console.log('Release runtime tests passed');
