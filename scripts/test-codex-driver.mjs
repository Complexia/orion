import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app } from 'electron';

import {
  codexErrorDetail,
  codexStatsFromTokenUsage,
  createCodexAppServerDriver,
  isRecoverableCodexContextError,
} from '../src/main/codex-driver.js';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(
  mainSource,
  /onSessionId: \(sessionId\) => \{\s*acceptedCodexSessionId = sessionId;\s*ensureCodexSpawnWatcher\(sessionId\);/,
  'fresh Codex app-server threads must start their filesystem spawn watcher from onSessionId'
);

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
assert.equal(
  isRecoverableCodexContextError({
    codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 504 } },
  }),
  true
);
assert.equal(
  isRecoverableCodexContextError({ codexErrorInfo: { unauthorized: null } }),
  false
);

const requests = [];
const activities = [];
const statsEvents = [];
const subagentEvents = [];
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
          ? { thread: { id: 'native-thread' } }
          : message.method === 'turn/start'
            ? { turn: { id: 'user-turn' } }
            : {};
      queueMicrotask(() => {
        driver.handleMessage({ jsonrpc: '2.0', id: message.id, result });
        if (message.method === 'turn/start') {
          driver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'native-thread', turn: { id: 'user-turn' } },
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
  input: { prompt: 'continue the long-running thread' },
  goal: undefined,
  review: undefined,
  resumeSessionId: 'native-thread',
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
    onSubagent: (subagent) => subagentEvents.push(subagent),
    onText: () => {},
  },
});

await driver.start();
assert.deepEqual(
  requests.map((request) => request.method),
  ['initialize', 'thread/resume', 'turn/start'],
  'Orion must delegate the initial compaction decision to turn/start'
);
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'item/started',
  params: {
    threadId: 'native-thread',
    turnId: 'user-turn',
    item: {
      id: 'spawn-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      prompt: 'Implement the durable ledger contract.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      receiverThreadIds: [],
      senderThreadId: 'native-thread',
      agentsStates: {},
      status: 'inProgress',
    },
  },
});
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'item/completed',
  params: {
    threadId: 'native-thread',
    turnId: 'user-turn',
    item: {
      id: 'spawn-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      prompt: null,
      model: null,
      reasoningEffort: null,
      receiverThreadIds: ['child-thread'],
      senderThreadId: 'native-thread',
      agentsStates: {},
      status: 'completed',
    },
  },
});
assert.deepEqual(subagentEvents, [
  {
    id: 'child-thread',
    prompt: 'Implement the durable ledger contract.',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
  },
]);
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'item/completed',
  params: {
    threadId: 'child-thread',
    turnId: 'child-turn',
    item: {
      id: 'spawn-2',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      prompt: 'Implement the Convex transaction layer.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      receiverThreadIds: ['grandchild-thread'],
      senderThreadId: 'child-thread',
      agentsStates: {},
      status: 'completed',
    },
  },
});
driver.handleMessage({
  jsonrpc: '2.0',
  method: 'item/completed',
  params: {
    threadId: 'unrelated-thread',
    turnId: 'unrelated-turn',
    item: {
      id: 'spawn-other',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      prompt: 'This belongs to another run.',
      receiverThreadIds: ['unrelated-child'],
      senderThreadId: 'unrelated-thread',
      agentsStates: {},
      status: 'completed',
    },
  },
});
assert.deepEqual(subagentEvents.at(-1), {
  id: 'grandchild-thread',
  prompt: 'Implement the Convex transaction layer.',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
});
assert.equal(
  subagentEvents.some((event) => event.id === 'unrelated-child'),
  false,
  'persistent app-server notifications from another run must remain isolated'
);

