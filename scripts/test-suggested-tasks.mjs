import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appSource, chatSource, claudeDriverSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/chat.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/claude-driver.js', import.meta.url), 'utf8'),
]);

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const autoScrollEffect = section(
  chatSource,
  'useEffect(() => {\n    if (!chatPinnedRef.current) return;',
  '  const handleMarkTaskDone'
);
assert.match(
  autoScrollEffect,
  /thread\?\.suggestedTask/,
  'Pinned transcripts must scroll when the suggestion card arrives'
);

const startTurn = section(appSource, '  const startTurnForThread = useCallback(', '  useEffect(() => {\n    startTurnForThreadRef.current');
assert.match(
  startTurn,
  /updateThread\(threadId, \{ status: 'running', suggestedTask: undefined \}\);/,
  'Starting a foreground turn must invalidate the previous suggestion'
);

for (const [name, start, end] of [
  ['goal', '  const startGoalRunForThread = useCallback(', '  // `/review`'],
  ['review', '  const startReviewForThread = useCallback(', '  const handleGoalCommand'],
]) {
  assert.match(
    section(appSource, start, end),
    /updateThread\(threadId, \{ status: 'running', suggestedTask: undefined \}\);/,
    `Starting a ${name} turn must invalidate the previous suggestion`
  );
}

const terminalSend = section(
  appSource,
  '    if (isTerminalThread) {',
  '    // `/goal …`'
);
assert.match(
  terminalSend,
  /if \(!result\?\.ok\)[\s\S]*updateThread\(submittedThreadId, \{ suggestedTask: undefined \}\);/,
  'A successfully delivered terminal turn must invalidate the previous suggestion'
);

const startSuggestedTask = section(
  appSource,
  '  const handleStartSuggestedTask = useCallback((threadId: string) => {',
  '  const handleDismissSuggestedTask'
);
const epicsGuardIndex = startSuggestedTask.indexOf('if (!epicsEnabled)');
const addEpicIndex = startSuggestedTask.indexOf('addEpic(');
assert.ok(epicsGuardIndex >= 0, 'Suggested tasks must be gated by the Epics setting');
assert.ok(addEpicIndex > epicsGuardIndex, 'The Epics setting guard must run before creating an epic');
assert.match(
  startSuggestedTask,
  /\}, \[[\s\S]*setupRiftForEpic[\s\S]*updateThread,[\s\S]*\]\);/,
  'The start callback must keep a memoized identity with explicit dependencies'
);
assert.match(
  appSource,
  /const handleDismissSuggestedTask = useCallback\([\s\S]*\}, \[updateThread\]\);/,
  'The dismiss callback must keep a memoized identity'
);

const turnEventHandler = section(
  appSource,
  "      // Every real turn supersedes the prior suggestion",
  "      // A claude session's background work settled"
);
assert.match(
  turnEventHandler,
  /event\.type === 'started'[\s\S]*latestTurnRunIdsRef\.current\.set\(event\.threadId, event\.runId\)[\s\S]*suggestedTask: undefined/,
  'Every observed turn start must invalidate the prior suggestion generation'
);
assert.match(
  turnEventHandler,
  /latestTurnRunIdsRef\.current\.get\(event\.threadId\) !== event\.runId/,
  'Late suggestions must be rejected when a newer turn generation owns the thread'
);
assert.match(
  turnEventHandler,
  /turnRunId: event\.runId/,
  'Accepted suggestions must retain their owning turn generation'
);

const backgroundContinuation = section(
  appSource,
  "        if (event.type === 'started' && event.background) {",
  '        return;\n      }'
);
assert.match(
  backgroundContinuation,
  /updateThread\(event\.threadId, \{ status: 'running', suggestedTask: undefined \}\);/,
  'Harness-initiated continuations must clear a hidden previous suggestion'
);

const promptSuggestion = section(
  claudeDriverSource,
  "  if (message?.type === 'prompt_suggestion') {",
  '  // Track the harness'
);
assert.match(
  promptSuggestion,
  /const runId = session\.pendingSuggestionRunId;[\s\S]*session\.pendingSuggestionRunId = null;[\s\S]*runId,/,
  'Prompt suggestions must use the completed turn owner exactly once'
);
assert.doesNotMatch(
  promptSuggestion,
  /crypto\.randomUUID\(\)/,
  'Suggestion ownership must never be replaced with an unrelated synthetic run id'
);
assert.match(
  claudeDriverSource,
  /const turn = session\.activeTurns\.shift\(\);[\s\S]*session\.pendingSuggestionRunId = turn\.runId;/,
  'Finalization must retain the completed turn as the next suggestion owner'
);
assert.ok(
  (claudeDriverSource.match(/session\.pendingSuggestionRunId = null;/g) ?? []).length >= 3,
  'Foreground and harness-initiated turn starts must supersede pending suggestion ownership'
);

const suggestedTaskCard = section(
  chatSource,
  'export const SuggestedTaskCard:',
  'export const changedFileStatusLabels'
);
assert.match(
  suggestedTaskCard,
  /canStart \? \(/,
  'The suggested-task card must hide its start action while Epics is disabled'
);
assert.match(
  appSource,
  /suggestedTaskCanStart=\{epicsEnabled\}/,
  'The transcript must receive the current Epics setting'
);

console.log('Suggested-task lifecycle checks passed.');
