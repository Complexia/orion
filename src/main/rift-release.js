import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const releasedRiftRefForEpic = (epicId) =>
  `refs/orion/releases/${crypto.createHash('sha256').update(epicId).digest('hex')}`;

// Rift removal changes shared workspace, journal, and restore-ref state. Keep
// every destructive flow on one queue, while counting queued/running epic
// reservations so one operation cannot clear another operation's launch
// guard when it finishes.
export const createRiftRemovalCoordinator = () => {
  let tail = Promise.resolve();
  const epicReservationCounts = new Map();

  const reserveEpics = (epicIds) => {
    const reserved = [
      ...new Set(
        [...epicIds].filter((epicId) => typeof epicId === 'string' && epicId)
      ),
    ];
    for (const epicId of reserved) {
      epicReservationCounts.set(epicId, (epicReservationCounts.get(epicId) ?? 0) + 1);
    }
    return reserved;
  };

  const releaseEpics = (epicIds) => {
    for (const epicId of epicIds) {
      const nextCount = (epicReservationCounts.get(epicId) ?? 0) - 1;
      if (nextCount > 0) epicReservationCounts.set(epicId, nextCount);
      else epicReservationCounts.delete(epicId);
    }
  };

  return {
    hasEpic: (epicId) => epicReservationCounts.has(epicId),
    pendingEpicIds: () => [...epicReservationCounts.keys()],
    run: (epicIds, operation) => {
      const reservedEpicIds = reserveEpics(epicIds);
      const queued = tail.catch(() => {}).then(operation);
      tail = queued.catch(() => {});
      return queued.finally(() => releaseEpics(reservedEpicIds));
    },
  };
};

// Creation ownership lives in main until the renderer proves its Epic binding
// reached disk. Surface those paths as active owners even before persistence,
// including the smaller window while `rift create` has produced a path but has
// not returned its final ownership payload yet.
export const collectPendingRiftOwnersByPath = (
  unacknowledgedRifts,
  pendingCreations
) => {
  const owners = new Map();
  for (const ownership of unacknowledgedRifts?.values?.() ?? []) {
    if (typeof ownership?.riftPath !== 'string' || !ownership.riftPath) continue;
    const owner = {
      ...ownership,
      cleanupPending: false,
      settledAt: null,
      gitBranch: ownership.gitBranch ?? ownership.branch ?? null,
    };
    owners.set(ownership.riftPath, owner);
    for (const repository of Array.isArray(ownership.repositories)
      ? ownership.repositories
      : []) {
      if (typeof repository?.riftPath !== 'string' || !repository.riftPath) continue;
      owners.set(repository.riftPath, {
        ...owner,
        repositoryChild: true,
        workspaceRiftPath: ownership.riftPath,
        gitBranch: repository.gitBranch ?? owner.gitBranch,
        gitRoot: repository.gitRoot ?? owner.gitRoot,
        prUrl: repository.prUrl ?? null,
        prState: repository.prState ?? null,
      });
    }
  }
  for (const creation of pendingCreations ?? []) {
    const riftPath = creation?.riftPath?.();
    if (
      typeof riftPath !== 'string' ||
      !riftPath ||
      typeof creation?.epicId !== 'string' ||
      !creation.epicId ||
      owners.has(riftPath)
    ) {
      continue;
    }
    owners.set(riftPath, {
      epicId: creation.epicId,
      name: typeof creation.epicName === 'string' ? creation.epicName : '',
      cleanupPending: false,
      settledAt: null,
      gitBranch: null,
      gitRoot: null,
      prUrl: null,
      prState: null,
    });
  }
  return owners;
};

export const isRetainedRiftOwnerEligible = (owner, { epicId, cutoff }) => {
  if (
    owner?.epicId !== epicId ||
    owner.cleanupPending === true ||
    typeof owner.settledAt !== 'string'
  ) {
    return false;
  }
  const settledAt = Date.parse(owner.settledAt);
  return Number.isFinite(settledAt) && settledAt <= cutoff;
};

// A manual sweep can spend time checking work state, preserving refs, and
// disposing runtimes after it first snapshots ownership. Only let that stale
// request cross the destructive boundary when the path still has exactly the
// same lifecycle owner (including the same settlement) it started with.
export const isRiftReleaseOwnerCurrent = (owner, expectedOwner) => {
  if (!expectedOwner) return !owner;
  return (
    owner?.epicId === expectedOwner.epicId &&
    owner.cleanupPending === expectedOwner.cleanupPending &&
    owner.settledAt === expectedOwner.settledAt
  );
};

// A manual confirmation is scoped to the exact successful Storage scan the
// dialog displayed. If a rescan completed while the dialog was open, do not
// silently rebind its paths to replacement rows from the newer scan.
export const collectCurrentManualRiftReleaseEntries = (
  entries,
  manualPaths,
  currentScanId,
  confirmedScanId
) => {
  if (
    typeof confirmedScanId !== 'string' ||
    !confirmedScanId ||
    confirmedScanId !== currentScanId
  ) {
    return new Map();
  }
  const entriesByPath = new Map(
    (Array.isArray(entries) ? entries : []).flatMap((entry) =>
      typeof entry?.riftPath === 'string' && entry.riftPath
        ? [[entry.riftPath, entry]]
        : []
    )
  );
  return new Map(
    [...(manualPaths ?? [])].flatMap((riftPath) => {
      const entry =
        typeof riftPath === 'string' ? entriesByPath.get(riftPath) : undefined;
      return entry ? [[riftPath, entry]] : [];
    })
  );
};

