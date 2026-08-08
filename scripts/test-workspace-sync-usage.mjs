import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  backfillCodexThreadUsage,
  computeThreadUsage,
} from '../src/main/workspace-sync.js';

const agentRun = (modelId, stats) => ({
  kind: 'agent-run',
  ...(modelId ? { modelId } : {}),
  stats,
});

{
  const result = computeThreadUsage({
    modelId: 'codex:gpt-5.6-terra',
    messages: [
      agentRun('codex:gpt-5.6-sol', {
        totalTokens: 1_000,
        inputTokens: 800,
        outputTokens: 200,
        cachedReadTokens: 100,
      }),
      agentRun('codex:gpt-5.6-terra', {
        totalTokens: 2_000,
        inputTokens: 1_500,
        outputTokens: 500,
        cachedReadTokens: 300,
      }),
    ],
  });

  assert.deepEqual(result.usage, {
    totalTokens: 2_000,
    inputTokens: 1_500,
    outputTokens: 500,
    cachedTokens: 300,
    reasoningTokens: 0,
  });
  assert.deepEqual(result.models, [
    {
      modelId: 'codex:gpt-5.6-sol',
      providerId: 'codex',
      turns: 1,
      totalTokens: 1_000,
      inputTokens: 800,
      outputTokens: 200,
      cachedTokens: 100,
      reasoningTokens: 0,
    },
    {
      modelId: 'codex:gpt-5.6-terra',
      providerId: 'codex',
      turns: 1,
      totalTokens: 1_000,
      inputTokens: 700,
      outputTokens: 300,
      cachedTokens: 200,
      reasoningTokens: 0,
    },
  ]);
}

{
  const result = computeThreadUsage({
    modelId: 'kimi:kimi-code/kimi-for-coding',
    messages: [
      agentRun(null, {
        modelId: 'kimi-code/k3',
        totalTokens: 500,
        inputTokens: 400,
        outputTokens: 100,
      }),
      agentRun(null, {
        modelId: 'kimi-code/kimi-for-coding',
        totalTokens: 900,
        inputTokens: 700,
        outputTokens: 200,
      }),
    ],
  });

  assert.equal(result.usage.totalTokens, 900);
  assert.deepEqual(
    result.models.map(({ modelId, providerId, totalTokens }) => ({
      modelId,
      providerId,
      totalTokens,
    })),
    [
      { modelId: 'kimi:kimi-code/k3', providerId: 'kimi', totalTokens: 500 },
      {
        modelId: 'kimi:kimi-code/kimi-for-coding',
        providerId: 'kimi',
        totalTokens: 400,
      },
    ]
  );
}

{
  const result = computeThreadUsage({
    modelId: 'codex:gpt-5.6-terra',
    messages: [
      agentRun('codex:gpt-5.6-sol', { totalTokens: 1_000 }),
      // A lower cumulative total means the provider session restarted.
      agentRun('codex:gpt-5.6-terra', { totalTokens: 200 }),
    ],
  });

  assert.equal(result.usage.totalTokens, 1_200);
  assert.equal(result.models[1]?.totalTokens, 200);
}

{
  const result = computeThreadUsage({
    modelId: 'claude:claude-sonnet',
    messages: [
      agentRun('claude:claude-sonnet', { totalTokens: 300 }),
      agentRun('claude:claude-opus', { totalTokens: 700 }),
    ],
  });

  assert.equal(result.usage.totalTokens, 1_000);
  assert.deepEqual(
    result.models.map(({ modelId, totalTokens }) => ({ modelId, totalTokens })),
    [
      { modelId: 'claude:claude-sonnet', totalTokens: 300 },
      { modelId: 'claude:claude-opus', totalTokens: 700 },
    ]
  );
}

{
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-codex-usage-'));
  const sessionId = '019fe10c-c13c-7a82-bcb9-c46be23b2ab6';
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '08');
  await fs.mkdir(sessionDir, { recursive: true });
  const rollout = path.join(sessionDir, `rollout-test-${sessionId}.jsonl`);
  const event = (timestamp, type, payload = {}) =>
    JSON.stringify({ timestamp, type: 'event_msg', payload: { type, ...payload } });
  await fs.writeFile(
    rollout,
    [
      event('2026-08-08T11:05:37.000Z', 'task_started', { turn_id: 'turn-1' }),
      event('2026-08-08T11:54:55.000Z', 'token_count', {
        info: {
          total_token_usage: {
            total_tokens: 31_910_288,
            input_tokens: 31_827_212,
            output_tokens: 83_076,
            cached_input_tokens: 31_414_272,
            reasoning_output_tokens: 18_893,
          },
        },
      }),
      event('2026-08-08T11:54:55.100Z', 'task_complete', { turn_id: 'turn-1' }),
      event('2026-08-08T12:43:11.000Z', 'task_started', { turn_id: 'turn-2' }),
      event('2026-08-08T13:05:50.000Z', 'token_count', {
        info: {
          total_token_usage: {
            total_tokens: 49_903_299,
            input_tokens: 49_784_297,
            output_tokens: 119_002,
            cached_input_tokens: 49_117_952,
            reasoning_output_tokens: 32_961,
          },
        },
      }),
      event('2026-08-08T13:05:50.100Z', 'task_complete', { turn_id: 'turn-2' }),
      '',
    ].join('\n')
  );

  try {
    const thread = await backfillCodexThreadUsage(
      {
        modelId: 'codex:gpt-5.6-sol',
        createdAt: '2026-08-08T11:05:35.000Z',
        agentSessionIds: { codex: sessionId },
        messages: [
          {
            kind: 'agent-run',
            modelId: 'codex:gpt-5.6-sol',
            ts: '2026-08-08T11:05:35.000Z',
            completedAt: '2026-08-08T11:54:56.000Z',
          },
          {
            kind: 'agent-run',
            modelId: 'codex:gpt-5.6-sol',
            ts: '2026-08-08T12:43:09.000Z',
            completedAt: '2026-08-08T13:05:51.000Z',
          },
        ],
      },
      { codexHome }
    );
    const result = computeThreadUsage(thread);
    assert.deepEqual(result.usage, {
      totalTokens: 49_903_299,
      inputTokens: 49_784_297,
      outputTokens: 119_002,
      cachedTokens: 49_117_952,
      reasoningTokens: 32_961,
    });
    assert.equal(thread.messages[0].stats.totalTokens, 31_910_288);
    assert.equal(thread.messages[1].stats.totalTokens, 49_903_299);
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

console.log('Workspace sync usage rollup checks passed.');
