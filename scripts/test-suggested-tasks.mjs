import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appSource, chatSource, claudeDriverSource, mainSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/chat.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/claude-driver.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const elementContaining = (source, tag, marker) => {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing ${tag} marker: ${marker}`);
  const startIndex = source.lastIndexOf(`<${tag}`, markerIndex);
  assert.notEqual(startIndex, -1, `Missing ${tag} start before: ${marker}`);
  const endToken = `</${tag}>`;
  const endIndex = source.indexOf(endToken, markerIndex);
  assert.notEqual(endIndex, -1, `Missing ${tag} end after: ${marker}`);
  return source.slice(startIndex, endIndex + endToken.length);
};

const autoScrollEffect = section(
  chatSource,
  'useEffect(() => {\n    if (!chatPinnedRef.current) return;',
  '  const handleMarkTaskDone'
);
assert.doesNotMatch(
  autoScrollEffect,
  /thread\?\.suggestedTask/,
  'The floating suggestion card must not drive transcript auto-scroll'
);

const startTurn = section(appSource, '  const startTurnForThreadUnlocked = useCallback(', '  const startTurnForThread = useCallback(');
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

const startPromptBuilder = section(
  appSource,
  'const suggestedTaskStartPrompt = (suggestion: SuggestedTask): string => {',
  'const getStoredThreadTitle'
);
assert.match(
  startPromptBuilder,
  /suggestion\.detailedPromptStatus === 'ready' && detailed\) return detailed;/,
  'Only a completed detailed prompt may be sent to a fresh agent'
);
assert.match(
  startPromptBuilder,
  /`\$\{suggestion\.text\}\\n\\n`[\s\S]*you do not have that session's conversation[\s\S]*first investigate the repository/,
  'Missing, pending, and failed detailed prompts must use an annotated short-text fallback'
);
assert.match(
  appSource,
  /suggestedTaskPromptResumeFallbackMarker\s*=\s*['"]_Could not resume the previous session; starting a fresh one\._['"]/,
  'Detailed-prompt generation must recognize the Claude resume-fallback marker'
);

const promptForkCancellation = section(
  appSource,
  '  const canceledSuggestionPromptRunIds = useRef(new Set<string>());',
  '  // Defined after the agent-event effect that calls it'
);
assert.match(
  promptForkCancellation,
  /suggestionPromptRuns\.current\.delete\(runId\)[\s\S]*canceledSuggestionPromptRunIds\.current\.add\(runId\)[\s\S]*stopAgentTurn\?\.\(runId\)/,
  'Canceling a prompt fork must untrack and stop it while quarantining late events'
);

const disposeThreadRuntime = section(
  appSource,
  '  const disposeThreadRuntime = useCallback(async (threadId: string) => {',
  '  const deleteThreadWithRuntime'
);
assert.match(
  disposeThreadRuntime,
  /cancelSuggestionPromptRuns\(threadId\)[\s\S]*detailedPromptStatus === 'pending'[\s\S]*detailedPromptStatus: 'failed'[\s\S]*await window\.orion\?\.disposeAgentThread\?\.\(threadId\)/,
  'Disposing a thread runtime must cancel and settle prompt forks before awaiting teardown'
);
assert.match(
  disposeThreadRuntime,
  /\}, \[cancelSuggestionPromptRuns, updateThread\]\);/,
  'Runtime disposal must retain the prompt-run settlement dependencies'
);
const mainRuntimeDisposal = section(
  mainSource,
  'async function disposeAgentThreadRuntime(threadId) {',
  "ipcMain.handle('agent:disposeThread'"
);
assert.match(
  mainRuntimeDisposal,
  /starting\.aborted = true;[\s\S]*starting\.abortError = 'The thread runtime was disposed during agent startup\.';/,
  'Main-owned runtime disposal must distinguish startup cancellation from a normal stop'
);
assert.match(
  mainSource,
  /const abortedStartup = startingAgentRuns\.get\(runId\);[\s\S]*abortedStartup\?\.aborted[\s\S]*abortedStartup\.abortError[\s\S]*return \{ ok: false, error: abortedStartup\.abortError \};/,
  'A startup aborted by runtime disposal must resolve unsuccessfully so hidden runs can settle'
);

const startSuggestedTask = section(
  appSource,
  "  const handleStartSuggestedTask = useCallback((threadId: string, mode: 'thread' | 'rift') => {",
  '  const handleDismissSuggestedTask'
);
const duplicateStartGuard = section(
  startSuggestedTask,
  'const suggestion = thread?.suggestedTask;',
  'const project = state.projects.find'
);
assert.match(
  duplicateStartGuard,
  /suggestion\.startedEpicId \|\| suggestion\.startedThreadId\) return;/,
  'An already-started suggestion must not start twice in either mode'
);
assert.doesNotMatch(
  duplicateStartGuard,
  /createThread\(|addEpic\(/,
  'Duplicate-start rejection must happen before either start mode creates anything'
);
const epicsGuard = section(
  startSuggestedTask,
  'if (!epicsEnabled) {',
  "if (suggestion.detailedPromptStatus === 'pending') {"
).trim();
assert.match(
  epicsGuard,
  /^if \(!epicsEnabled\) \{[\s\S]*toast\.error\([\s\S]*\);\s*return;\s*\}$/,
  'The Epics-disabled Rift branch must return before epic creation'
);
assert.doesNotMatch(
  epicsGuard,
  /addEpic\(/,
  'The Epics-disabled Rift branch must not create an epic before returning'
);
const threadMode = section(startSuggestedTask, "if (mode === 'thread') {", 'if (!epicsEnabled)');
assert.doesNotMatch(
  threadMode,
  /addEpic\(|setupRiftForEpic\(/,
  'Thread mode must stay on the current branch — no epic, no rift'
);
assert.match(
  threadMode,
  /const newThreadId = createThread\(project\.id, undefined, \{ epicId: thread\.epicId \}\);[\s\S]*startedThreadId: newThreadId[\s\S]*startTurnForThreadRef\.current\?\.\(newThreadId, startPrompt, \[\]\)/,
  'Thread mode must preserve the source epic workspace before running the selected prompt'
);
assert.match(
  threadMode,
  /detailedPromptStatus === 'pending'[\s\S]*cancelSuggestionPromptRuns\(threadId, suggestion\.turnRunId\)[\s\S]*createThread\(/,
  'Starting the fallback in thread mode must cancel its unusable pending prompt fork'
);
assert.match(
  threadMode,
  /const startup = await result\.startup;[\s\S]*if \(!startup\.ok\) restoreDraft\(startup\.error\)/,
  'Thread mode must observe the asynchronous IPC startup result'
);
assert.match(
  threadMode,
  /const restoreDraft = \(error\?: string\) => \{[\s\S]*composerDraftsRef\.current\.set\(newThreadId, \{ text: startPrompt, attachments: \[\] \}\)[\s\S]*setChatInput\(startPrompt\)[\s\S]*toast\.error/,
  'A failed thread-mode start must preserve and show the prompt as the composer draft'
);
assert.match(
  section(startSuggestedTask, 'if (!epicsEnabled) {', 'const createRift'),
  /return;\s*\}[\s\S]*detailedPromptStatus === 'pending'[\s\S]*cancelSuggestionPromptRuns\(threadId, suggestion\.turnRunId\)/,
  'Starting the fallback in Rift mode must cancel its unusable pending prompt fork'
);
assert.match(
  startSuggestedTask,
  /const createRift[\s\S]*description: startPrompt[\s\S]*text: startPrompt/,
  'Rift mode must use the selected prompt for its epic and composer draft'
);
assert.match(
  startTurn,
  /return \{ ok: true, startup \};/,
  'A dispatched turn must expose its IPC startup result to launch callers'
);
assert.match(
  startSuggestedTask,
  /\}, \[[\s\S]*setupRiftForEpic[\s\S]*updateThread,[\s\S]*\]\);/,
  'The start callback must keep a memoized identity with explicit dependencies'
);
assert.match(
  appSource,
  /const handleDismissSuggestedTask = useCallback\([\s\S]*cancelSuggestionPromptRuns\(threadId\)[\s\S]*\}, \[cancelSuggestionPromptRuns, updateThread\]\);/,
  'The dismiss callback must keep a memoized identity'
);

const suggestionPromptEvents = section(
  appSource,
  '      // Suggested-task detailed-prompt forks:',
  '      // Goal state belongs to the thread'
);
assert.match(
  suggestionPromptEvents,
  /buffer\.includes\(suggestedTaskPromptResumeFallbackMarker\)[\s\S]*detailedPrompt: undefined[\s\S]*detailedPromptStatus: 'failed'[\s\S]*cancelSuggestionPromptRuns/,
  'A failed session resume must reject and cancel the context-free prompt retry'
);
assert.match(
  appSource,
  /canceledSuggestionPromptRunIds\.current\.has\(event\.runId\)[\s\S]*event\.type === 'done' \|\| event\.type === 'error'[\s\S]*return;/,
  'Late events from canceled prompt forks must stay out of the normal turn lifecycle'
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
  'export const FloatingSuggestedTaskCard:',
  'export const changedFileStatusLabels'
);
const primaryThreadButton = elementContaining(
  suggestedTaskCard,
  'button',
  'className="suggested-task-start"'
);
assert.match(
  primaryThreadButton,
  /onStart\('thread'\)/,
  'The suggested-task card must offer starting as a regular thread on the current branch'
);
assert.doesNotMatch(
  primaryThreadButton,
  /\bdisabled=/,
  'The primary regular-thread start action must remain enabled'
);
const riftButton = elementContaining(suggestedTaskCard, 'button', 'disabled={!canStartRift}');
assert.match(
  riftButton,
  /disabled=\{!canStartRift\}/,
  'The rift/epic start option must be disabled while Epics is disabled'
);
assert.match(riftButton, /onStart\('rift'\)/, 'The Epics-gated option must start Rift mode');
assert.match(
  suggestedTaskCard,
  /useFloatingCardDrag\(/,
  'The suggested-task card must stay draggable via the shared floating-card hook'
);
assert.match(
  suggestedTaskCard,
  /const fitsBelow = belowTop \+ cardHeight <= host\.clientHeight - margin;[\s\S]*tasksCard\.offsetTop - cardHeight - gap/,
  'The suggested-task card must move above the Tasks card when the lower stack would overflow'
);
assert.match(
  suggestedTaskCard,
  /const maxTop = Math\.max\(host\.clientHeight - cardHeight - margin, margin\);[\s\S]*Math\.min\(Math\.max\(preferredTop, margin\), maxTop\)/,
  'The suggested-task default position must be clamped inside its host'
);
assert.match(
  suggestedTaskCard,
  /observer\.observe\(host\);[\s\S]*observer\.observe\(card\);[\s\S]*observer\.observe\(tasksCard\)/,
  'The suggested-task stack must be remeasured when its host or either card resizes'
);
assert.match(
  appSource,
  /suggestedTaskCanStartRift=\{epicsEnabled\}/,
  'The transcript must receive the current Epics setting'
);

console.log('Suggested-task lifecycle checks passed.');
