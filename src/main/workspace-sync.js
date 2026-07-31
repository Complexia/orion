import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clearCloudRepoLink, getCloudRepoLink, publishRepo, pushRepo } from '../cloud-sync.js';

const execFileAsync = promisify(execFile);

// Workspace sync engine (contract: orion-web/docs/workspace-sync.md). Mirrors
// the local workspace — projects, epics, threads with full transcripts, token
// usage, and (optionally) code as Orion Cloud repos — to Orion Web.
//
// Everything here is gated twice: the opt-in setting (disabled by default,
// pushed from the renderer over sync:configure) AND a signed-in account. While
// either is missing the engine is inert — no timers, no network, no capture —
// so users who keep the setting off are entirely unaffected. All work happens
// on debounced timers in this process; failures land in the status broadcast,
// never in the agent-run path.

const THREAD_SYNC_BATCH = 50;
const SYNC_DEBOUNCE_MS = 15_000;
const CODE_POLL_MS = 60_000;
const MIN_SYNC_GAP_MS = 5_000;

// Injected by main.js at startup so this module needs no knowledge of Electron
// state: { getWebUrl, readSession, readStoreState, readThreadsFile, broadcast }.
let deps = null;

let settings = { enabled: false, syncCode: true };
let status = {
  enabled: false,
  authenticated: false,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  backfillDone: false,
  counts: null,
};

let syncTimer = null;
let codePollTimer = null;
let syncInFlight = null;
let syncQueued = false;
let syncGeneration = 0;
let activeSyncController = null;
let lastSyncStartedAt = 0;
// Per-thread sha256 of the serialized thread confirmed uploaded (seeded from
// the server on the first pass so restarts don't re-upload every transcript).
let knownTranscriptHashes = new Map();
let serverStateSeeded = false;
// gitRoot -> complete refs/heads state successfully pushed.
const pushedBranchStates = new Map();
// gitRoot -> last auto-publish failure; retried only on explicit "Sync now".
const publishFailures = new Map();
// Runtime ownership of local Orion Cloud links. A link without an entry is
// adopted by the first signed-in account that observes it; a later account
// must not reuse that inaccessible repository id.
const repoLinkOwners = new Map();
let syncOwnerId = null;
let totals = { projects: 0, epics: 0, threads: 0, transcriptsUploaded: 0, codePushes: 0 };

const broadcastStatus = () => {
  deps?.broadcast('sync:state', { ...status, counts: totals.threads > 0 ? { ...totals } : status.counts });
};

const setStatus = (updates) => {
  status = { ...status, ...updates };
  broadcastStatus();
};

