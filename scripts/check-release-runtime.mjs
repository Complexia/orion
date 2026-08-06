#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const REQUIRED_NODE_MAJOR = 24;

export function verifyReleaseRuntime({
  nodeVersion = process.versions.node,
  platform = process.platform,
  requireNativePackaging = true,
  loadMacosAlias = () => require('macos-alias'),
} = {}) {
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0], 10);
  if (nodeMajor !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Orion releases require Node.js ${REQUIRED_NODE_MAJOR}.x, but this process is using Node.js ${nodeVersion}. `
      + 'Run "nvm use" in the Orion repository before deploying.',
    );
  }

  if (platform !== 'darwin' || !requireNativePackaging) return;

  try {
    loadMacosAlias();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `macos-alias cannot load under Node.js ${nodeVersion}. `
      + `Run "npm rebuild macos-alias" under Node.js ${REQUIRED_NODE_MAJOR}.x before deploying.\n${detail}`,
      { cause: error },
    );
  }
}