// A manual row confirmation may override lifecycle eligibility, but only for
// the exact lifecycle identity shown by the scan. A replacement owner or a
// same-Epic settle/restore transition must win over the stale confirmation.
export const isManualRiftReleaseEntryCurrent = (entry, owner) => {
  if (!entry) return false;
  const ownerStatus = owner
    ? owner.cleanupPending
      ? 'cleanupPending'
      : owner.settledAt
        ? 'settled'
        : 'active'
    : 'orphan';
  return (
    (entry.epicId ?? null) === (owner?.epicId ?? null) &&
    entry.status === ownerStatus &&
    (entry.settledAt ?? null) === (owner?.settledAt ?? null)
  );
};

// Active Epic deletion is renderer-owned, but restore-ref deletion and Rift
// removal happen in main. Require the persisted store (the crash-recovery
// source of truth) to prove the Epic is gone before crossing that boundary.
export const isEpicDeletionPersisted = (state, epicId) =>
  typeof epicId === 'string' &&
  epicId.length > 0 &&
  Array.isArray(state?.epics) &&
  !state.epics.some((epic) => epic?.id === epicId);

// Both journal phases protect the owning epic. `removing` covers the window
// between durable intent and the final move, while `released` keeps launches
// blocked until a renderer has durably reconciled and acknowledged metadata.
export const guardedEpicIdsForRiftReleaseJournal = (journal) =>
  new Set(
    (Array.isArray(journal?.releases) ? journal.releases : []).flatMap((entry) =>
      entry &&
      (entry.phase === 'removing' || entry.phase === 'released') &&
      typeof entry.epicId === 'string' &&
      entry.epicId
        ? [entry.epicId]
        : []
    )
  );

// Normalize crash/interruption state every time the renderer asks to reconcile,
// not only at process startup. A missing path proves a `removing` operation
// completed, while an existing path is retained only when main still has a
// queued/running removal reservation for its epic.
export const reconcileRiftReleaseJournal = (
  journal,
  { pathExists, isEpicRemovalPending }
) => {
  const releases = [];
  for (const entry of Array.isArray(journal?.releases) ? journal.releases : []) {
    if (
      !entry ||
      typeof entry.riftPath !== 'string' ||
      typeof entry.epicId !== 'string'
    ) {
      continue;
    }
    if (entry.phase === 'released' || !pathExists(entry.riftPath)) {
      releases.push({ ...entry, phase: 'released' });
    } else if (entry.phase === 'removing' && isEpicRemovalPending(entry.epicId)) {
      releases.push(entry);
    }
  }
  return { releases };
};

// A commit merely being reachable from some origin ref does not mean the
// epic's named branch can be recreated later. Pin the exact Rift HEAD in the
// source repository before removal; `rift gc` can then delete the clone
// without making restore depend on a remote branch that may never have
// existed, may lag, or may have been deleted after merge.
export const preserveRiftHeadForRestore = async (riftPath, owner) => {
  if (!owner?.epicId || !owner?.gitRoot || !owner?.gitBranch) {
    throw new Error('The owning epic is missing the Git metadata required for restore.');
  }
  let currentBranch = null;
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      riftPath,
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ]);
    currentBranch = stdout.trim() || null;
  } catch {}
  if (currentBranch !== owner.gitBranch) {
    throw new Error(
      `The rift is on ${currentBranch || 'a detached HEAD'}, not its recorded ${owner.gitBranch} branch.`
    );
  }
  const { stdout } = await execFileAsync('git', [
    '-C',
    riftPath,
    'rev-parse',
    '--verify',
    'HEAD',
  ]);
  const head = stdout.trim();
  if (!head) throw new Error('The rift does not have a commit to preserve.');

  const restoreRef = releasedRiftRefForEpic(owner.epicId);
  // The Rift has its own object database, so the source may not know this
  // commit even when the hash is valid. Fetching from the local Rift imports
  // the objects and atomically updates only Orion's hidden restore ref.
  await execFileAsync('git', [
    '-C',
    owner.gitRoot,
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    riftPath,
    `+HEAD:${restoreRef}`,
  ]);
  const { stdout: preservedOutput } = await execFileAsync('git', [
    '-C',
    owner.gitRoot,
    'rev-parse',
    '--verify',
    restoreRef,
  ]);
  if (preservedOutput.trim() !== head) {
    throw new Error('The exact Rift HEAD could not be verified in the source repository.');
  }
  return { head, restoreRef };
};

// Restore refs deliberately outlive a released Rift, but not the epic that
// owns it. Deleting a missing ref is an idempotent success, which keeps epic
// deletion retryable after a renderer reload or partial prior attempt.
export const deleteRiftRestoreRef = async (gitRoot, epicId) => {
  if (!gitRoot || !epicId) {
    throw new Error('The epic is missing the Git metadata required to delete its restore ref.');
  }
  await execFileAsync('git', [
    '-C',
    gitRoot,
    'update-ref',
    '-d',
    releasedRiftRefForEpic(epicId),
  ]);
};

/** Delete an Epic's restore ref from every distinct source repository. */
export const deleteRiftRestoreRefs = async (gitRoots, epicId) => {
  const errors = [];
  let deleted = 0;
  for (const gitRoot of new Set(
    (Array.isArray(gitRoots) ? gitRoots : []).filter(
      (candidate) => typeof candidate === 'string' && candidate
    )
  )) {
    try {
      await deleteRiftRestoreRef(gitRoot, epicId);
      deleted += 1;
    } catch (error) {
      errors.push(error?.stderr?.toString().trim() || error?.message || String(error));
    }
  }
  return { deleted, errors };
};
