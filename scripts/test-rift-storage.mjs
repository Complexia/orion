import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import {
  collectCurrentManualRiftReleaseEntries,
  collectPendingRiftOwnersByPath,
  createRiftRemovalCoordinator,
  deleteRiftRestoreRef,
  deleteRiftRestoreRefs,
  guardedEpicIdsForRiftReleaseJournal,
  isEpicDeletionPersisted,
  isManualRiftReleaseEntryCurrent,
  isRiftReleaseOwnerCurrent,
  isRetainedRiftOwnerEligible,
  preserveRiftHeadForRestore,
  reconcileRiftReleaseJournal,
  releasedRiftRefForEpic,
} from '../src/main/rift-release.js';
import {
  collapseNestedPaths,
  isExternalRiftLinkedFromWorkspace,
  isRiftRepositoryChildPath,
  isRiftRepositoryIncludedInWorkspaceSize,
  planRiftStorageEntries,
  reclaimedBytesAcrossVolumes,
} from '../src/main/rift-storage-accounting.js';

const execFileAsync = promisify(execFile);
const git = (cwd, ...args) => execFileAsync('git', ['-C', cwd, ...args]);

const pendingOwners = collectPendingRiftOwnersByPath(
  new Map([
    [
      'unacknowledged-epic',
      {
        epicId: 'unacknowledged-epic',
        riftPath: '/rift/unacknowledged',
        branch: 'orion/unacknowledged',
        repositories: [
          {
            projectId: 'child-project',
            riftPath: '/rift/unacknowledged/child',
            gitRoot: '/source/child',
            gitBranch: 'orion/child',
          },
        ],
      },
    ],
    [
      'single-project-epic',
      {
        epicId: 'single-project-epic',
        riftPath: '/rift/single-project',
        branch: 'orion/single-project',
        repositories: [
          {
            projectId: 'single-project',
            riftPath: '/rift/single-project',
            gitRoot: '/source/single-project',
            gitBranch: 'orion/single-project',
          },
        ],
      },
    ],
  ]),
  [
    {
      epicId: 'creating-epic',
      epicName: 'Creating epic',
      riftPath: () => '/rift/creating',
    },
  ]
);
assert.equal(pendingOwners.get('/rift/unacknowledged')?.settledAt, null);
assert.equal(
  pendingOwners.get('/rift/unacknowledged')?.gitBranch,
  'orion/unacknowledged'
);
assert.equal(
  pendingOwners.get('/rift/unacknowledged/child')?.epicId,
  'unacknowledged-epic',
  'every child Rift must remain owned until the shared workspace is acknowledged'
);
assert.equal(
  pendingOwners.get('/rift/unacknowledged/child')?.workspaceRiftPath,
  '/rift/unacknowledged'
);
assert.equal(
  pendingOwners.get('/rift/unacknowledged/child')?.gitBranch,
  'orion/child'
);
assert.equal(
  pendingOwners.get('/rift/single-project')?.repositoryChild,
  undefined,
  'a single-project Rift must remain the workspace owner when its repository row uses the same path'
);
assert.deepEqual(pendingOwners.get('/rift/creating'), {
  epicId: 'creating-epic',
  name: 'Creating epic',
  cleanupPending: false,
  settledAt: null,
  gitBranch: null,
  gitRoot: null,
  prUrl: null,
  prState: null,
});

assert.equal(
  isRiftRepositoryChildPath('/rifts/single-abcd', '/rifts/single-abcd'),
  false,
  'the repository row for a single-project Rift is not a child of itself'
);
assert.equal(
  isRiftRepositoryChildPath('/rifts/epics/shared', '/rifts/epics/shared/child'),
  true,
  'a distinct repository inside a shared workspace remains a child'
);
const singleProjectPlan = planRiftStorageEntries(
  [{ riftPath: '/rift/single-project', riftRoot: '/rift' }],
  pendingOwners,
  () => true
);
assert.deepEqual(
  singleProjectPlan.visibleRifts,
  [{ riftPath: '/rift/single-project', riftRoot: '/rift' }],
  'single-project Rifts must remain visible and independently releasable in Storage'
);

