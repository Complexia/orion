import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  epicHasActionableCommitWork,
  epicRepositoryShouldAutoCreatePr,
} from '../src/app/epicGit.ts';
import {
  CODE_SIDEBAR_MAX_WIDTH,
  CODE_SIDEBAR_MIN_WIDTH,
  clampCodeSidebarWidth,
} from '../src/app/codeSidebarResize.ts';

const [appSource, chatSource, mainSource, preloadSource, dialogsSource, storeSource, sidebarSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/chat.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/preload.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/AppDialogs.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/AgentsSidebar.tsx', import.meta.url), 'utf8'),
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

assert.equal(
  epicRepositoryShouldAutoCreatePr({ autoPrAfterCommit: true }, {}),
  true,
  'a pushed multi-project repository without a PR must continue into PR creation'
);
assert.equal(
  epicRepositoryShouldAutoCreatePr(
    { autoPrAfterCommit: true },
    { prUrl: 'https://example.test/pull/1', prState: 'OPEN' }
  ),
  false,
  'an existing open repository PR must not be recreated after a push'
);
assert.equal(
  epicRepositoryShouldAutoCreatePr(
    { autoPrAfterCommit: true },
    { prUrl: 'https://example.test/pull/1', prState: 'CLOSED' }
  ),
  true,
  'a closed repository PR must allow the multi-project flow to create a replacement'
);
assert.equal(
  epicRepositoryShouldAutoCreatePr({ autoPrAfterCommit: true, commitWithoutPush: true }, {}),
  false,
  'commit-only mode must suppress multi-project auto-PR creation'
);

assert.equal(
  clampCodeSidebarWidth(400, 1200),
  400,
  'the Code explorer should accept an editor-safe drag width'
);
assert.equal(
  clampCodeSidebarWidth(100, 1200),
  CODE_SIDEBAR_MIN_WIDTH,
  'the Code explorer must retain its usable minimum width'
);
assert.equal(
  clampCodeSidebarWidth(900, 1200),
  CODE_SIDEBAR_MAX_WIDTH,
  'the Code explorer must stop at its normal editor-style maximum width'
);
assert.equal(
  clampCodeSidebarWidth(600, 700),
  380,
  'the Code explorer must leave a usable editor area in a narrow window'
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
  'A completed Claude response with only shell work left must append an Orion monitor message'
);

assert.match(
  dialogsSource,
  /newEpicProjectIds\.length < projects\.length[\s\S]*Add another project/,
  'the Epic dialog must let the user add another unique project picker'
);
assert.match(
  dialogsSource,
  /newEpicProjectIds\.length > 1 \|\| !newEpicCreateRift/,
  'an Epic without a Rift must allow its final project selection to be removed'
);
assert.match(
  storeSource,
  /repositories\?: EpicRepository\[\][\s\S]*projects\?: Array</,
  'Epic persistence must retain all repositories and every pending Rift request'
);
assert.match(
  mainSource,
  /createMultiProjectRift[\s\S]*riftWorkingDir: workspacePath[\s\S]*repositories,/,
  'multi-project Rift creation must return the shared parent as agent cwd and each child repository'
);
assert.match(
  appSource,
  /activeRiftRepository[\s\S]*activeRiftRepository\?\.riftWorkingDir[\s\S]*activeRiftRepository\?\.riftPath/,
  'repository controls must use a child checkout while multi-project agents retain the shared cwd'
);
assert.match(
  mainSource,
  /isRiftRepositoryChildPath\(epic\.riftPath, repository\.riftPath\)[\s\S]*owners\.set\(repository\.riftPath,[\s\S]*repositoryChild: true[\s\S]*ownedRiftHasMarker[\s\S]*removeOwnedRift/,
  'shared Rift children must be durable owners and the parent lifecycle must delegate to them'
);
assert.match(
  appSource,
  /Commit & push all projects[\s\S]*Create PRs for all[\s\S]*runMultiRepositoryAction/,
  'the Epic view must expose batch and per-project repository actions'
);
const multiRepositoryActions = section(
  appSource,
  '                      {selectedEpicRepositories.length > 1 && (',
  '                      <span className="epic-view-repository-hint">'
);
assert.match(
  multiRepositoryActions,
  /checked=\{Boolean\(selectedEpic\.autoPrAfterCommit\)\}[\s\S]*Auto create PR on commit/,
  'the multi-project Epic view must expose the persisted auto-create-PR checkbox'
);
assert.match(
  appSource,
  /epicRepositoryShouldAutoCreatePr\(latestEpic, latestRepository\)[\s\S]*createEpicRepositoryPr\(latestEpic, latestRepository\)/,
  'a successful multi-project commit must continue into PR creation when enabled'
);
assert.match(
  dialogsSource,
  /newEpicProjectIds\.map[\s\S]*branchState = newEpicRiftBranches\[projectId\][\s\S]*Branch from:/,
  'every selected project must get its own styled Rift source-branch picker'
);
assert.match(
  appSource,
  /const riftProjects = epicProjects\.map[\s\S]*sourceBranch: selectedBranch[\s\S]*baseBranch: selectedBranch/,
  'each project source-branch choice must be carried into its Rift request'
);
assert.match(
  mainSource,
  /sourceBranch =\s*[\s\S]*requested\.sourceBranch[\s\S]*repositories\.push\([\s\S]*sourceBranch: source\.sourceBranch/,
  'multi-project Rift ownership must retain every repository source branch'
);
assert.match(
  appSource,
  /const restoreProjects = recordedRepositories[\s\S]*existingBranch: repository\.gitBranch[\s\S]*projects: restoreProjects\.map/,
  'restoring a released shared Rift must request every recorded repository branch'
);
assert.match(
  appSource,
  /const repositories = ownership\.repositories\?\.length[\s\S]*repositories \? \{ repositories \}/,
  'Rift acknowledgement must replace stale repository paths with recreated ownership metadata'
);
assert.match(
  appSource,
  /result === 'aborted'\) break/,
  'a user-aborted repository operation must stop the remaining batch'
);
assert.match(
  appSource,
  /epic\.repositories\?\.length \?\? 0\) > 1[\s\S]*return UNCLAIMED_EPIC_GIT_WORKSPACE_KEY/,
  'non-Rift multi-repository actions must use the conservative shared-checkout lock'
);
assert.match(
  appSource,
  /claimedBranches: claimedBranchesForEpic\(epic\.id\)/,
  'non-Rift per-repository actions must enforce cross-Epic branch claims'
);
assert.match(
  appSource,
  /kind === 'commit' && window\.orion\?\.epicGitStatus[\s\S]*status\.hasChangesToCommit[\s\S]*status\.hasUnpushedCommits/,
  'batch commits must preflight and skip clean, fully-pushed repositories'
);
assert.match(
  appSource,
  /baseBranch: repository\.sourceBranch \?\? ''/,
  'each repository pull request must target the source branch selected for its Rift'
);
assert.match(
  appSource,
  /epic-view-actions[\s\S]*selectedEpicRepositories\.length <= 1/,
  'legacy primary-only git controls must be hidden for multi-project Epics'
);
assert.match(
  sidebarSource,
  /openAddProjectToEpicDialog\(epic\)[\s\S]*Add project to Rift/,
  'the Epic options menu must expose the add-project flow'
);
assert.match(
  appSource,
  /className="sidebar-section-action epic-view-add-project"[\s\S]*title="Add project"[\s\S]*aria-label="Add project"[\s\S]*openAddProjectToEpicDialog\(selectedEpic\)[\s\S]*<Plus size=\{14\}/,
  'the Epic repository row must expose the add-project flow as an accessible plus icon'
);
assert.match(
  dialogsSource,
  /aria-label="Project to add"[\s\S]*role="option"[\s\S]*Add project/,
  'the add-project dialog must use the styled project picker instead of a native select'
);
assert.match(
  appSource,
  /epicAddRiftProject\([\s\S]*persistAndAcknowledgeRift\([\s\S]*Project added, but Rift ownership could not be persisted/,
  'the renderer must durably persist and acknowledge an appended Rift repository'
);
assert.match(
  mainSource,
  /addProjectToExistingRift[\s\S]*readPersistedRiftOwners[\s\S]*existingGitRoots[\s\S]*riftCreate\(canonicalGitRoot,[\s\S]*unacknowledgedRifts\.set/,
  'main must validate durable ownership and duplicate Git roots before journaling an appended repository'
);
assert.match(
  mainSource,
  /workspaceLinkPath[\s\S]*fs\.symlink[\s\S]*sharedRiftRepositories[\s\S]*isSymbolicLink\(\)[\s\S]*realpathSync/,
  'expanding a legacy one-project Rift must retain and validate its original repository through the shared workspace link'
);
const addRiftProject = section(
  mainSource,
  'const addProjectToExistingRift = async (event, input) => {',
  "ipcMain.handle('epic:addRiftProject'"
);
assert.match(
  addRiftProject,
  /pendingRiftEpicIds\.add\(epicId\)[\s\S]*riftRemovalCoordinator\.run\(\[epicId\]/,
  'adding a project must synchronously reserve the destructive-operation coordinator'
);
const removeRift = section(
  mainSource,
  "ipcMain.handle('epic:removeRift'",
  "ipcMain.handle('epic:deleteRiftRestoreRef'"
);
assert.match(
  removeRift,
  /pendingRiftEpicIds\.has\(epicId\)[\s\S]*still being updated[\s\S]*riftRemovalCoordinator\.run/,
  'Epic deletion must reject a Rift setup whose ownership is not durable yet'
);
assert.match(
  removeRift,
  /if \(!existsSync\(riftPath\)\)[\s\S]*isExternalRiftLinkedFromWorkspace[\s\S]*riftRemove\(repositoryRiftPath\)[\s\S]*deleteEpicRestoreRefBestEffort/,
  'missing shared parents must not orphan an externally linked legacy Rift'
);
const storageRelease = section(
  mainSource,
  "ipcMain.handle('riftStorage:release'",
  '// Age-based retention.'
);
assert.match(
  storageRelease,
  /owner\?\.repositoryChild[\s\S]*workspace-owned/,
  'Storage release must reject standalone child-repository requests'
);
assert.match(
  storageRelease,
  /if \(!existsSync\(riftPath\)\)[\s\S]*linkedRepositoriesForMissingWorkspace[\s\S]*readRepositoryRiftsWorkState[\s\S]*preserveRepositoryRiftHeadsForRestore[\s\S]*riftRemove\(repository\.riftPath\)[\s\S]*completeRiftRelease/,
  'Storage release must preserve and remove linked repositories before settling a missing parent'
);
const persistRift = section(
  appSource,
  'const persistAndAcknowledgeRift = useCallback(',
  '  useEffect(() => {'
);
assert.match(
  persistRift,
  /flushOrionThreadsSave\(\)[\s\S]*updateEpic\(ownership\.epicId[\s\S]*flushOrionStoreSave\(\)/,
  'provider session resets must reach thread storage before the new workspace is activated'
);
assert.match(
  preloadSource,
  /epicAddRiftProject:[\s\S]*epic:addRiftProject/,
  'the add-project operation must cross the preload boundary'
);
assert.match(
  mainSource,
  /input\?\.projectPaths[\s\S]*input\?\.gitRoots[\s\S]*deleteRiftRestoreRefs/,
  'Epic deletion must remove restore refs from every source repository'
);
assert.match(
  appSource,
  /Shell-only work follows Claude Code's monitor semantics[\s\S]*if \(waiting\)[\s\S]*else \{[\s\S]*status: 'done'/,
  'Shell-only monitors must not keep the completed Claude turn in the working state'
);
assert.match(
  chatSource,
  /Stop background monitors[\s\S]*onDiscardClaudeBackgroundTasks/,
  'The monitor card must expose an explicit stop action in the transcript'
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

const cloudDeployPrecheck = section(
  mainSource,
  'const cloudDeployPrecheck = async (gitRoot) => {',
  "ipcMain.handle('cloud:deployPrecheck'"
);
assert.match(
  cloudDeployPrecheck,
  /readGitStatusEntries\(gitRoot\)[\s\S]*uncommitted working tree changes/,
  'a dirty worktree must route through the deployment agent instead of rebuilding stale HEAD'
);
assert.match(
  cloudDeployPrecheck,
  /reasons\.length === 0 && \(await cloudAppFileExists\(gitRoot, name\)\)/,
  'explicit build config must not bypass the dirty-worktree deploy guard'
);
assert.match(
  appSource,
  /working tree has uncommitted changes[\s\S]*commit the intended deployable work[\s\S]*preserving unrelated user changes/,
  'the deployment agent must commit intended dirty-tree work without swallowing unrelated changes'
);

console.log('UI improvements tests passed');
