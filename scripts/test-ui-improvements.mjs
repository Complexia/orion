import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { epicHasActionableCommitWork } from '../src/app/epicGit.ts';

const [appSource, chatSource, mainSource, preloadSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/chat.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/preload.js', import.meta.url), 'utf8'),
]);

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

assert.equal(
  epicHasActionableCommitWork(undefined, true),
  true,
  'commit stays available until the first workspace status arrives'
);
assert.equal(
  epicHasActionableCommitWork(
    { hasChangesToCommit: true, hasUnpushedCommits: true },
    true
  ),
  true,
  'commit-only remains available when there are fresh changes to commit'
);
assert.equal(
  epicHasActionableCommitWork(
    { hasChangesToCommit: false, hasUnpushedCommits: true },
    true
  ),
  false,
  'commit-only must not offer an action when only unpushed commits remain'
);
assert.equal(
  epicHasActionableCommitWork(
    { hasChangesToCommit: false, hasUnpushedCommits: true },
    false
  ),
  true,
  'commit-and-push remains available to retry an earlier failed push'
);
assert.equal(
  epicHasActionableCommitWork(
    { hasChangesToCommit: false, hasUnpushedCommits: false },
    false
  ),
  false,
  'a clean, fully pushed workspace has no actionable commit work'
);

const backgroundSettled = section(
  appSource,
  "      if (event.type === 'background-settled') {",
  '      // Provider-native subagents'
);
assert.doesNotMatch(
  backgroundSettled,
  /completeInProgressPlanEntries/,
  'failed or killed background work must leave its in-progress plan entry halted'
);

assert.match(
  appSource,
  /pendingBackgroundShellTasks[\s\S]*kind: 'claude-background-intervention'[\s\S]*status: 'pending'/,
  'A completed Claude response with only shell work left must append an Orion intervention message'
);
assert.match(
  chatSource,
  /Stop background processes and finish[\s\S]*onDiscardClaudeBackgroundTasks/,
  'The intervention must expose an explicit user action in the transcript'
);
assert.match(
  mainSource,
  /agent:discardClaudeBackgroundShellTasks/,
  'The renderer action must have a dedicated Claude-only IPC route'
);
assert.match(
  preloadSource,
  /discardClaudeBackgroundShellTasks/,
  'The Claude shell-discard action must be exposed through the preload boundary'
);

const epicActions = section(
  appSource,
  '                    <div className="epic-view-actions">',
  '                      {selectedEpicPrBadge && ('
);
assert.match(
  epicActions,
  /disabled=\{selectedEpicOperationBusy\}[\s\S]*checked=\{Boolean\(selectedEpic\.commitWithoutPush\)\}/,
  'commit-only mode must be frozen while the selected epic operation is busy'
);

console.log('UI improvements tests passed');
