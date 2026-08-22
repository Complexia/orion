import assert from 'node:assert/strict';
import { app } from 'electron';

import { commandForModel } from '../src/main/command-for-model.js';

const model = {
  id: 'opencode:opencode/mimo-v2.5-free',
  providerId: 'opencode',
  slug: 'opencode/mimo-v2.5-free',
};

assert.deepEqual(
  commandForModel(model, {
    prompt: 'Hello',
    projectPath: '/tmp/project',
    accessMode: 'full-access',
  }),
  [
    'opencode',
    'run',
    '--format',
    'json',
    '--model',
    'opencode/mimo-v2.5-free',
    '--auto',
    'Hello',
  ],
  'a fresh OpenCode run should use its JSONL protocol and explicit full-access approval'
);

assert.deepEqual(
  commandForModel(model, {
    prompt: 'Continue',
    projectPath: '/tmp/project',
    accessMode: 'workspace-write',
    resumeSessionId: 'ses_test',
    forkSession: true,
    openCodeReasoningEffort: 'high',
    providerOptions: { extraArgs: '--thinking' },
  }),
  [
    'opencode',
    'run',
    '--format',
    'json',
    '--model',
    'opencode/mimo-v2.5-free',
    '--session',
    'ses_test',
    '--fork',
    '--variant',
    'high',
    '--thinking',
    'Continue',
  ],
  'OpenCode should resume and natively fork sessions while preserving extra flags'
);

console.log('OpenCode provider command regression tests passed.');
app.exit(0);
