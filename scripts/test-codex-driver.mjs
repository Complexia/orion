import assert from 'node:assert/strict';
import { app } from 'electron';

import {
  codexErrorDetail,
  codexStatsFromTokenUsage,
  createCodexAppServerDriver,
} from '../src/main/codex-driver.js';

const model = {
  id: 'codex:gpt-test',
  providerId: 'codex',
  slug: 'gpt-test',
  label: 'Codex Test',
};

assert.deepEqual(
  codexStatsFromTokenUsage(
    {
      total: { totalTokens: 900, inputTokens: 800, outputTokens: 100 },
      last: { inputTokens: 620 },
      modelContextWindow: 1_000,
    },
    model.id
  ),
  {
    modelId: model.id,
    totalTokens: 900,
    inputTokens: 800,
    outputTokens: 100,
    contextTokens: 620,
    contextWindow: 1_000,
  },
  'Codex token updates must expose current context fill separately from cumulative usage'
);
assert.equal(
  codexErrorDetail({
    message: 'response stream disconnected',
    codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
  }),
  'response stream disconnected · response stream disconnected (HTTP 502)',
  'Codex retry details must preserve the structured transport classification'
);

const requests = [];
const activities = [];
const statsEvents = [];
let runEnded = 0;
let driver;
const child = {
  stdin: {
    write: (line) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      requests.push(message);
      const result =
        message.method === 'thread/resume'
          ? { thread: { id: 'compact-thread' } }
          : message.method === 'turn/start'
            ? { turn: { id: 'user-turn' } }
            : {};
      queueMicrotask(() => {
        driver.handleMessage({ jsonrpc: '2.0', id: message.id, result });
        if (message.method === 'thread/compact/start') {
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'compact-thread', turn: { id: 'compact-turn' } },
          });
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'error',
            params: {
              threadId: 'compact-thread',
              error: {
                message: 'temporary compaction stream interruption',
                codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 503 } },
              },
              willRetry: true,
            },
          });
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: 'compact-thread',
              tokenUsage: {
                total: { totalTokens: 700, inputTokens: 650, outputTokens: 50 },
                last: { inputTokens: 45 },
                modelContextWindow: 1_000,
              },
            },
          });
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: { threadId: 'compact-thread', turn: { id: 'compact-turn', status: 'completed' } },
          });
        }
        if (message.method === 'turn/start') {
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'compact-thread', turn: { id: 'user-turn' } },
          });
        }
      });
    },
  },
};

driver = createCodexAppServerDriver({
  child,
  cwd: '/tmp/project',
  model,
  input: {
    prompt: 'continue the long-running thread',
    codexContextUsage: { inputTokens: 700, modelContextWindow: 1_000 },
  },
  goal: undefined,
  review: undefined,
  resumeSessionId: 'compact-thread',
  accessMode: 'full-access',
  callbacks: {
    onActivity: (activity) => activities.push(activity),
    onActionAccepted: () => {},
    onFatal: (error) => assert.fail(error),
    onGoal: () => {},
    onReasoning: () => {},
    onRunEnd: () => {
      runEnded += 1;
    },
    onSessionId: () => {},
    onStats: (stats) => statsEvents.push(stats),
    onText: () => {},
  },
});

await driver.start();
assert.deepEqual(
  requests.slice(0, 4).map((request) => request.method),
  ['initialize', 'thread/resume', 'thread/compact/start', 'turn/start'],
  'A resumed thread above the context threshold must compact before its user turn'
);
const contextActivities = activities.filter(
  (activity) => activity.key === 'codex-context-compaction'
);
assert.equal(contextActivities.length, 3, 'Compaction retries must update one keyed activity');
assert.equal(contextActivities.at(-1)?.status, 'done');
assert.equal(contextActivities.at(-1)?.title, 'Codex context optimized');
assert.equal(
  activities.some((activity) => activity.key === 'codex-response-retry'),
  false,
  'Internal compaction retries must not create a separate user-turn retry row'
);
assert.deepEqual(statsEvents.at(-1), {
  modelId: model.id,
  totalTokens: 700,
  inputTokens: 650,
  outputTokens: 50,
  contextTokens: 45,
  contextWindow: 1_000,
});

for (const status of [502, 503]) {
  driver.handleMessage({
    jsonrpc: '2.0',
    method: 'error',
    params: {
      threadId: 'compact-thread',
      error: {
        message: 'response stream disconnected',
        codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: status } },
      },
      willRetry: true,
    },
  });
}
const reconnecting = activities.filter((activity) => activity.key === 'codex-response-retry');
assert.equal(reconnecting.length, 2);
assert.ok(reconnecting.every((activity) => activity.status === 'running'));
assert.match(reconnecting.at(-1)?.detail ?? '', /HTTP 503/);
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'item/started',
  params: {
    threadId: 'compact-thread',
    turnId: 'user-turn',
    item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: [] },
  },
});
const recovered = activities.filter((activity) => activity.key === 'codex-response-retry');
assert.equal(recovered.length, 3);
assert.equal(recovered.at(-1)?.status, 'done');
assert.equal(recovered.at(-1)?.title, 'Codex reconnected');

driver.handleMessage({
  jsonrpc: '2.0',
  method: 'error',
  params: {
    threadId: 'compact-thread',
    error: {
      message: 'response stream disconnected',
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 504 } },
    },
    willRetry: true,
  },
});
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'error',
  params: {
    threadId: 'compact-thread',
    error: {
      message: 'response retry limit reached',
      codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 504 } },
    },
    willRetry: false,
  },
});
const failedReconnect = activities.filter(
  (activity) => activity.key === 'codex-response-retry'
);
assert.equal(failedReconnect.at(-1)?.status, 'error');
assert.equal(failedReconnect.at(-1)?.title, 'Codex reconnect failed');
assert.match(failedReconnect.at(-1)?.detail ?? '', /response too many failed attempts \(HTTP 504\)/);
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'turn/completed',
  params: { threadId: 'compact-thread', turn: { id: 'user-turn', status: 'completed' } },
});
assert.equal(runEnded, 1);

console.log('Codex context compaction and reconnect lifecycle tests passed.');
app.quit();
