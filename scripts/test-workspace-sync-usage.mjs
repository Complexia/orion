import assert from 'node:assert/strict';
import { computeThreadUsage } from '../src/main/workspace-sync.js';

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

console.log('Workspace sync usage rollup checks passed.');
