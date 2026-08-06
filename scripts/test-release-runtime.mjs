#!/usr/bin/env node

import assert from 'node:assert/strict';
import { verifyReleaseRuntime } from './check-release-runtime.mjs';

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