const removalCoordinator = createRiftRemovalCoordinator();
const removalOrder = [];
let releaseFirstRemoval;
let releaseSecondRemoval;
const firstRemovalGate = new Promise((resolve) => {
  releaseFirstRemoval = resolve;
});
const secondRemovalGate = new Promise((resolve) => {
  releaseSecondRemoval = resolve;
});
const firstRemoval = removalCoordinator.run(['shared-epic'], async () => {
  removalOrder.push('first-start');
  await firstRemovalGate;
  removalOrder.push('first-end');
});
const secondRemoval = removalCoordinator.run(['shared-epic'], async () => {
  removalOrder.push('second-start');
  await secondRemovalGate;
  removalOrder.push('second-end');
});
assert.equal(removalCoordinator.hasEpic('shared-epic'), true);
releaseFirstRemoval();
await firstRemoval;
assert.equal(
  removalCoordinator.hasEpic('shared-epic'),
  true,
  'one completion must not clear another queued removal reservation'
);
assert.deepEqual(removalOrder, ['first-start', 'first-end', 'second-start']);
releaseSecondRemoval();
await secondRemoval;
assert.equal(removalCoordinator.hasEpic('shared-epic'), false);
assert.deepEqual(removalOrder, [
  'first-start',
  'first-end',
  'second-start',
  'second-end',
]);

assert.equal(
  isRiftRepositoryIncludedInWorkspaceSize('/rifts/epics/shared/child', {
    repositoryChild: true,
    workspaceRiftPath: '/rifts/epics/shared',
  }),
  true,
  'a real shared-workspace child is already included in its parent size'
);
assert.equal(
  isRiftRepositoryIncludedInWorkspaceSize('/rifts/original/legacy-abcd', {
    repositoryChild: true,
    workspaceRiftPath: '/rifts/epics/shared',
  }),
  false,
  'an externally linked legacy Rift must be measured outside its parent directory'
);
assert.equal(
  isExternalRiftLinkedFromWorkspace('/rifts/epics/shared', {
    riftPath: '/rifts/original/legacy-abcd',
    workspaceLinkPath: '/rifts/epics/shared/original',
  }),
  true,
  'missing-parent cleanup can identify the persisted external legacy link shape'
);
assert.equal(
  isExternalRiftLinkedFromWorkspace('/rifts/epics/shared', {
    riftPath: '/rifts/epics/shared/child',
    workspaceLinkPath: '/rifts/epics/shared/child-link',
  }),
  false,
  'missing-parent cleanup must not classify an ordinary child as an external link'
);

const linkedWorkspaceOwners = new Map([
  ['/rifts/epics/shared', { epicId: 'shared-epic', repositories: [] }],
  ['/rifts/epics/shared/child', {
    epicId: 'shared-epic',
    repositoryChild: true,
    workspaceRiftPath: '/rifts/epics/shared',
  }],
  ['/rifts/original/legacy-abcd', {
    epicId: 'shared-epic',
    repositoryChild: true,
    workspaceRiftPath: '/rifts/epics/shared',
    workspaceLinkPath: '/rifts/epics/shared/original',
  }],
]);
const linkedWorkspacePlan = planRiftStorageEntries(
  [
    { riftPath: '/rifts/epics/shared', riftRoot: '/rifts/epics' },
    { riftPath: '/rifts/epics/shared/child', riftRoot: '/rifts/epics/shared' },
    { riftPath: '/rifts/original/legacy-abcd', riftRoot: '/rifts/original' },
  ],
  linkedWorkspaceOwners,
  (candidate) => candidate === '/rifts/epics/shared'
);
assert.deepEqual(
  linkedWorkspacePlan.visibleRifts.map(({ riftPath }) => riftPath),
  ['/rifts/epics/shared'],
  'linked repository children must not become independently releasable Storage rows'
);
assert.deepEqual(
  linkedWorkspacePlan.externalSizePathsByWorkspace.get('/rifts/epics/shared'),
  ['/rifts/original/legacy-abcd'],
  'the external legacy repository size must be folded into its parent row'
);

const missingLinkedWorkspacePlan = planRiftStorageEntries(
  [{ riftPath: '/rifts/original/legacy-abcd', riftRoot: '/rifts/original' }],
  linkedWorkspaceOwners,
  () => false
);
assert.deepEqual(
  missingLinkedWorkspacePlan.visibleRifts,
  [{ riftPath: '/rifts/epics/shared', riftRoot: '/rifts/epics' }],
  'a missing linked parent must retain one parent-owned cleanup row'
);
assert.deepEqual(
  missingLinkedWorkspacePlan.externalSizePathsByWorkspace.get('/rifts/epics/shared'),
  ['/rifts/original/legacy-abcd'],
  'a missing parent row must still account for its external repository bytes'
);

