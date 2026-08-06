import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  claudeBackgroundRunSessions,
  claudeSdkSessions,
  createClaudeTurnState,
  finalizeClaudeTurn,
  steerClaudeSdkRun,
} from '../src/main/claude-driver.js';
import { createThreadSteeringCoordinator } from '../src/app/thread-steering.js';

const [appSource, claudeDriverSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/claude-driver.js', import.meta.url), 'utf8'),
]);

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const steerRenderer = section(
  appSource,
  '  const performSteerWithContent = async (',
  '  // Composer ⚡ / ⌘⏎'
);
const refreshIndex = steerRenderer.indexOf('await refreshLinkedTasksBeforeDispatch(threadId);');
const dispatchIndex = steerRenderer.indexOf('window.orion?.steerAgentTurn?.(');
assert.ok(
  refreshIndex >= 0 && refreshIndex < dispatchIndex,
  'Steering must refresh linked Board tasks before dispatching the live input'
);
for (const requiredContext of [
  'buildLinkedTaskContext(',
  'buildModelMentionsContext(',
  'buildThreadMentionsContext(',
]) {
  assert.match(
    steerRenderer,
    new RegExp(requiredContext.replace('(', '\\(')),
    `Steering must preserve ${requiredContext.slice(0, -1)} dispatch context`
  );
}
assert.match(
  steerRenderer,
  /flushOrionThreadsSave\(\)/,
  'Steering with @thread references must flush the transcript snapshot before exposing thread ids'
);
assert.match(
  steerRenderer,
  /linkedTaskMediaAttachments\(tasksToInject\)[\s\S]*injected: true/,
  'A successful steer must retain Board media in the transcript and consume its task context once'
);
assert.match(
  steerRenderer,
  /activeRunsByThreadRef\.current\[threadId\] !== target\.runId[\s\S]*window\.orion\?\.steerAgentTurn/,
  'Steering must recheck exact run ownership after async preparation and before IPC dispatch'
);
assert.match(
  steerRenderer,
  /steerAgentTurn[\s\S]*if \(cancelled\(\)\) return;[\s\S]*if \(!injected\)/,
  'A Stop generation must suppress both late IPC success and fallback queueing'
);
const stopThreadTree = section(
  appSource,
  '  const stopThreadTree = async ({',
  '  const stopActiveAgent = async () =>'
);
assert.ok(
  stopThreadTree.indexOf('cancelPendingSteers(threadIds);') >= 0 &&
    stopThreadTree.indexOf('cancelPendingSteers(threadIds);') < stopThreadTree.indexOf('clearActiveRun(runId);'),
  'Stop must invalidate pending steers before clearing active run ownership'
);

const coordinator = createThreadSteeringCoordinator();
const releaseFirst = {};
releaseFirst.promise = new Promise((resolve) => {
  releaseFirst.resolve = resolve;
});
const order = [];
const first = coordinator.enqueue('thread-serial', async (cancelled) => {
  order.push('first:start');
  await releaseFirst.promise;
  order.push(cancelled() ? 'first:cancelled' : 'first:dispatch');
});
const second = coordinator.enqueue('thread-serial', async (cancelled) => {
  order.push('second:start');
  order.push(cancelled() ? 'second:cancelled' : 'second:dispatch');
});
await Promise.resolve();
assert.deepEqual(order, ['first:start'], 'A second steer must wait behind the first thread reservation');
coordinator.cancel(['thread-serial']);
const afterStop = coordinator.enqueue('thread-serial', async (cancelled) => {
  order.push(cancelled() ? 'after-stop:cancelled' : 'after-stop:dispatch');
});
await afterStop;
assert.deepEqual(
  order,
  ['first:start', 'after-stop:dispatch'],
  'A new run generation must not wait behind stale steering work from before Stop'
);
releaseFirst.resolve();
await Promise.all([first, second]);
assert.deepEqual(
  order,
  ['first:start', 'after-stop:dispatch', 'first:cancelled', 'second:start', 'second:cancelled'],
  'Stop must invalidate both an in-flight steer and a steer already queued behind it'
);

