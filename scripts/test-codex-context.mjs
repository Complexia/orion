import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  codexContextUsageFromRolloutEvent,
  readLatestCodexContextUsage,
  shouldAutoCompactCodexContext,
} from '../src/main/codex-context.js';

const tokenEvent = (inputTokens, modelContextWindow) => ({
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: { input_tokens: inputTokens },
      model_context_window: modelContextWindow,
    },
  },
});

assert.deepEqual(codexContextUsageFromRolloutEvent(tokenEvent(174_737, 258_400)), {
  inputTokens: 174_737,
  modelContextWindow: 258_400,
});
assert.equal(shouldAutoCompactCodexContext({ inputTokens: 154_000, modelContextWindow: 258_400 }), false);
assert.equal(shouldAutoCompactCodexContext({ inputTokens: 155_040, modelContextWindow: 258_400 }), true);
assert.equal(shouldAutoCompactCodexContext(null), false);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-codex-context-'));
try {
  const sessionId = '01999999-aaaa-7bbb-8ccc-dddddddddddd';
  const dayDir = path.join(tempRoot, 'sessions', '2026', '08', '23');
  await fs.mkdir(dayDir, { recursive: true });
  const rollout = path.join(dayDir, `rollout-test-${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
    JSON.stringify(tokenEvent(40, 100)),
    JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
    JSON.stringify(tokenEvent(70, 100)),
    '',
  ];
  await fs.writeFile(rollout, lines.join('\n'));
  assert.deepEqual(await readLatestCodexContextUsage(sessionId, { codexHome: tempRoot }), {
    inputTokens: 70,
    modelContextWindow: 100,
  });
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('Codex context tests passed.');