assert.deepEqual(
  guardedEpicIdsForRiftReleaseJournal({
    releases: [
      { epicId: 'removing-epic', riftPath: '/rift/a', phase: 'removing' },
      { epicId: 'released-epic', riftPath: '/rift/b', phase: 'released' },
      { epicId: 'acknowledged-epic', riftPath: '/rift/c', phase: 'acknowledged' },
      { epicId: '', riftPath: '/rift/d', phase: 'released' },
    ],
  }),
  new Set(['removing-epic', 'released-epic']),
  'both release phases must retain the main-process launch guard until acknowledgement'
);

const reconciledReleaseJournal = reconcileRiftReleaseJournal(
  {
    releases: [
      { epicId: 'completed-epic', riftPath: '/rift/missing', phase: 'removing' },
      { epicId: 'active-removal-epic', riftPath: '/rift/active', phase: 'removing' },
      { epicId: 'abandoned-epic', riftPath: '/rift/abandoned', phase: 'removing' },
      { epicId: 'released-epic', riftPath: '/rift/released', phase: 'released' },
    ],
  },
  {
    pathExists: (riftPath) => riftPath !== '/rift/missing',
    isEpicRemovalPending: (epicId) => epicId === 'active-removal-epic',
  }
);
assert.deepEqual(reconciledReleaseJournal, {
  releases: [
    { epicId: 'completed-epic', riftPath: '/rift/missing', phase: 'released' },
    { epicId: 'active-removal-epic', riftPath: '/rift/active', phase: 'removing' },
    { epicId: 'released-epic', riftPath: '/rift/released', phase: 'released' },
  ],
});

const before = new Map([
  ['volume-a', { path: '/volume-a', freeBytes: 1_000 }],
  ['volume-b', { path: '/volume-b', freeBytes: 5_000 }],
]);
const after = new Map([
  ['volume-a', { path: '/volume-a', freeBytes: 1_250 }],
  ['volume-b', { path: '/volume-b', freeBytes: 5_500 }],
]);
assert.equal(reclaimedBytesAcrossVolumes(before, after), 750);
assert.equal(
  reclaimedBytesAcrossVolumes(
    before,
    new Map([['volume-a', { path: '/volume-a', freeBytes: 1_250 }]])
  ),
  null
);

const retentionCutoff = Date.parse('2026-07-20T00:00:00.000Z');
const retainedOwner = {
  epicId: 'retained-epic',
  settledAt: '2026-07-19T00:00:00.000Z',
  cleanupPending: false,
};
assert.equal(
  isRetainedRiftOwnerEligible(retainedOwner, {
    epicId: retainedOwner.epicId,
    cutoff: retentionCutoff,
  }),
  true
);
assert.equal(
  isRetainedRiftOwnerEligible(
    { ...retainedOwner, settledAt: null },
    { epicId: retainedOwner.epicId, cutoff: retentionCutoff }
  ),
  false,
  'a restored epic must no longer be eligible'
);
assert.equal(
  isRetainedRiftOwnerEligible(
    { ...retainedOwner, settledAt: '2026-07-21T00:00:00.000Z' },
    { epicId: retainedOwner.epicId, cutoff: retentionCutoff }
  ),
  false,
  'a newly settled epic must get a fresh retention window'
);
assert.equal(
  isRetainedRiftOwnerEligible(
    { ...retainedOwner, epicId: 'replacement-epic' },
    { epicId: retainedOwner.epicId, cutoff: retentionCutoff }
  ),
  false,
  'ownership changes must cancel the stale candidate'
);

