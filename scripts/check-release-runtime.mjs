#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export const REQUIRED_NODE_MAJOR = 24;

export function relaunchWithPinnedNode({
  nodeVersion = process.versions.node,
  rootDir,
  argv = process.argv.slice(2),
  env = process.env,
  pinnedNodeVersion,
  spawn = spawnSync,
  exit = process.exit,
} = {}) {
  if (!rootDir) throw new Error('rootDir is required to locate Orion\'s pinned Node.js runtime.');

  const pinnedVersion = pinnedNodeVersion
    ?? fs.readFileSync(path.join(rootDir, '.nvmrc'), 'utf8').trim();
  if (nodeVersion === pinnedVersion) return false;

  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [
    env.NVM_BIN && path.join(env.NVM_BIN, executableName),
    env.NVM_DIR && path.join(env.NVM_DIR, 'versions', 'node', `v${pinnedVersion}`, 'bin', executableName),
    path.join(os.homedir(), '.nvm', 'versions', 'node', `v${pinnedVersion}`, 'bin', executableName),
    executableName,
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

  const pinnedNode = candidates.find((candidate) => {
    const probe = spawn(candidate, ['-p', 'process.versions.node'], {
      cwd: rootDir,
      encoding: 'utf8',
      env,
    });
    return probe.status === 0 && probe.stdout.trim() === pinnedVersion;
  });

  if (!pinnedNode) {
    throw new Error(
      `Orion releases require Node.js ${pinnedVersion}, but this process is using Node.js ${nodeVersion}. `
      + 'Install the pinned version with "nvm install" and retry.',
    );
  }

  console.log(`Re-launching Orion deploy with Node.js ${pinnedVersion}`);
  const result = spawn(pinnedNode, [path.join(rootDir, 'scripts', 'deploy.mjs'), ...argv], {
    cwd: rootDir,
    stdio: 'inherit',
    env,
  });
  if (result.error) throw result.error;
  exit(result.status ?? 1);
  return true;
}

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
      + 'Run "nvm install" in the Orion repository before deploying.',
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
