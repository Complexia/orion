import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  providerUpdaterConfigs,
  updateProviderTool,
} from '../src/main/provider-updates.js';

const kimiConfig = providerUpdaterConfigs.find((config) => config.id === 'kimi');
assert.ok(kimiConfig, 'Kimi updater configuration should exist');
assert.equal(
  'updateTimeoutMs' in kimiConfig,
  false,
  'provider downloads should remain user-controlled instead of timing out'
);

const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'orion-provider-update-'));
const fixtureCommand = path.join(fixtureDir, 'slow-provider');

try {
  await writeFile(
    fixtureCommand,
    `#!/bin/sh
if [ "$2" = "--help" ]; then
  exit 0
fi
if [ "$1" = "quick" ]; then
  printf 'Downloading provider fixture 100%%\n'
  exit 0
fi
printf 'Downloading provider fixture\n'
sleep 2
`,
    'utf8'
  );
  await chmod(fixtureCommand, 0o755);

  const controller = new AbortController();
  const chunks = [];
  const result = await updateProviderTool(
    {
      id: 'fixture',
      label: 'Fixture Provider',
      command: fixtureCommand,
      updateCommands: [['upgrade']],
    },
    null,
    {
      signal: controller.signal,
      onOutput: ({ chunk }) => {
        chunks.push(chunk);
        if (chunk.includes('Downloading provider fixture')) controller.abort();
      },
    }
  );

  assert.equal(result.ok, false, 'an aborted update should not report success');
  assert.equal(result.cancelled, true, 'the updater should distinguish user cancellation from failure');
  assert.equal(result.error, 'Fixture Provider update cancelled.');
  assert.match(
    result.output,
    /Downloading provider fixture/,
    'captured updater progress should remain available for diagnostics'
  );
  assert.match(chunks.join(''), /Downloading provider fixture/);

  const completedChunks = [];
  const completed = await updateProviderTool(
    {
      id: 'fixture',
      label: 'Fixture Provider',
      command: fixtureCommand,
      updateCommands: [['quick']],
    },
    null,
    {
      onOutput: ({ chunk }) => completedChunks.push(chunk),
    }
  );
  assert.equal(completed.ok, true, 'a streaming update should complete without a deadline');
  assert.match(completedChunks.join(''), /100%/, 'live progress should be emitted before completion');
} finally {
  await rm(fixtureDir, { recursive: true });
}

console.log('Provider update regression tests passed.');