for (const completed of [false, true]) {
  driver.handleMessage({
    jsonrpc: '2.0',
    method: completed ? 'item/completed' : 'item/started',
    params: {
      threadId: 'native-thread',
      turnId: 'user-turn',
      item: { id: 'native-compaction', type: 'contextCompaction' },
    },
  });
}
const contextActivities = activities.filter((activity) => activity.kind === 'context');
assert.equal(contextActivities.length, 2, 'Native compaction must stream through its item lifecycle');
assert.equal(contextActivities.at(-1)?.status, 'done');
assert.equal(contextActivities.at(-1)?.title, 'Codex context optimized');

driver.handleMessage({
  jsonrpc: '2.0',
  method: 'thread/tokenUsage/updated',
  params: {
    threadId: 'native-thread',
    tokenUsage: {
      total: { totalTokens: 700, inputTokens: 650, outputTokens: 50 },
      last: { inputTokens: 45 },
      modelContextWindow: 1_000,
    },
  },
});
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
      threadId: 'native-thread',
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
    threadId: 'native-thread',
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
  method: 'turn/completed',
  params: { threadId: 'native-thread', turn: { id: 'user-turn', status: 'completed' } },
});
assert.equal(runEnded, 1);

const recoveryRequests = [];
const recoveryActivities = [];
let recoveryRunEnded = 0;
let recoveryDriver;
let userTurnNumber = 0;
const recoveryChild = {
  stdin: {
    write: (line) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      recoveryRequests.push(message);
      let result = {};
      if (message.method === 'thread/resume') result = { thread: { id: 'recovery-thread' } };
      if (message.method === 'turn/start') {
        userTurnNumber += 1;
        result = { turn: { id: `user-turn-${userTurnNumber}` } };
      }
      queueMicrotask(() => {
        recoveryDriver.handleMessage({ jsonrpc: '2.0', id: message.id, result });
        if (message.method === 'turn/start' && userTurnNumber === 1) {
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'recovery-thread', turn: { id: 'user-turn-1' } },
          });
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'error',
            params: {
              threadId: 'recovery-thread',
              error: {
                message: 'response retry limit reached',
                codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 504 } },
              },
              willRetry: false,
            },
          });
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: { threadId: 'recovery-thread', turn: { id: 'user-turn-1', status: 'failed' } },
          });
        } else if (message.method === 'thread/compact/start') {
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'recovery-thread', turn: { id: 'recovery-compaction-turn' } },
          });
          for (const completed of [false, true]) {
            recoveryDriver.handleMessage({
              jsonrpc: '2.0',
              method: completed ? 'item/completed' : 'item/started',
              params: {
                threadId: 'recovery-thread',
                turnId: 'recovery-compaction-turn',
                item: { id: 'recovery-compaction', type: 'contextCompaction' },
              },
            });
          }
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: 'recovery-thread',
              turn: { id: 'recovery-compaction-turn', status: 'completed' },
            },
          });
        } else if (message.method === 'turn/start' && userTurnNumber === 2) {
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'recovery-thread', turn: { id: 'user-turn-2' } },
          });
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'item/started',
            params: {
              threadId: 'recovery-thread',
              turnId: 'user-turn-2',
              item: { id: 'retry-reasoning', type: 'reasoning', summary: [], content: [] },
            },
          });
          recoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: { threadId: 'recovery-thread', turn: { id: 'user-turn-2', status: 'completed' } },
          });
        }
      });
    },
  },
};

recoveryDriver = createCodexAppServerDriver({
  child: recoveryChild,
  cwd: '/tmp/project',
  model,
  input: { prompt: 'retry this exact request' },
  goal: undefined,
  review: undefined,
  resumeSessionId: 'recovery-thread',
  accessMode: 'full-access',
  callbacks: {
    onActivity: (activity) => recoveryActivities.push(activity),
    onActionAccepted: () => {},
    onFatal: (error) => assert.fail(error),
    onGoal: () => {},
    onReasoning: () => {},
    onRunEnd: () => {
      recoveryRunEnded += 1;
    },
    onSessionId: () => {},
    onStats: () => {},
    onText: () => {},
  },
});