const api = async (token, apiPath, options = {}) => {
  const response = await fetch(new URL(apiPath, deps.getWebUrl()), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) {
    const error = new Error(data?.error || `Sync request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const syncOwnerIdentity = (session) => {
  const userId = session?.user?.id ?? session?.userId;
  if (typeof userId === 'string' && userId) return userId;
  // Authenticated desktop sessions normally include user.id. Keep the
  // fallback opaque and in-memory if an older session shape does not.
  return session?.token
    ? `token:${crypto.createHash('sha256').update(session.token).digest('hex')}`
    : null;
};

const resetAccountScopedState = (ownerId) => {
  syncOwnerId = ownerId;
  serverStateSeeded = false;
  knownTranscriptHashes = new Map();
  pushedBranchStates.clear();
  publishFailures.clear();
  totals = { projects: 0, epics: 0, threads: 0, transcriptsUploaded: 0, codePushes: 0 };
  status = {
    ...status,
    lastSyncAt: null,
    lastError: null,
    backfillDone: false,
    counts: null,
  };
};

const ensureCurrentSync = (generation, signal) => {
  if (generation !== syncGeneration || signal?.aborted || !settings.enabled) {
    const error = new Error('Workspace sync was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
};

const invalidateActiveSync = () => {
  syncGeneration += 1;
  syncQueued = false;
  activeSyncController?.abort();
};

const isCancelledSync = (error, generation, signal) =>
  generation !== syncGeneration || signal?.aborted || error?.name === 'AbortError';

// --- Usage rollups ------------------------------------------------------------

const providerOfModel = (modelId) =>
  typeof modelId === 'string' && modelId.includes(':') ? modelId.split(':', 1)[0] : '';

const emptyTotals = () => ({
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
});

const statsTotals = (stats) => ({
  totalTokens: Number(stats?.totalTokens) || 0,
  inputTokens: Number(stats?.inputTokens) || 0,
  outputTokens: Number(stats?.outputTokens) || 0,
  cachedTokens: Number(stats?.cachedReadTokens) || 0,
  reasoningTokens: Number(stats?.reasoningTokens) || 0,
});

const addTotals = (target, source) => {
  target.totalTokens += source.totalTokens;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cachedTokens += source.cachedTokens;
  target.reasoningTokens += source.reasoningTokens;
};

const cumulativeDelta = (current, previous) => {
  if (!previous || current.totalTokens < previous.totalTokens) return current;
  return {
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cachedTokens: Math.max(0, current.cachedTokens - previous.cachedTokens),
    reasoningTokens: Math.max(0, current.reasoningTokens - previous.reasoningTokens),
  };
};

const normalizedTurnModelId = (message, thread) => {
  const messageModelId =
    typeof message?.modelId === 'string' && message.modelId ? message.modelId : null;
  const statsModelId =
    typeof message?.stats?.modelId === 'string' && message.stats.modelId
      ? message.stats.modelId
      : null;
  const threadModelId =
    typeof thread?.modelId === 'string' && thread.modelId ? thread.modelId : null;
  const threadProviderId = providerOfModel(threadModelId);
  const providerHint =
    providerOfModel(messageModelId) ||
    providerOfModel(statsModelId) ||
    (threadProviderId !== 'orion' ? threadProviderId : '');
  const modelId = messageModelId || statsModelId || threadModelId || 'unknown:unknown';
  return modelId.includes(':') || !providerHint ? modelId : `${providerHint}:${modelId}`;
};

/**
 * Per-model usage for one thread. Provider stat semantics differ (see the
 * driver notes in src/main/*-driver.js): codex and kimi report cumulative
 * provider-session totals on every turn. Derive their chronological provider
 * delta before assigning it to a model, because a resumed session can switch
 * models without resetting its cumulative counters. Claude/grok report
 * per-turn stats, so their full reports are assigned directly.
 */
export const computeThreadUsage = (thread) => {
  const groups = new Map();
  const previousCumulativeByProvider = new Map();
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  for (const message of messages) {
    if (message?.kind !== 'agent-run') continue;
    const modelId = normalizedTurnModelId(message, thread);
    const providerId = providerOfModel(modelId);
    let group = groups.get(modelId);
    if (!group) {
      group = { modelId, providerId, turns: 0, totals: emptyTotals() };
      groups.set(modelId, group);
    }
    group.turns += 1;
    if (!message.stats) continue;
    const turnTotals = statsTotals(message.stats);
    if (providerId === 'codex' || providerId === 'kimi') {
      const previous = previousCumulativeByProvider.get(providerId);
      addTotals(group.totals, cumulativeDelta(turnTotals, previous));
      previousCumulativeByProvider.set(providerId, turnTotals);
    } else {
      addTotals(group.totals, turnTotals);
    }
  }

  const usage = emptyTotals();
  const models = [];
  for (const group of groups.values()) {
    addTotals(usage, group.totals);
    models.push({
      modelId: group.modelId,
      providerId: group.providerId,
      turns: group.turns,
      ...group.totals,
    });
  }
  return { usage, models };
};

const threadLastActivity = (thread) => {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const last = messages[messages.length - 1];
  return last?.completedAt || last?.ts || thread?.createdAt || null;
};

const threadPayload = (thread, transcriptHash) => {
  const { usage, models } = computeThreadUsage(thread);
  return {
    id: thread.id,
    projectId: thread.projectId ?? null,
    epicId: thread.epicId ?? null,
    parentThreadId: thread.parentThreadId ?? null,
    title: typeof thread.title === 'string' ? thread.title : '',
    // The desktop's transient statuses map onto the synced vocabulary.
    status: ['idle', 'running', 'done', 'error'].includes(thread.status) ? thread.status : 'idle',
    modelId: thread.modelId ?? null,
    isSubagent: Boolean(thread.subagent),
    messageCount: Array.isArray(thread.messages) ? thread.messages.length : 0,
    createdAt: thread.createdAt ?? null,
    lastActivityAt: threadLastActivity(thread),
    transcriptHash,
    usage,
    models,
  };
};

// --- Sync passes --------------------------------------------------------------

const syncSnapshot = async (token, storeState, threads, { ownerId, generation, signal }) => {
  const projects = Array.isArray(storeState?.projects) ? storeState.projects : [];
  const epics = Array.isArray(storeState?.epics) ? storeState.epics : [];

  // Resolve each project's cloud repo link so the web UI can cross-link the
  // synced code. Cheap local git config reads; failures just leave it null.
  const projectPayloads = [];
  for (const project of projects) {
    if (typeof project?.id !== 'string') continue;
    let repoId = null;
    try {
      const gitRoot = await getGitRootSafe(project.path);
      ensureCurrentSync(generation, signal);
      if (gitRoot) {
        repoId =
          (await getCloudRepoLinkForOwner(gitRoot, ownerId, { generation, signal }))?.repoId ?? null;
      }
    } catch (error) {
      if (isCancelledSync(error, generation, signal)) throw error;
    }
    projectPayloads.push({ id: project.id, name: project.name ?? '', path: project.path ?? '', repoId });
  }

  const epicPayloads = epics
    .filter((epic) => typeof epic?.id === 'string')
    .map((epic) => ({
      id: epic.id,
      projectId: epic.repositoryProjectId ?? null,
      name: epic.name ?? '',
      description: epic.description ?? '',
      gitBranch: epic.gitBranch ?? null,
      prUrl: epic.prUrl ?? null,
      prState: epic.prState ?? null,
      createdAt: epic.createdAt ?? null,
      settledAt: epic.settledAt ?? null,
    }));

  ensureCurrentSync(generation, signal);
  await api(token, '/api/sync/snapshot', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      projects: projectPayloads,
      epics: epicPayloads,
      threadIds: threads.map((thread) => thread.id),
      complete: true,
    }),
  });
  totals.projects = projectPayloads.length;
  totals.epics = epicPayloads.length;
};

const syncThreads = async (token, threads, { generation, signal }) => {
  // Serialize every thread once; the hash doubles as the change detector, so
  // unchanged threads cost one JSON.stringify and no network.
  const entries = [];
  for (const thread of threads) {
    ensureCurrentSync(generation, signal);
    if (typeof thread?.id !== 'string') continue;
    const serialized = JSON.stringify(thread);
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    if (knownTranscriptHashes.get(thread.id) === hash) continue;
    entries.push({ thread, serialized, hash });
  }
  totals.threads = threads.length;
  if (entries.length === 0) return;

  for (let index = 0; index < entries.length; index += THREAD_SYNC_BATCH) {
    ensureCurrentSync(generation, signal);
    const batch = entries.slice(index, index + THREAD_SYNC_BATCH);
    const response = await api(token, '/api/sync/threads', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        threads: batch.map((entry) => threadPayload(entry.thread, entry.hash)),
      }),
    });

    const uploads = Array.isArray(response?.uploads) ? response.uploads : [];
    const byThreadId = new Map(batch.map((entry) => [entry.thread.id, entry]));
    const confirmed = [];
    for (const upload of uploads) {
      const entry = byThreadId.get(upload?.threadId);
      if (!entry || !upload?.url) continue;
      const put = await fetch(upload.url, {
        method: 'PUT',
        body: entry.serialized,
        signal,
        headers: { 'content-type': 'application/json' },
      });
      if (!put.ok) throw new Error(`Transcript upload failed (${put.status})`);
      confirmed.push({
        threadId: entry.thread.id,
        transcriptHash: entry.hash,
        transcriptSize: Buffer.byteLength(entry.serialized),
      });
    }
    if (confirmed.length > 0) {
      await api(token, '/api/sync/threads/complete', {
        method: 'POST',
        signal,
        body: JSON.stringify({ uploads: confirmed }),
      });
    }
    // Threads whose transcript the server already had (hash match) are synced
    // too — remember every hash in the batch, not just fresh uploads.
    for (const entry of batch) knownTranscriptHashes.set(entry.thread.id, entry.hash);
    totals.transcriptsUploaded += confirmed.length;
  }
};

const getGitRootSafe = async (startPath) => {
  if (!startPath || typeof startPath !== 'string') return null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startPath,
    });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
};

const gitBranchState = async (gitRoot) => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['for-each-ref', '--sort=refname', '--format=%(refname) %(objectname)', 'refs/heads'],
      { cwd: gitRoot }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

const getCloudRepoLinkForOwner = async (
  gitRoot,
  ownerId,
  { generation, signal }
) => {
  const link = await getCloudRepoLink(gitRoot);
  ensureCurrentSync(generation, signal);
  if (!link) {
    repoLinkOwners.delete(gitRoot);
    return null;
  }

  const recorded = repoLinkOwners.get(gitRoot);
  if (recorded && recorded.ownerId !== ownerId) {
    // The git config link is account-specific. Remove it before snapshots or
    // pushes can expose/reuse the previous account's inaccessible repository.
    await clearCloudRepoLink(gitRoot);
    ensureCurrentSync(generation, signal);
    repoLinkOwners.delete(gitRoot);
    return null;
  }

  repoLinkOwners.set(gitRoot, { ownerId, repoId: link.repoId });
  return link;
};

// Auto-publish unlinked git projects and push linked ones whose branch refs
// moved. Serialized on purpose: pushes are I/O-heavy and this must never
// compete with the agent-run path for resources.
const syncCode = async (
  token,
  storeState,
  { retryFailedPublishes = false, ownerId, generation, signal }
) => {
  const projects = Array.isArray(storeState?.projects) ? storeState.projects : [];
  const seenRoots = new Set();
  const failures = [];
  for (const project of projects) {
    ensureCurrentSync(generation, signal);
    const gitRoot = await getGitRootSafe(project?.path);
    if (!gitRoot || seenRoots.has(gitRoot)) continue;
    seenRoots.add(gitRoot);

    const branchState = await gitBranchState(gitRoot);
    ensureCurrentSync(generation, signal);
    if (!branchState) continue; // empty repo — nothing to push yet

    let link = null;
    try {
      link = await getCloudRepoLinkForOwner(gitRoot, ownerId, { generation, signal });
      if (!link) {
        if (publishFailures.has(gitRoot) && !retryFailedPublishes) {
          failures.push(publishFailures.get(gitRoot));
          continue;
        }
        const name = path
          .basename(gitRoot)
          .replace(/[^A-Za-z0-9._-]+/g, '-')
          .replace(/^[-.]+/, '')
          .slice(0, 100);
        if (!name) continue;
        // Claim any link publishRepo creates even if cancellation arrives
        // between repository creation and its first code upload.
        repoLinkOwners.set(gitRoot, { ownerId, repoId: null });
        const result = await publishRepo({
          gitRoot,
          name,
          baseUrl: deps.getWebUrl(),
          token,
          signal,
        });
        ensureCurrentSync(generation, signal);
        if (!result?.ok || result?.skipped?.length > 0) {
          throw new Error(
            result?.error ||
              result?.skipped?.[0]?.reason ||
              'Cloud repository publish failed.'
          );
        }
        if (result.repo?.id) {
          repoLinkOwners.set(gitRoot, { ownerId, repoId: result.repo.id });
        }
        publishFailures.delete(gitRoot);
        pushedBranchStates.set(gitRoot, branchState);
        totals.codePushes += 1;
        continue;
      }
      if (pushedBranchStates.get(gitRoot) === branchState) continue;
      const result = await pushRepo({
        gitRoot,
        repoId: link.repoId,
        baseUrl: deps.getWebUrl(),
        token,
        signal,
      });
      ensureCurrentSync(generation, signal);
      if (!result?.ok || result?.skipped?.length > 0) {
        throw new Error(
          result?.error || result?.skipped?.[0]?.reason || 'Cloud repository push failed.'
        );
      }
      publishFailures.delete(gitRoot);
      pushedBranchStates.set(gitRoot, branchState);
      totals.codePushes += 1;
    } catch (error) {
      if (isCancelledSync(error, generation, signal)) throw error;
      const failure = `${path.basename(gitRoot)}: ${error?.message || String(error)}`;
      publishFailures.set(gitRoot, failure);
      failures.push(failure);
    }
  }
  return failures;
};

const seedServerState = async (token, signal) => {
  if (serverStateSeeded) return;
  const state = await api(token, '/api/sync/state', { signal });
  knownTranscriptHashes = new Map(
    (state?.threads ?? [])
      .filter((thread) => thread?.transcriptHash)
      .map((thread) => [thread.id, thread.transcriptHash])
  );
  serverStateSeeded = true;
};

const runSyncPass = async (
  { retryFailedPublishes = false } = {},
  { generation, signal }
) => {
  try {
    const session = await deps.readSession();
    const authenticated = Boolean(session?.token);
    if (!settings.enabled || !authenticated) {
      setStatus({ enabled: settings.enabled, authenticated, syncing: false });
      return;
    }

    const ownerId = syncOwnerIdentity(session);
    if (syncOwnerId !== ownerId) {
      resetAccountScopedState(ownerId);
    }
    ensureCurrentSync(generation, signal);
    setStatus({ enabled: true, authenticated: true, syncing: true, lastError: null });

    await seedServerState(session.token, signal);
    ensureCurrentSync(generation, signal);

    const [storeState, threadsData] = await Promise.all([
      deps.readStoreState(),
      deps.readThreadsFile(),
    ]);
    ensureCurrentSync(generation, signal);
    const threads = Array.isArray(threadsData?.threads) ? threadsData.threads : [];

    await syncSnapshot(session.token, storeState, threads, {
      ownerId,
      generation,
      signal,
    });
    ensureCurrentSync(generation, signal);
    await syncThreads(session.token, threads, { generation, signal });
    ensureCurrentSync(generation, signal);
    let codeFailures = [];
    if (settings.syncCode) {
      codeFailures = await syncCode(session.token, storeState, {
        retryFailedPublishes,
        ownerId,
        generation,
        signal,
      });
    }
    ensureCurrentSync(generation, signal);

    setStatus({
      syncing: false,
      lastSyncAt: new Date().toISOString(),
      lastError: codeFailures.length > 0 ? codeFailures.join('\n') : null,
      backfillDone: true,
      counts: { ...totals },
    });
  } catch (error) {
    if (isCancelledSync(error, generation, signal)) return;
    if (error?.status === 401) {
      setStatus({ syncing: false, authenticated: false, lastError: 'Session expired — sign in again.' });
      return;
    }
    setStatus({ syncing: false, lastError: error?.message || String(error) });
  }
};

const runSync = (options) => {
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }
  const generation = syncGeneration;
  const controller = new AbortController();
  activeSyncController = controller;
  lastSyncStartedAt = Date.now();
  syncInFlight = runSyncPass(options, { generation, signal: controller.signal }).finally(() => {
    syncInFlight = null;
    if (activeSyncController === controller) activeSyncController = null;
    if (syncQueued) {
      syncQueued = false;
      scheduleSync(SYNC_DEBOUNCE_MS);
    }
  });
  return syncInFlight;
};

const scheduleSync = (delayMs = SYNC_DEBOUNCE_MS) => {
  if (!settings.enabled) return;
  if (syncTimer) clearTimeout(syncTimer);
  const sinceLast = Date.now() - lastSyncStartedAt;
  const delay = Math.max(delayMs, MIN_SYNC_GAP_MS - sinceLast);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runSync();
  }, delay);
  // Don't hold the process open for a pending sync.
  syncTimer.unref?.();
};

const startCodePoll = () => {
  if (codePollTimer) return;
  codePollTimer = setInterval(() => {
    // The full pass cheaply skips repos whose complete branch-ref state is unchanged.
    void runSync();
  }, CODE_POLL_MS);
  codePollTimer.unref?.();
};

const stopTimers = () => {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  if (codePollTimer) clearInterval(codePollTimer);
  codePollTimer = null;
};

// --- Public surface (called from main.js) ------------------------------------

export const initWorkspaceSync = (injectedDeps) => {
  deps = injectedDeps;
};

/** Renderer pushes the persisted settings on hydration and every change. */
export const configureWorkspaceSync = (nextSettings) => {
  const wasEnabled = settings.enabled;
  settings = {
    enabled: nextSettings?.enabled === true,
    syncCode: nextSettings?.syncCode !== false,
  };
  if (settings.enabled && !wasEnabled) {
    // First enable (or re-enable): backfill everything in the background.
    setStatus({ enabled: true, backfillDone: false });
    startCodePoll();
    scheduleSync(1_000);
  } else if (!settings.enabled && wasEnabled) {
    invalidateActiveSync();
    stopTimers();
    setStatus({ enabled: false, syncing: false });
  } else {
    setStatus({ enabled: settings.enabled });
  }
  return { ...status };
};

/** Debounced change signal — safe to call on every threads/store save. */
export const notifyWorkspaceChanged = () => {
  if (!settings.enabled) return;
  scheduleSync();
};

export const workspaceSyncNow = () => {
  if (!settings.enabled) return Promise.resolve({ ...status });
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  return runSync({ retryFailedPublishes: true }).then(() => ({ ...status }));
};

export const getWorkspaceSyncStatus = () => ({ ...status });

/** Account changes flip authentication without touching the setting. */
export const notifyAccountChanged = () => {
  invalidateActiveSync();
  serverStateSeeded = false;
  knownTranscriptHashes = new Map();
  if (!settings.enabled) return;
  setStatus({ syncing: false });
  scheduleSync(1_000);
};

export const shutdownWorkspaceSync = () => {
  invalidateActiveSync();
  stopTimers();
};