const manualOwner = {
  epicId: 'manual-epic',
  settledAt: '2026-07-19T00:00:00.000Z',
  cleanupPending: false,
};
const confirmedManualEntry = {
  riftPath: '/rift/manual',
  epicId: manualOwner.epicId,
  status: 'settled',
  settledAt: manualOwner.settledAt,
  hasMarker: true,
};
assert.equal(isRiftReleaseOwnerCurrent(manualOwner, manualOwner), true);
assert.equal(
  isManualRiftReleaseEntryCurrent(confirmedManualEntry, manualOwner),
  true,
  'manual confirmation should accept the lifecycle identity shown by the scan'
);
assert.equal(
  isManualRiftReleaseEntryCurrent(
    { epicId: null, status: 'orphan', settledAt: null },
    undefined
  ),
  true,
  'an orphan row should remain manually eligible while it is still unowned'
);
assert.equal(
  isManualRiftReleaseEntryCurrent(
    { epicId: manualOwner.epicId, status: 'active', settledAt: null },
    { ...manualOwner, settledAt: null }
  ),
  true,
  'an explicitly confirmed active row should be manually eligible'
);
assert.equal(
  isManualRiftReleaseEntryCurrent(
    { epicId: null, status: 'orphan', settledAt: null },
    {
      ...manualOwner,
      settledAt: null,
    }
  ),
  false,
  'a newly claimed Rift must win over a stale orphan-row confirmation'
);
assert.equal(
  isManualRiftReleaseEntryCurrent(
    confirmedManualEntry,
    { ...manualOwner, settledAt: null }
  ),
  false,
  'restoring an Epic must win over a stale settled-row confirmation'
);
assert.equal(
  isManualRiftReleaseEntryCurrent(
    confirmedManualEntry,
    { ...manualOwner, settledAt: '2026-07-22T00:00:00.000Z' }
  ),
  false,
  're-settling an Epic must not revive an older manual confirmation'
);
assert.equal(
  collectCurrentManualRiftReleaseEntries(
    [confirmedManualEntry],
    [confirmedManualEntry.riftPath],
    'scan-current',
    'scan-current'
  ).get(confirmedManualEntry.riftPath),
  confirmedManualEntry,
  'manual confirmation should retain the row from the scan the user saw'
);
assert.equal(
  collectCurrentManualRiftReleaseEntries(
    [{ ...confirmedManualEntry, status: 'active', settledAt: null }],
    [confirmedManualEntry.riftPath],
    'scan-new',
    'scan-old'
  ).size,
  0,
  'a completed rescan must not rebind a stale path confirmation to its replacement row'
);
assert.equal(
  isRiftReleaseOwnerCurrent({ ...manualOwner, settledAt: null }, manualOwner),
  false,
  'restoring an epic must cancel an in-flight manual sweep'
);
assert.equal(
  isRiftReleaseOwnerCurrent(
    { ...manualOwner, settledAt: '2026-07-22T00:00:00.000Z' },
    manualOwner
  ),
  false,
  're-settling an epic must not revive an older sweep request'
);
assert.equal(
  isRiftReleaseOwnerCurrent({ ...manualOwner, epicId: 'replacement-epic' }, manualOwner),
  false,
  'rebound ownership must cancel an in-flight manual sweep'
);
assert.equal(
  isRiftReleaseOwnerCurrent(
    { epicId: 'new-owner', settledAt: null, cleanupPending: false },
    undefined
  ),
  false,
  'a newly claimed orphan must no longer be removable'
);

