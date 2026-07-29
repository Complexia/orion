import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const sourceUrl = new URL('../src/app/authRetry.ts', import.meta.url);
const source = await fs.readFile(sourceUrl, 'utf8');
const transformed = await transformWithEsbuild(source, sourceUrl.pathname, {
  loader: 'ts',
  format: 'esm',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
const {
  authRetryThreadIdsForWorkingDir,
  consumeAuthRetryAttempt,
  dispatchAuthRetryPayload,
  filterUsableAuthRetryTargets,
  findExactAuthRetryModel,
  findRetryableAuthMessage,
  linkedTasksForTurnDispatch,
  recoverAuthRetryAttempt,
  resolveAuthRetryTargets,
  retireAuthRetryTargets,
} = await import(moduleUrl);

const workspaceThreads = [
  { id: 'thread-selected', workingDir: '/repo/app' },
  { id: 'thread-shared', workingDir: '/repo/app/' },
  { id: 'thread-windows', workingDir: '\\repo\\app' },
  { id: 'thread-other', workingDir: '/repo/other' },
  { id: 'thread-unavailable', workingDir: null },
];
assert.deepEqual(
  authRetryThreadIdsForWorkingDir(
    workspaceThreads,
    '/repo/app/',
    (thread) => thread.workingDir
  ),
  ['thread-selected', 'thread-shared', 'thread-windows'],
  'branch transitions must retire every thread sharing the normalized working directory'
);

const retirementAttempts = new Map([
  [
    'attempt-shared',
    {
      providerId: 'codex',
      targets: [
        { threadId: 'thread-moving', messageId: 'run-moving' },
        { threadId: 'thread-staying', messageId: 'run-staying' },
      ],
    },
  ],
]);
const retirementQueues = new Map([
  [
    'thread-moving',
    [
      {
        providerId: 'codex',
        target: { threadId: 'thread-moving', messageId: 'run-ready' },
      },
    ],
  ],
  [
    'thread-staying',
    [
      {
        providerId: 'codex',
        target: { threadId: 'thread-staying', messageId: 'run-staying-ready' },
      },
    ],
  ],
]);
assert.equal(
  retireAuthRetryTargets(retirementAttempts, retirementQueues, ['thread-moving']),
  2,
  'retirement must count pending and ready retries for the affected thread'
);
assert.deepEqual(
  retirementAttempts.get('attempt-shared').targets,
  [{ threadId: 'thread-staying', messageId: 'run-staying' }],
  'retirement must remove affected targets from shared authentication attempts'
);
assert.equal(
  retirementQueues.has('thread-moving'),
  false,
  'retirement must drop the affected thread retry queue'
);
assert.equal(
  retirementQueues.has('thread-staying'),
  true,
  'retirement must preserve unrelated thread retries'
);

const pendingAttempts = new Map([
  [
    'attempt-stale',
    {
      providerId: 'codex',
      targets: [{ threadId: 'thread-stale', messageId: 'run-stale' }],
    },
  ],
  [
    'attempt-current',
    {
      providerId: 'codex',
      targets: [
        { threadId: 'thread-current', messageId: 'run-current-1' },
        { threadId: 'thread-current', messageId: 'run-current-2' },
      ],
    },
  ],
]);
assert.deepEqual(
  consumeAuthRetryAttempt(pendingAttempts, 'attempt-stale', 'codex'),
  [{ threadId: 'thread-stale', messageId: 'run-stale' }],
  'an authentication outcome must consume only its own retry targets'
);
assert.equal(
  pendingAttempts.has('attempt-stale'),
  false,
  'failed authentication outcomes can discard their consumed target'
);
assert.equal(
  pendingAttempts.has('attempt-current'),
  true,
  'an unrelated later authentication attempt must remain pending'
);
assert.deepEqual(
  consumeAuthRetryAttempt(pendingAttempts, 'attempt-current', 'codex'),
  [
    { threadId: 'thread-current', messageId: 'run-current-1' },
    { threadId: 'thread-current', messageId: 'run-current-2' },
  ],
  'multiple failures can share one authentication attempt without losing order'
);

const retryModels = [
  { id: 'grok:grok-4.5', label: 'Default' },
  { id: 'codex:gpt-5', label: 'Original' },
];
assert.equal(
  findExactAuthRetryModel(retryModels, 'codex:removed-model'),
  undefined,
  'authentication retries must not fall back when the original model is missing'
);
assert.equal(
  findExactAuthRetryModel(retryModels, 'codex:gpt-5'),
  retryModels[1],
  'authentication retries must resolve the exact persisted model'
);

const validRetryMessage = {
  id: 'run-valid',
  role: 'agent',
  content: '',
  ts: '2026-07-29T00:00:00.000Z',
  kind: 'agent-run',
  status: 'error',
  authProviderId: 'codex',
  authRetryPayload: {
    kind: 'turn',
    modelId: 'codex:gpt-5',
    prompt: 'resume me',
    attachments: [],
  },
};
const missingModelRetryMessage = {
  ...validRetryMessage,
  id: 'run-missing-model',
  authRetryPayload: {
    ...validRetryMessage.authRetryPayload,
    modelId: 'codex:removed-model',
  },
};
const unavailableModelRetryMessage = {
  ...validRetryMessage,
  id: 'run-unavailable-model',
  authRetryPayload: {
    ...validRetryMessage.authRetryPayload,
    modelId: 'codex:unavailable-model',
  },
};
assert.deepEqual(
  filterUsableAuthRetryTargets(
    [
      { threadId: 'thread-valid', messageId: 'run-valid' },
      { threadId: 'thread-deleted', messageId: 'run-deleted' },
      { threadId: 'thread-valid', messageId: 'run-deleted' },
      { threadId: 'thread-valid', messageId: 'run-missing-model' },
      { threadId: 'thread-valid', messageId: 'run-unavailable-model' },
    ],
    [
      {
        id: 'thread-valid',
        messages: [
          validRetryMessage,
          missingModelRetryMessage,
          unavailableModelRetryMessage,
        ],
      },
    ],
    'codex',
    [...retryModels, { id: 'codex:unavailable-model', available: false }]
  ),
  [{ threadId: 'thread-valid', messageId: 'run-valid' }],
  'stale targets must be discarded without blocking remaining usable retries'
);

const dynamicCursorRetryMessage = {
  ...validRetryMessage,
  id: 'run-dynamic-cursor',
  authProviderId: 'cursor',
  authRetryAttemptId: 'attempt-dynamic-cursor',
  authRetryPayload: {
    ...validRetryMessage.authRetryPayload,
    modelId: 'cursor:account-only-model',
  },
};
const dynamicCursorThread = {
  id: 'thread-dynamic-cursor',
  messages: [dynamicCursorRetryMessage],
};
const dynamicCursorTarget = {
  threadId: dynamicCursorThread.id,
  messageId: dynamicCursorRetryMessage.id,
};
assert.deepEqual(
  resolveAuthRetryTargets(
    [dynamicCursorTarget],
    [dynamicCursorThread],
    'cursor',
    [{ id: 'cursor:composer-2.5' }],
    true
  ),
  {
    usableTargets: [],
    undiscoveredTargets: [dynamicCursorTarget],
  },
  'a fallback Cursor catalog must retain an undiscovered exact model for delayed discovery'
);
assert.deepEqual(
  resolveAuthRetryTargets(
    [dynamicCursorTarget],
    [dynamicCursorThread],
    'cursor',
    [{ id: 'cursor:composer-2.5' }]
  ),
  {
    usableTargets: [],
    undiscoveredTargets: [],
  },
  'missing dynamic models become discardable outside the discovery retry window'
);
assert.deepEqual(
  recoverAuthRetryAttempt(
    [
      dynamicCursorThread,
      {
        id: 'thread-unrelated-attempt',
        messages: [
          {
            ...dynamicCursorRetryMessage,
            id: 'run-unrelated-attempt',
            authRetryAttemptId: 'attempt-other',
          },
        ],
      },
    ],
    'attempt-dynamic-cursor',
    'cursor'
  ),
  {
    providerId: 'cursor',
    targets: [dynamicCursorTarget],
  },
  'renderer reload recovery must use the persisted exact attempt association'
);

const taskLinkedDuringLogin = {
  id: 'task-new',
  title: 'New task',
  description: 'Must remain pending',
  injected: false,
};
assert.deepEqual(
  linkedTasksForTurnDispatch([taskLinkedDuringLogin], true),
  [],
  'an authentication replay must not consume tasks linked during login'
);
assert.equal(
  taskLinkedDuringLogin.injected,
  false,
  'selecting tasks for an authentication replay must not mutate pending tasks'
);
assert.deepEqual(
  linkedTasksForTurnDispatch([taskLinkedDuringLogin], false),
  [taskLinkedDuringLogin],
  'an ordinary turn must still inject pending linked tasks'
);

const taskOnlyPayload = {
  kind: 'turn',
  modelId: 'codex:gpt-5',
  prompt: '<linked_tasks><task>Task-only context</task></linked_tasks>',
  attachments: [],
};
const oldFailure = {
  id: 'run-old',
  role: 'agent',
  content: '',
  ts: '2026-07-29T00:00:00.000Z',
  kind: 'agent-run',
  status: 'error',
  authProviderId: 'codex',
  authRetryPayload: taskOnlyPayload,
};
const latestFailure = {
  ...oldFailure,
  id: 'run-latest',
  authRetryPayload: {
    kind: 'review',
    modelId: 'codex:gpt-5',
    rawText: '/review',
    prompt: 'Code review (uncommitted changes)',
    review: { mode: 'uncommitted', threadContext: 'newer review context' },
  },
};
const thread = {
  id: 'thread-1',
  messages: [oldFailure, latestFailure],
};
assert.equal(
  findRetryableAuthMessage(
    thread,
    { threadId: thread.id, messageId: oldFailure.id },
    'codex'
  ),
  oldFailure,
  'the clicked historical failure must win over the latest thread message'
);
assert.equal(
  findRetryableAuthMessage(
    thread,
    { threadId: thread.id, messageId: oldFailure.id },
    'claude'
  ),
  undefined,
  'a login must not replay a failure from another provider'
);

const dispatched = [];
const dispatchers = {
  turn: async (payload) => {
    dispatched.push(['turn', payload]);
    return { ok: true };
  },
  goal: (payload) => {
    dispatched.push(['goal', payload]);
    return { ok: true };
  },
  review: (payload) => {
    dispatched.push(['review', payload]);
    return { ok: true };
  },
};
await dispatchAuthRetryPayload(taskOnlyPayload, dispatchers);
await dispatchAuthRetryPayload(
  {
    kind: 'goal',
    modelId: 'codex:gpt-5',
    rawText: '/goal ship it',
    prompt: 'ship it',
    goal: { action: 'set', objective: 'ship it', tokenBudget: 500_000 },
  },
  dispatchers
);
await dispatchAuthRetryPayload(latestFailure.authRetryPayload, dispatchers);
assert.deepEqual(
  dispatched.map(([kind]) => kind),
  ['turn', 'goal', 'review'],
  'authentication retries must retain and redispatch the original run kind'
);
assert.equal(
  dispatched[0][1].prompt,
  taskOnlyPayload.prompt,
  'task-only retries must use persisted linked-task context after restart'
);
assert.equal(
  dispatched[2][1].review.threadContext,
  'newer review context',
  'review retries must preserve their frozen Codex review payload'
);

const appSource = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const storeSource = await fs.readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const providerUpdatesSource = await fs.readFile(
  new URL('../src/main/provider-updates.js', import.meta.url),
  'utf8'
);
const authenticationCompletedIndex = appSource.indexOf(
  'onProviderAuthenticationCompleted((event) =>'
);
const authenticationCompletedSource = appSource.slice(
  authenticationCompletedIndex,
  appSource.indexOf(
    '  // Claude Code CLI terminal threads:',
    authenticationCompletedIndex
  )
);
assert.notEqual(
  authenticationCompletedIndex,
  -1,
  'expected the provider authentication completion handler'
);
const queueAuthenticatedRetriesIndex = appSource.indexOf('const queueAuthenticatedRetries = useCallback(');
const queueAuthenticatedRetriesSource = appSource.slice(
  queueAuthenticatedRetriesIndex,
  appSource.indexOf('useEffect(() => {', queueAuthenticatedRetriesIndex)
);
assert.notEqual(
  queueAuthenticatedRetriesIndex,
  -1,
  'expected the authenticated retry catalog gate'
);
assert.ok(
  queueAuthenticatedRetriesSource.indexOf('const refreshedModels = await refreshAgentModels(true)') <
    queueAuthenticatedRetriesSource.indexOf('if (refreshedModels == null) return false;') &&
    queueAuthenticatedRetriesSource.indexOf('if (refreshedModels == null) return false;') <
      queueAuthenticatedRetriesSource.indexOf('resolveAuthRetryTargets(') &&
    queueAuthenticatedRetriesSource.indexOf('resolveAuthRetryTargets(') <
      queueAuthenticatedRetriesSource.indexOf('pending.targets = undiscoveredTargets') &&
    queueAuthenticatedRetriesSource.indexOf('pending.targets = undiscoveredTargets') <
      queueAuthenticatedRetriesSource.indexOf('consumeAuthRetryAttempt(') &&
    queueAuthenticatedRetriesSource.indexOf('consumeAuthRetryAttempt(') <
      queueAuthenticatedRetriesSource.indexOf('queue.push({ providerId, target })'),
  'discovery must retain unresolved dynamic targets and queue independently usable targets'
);
assert.doesNotMatch(
  queueAuthenticatedRetriesSource,
  /pending\.targets\.every\(/,
  'one stale target must not gate the complete authentication retry batch'
);
assert.match(
  authenticationCompletedSource,
  /pending\.authenticationCompleted = true;[\s\S]*queueAuthenticatedRetries\(event\.attemptId, event\.providerId\)[\s\S]*setTimeout\(resolve, 1_000\)[\s\S]*queueAuthenticatedRetries\(event\.attemptId, event\.providerId\)/,
  'a transient post-login model discovery failure must retain and retry the automatic replay'
);
assert.doesNotMatch(
  queueAuthenticatedRetriesSource,
  /pendingAuthRetriesRef\.current\.delete\(/,
  'failed model discovery must not delete the completed retry attempt'
);
assert.match(
  queueAuthenticatedRetriesSource,
  /resolveAuthRetryTargets\([\s\S]*refreshedModels,[\s\S]*true[\s\S]*pending\.targets = undiscoveredTargets[\s\S]*return undiscoveredTargets\.length === 0/,
  'fallback discovery must keep missing dynamic targets available for the delayed retry'
);
assert.match(
  authenticationCompletedSource,
  /waitForOrionStoreHydration\(\)[\s\S]*recoverAuthRetryAttempt\([\s\S]*pendingAuthRetriesRef\.current\.set\(event\.attemptId, pending\)/,
  'authentication completion after renderer reload must recover the persisted attempt targets'
);
assert.match(
  storeSource,
  /authRetryAttemptId\?: string;/,
  'the message schema must persist the authentication attempt association'
);
const authenticateProviderIndex = appSource.indexOf('const handleAuthenticateProvider = useCallback(');
const authenticateProviderSource = appSource.slice(
  authenticateProviderIndex,
  appSource.indexOf('\n  useEffect(() => {', authenticateProviderIndex)
);
assert.match(
  authenticateProviderSource,
  /authRetryAttemptId: attemptId/,
  'launching authentication must persist the attempt id on the clicked failed message'
);

const retryAuthFailureIndex = appSource.indexOf('const retryAuthFailure = useCallback(');
const retryAuthFailureSource = appSource.slice(
  retryAuthFailureIndex,
  appSource.indexOf('useEffect(() => {', retryAuthFailureIndex)
);
assert.notEqual(retryAuthFailureIndex, -1, 'expected the authentication retry dispatcher');
assert.match(
  retryAuthFailureSource,
  /const reservesThreadStart = retryPayload\.kind !== 'turn';[\s\S]*pendingTurnStartsRef\.current\.add\(target\.threadId\);[\s\S]*await dispatchAuthRetryPayload\(/,
  'goal and review retries must reserve the thread before synchronous dispatch'
);
assert.match(
  retryAuthFailureSource,
  /finally \{[\s\S]*pendingTurnStartsRef\.current\.delete\(target\.threadId\);/,
  'authentication retry thread reservations must always be released'
);
assert.match(
  retryAuthFailureSource,
  /isRetryStillCurrent[\s\S]*startTurnForThread\(target\.threadId, '', \[\], \{[\s\S]*isRetryStillCurrent/,
  'dequeued turn retries must revalidate their generation after linked-task refresh'
);

for (const statusText of [
  'Stopped because the thread left its epic rift.',
  'Stopped because the epic rift was removed.',
  'Stopped by the orchestrator.',
  'Interrupted — steered to a new instruction.',
  'Stopped by user.',
]) {
  const statusIndex = appSource.indexOf(`statusText: '${statusText}'`);
  assert.notEqual(statusIndex, -1, `expected stopped path: ${statusText}`);
  assert.match(
    appSource.slice(statusIndex, statusIndex + 180),
    /authRetryPayload: undefined/,
    `${statusText} must retire its replay payload`
  );
}
assert.match(
  storeSource.slice(
    storeSource.indexOf("statusText: 'Interrupted by app restart.'"),
    storeSource.indexOf("statusText: 'Interrupted by app restart.'") + 180
  ),
  /authRetryPayload: undefined/,
  'restart recovery must retire replay payloads from stopped runs'
);

const ordinaryDispatchRetirements =
  appSource.match(/retireAuthRetriesForThreads\(\[threadId\]\);/g) ?? [];
assert.equal(
  ordinaryDispatchRetirements.length,
  3,
  'turn, goal, and review user dispatches must all supersede pending authentication retries'
);
assert.match(
  appSource.slice(
    appSource.indexOf('const handleRemoveThreadFromEpic = async'),
    appSource.indexOf('// Confirms and deletes an epic.')
  ),
  /retireAuthRetriesForThreads\(\[thread\.id\], true\)/,
  'detaching a thread must retire pending retries and persisted replay payloads'
);
assert.match(
  appSource.slice(
    appSource.indexOf('const runtimeThreads = state.threads.filter'),
    appSource.indexOf('deleteEpic(currentEpic.id', appSource.indexOf('const runtimeThreads = state.threads.filter'))
  ),
  /retireAuthRetriesForThreads\(removalThreadIds, true\)/,
  'removing a Rift must retire retries for every affected runtime thread'
);
assert.match(
  appSource.slice(
    appSource.indexOf('const finalizeReleasedRifts = useCallback'),
    appSource.indexOf('// Rift storage.', appSource.indexOf('const finalizeReleasedRifts = useCallback'))
  ),
  /retireAuthRetriesForThreads\([\s\S]*threadsToFinalize\.map\(\(thread\) => thread\.id\),[\s\S]*true[\s\S]*\);[\s\S]*agentSessionIds: undefined/,
  'finalizing a released Rift must retire every affected runtime thread retry before clearing sessions'
);
for (const [handlerName, nextHandlerMarker] of [
  ['handleCheckoutBranch', 'const handleCreateBranch'],
  ['handleCreateBranch', 'const handleCommitAndPush'],
]) {
  const handlerIndex = appSource.indexOf(`const ${handlerName} = async`);
  const handlerSource = appSource.slice(
    handlerIndex,
    appSource.indexOf(nextHandlerMarker, handlerIndex)
  );
  assert.notEqual(handlerIndex, -1, `expected ${handlerName}`);
  assert.ok(
    handlerSource.indexOf('suspendAuthRetriesForWorkingDir(activeWorkingDir)') <
      handlerSource.indexOf('window.orion.checkoutGitBranch({') &&
      handlerSource.indexOf('window.orion.checkoutGitBranch({') <
        handlerSource.indexOf('retireAuthRetriesForWorkingDir(activeWorkingDir)') &&
      handlerSource.indexOf('retireAuthRetriesForWorkingDir(activeWorkingDir)') <
        handlerSource.indexOf('resumeAuthRetriesForThreads(suspendedAuthRetryThreadIds)'),
    `${handlerName} must suspend retries during checkout, retire only on success, and resume afterward`
  );
}
assert.match(
  appSource.slice(
    appSource.indexOf('const stopActiveAgent = async'),
    appSource.indexOf('// Track the composer', appSource.indexOf('const stopActiveAgent = async'))
  ),
  /retireAuthRetriesForThreads\(threadIds\);[\s\S]*for \(const \{ threadId: runThreadId, runId \} of runsToStop\)/,
  'stopping a thread subtree must retire pending authentication retries before clearing runs'
);
for (const [startMarker, endMarker, retirementPattern, firstRunSnapshotPattern, description] of [
  [
    'const deleteThreadWithRuntime = useCallback',
    'const removeProjectWithRuntimes = useCallback',
    /retireAuthRetriesForThreads\(threadIds, true\)/,
    /const runIds: string\[\] = \[\]/,
    'thread deletion',
  ],
  [
    'const removeProjectWithRuntimes = useCallback',
    'const refreshAgentModels = useCallback',
    /retireAuthRetriesForThreads\([\s\S]*projectThreads\.map\(\(thread\) => thread\.id\),[\s\S]*true[\s\S]*\)/,
    /const runIds = projectThreads/,
    'project deletion',
  ],
]) {
  const source = appSource.slice(
    appSource.indexOf(startMarker),
    appSource.indexOf(endMarker, appSource.indexOf(startMarker))
  );
  assert.ok(
    source.search(retirementPattern) !== -1 &&
      source.search(retirementPattern) < source.search(firstRunSnapshotPattern) &&
      source.search(firstRunSnapshotPattern) < source.indexOf('await Promise.all'),
    `${description} must retire every retry before capturing or asynchronously stopping runs`
  );
}
const stopTrackedGoalRunSource = appSource.slice(
  appSource.indexOf('const stopTrackedGoalRun = async'),
  appSource.indexOf('// `/goal <objective>', appSource.indexOf('const stopTrackedGoalRun = async'))
);
assert.ok(
  stopTrackedGoalRunSource.indexOf('retireAuthRetriesForThreads([tracked.threadId])') <
    stopTrackedGoalRunSource.indexOf('runOutputMessages.current.delete(runId)'),
  'goal pause/clear must retire queued retries before untracking the resumed run'
);
const stopSubagentsSource = appSource.slice(
  appSource.indexOf('const stopSubagentsForRequest = useCallback'),
  appSource.indexOf('const stopSubagentsForRequestRef', appSource.indexOf('const stopSubagentsForRequest = useCallback'))
);
assert.ok(
  stopSubagentsSource.indexOf('retireAuthRetriesForThreads(threadIds)') <
    stopSubagentsSource.indexOf('const stoppedThreads ='),
  'orchestrator subagent stops must retire queued retries before clearing runs'
);
assert.match(
  retryAuthFailureSource,
  /result = await dispatchAuthRetryPayload\([\s\S]*if \(result\.cancelled\) return result;[\s\S]*result\.ok[\s\S]*authProviderId: undefined,[\s\S]*authRetryPayload: undefined/,
  'the logged-out marker must be retired only after redispatch succeeds'
);
assert.match(
  retryAuthFailureSource,
  /result\.ok[\s\S]*authProviderId: providerId,[\s\S]*authRetryPayload: retryPayload/,
  'redispatch failures must retain the exact authentication retry payload'
);
assert.match(
  retryAuthFailureSource,
  /Authentication succeeded, but the request could not be resumed\./,
  'redispatch failures must be represented separately from authentication failures'
);
const authQueueDrainSource = appSource.slice(
  appSource.indexOf('// Drain at most one authentication replay per idle thread.'),
  appSource.indexOf('// Dismissing a still-running aside', appSource.indexOf('// Drain at most one authentication replay per idle thread.'))
);
assert.match(
  authQueueDrainSource,
  /const next = queue\[0\];[\s\S]*retryAuthFailure\(next\.providerId, next\.target, generation\)[\s\S]*if \(!result\.cancelled\) removeLiveQueueHead\(\);/,
  'a dequeued retry must stay cancellable and remain queued when its workspace generation is invalidated'
);
const steerCatchSource = appSource.slice(
  appSource.indexOf('} catch (error) {', appSource.indexOf('const steerWithContent = async')),
  appSource.indexOf('} finally {', appSource.indexOf('} catch (error) {', appSource.indexOf('const steerWithContent = async')))
);
assert.match(
  steerCatchSource,
  /runOutputMessages\.current\.set\(runId, tracked\);[\s\S]*authRetryPayload: trackedMessage\?\.authRetryPayload/,
  'a failed steer interruption must restore the original run retry payload'
);

assert.match(
  providerUpdatesSource,
  /PROVIDER_AUTH_ATTEMPT_TIMEOUT_MS = [^;]+;[\s\S]*createProviderAuthenticationCompletion[\s\S]*setTimeout\(\(\) => \{[\s\S]*signalProviderAuthenticationProcess\(child, 'SIGTERM'\)[\s\S]*timedOut: true/,
  'provider authentication child processes must have a bounded terminal outcome'
);
assert.match(
  providerUpdatesSource.slice(
    providerUpdatesSource.indexOf('export const authenticateProviderTool'),
    providerUpdatesSource.indexOf('export const PROVIDER_AUTH_POLL_MS')
  ),
  /const completion = createProviderAuthenticationCompletion\(child\)/,
  'every provider login must use the bounded completion lifecycle'
);
const signalAuthenticationProcessSource = providerUpdatesSource.slice(
  providerUpdatesSource.indexOf('const signalProviderAuthenticationProcess'),
  providerUpdatesSource.indexOf('export const createProviderAuthenticationCompletion')
);
assert.ok(
  signalAuthenticationProcessSource.indexOf('process.kill(-child.pid, signal)') <
    signalAuthenticationProcessSource.indexOf(
      'if (child.exitCode !== null || child.signalCode !== null) return'
    ),
  'POSIX process groups must still be signaled after their detached shell exits'
);

console.log('auth retry regression checks passed');