const independent = createThreadSteeringCoordinator();
const independentOrder = [];
const left = independent.enqueue('left', async () => independentOrder.push('left'));
const right = independent.enqueue('right', async () => independentOrder.push('right'));
await Promise.all([left, right]);
assert.deepEqual(new Set(independentOrder), new Set(['left', 'right']), 'Steering reservations must be per thread');

const createSession = ({ threadId, runId, retained = false }) => {
  const events = [];
  const pushed = [];
  const session = {
    threadId,
    activeTurns: retained ? [] : [createClaudeTurnState(runId, { baseline: runId })],
    backgroundRunId: retained ? runId : null,
    backgroundSettleTimer: retained ? setTimeout(() => {}, 60_000) : null,
    backgroundTasks: new Map(),
    skipTranscriptTaskIds: new Set(),
    pendingSuggestionRunId: 'older-turn',
    pendingTaskNotifications: [],
    lastTurnEndSnapshot: { baseline: 'background' },
    resultsOwed: 1,
    ended: false,
    disposed: false,
    query: {},
    sender: {
      isDestroyed: () => false,
      send: (_channel, event) => events.push(event),
    },
    pushUserMessage: (text, { expectResult = true } = {}) => {
      if (expectResult) session.resultsOwed += 1;
      pushed.push(text);
    },
  };
  return { session, events, pushed };
};

claudeSdkSessions.clear();
claudeBackgroundRunSessions.clear();

const active = createSession({ threadId: 'thread-active', runId: 'run-active' });
claudeSdkSessions.set(active.session.threadId, active.session);
assert.equal(steerClaudeSdkRun('run-active', 'change direction'), true);
assert.equal(active.session.activeTurns.length, 1, 'An active steer must reuse the running result owner');
assert.equal(active.session.resultsOwed, 1, 'A folded steer must not reserve a second SDK result');
assert.deepEqual(active.pushed, ['change direction']);
assert.equal(active.session.backgroundSettleTimer, null, 'A live steer must disarm background settlement');
assert.equal(active.session.pendingSuggestionRunId, null, 'A steer supersedes the prior suggestion owner');
assert.equal(active.events.length, 0, 'An already tracked foreground run does not need a synthetic start');
active.session.resultsOwed -= 1;
await finalizeClaudeTurn(active.session, {
  usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 },
});
assert.equal(active.session.activeTurns.length, 0, 'One folded result must fully settle the visible run');
assert.equal(active.session.resultsOwed, 0, 'One folded result must clear all result debt');
assert.equal(active.events.length, 1, 'The folded result must emit a terminal event');
assert.equal(active.events[0]?.type, 'done');
assert.deepEqual(active.events[0]?.stats, {
  totalTokens: 16,
  inputTokens: 12,
  outputTokens: 4,
  cachedReadTokens: 2,
});

const retained = createSession({
  threadId: 'thread-retained',
  runId: 'run-retained',
  retained: true,
});
retained.session.resultsOwed = 0;
claudeSdkSessions.set(retained.session.threadId, retained.session);
claudeBackgroundRunSessions.set('run-retained', retained.session);
assert.equal(steerClaudeSdkRun('run-retained', 'follow up'), true);
assert.equal(retained.session.backgroundRunId, null, 'Steering must consume the retained background handle');
assert.equal(
  claudeBackgroundRunSessions.has('run-retained'),
  false,
  'A retained handle must not settle independently after steering starts'
);
assert.equal(retained.session.backgroundSettleTimer, null, 'Retained-run steering must cancel its armed timer');
assert.equal(retained.session.activeTurns.length, 1, 'Retained-run steering must reserve a real active turn');
assert.equal(retained.session.resultsOwed, 1);
assert.equal(retained.events[0]?.type, 'started', 'The renderer must receive an owner for retained-run output');
assert.equal(retained.events[0]?.runId, 'run-retained');

assert.match(
  claudeDriverSource,
  /if \(activeOwner\) \{[\s\S]*pushUserMessage\(text, \{ expectResult: false \}\)[\s\S]*return true;/,
  'An active steer must push into the current result boundary without adding a continuation owner'
);

for (const { session } of [active, retained]) {
  if (session.backgroundSettleTimer) clearTimeout(session.backgroundSettleTimer);
}
claudeSdkSessions.clear();
claudeBackgroundRunSessions.clear();

console.log('Steering context and lifecycle checks passed.');