assert.equal(
  isEpicDeletionPersisted(
    { epics: [{ id: 'other-epic' }] },
    'deleted-epic'
  ),
  true,
  'main may remove an active Rift only after the owning Epic is durably absent'
);
assert.equal(
  isEpicDeletionPersisted(
    { epics: [{ id: 'deleted-epic' }] },
    'deleted-epic'
  ),
  false,
  'a still-persisted Epic must retain its Rift and restore ref'
);
assert.equal(
  isEpicDeletionPersisted(null, 'deleted-epic'),
  false,
  'unavailable storage must fail closed at the destructive boundary'
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-rift-storage-test-'));
const source = path.join(tempRoot, 'source');
const rift = path.join(tempRoot, 'rift');
const riftHome = path.join(tempRoot, 'home');
try {
  const knownRiftRoot = path.join(tempRoot, '.rifts', 'known');
  const knownTrashRoot = path.join(knownRiftRoot, '.trash');
  const knownTrashEntry = path.join(knownTrashRoot, 'known-trash-entry');
  const registryOnlyTrashEntry = path.join(tempRoot, 'registry-only', '.trash', 'external-entry');
  await fs.mkdir(knownTrashEntry, { recursive: true });
  await fs.mkdir(registryOnlyTrashEntry, { recursive: true });
  assert.deepEqual(
    new Set(collapseNestedPaths([knownTrashEntry, registryOnlyTrashEntry, knownTrashRoot])),
    new Set([knownTrashRoot, registryOnlyTrashEntry])
  );

  await fs.mkdir(source);
  await git(source, 'init', '-b', 'main');
  await git(source, 'config', 'user.name', 'Orion test');
  await git(source, 'config', 'user.email', 'orion-test@example.invalid');
  await fs.writeFile(path.join(source, 'README.md'), 'base\n');
  await git(source, 'add', 'README.md');
  await git(source, 'commit', '-m', 'base');

  const secondSource = path.join(tempRoot, 'second-source');
  await fs.mkdir(secondSource);
  await git(secondSource, 'init', '-b', 'main');
  await git(secondSource, 'config', 'user.name', 'Orion test');
  await git(secondSource, 'config', 'user.email', 'orion-test@example.invalid');
  await fs.writeFile(path.join(secondSource, 'README.md'), 'second base\n');
  await git(secondSource, 'add', 'README.md');
  await git(secondSource, 'commit', '-m', 'second base');
  const multiRestoreEpicId = 'multi-repository-restore-ref';
  const multiRestoreRef = releasedRiftRefForEpic(multiRestoreEpicId);
  await git(source, 'update-ref', multiRestoreRef, 'HEAD');
  await git(secondSource, 'update-ref', multiRestoreRef, 'HEAD');
  const multiDelete = await deleteRiftRestoreRefs(
    [source, secondSource, source],
    multiRestoreEpicId
  );
  assert.deepEqual(multiDelete, { deleted: 2, errors: [] });
  await assert.rejects(git(source, 'rev-parse', '--verify', multiRestoreRef));
  await assert.rejects(git(secondSource, 'rev-parse', '--verify', multiRestoreRef));

  await execFileAsync('git', ['clone', '--no-local', source, rift]);
  await git(rift, 'config', 'user.name', 'Orion test');
  await git(rift, 'config', 'user.email', 'orion-test@example.invalid');
  const branch = 'orion/never-pushed';
  await git(rift, 'checkout', '-b', branch);
  await fs.writeFile(path.join(rift, 'work.txt'), 'only in the rift\n');
  await git(rift, 'add', 'work.txt');
  await git(rift, 'commit', '-m', 'rift-only commit');
  const { stdout: riftHeadOutput } = await git(rift, 'rev-parse', 'HEAD');
  const riftHead = riftHeadOutput.trim();

  const { restoreRef } = await preserveRiftHeadForRestore(rift, {
    epicId: 'epic-with-never-pushed-branch',
    gitRoot: source,
    gitBranch: branch,
  });
  await fs.rm(rift, { recursive: true });

  const platformDirectory = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[
    process.platform
  ];
  const architectureDirectory = { arm64: 'arm64', x64: 'x64' }[process.arch];
  assert.ok(platformDirectory && architectureDirectory, 'Unsupported Rift test platform');
  const riftBinary = path.resolve(
    'node_modules',
    'rift-snapshot',
    'prebuilds',
    `${platformDirectory}-${architectureDirectory}`,
    process.platform === 'win32' ? 'rift.exe' : 'rift'
  );
  const riftEnvironment = {
    ...process.env,
    HOME: riftHome,
    XDG_DATA_HOME: path.join(riftHome, '.local', 'share'),
    APPDATA: path.join(riftHome, 'AppData', 'Roaming'),
  };
  const runRift = (...args) => execFileAsync(riftBinary, args, { env: riftEnvironment });
  await fs.mkdir(riftHome, { recursive: true });
  await runRift('init', source, '--here');
  const riftParent = path.join(tempRoot, '.rifts', 'source');
  const { stdout: createOutput } = await runRift(
    'create',
    source,
    '--name',
    'restored-1234',
    '--into',
    riftParent,
    '--copy-all',
    '--no-hooks'
  );
  const restored = createOutput.trim().split('\n').pop().trim();
  await git(restored, 'checkout', '-B', branch, restoreRef, '--');
  const { stdout: restoredHeadOutput } = await git(restored, 'rev-parse', 'HEAD');
  assert.equal(restoredHeadOutput.trim(), riftHead);
  assert.equal(await fs.readFile(path.join(restored, 'work.txt'), 'utf-8'), 'only in the rift\n');
  await deleteRiftRestoreRef(source, 'epic-with-never-pushed-branch');
  await assert.rejects(git(source, 'rev-parse', '--verify', restoreRef));
  // Ref deletion is intentionally idempotent so a retried epic deletion is safe.
  await deleteRiftRestoreRef(source, 'epic-with-never-pushed-branch');

  await runRift('remove', restored);
  const riftDatabase = new DatabaseSync(
    process.platform === 'linux'
      ? path.join(riftEnvironment.XDG_DATA_HOME, 'rift', 'rift.sqlite')
      : process.platform === 'win32'
        ? path.join(riftEnvironment.APPDATA, 'rift', 'rift.sqlite')
        : path.join(riftHome, 'Library', 'Application Support', 'rift', 'rift.sqlite'),
    { readOnly: true }
  );
  const trashRows = riftDatabase.prepare('SELECT path FROM trash').all();
  riftDatabase.close();
  assert.equal(trashRows.length, 1);
  assert.ok(trashRows[0].path.includes(`${path.sep}.trash${path.sep}`));
  await fs.access(trashRows[0].path);
  await runRift('gc');
  await assert.rejects(fs.access(trashRows[0].path));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('Rift storage checks passed');