await recoveryDriver.start();
for (let attempt = 0; attempt < 50 && recoveryRunEnded === 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.deepEqual(
  recoveryRequests.map((request) => request.method),
  [
    'initialize',
    'thread/resume',
    'turn/start',
    'thread/rollback',
    'thread/compact/start',
    'turn/start',
  ],
  'A side-effect-free resumed turn failure must roll back, compact through app-server, and retry once'
);
const retriedPrompts = recoveryRequests
  .filter((request) => request.method === 'turn/start')
  .map((request) => request.params.input[0].text);
assert.deepEqual(retriedPrompts, ['retry this exact request', 'retry this exact request']);
assert.equal(
  recoveryActivities.some(
    (activity) => activity.title === 'Codex recovering context' && activity.status === 'running'
  ),
  true
);
assert.equal(
  recoveryActivities.some(
    (activity) => activity.title === 'Codex context optimized' && activity.status === 'done'
  ),
  true
);
assert.equal(recoveryRunEnded, 1);

const failedRecoveryRequests = [];
let failedRecoveryRunEnded = 0;
let failedRecoveryDriver;
const failedRecoveryChild = {
  stdin: {
    write: (line) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      failedRecoveryRequests.push(message);
      const response =
        message.method === 'thread/resume'
          ? { result: { thread: { id: 'failed-recovery-thread' } } }
          : message.method === 'thread/compact/start'
            ? { error: { message: 'compaction unavailable' } }
            : message.method === 'turn/start'
              ? { result: { turn: { id: 'failed-user-turn' } } }
              : { result: {} };
      queueMicrotask(() => {
        failedRecoveryDriver.handleMessage({ jsonrpc: '2.0', id: message.id, ...response });
        if (message.method !== 'turn/start') return;
        failedRecoveryDriver.handleMessage({
          jsonrpc: '2.0',
          method: 'turn/started',
          params: { threadId: 'failed-recovery-thread', turn: { id: 'failed-user-turn' } },
        });
        failedRecoveryDriver.handleMessage({
          jsonrpc: '2.0',
          method: 'error',
          params: {
            threadId: 'failed-recovery-thread',
            error: {
              message: 'context window exceeded',
              codexErrorInfo: 'contextWindowExceeded',
            },
            willRetry: false,
          },
        });
        failedRecoveryDriver.handleMessage({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { threadId: 'failed-recovery-thread', turn: { id: 'failed-user-turn', status: 'failed' } },
        });
      });
    },
  },
};

failedRecoveryDriver = createCodexAppServerDriver({
  child: failedRecoveryChild,
  cwd: '/tmp/project',
  model,
  input: { prompt: 'preserve this failed prompt' },
  goal: undefined,
  review: undefined,
  resumeSessionId: 'failed-recovery-thread',
  accessMode: 'full-access',
  callbacks: {
    onActivity: () => {},
    onActionAccepted: () => {},
    onFatal: (error) => assert.fail(error),
    onGoal: () => {},
    onReasoning: () => {},
    onRunEnd: () => {
      failedRecoveryRunEnded += 1;
    },
    onSessionId: () => {},
    onStats: () => {},
    onText: () => {},
  },
});

await failedRecoveryDriver.start();
for (let attempt = 0; attempt < 50 && failedRecoveryRunEnded === 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.deepEqual(
  failedRecoveryRequests.map((request) => request.method),
  [
    'initialize',
    'thread/resume',
    'turn/start',
    'thread/rollback',
    'thread/compact/start',
    'thread/inject_items',
  ],
  'A failed fallback compaction must restore the rolled-back user prompt'
);
assert.equal(
  failedRecoveryRequests.at(-1)?.params.items[0].content[0].text,
  'preserve this failed prompt'
);
assert.equal(failedRecoveryRunEnded, 1);

const cancelledRecoveryRequests = [];
let cancelledRecoveryDriver;
let completeCancelledPromptRestore = null;
const cancelledRecoveryChild = {
  stdin: {
    write: (line) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      cancelledRecoveryRequests.push(message);
      let result = {};
      if (message.method === 'thread/resume') {
        result = { thread: { id: 'cancelled-recovery-thread' } };
      } else if (message.method === 'turn/start') {
        result = { turn: { id: 'cancelled-user-turn' } };
      }
      if (message.method === 'thread/inject_items') {
        completeCancelledPromptRestore = () =>
          cancelledRecoveryDriver.handleMessage({ jsonrpc: '2.0', id: message.id, result });
        return;
      }
      if (message.method === 'thread/compact/start') {
        // Simulate an app-server that stops responding while recovery is
        // awaiting its compaction RPC. Disposal must release this request
        // before it waits for the recovery task to finish.
        return;
      }
      queueMicrotask(() => {
        cancelledRecoveryDriver.handleMessage({ jsonrpc: '2.0', id: message.id, result });
        if (message.method === 'turn/start') {
          cancelledRecoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: {
              threadId: 'cancelled-recovery-thread',
              turn: { id: 'cancelled-user-turn' },
            },
          });
          cancelledRecoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'error',
            params: {
              threadId: 'cancelled-recovery-thread',
              error: {
                message: 'context window exceeded',
                codexErrorInfo: 'contextWindowExceeded',
              },
              willRetry: false,
            },
          });
          cancelledRecoveryDriver.handleMessage({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: 'cancelled-recovery-thread',
              turn: { id: 'cancelled-user-turn', status: 'failed' },
            },
          });
        }
      });
    },
  },
};

cancelledRecoveryDriver = createCodexAppServerDriver({
  child: cancelledRecoveryChild,
  cwd: '/tmp/project',
  model,
  input: { prompt: 'restore this prompt when stopped' },
  goal: undefined,
  review: undefined,
  resumeSessionId: 'cancelled-recovery-thread',
  accessMode: 'full-access',
  callbacks: {
    onActivity: () => {},
    onActionAccepted: () => {},
    onFatal: (error) => assert.fail(error),
    onGoal: () => {},
    onReasoning: () => {},
    onRunEnd: () => assert.fail('Disposal must not finish an already cancelled run'),
    onSessionId: () => {},
    onStats: () => {},
    onText: () => {},
  },
});

await cancelledRecoveryDriver.start();
for (
  let attempt = 0;
  attempt < 50 &&
  !cancelledRecoveryRequests.some((request) => request.method === 'thread/compact/start');
  attempt += 1
) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
let cancellationDisposed = false;
const cancellationDisposal = cancelledRecoveryDriver.dispose().then(() => {
  cancellationDisposed = true;
});
for (
  let attempt = 0;
  attempt < 50 &&
  !cancelledRecoveryRequests.some((request) => request.method === 'thread/inject_items');
  attempt += 1
) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(cancellationDisposed, false, 'Disposal must wait for prompt restoration to persist');
completeCancelledPromptRestore?.();
let cancellationTimeout = null;
await Promise.race([
  cancellationDisposal,
  new Promise((_, reject) => {
    cancellationTimeout = setTimeout(
      () => reject(new Error('Disposal hung on the unresponsive recovery RPC')),
      1000
    );
  }),
]);
if (cancellationTimeout) clearTimeout(cancellationTimeout);
assert.deepEqual(
  cancelledRecoveryRequests.map((request) => request.method),
  [
    'initialize',
    'thread/resume',
    'turn/start',
    'thread/rollback',
    'thread/compact/start',
    'turn/interrupt',
    'thread/inject_items',
  ],
  'Disposal during recovery compaction must restore the rolled-back prompt before disconnecting'
);
assert.equal(
  cancelledRecoveryRequests.at(-1)?.params.items[0].content[0].text,
  'restore this prompt when stopped'
);

console.log('Codex native compaction and context recovery lifecycle tests passed.');
app.quit();
