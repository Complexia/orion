import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, dialog, Menu, nativeImage, protocol, safeStorage, shell, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  watch as watchFsPath,
  writeFileSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import started from 'electron-squirrel-startup';
import {
  clearCloudRepoLink,
  getCloudRepoLink,
  getCloudState,
  publishRepo,
  pullRepo,
  pushRepo,
} from './cloud-sync.js';
import { appUpdateDownloadedVersion, appUpdateState, checkForAppUpdate, getAppIconPath, initializeAppUpdater, invalidateAppUpdateDownload, publishAppUpdateState, scheduleAppUpdateChecks, waitForAppUpdateStagedForInstall } from './main/app-updater.js';
import { claudeSdkSessions, disposeAllClaudeSdkSessions, disposeClaudeSdkSession, disposeClaudeSdkSessionAndWait, interruptClaudeSdkRun, listClaudeSlashCommands, runClaudeSdkTurn, steerClaudeSdkRun } from './main/claude-driver.js';
import { devServerUrlForPort, killDevServers, listDevServers } from './main/dev-servers.js';
import { codexUtilityPrivacyOptions } from './main/codex-config.js';
import { codexGoalRunDrivers, createCodexAppServerDriver, runCodexGoalOp } from './main/codex-driver.js';
import { commandForModel } from './main/command-for-model.js';
import { captureGitChangeSnapshot, commandSucceeds, commitMessageForEntries, getCurrentGitBranch, getGitRoot, getGitStateForPath, getGitStatusMap, invalidateTreeGitStatusCache, readGitStatusEntries, summarizeChangedFiles, validateNewBranchName } from './main/git-utils.js';
import { createKimiAcpDriver, handleKimiSubagentLine, kimiPlanModeOneShot, kimiStatsFromSessionDisk, watchKimiSubagentSpawns } from './main/kimi-driver.js';
import { legacyMcpCleanupPromise, openCodeMcpConfigContent, orionAcpMcpServers, pendingSubagentSpawns, pendingSubagentStops, providerSupportsRunPlugin, providerSupportsThreadReader, registerMcpBridgeForRun, startLegacyMcpCleanup } from './main/mcp-bridge.js';
import { isEffectiveThreadReaderBridgeReady, isMcpBridgeProvider, isRequiredThreadReaderBridgeMissing } from './main/thread-reader-routing.js';
import { clearThreadsStorage, readThreadById, readThreadsByIds, readThreadsIndex, readThreadsPage, writeThreadsPatch, writeThreadsPatchSync } from './main/thread-storage.js';
import { extensionFromMediaInput, getMimeTypeForMediaPath, mediaPreviewExtensions, sanitizeAttachmentName } from './main/media.js';
import { getAgentModels, invalidateAgentModelsCache, listAgentModelsWithAvailability } from './main/models.js';
import { appProtocol, attachmentProtocol, getAccountSessionFilePath, getAttachmentDirectoryPath, getStorageFilePath, storageFileName, threadsDirectoryName, threadsFileName } from './main/paths.js';
import { authenticateProviderTool, checkProviderUpdates, getProcessErrorMessage, getProviderStatuses, normalizeEnabledProviderIds, providerAuthenticationGenerations, providerUpdaterConfigs, updateProviderTool, waitForProviderAuthentication } from './main/provider-updates.js';
import { activeAgentRuns, finalizingAgentRuns, killAgentChild, startingAgentRuns, stoppedAgentRuns, trackAgentShutdown, waitForAgentThreadShutdowns, waitForPendingAgentShutdowns } from './main/run-registry.js';
import { checkCommandAvailable, execFileAsync, loginShell, runShellCommand, shellQuote, startShellPathSync } from './main/shell-env.js';
import { extractSessionIdFromJsonEvent, isTerminalJsonEvent, jsonAdapterForProvider, sendsJsonEvents, stringifySummary } from './main/stream-adapters.js';
import { syncOrchestrationInstructionFiles } from './main/orchestration-files.js';
import { deleteSkill, importSkills, listSkills, openSkillsFolder, revealSkill, setSkillEnabled } from './main/skills.js';
import { findKimiSessionIndexEntry, forkSessionOnDisk } from './main/session-fork.js';
import { addAgentEventListener, emitAgentEvent, sendToAllWindows } from './main/events.js';
import { fetchRelayApiJson, fetchRemotePairingProofJson } from './main/remote-api.js';
import {
  cancelRemotePairing,
  configureRemoteControl,
  connectRemoteMachine,
  deregisterRelayMachine,
  disconnectRemoteMachine,
  fetchRemoteSnapshot,
  fetchRemoteThread,
  forwardAgentEventToRemote,
  getRemoteControlState,
  initRemoteControl,
  notifyRemoteControlAccountChanged,
  notifyRemoteCommandRendererLost,
  claimRemoteCommand,
  notifyRemoteWorkspaceChanged,
  pairWithRemoteHost,
  removeRemoteMachine,
  resolveRemoteCommand,
  revokeRemoteDevice,
  runRemoteTurn,
  shutdownRemoteControl,
  startRemotePairing,
  stopRemoteTurn,
  waitForRemoteControlPersistence,
} from './main/remote-control.js';
import {
  configureWorkspaceSync,
  getWorkspaceSyncStatus,
  initWorkspaceSync,
  notifyAccountChanged as notifyWorkspaceSyncAccountChanged,
  notifyWorkspaceChanged,
  shutdownWorkspaceSync,
  workspaceSyncNow,
} from './main/workspace-sync.js';
import { codexSubagentTitle, createSubagentTracker, cursorAgentTranscriptFile, handleCodexRolloutLine, handleCursorSubagentLine, watchCodexSubagentSpawns } from './main/subagent-trackers.js';
import { createGrokAcpDriver, grokStatsFromPromptMeta, grokSubagentUpdatesFile, handleGrokSubagentLine } from './main/grok-driver.js';
import { listRiftTrashPaths, riftBinaryPath, riftCreate, riftGc, riftInit, riftPackageVersion, riftRemove, riftSlug } from './main/rift.js';
import {
  collectCurrentManualRiftReleaseEntries,
  collectPendingRiftOwnersByPath,
  createRiftRemovalCoordinator,
  deleteRiftRestoreRef,
  guardedEpicIdsForRiftReleaseJournal,
  isEpicDeletionPersisted,
  isManualRiftReleaseEntryCurrent,
  isRiftReleaseOwnerCurrent,
  isRetainedRiftOwnerEligible,
  preserveRiftHeadForRestore,
  reconcileRiftReleaseJournal,
  releasedRiftRefForEpic,
} from './main/rift-release.js';
import { collapseNestedPaths, readVolumeFreeSpace, reclaimedBytesAcrossVolumes } from './main/rift-storage-accounting.js';
import { isRiftDirectoryPath, listRiftRootEntries, loadSizeCache, measurePathSize, riftHasMarker, riftRootForGitRoot, saveSizeCache } from './main/rift-storage.js';

// Set the application name as early as possible.
// This helps the Dock, menu bar, and tooltips show "Orion" instead of "Electron"
// especially during development (`npm start`).
app.setName('Orion');
app.setAppUserModelId('com.complexia.orion');

const hiddenSystemDirectories = new Set(['.git']);
let quitAfterPendingWork = false;
let quitBarrierSatisfied = false;
let appShutdownRequested = false;
let riftShutdownRequested = false;
const pendingRiftCreations = new Set();
const pendingRiftEpicIds = new Set();
// Destructive Rift operations share one queue. Its reference-counted epic
// reservations cover both queued and running work, while durable release
// journal ownership remains separate until renderer acknowledgement.
const riftRemovalCoordinator = createRiftRemovalCoordinator();
const pendingRiftReleaseEpicIds = new Set();
// Successful workspaces remain main-owned until the renderer proves the epic
// binding reached durable store storage. This bridges invoke completion,
// renderer reloads, and process crashes without exposing the source checkout.
const unacknowledgedRifts = new Map(); // epicId -> ownership
const codexGoalOpsByThread = new Map(); // threadId -> Set<{ controller, promise }>
const disposeCodexGoalOpsForThread = async (threadId) => {
  const operations = [...(codexGoalOpsByThread.get(threadId) ?? [])];
  if (operations.length === 0) return false;
  for (const operation of operations) operation.controller.abort();
  await Promise.allSettled(operations.map((operation) => operation.promise));
  return true;
};
const disposeAllCodexGoalOps = () => {
  const shutdowns = [...codexGoalOpsByThread.keys()].map((threadId) =>
    disposeCodexGoalOpsForThread(threadId)
  );
  if (shutdowns.length > 0) trackAgentShutdown(Promise.all(shutdowns));
};
const titleGenerationsByThread = new Map(); // threadId -> Set<{ controller, promise }>
const disposeTitleGenerationsForThread = async (threadId) => {
  const generations = [...(titleGenerationsByThread.get(threadId) ?? [])];
  if (generations.length === 0) return false;
  for (const generation of generations) generation.controller.abort();
  await Promise.allSettled(generations.map((generation) => generation.promise));
  return true;
};
const disposeAllTitleGenerations = () => {
  const shutdowns = [...titleGenerationsByThread.keys()].map((threadId) =>
    disposeTitleGenerationsForThread(threadId)
  );
  if (shutdowns.length > 0) trackAgentShutdown(Promise.all(shutdowns));
};
const PROVIDER_UPDATE_PROGRESS_OUTPUT_LIMIT = 24_000;
const PROVIDER_UPDATE_PROGRESS_INTERVAL_MS = 100;
let activeProviderUpdate = null;
let lastProviderUpdateProgress = null;
const providerUpdateOutputTail = (current, chunk) => {
  const combined = `${current || ''}${chunk || ''}`;
  return combined.length > PROVIDER_UPDATE_PROGRESS_OUTPUT_LIMIT
    ? combined.slice(-PROVIDER_UPDATE_PROGRESS_OUTPUT_LIMIT)
    : combined;
};
const cleanProviderUpdateOutput = (value) =>
  String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n');
const providerUpdateProgressMessage = (output, fallback) => {
  const lines = String(output || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) || fallback;
};
const providerUpdatePercent = (output) => {
  const matches = [...String(output || '').matchAll(/(?:^|\s)(100|\d{1,2}(?:\.\d+)?)%/g)];
  if (matches.length === 0) return null;
  const percent = Number(matches.at(-1)?.[1]);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
};
const publishProviderUpdateProgress = (operation, patch) => {
  const progress = {
    ...(operation.lastProgress || {}),
    operationId: operation.id,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  operation.lastProgress = progress;
  lastProviderUpdateProgress = progress;
  sendToAllWindows('providers:updateProgress', progress);
  return progress;
};
const cancelActiveProviderUpdate = (operationId = null) => {
  const operation = activeProviderUpdate;
  if (!operation || (operationId && operation.id !== operationId)) return false;
  if (operation.controller.signal.aborted) return true;
  publishProviderUpdateProgress(operation, {
    status: 'cancelling',
    message: operation.lastProgress?.providerLabel
      ? `Stopping ${operation.lastProgress.providerLabel} update…`
      : 'Stopping provider updates…',
  });
  operation.controller.abort();
  return true;
};
const waitForProviderUpdateShutdown = () =>
  activeProviderUpdate?.promise?.catch(() => {}) ?? Promise.resolve();
const pendingRiftSetupError = (input) => {
  if (typeof input?.epicId !== 'string') return null;
  if (pendingRiftEpicIds.has(input.epicId)) {
    return 'This epic’s rift workspace is still being created — try again in a moment';
  }
  if (
    riftRemovalCoordinator.hasEpic(input.epicId) ||
    pendingRiftReleaseEpicIds.has(input.epicId)
  ) {
    return 'This epic’s rift workspace is being removed — try again after restoring it';
  }
  return null;
};
const cancelPendingRiftCreations = () => {
  for (const creation of pendingRiftCreations) creation.cancel();
};
const waitForPendingRiftCreations = async (timeoutMs = 8_000) => {
  const deadline = new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs);
  });
  while (pendingRiftCreations.size > 0) {
    const result = await Promise.race([
      Promise.allSettled([...pendingRiftCreations].map((creation) => creation.promise)).then(
        () => 'settled'
      ),
      deadline,
    ]);
    if (result === 'timeout') {
      // A force-killed Rift child should normally settle well before this
      // deadline. Journal any workspace path already reported so startup can
      // retry cleanup without holding Cmd-Q open indefinitely.
      rememberRiftCleanupForQuit(
        [...pendingRiftCreations].map((creation) => creation.riftPath()).filter(Boolean)
      );
      return;
    }
  }
};
const riftQuitCleanupPaths = new Set();
let riftCleanupJournalQueue = Promise.resolve();
const riftCleanupJournalPath = () => path.join(app.getPath('userData'), 'orphaned-rifts.json');
const updateRiftCleanupJournal = (update) => {
  riftCleanupJournalQueue = riftCleanupJournalQueue
    .catch(() => {})
    .then(async () => {
      const journalPath = riftCleanupJournalPath();
      let paths = [];
      try {
        const parsed = JSON.parse(await fs.readFile(journalPath, 'utf-8'));
        if (Array.isArray(parsed)) paths = parsed.filter((value) => typeof value === 'string');
      } catch {}
      const nextPaths = [...new Set([...(await update(paths)), ...riftQuitCleanupPaths])];
      const tempPath = `${journalPath}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(journalPath), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(nextPaths), 'utf-8');
      await fs.rename(tempPath, journalPath);
    });
  return riftCleanupJournalQueue;
};
const rememberRiftCleanup = (riftPath) =>
  updateRiftCleanupJournal((paths) => [...paths, riftPath]);
const forgetRiftCleanup = (riftPath) =>
  updateRiftCleanupJournal((paths) => paths.filter((candidate) => candidate !== riftPath));
const hasRememberedRiftCleanup = async (riftPath) => {
  let remembered = false;
  await updateRiftCleanupJournal((paths) => {
    remembered = paths.includes(riftPath);
    return paths;
  });
  return remembered;
};
const isSafeMarkerlessRiftPath = (riftPath) => {
  const resolvedPath = path.resolve(riftPath);
  const riftsDirectory = path.dirname(path.dirname(resolvedPath));
  if (
    path.basename(riftsDirectory) !== '.rifts' ||
    !/-[0-9a-f]{24}$/.test(path.basename(resolvedPath))
  ) {
    return false;
  }
  try {
    const stat = lstatSync(resolvedPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};
const removeRememberedRiftCleanup = async (riftPath, { allowMarkerless = false } = {}) => {
  if (existsSync(path.join(riftPath, '.rift'))) {
    await riftRemove(riftPath);
    return;
  }
  if (!allowMarkerless || !isSafeMarkerlessRiftPath(riftPath)) {
    throw new Error(
      'The rift path still exists but its .rift marker is missing; refusing unsafe removal.'
    );
  }
  // A failed `rift create` can leave the deterministic destination behind
  // before writing its marker. Only pre-journaled Orion destinations reach
  // this path, and the OS trash keeps their removal recoverable.
  await shell.trashItem(riftPath);
};
const rememberRiftCleanupForQuit = (riftPaths) => {
  for (const riftPath of riftPaths) riftQuitCleanupPaths.add(riftPath);
  if (riftQuitCleanupPaths.size === 0) return;
  try {
    const journalPath = riftCleanupJournalPath();
    let paths = [];
    try {
      const parsed = JSON.parse(readFileSync(journalPath, 'utf-8'));
      if (Array.isArray(parsed)) paths = parsed.filter((value) => typeof value === 'string');
    } catch {}
    const tempPath = `${journalPath}.${process.pid}.quit.tmp`;
    mkdirSync(path.dirname(journalPath), { recursive: true });
    writeFileSync(
      tempPath,
      JSON.stringify([...new Set([...paths, ...riftQuitCleanupPaths])]),
      'utf-8'
    );
    renameSync(tempPath, journalPath);
  } catch (error) {
    console.error('Could not journal pending Rift cleanup before quit', error);
  }
};
const retryOrphanedRiftCleanup = () =>
  updateRiftCleanupJournal(async (paths) => {
    const persistedOwners = await readPersistedRiftOwners();
    const remaining = [];
    for (const riftPath of paths) {
      // The renderer can durably save active ownership immediately before a
      // crash prevents its acknowledgement IPC. Active ownership wins over the
      // stale journal; cleanup-pending ownership remains eligible for recovery.
      const persistedOwner = persistedOwners.get(riftPath);
      if (persistedOwner && !persistedOwner.cleanupPending) continue;
      if (!existsSync(riftPath)) continue;
      try {
        await removeRememberedRiftCleanup(riftPath, { allowMarkerless: true });
      } catch {
        remaining.push(riftPath);
      }
    }
    return remaining;
  });

let pendingDesktopAuth = null;
let inMemoryAccountSession = null;
let lastPublishedAccountAuthenticated = null;
let storageSaveQueue = Promise.resolve();
let threadsSaveQueue = Promise.resolve();
// The quit-time synchronous threads flush jumps the async save queue; the
// sequence pair lets a stale queued write detect it has been superseded so
// its manifest commit cannot clobber the newer quit-time snapshot. A commit
// already submitted to the fs when the sync flush runs can still land after
// it — the retained sync snapshot lets that writer notice (post-rename seq
// check) and reinstall the newer data, which matters on macOS where the main
// process outlives the window and the clobbered file would persist.
let threadsWriteSeq = 0;
let threadsCommittedSeq = 0;
let threadsSyncSnapshot = null; // { seq, patch } from the latest sync flush
// A BrowserWindow can exist while its renderer is still loading or has
// crashed/reloaded before installing the remote-command subscription. Only a
// renderer that explicitly announces readiness may receive a command.
let remoteCommandRenderer = null;
let remoteCommandRendererCleanup = null;

const markRemoteCommandRendererReady = (webContents) => {
  if (!webContents || webContents.isDestroyed()) return { ok: false };
  if (remoteCommandRenderer === webContents) return { ok: true };
  remoteCommandRendererCleanup?.();
  remoteCommandRenderer = webContents;
  const clear = () => {
    webContents.removeListener('did-start-loading', clear);
    webContents.removeListener('render-process-gone', clear);
    webContents.removeListener('destroyed', clear);
    if (remoteCommandRenderer === webContents) {
      remoteCommandRenderer = null;
      notifyRemoteCommandRendererLost();
    }
    if (remoteCommandRendererCleanup === clear) remoteCommandRendererCleanup = null;
  };
  remoteCommandRendererCleanup = clear;
  webContents.once('did-start-loading', clear);
  webContents.once('render-process-gone', clear);
  webContents.once('destroyed', clear);
  return { ok: true };
};

const dispatchRemoteCommand = (payload) => {
  const target = remoteCommandRenderer;
  if (!target || target.isDestroyed()) {
    remoteCommandRendererCleanup?.();
    return 0;
  }
  try {
    target.send('remote:commandRequest', payload);
    return 1;
  } catch {
    remoteCommandRendererCleanup?.();
    return 0;
  }
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: attachmentProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const sanitizeStoreValue = (value) => {
  try {
    JSON.parse(value);
    return value;
  } catch {}

  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== '}') continue;
    const candidate = value.slice(0, index + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  return null;
};

// The persisted store is the main process's only view of renderer state, and
// the one that survives a crash. The renderer flushes it before any rift
// operation, so reading it here stays in step with what the user just did.
const readPersistedStoreState = async () => {
  try {
    const value = sanitizeStoreValue(await fs.readFile(getStorageFilePath(), 'utf-8'));
    if (!value) return null;
    return JSON.parse(value)?.state ?? null;
  } catch {
    return null;
  }
};

const readPersistedRiftOwners = async (state) => {
  const owners = new Map();
  const epics = (state === undefined ? await readPersistedStoreState() : state)?.epics;
  if (!Array.isArray(epics)) return owners;
  for (const epic of epics) {
    if (typeof epic?.id === 'string' && typeof epic?.riftPath === 'string') {
      owners.set(epic.riftPath, {
        epicId: epic.id,
        cleanupPending: epic.riftCleanupPending === true,
        settledAt: typeof epic.settledAt === 'string' ? epic.settledAt : null,
        name: typeof epic.name === 'string' ? epic.name : '',
        gitBranch: typeof epic.gitBranch === 'string' ? epic.gitBranch : null,
        gitRoot: typeof epic.gitRoot === 'string' ? epic.gitRoot : null,
        prUrl: typeof epic.prUrl === 'string' ? epic.prUrl : null,
        prState: typeof epic.prState === 'string' ? epic.prState : null,
      });
    }
  }
  return owners;
};

const readPersistedRuntimeThreadIdsByEpic = async () => {
  let threads = [];
  try {
    threads = (await readThreadsIndex()).entries;
  } catch {}
  const result = new Map();
  const knownEpicIds = new Set(
    threads
      .map((thread) => (typeof thread?.epicId === 'string' ? thread.epicId : null))
      .filter(Boolean)
  );
  for (const epicId of knownEpicIds) {
    const threadIds = new Set(
      threads
        .filter((thread) => thread?.epicId === epicId && typeof thread?.id === 'string')
        .map((thread) => thread.id)
    );
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      for (const thread of threads) {
        if (
          typeof thread?.id === 'string' &&
          typeof thread?.parentThreadId === 'string' &&
          threadIds.has(thread.parentThreadId) &&
          !threadIds.has(thread.id)
        ) {
          threadIds.add(thread.id);
          foundChild = true;
        }
      }
    }
    result.set(epicId, [...threadIds]);
  }
  return result;
};

const base64Url = (value) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const randomBase64Url = (byteLength = 32) => base64Url(crypto.randomBytes(byteLength));

const sha256Base64Url = (value) => base64Url(crypto.createHash('sha256').update(value).digest());

const getOrionWebUrl = () => {
  // Packaged builds talk to the live site; development defaults to the local
  // Orion Web dev server. ORION_WEB_URL overrides either.
  const defaultWebUrl = app.isPackaged ? 'https://orioncode.xyz' : 'http://localhost:3000';
  const rawUrl = process.env.ORION_WEB_URL || defaultWebUrl;
  const url = new URL(rawUrl);
  url.hash = '';
  url.search = '';
  return url;
};

const remotePairingProofRequest = async (method, body, token, { signal } = {}) => {
  const { response, data } = await fetchRemotePairingProofJson({
    url: new URL('/api/desktop-auth/remote-pairing-proof', getOrionWebUrl()),
    method,
    token,
    body,
    signal,
  });
  if (!response.ok) {
    throw new Error(
      data?.error ||
        (response.status === 404
          ? 'Orion Cloud does not support secure remote pairing yet.'
          : 'Orion Cloud could not authenticate remote pairing.')
    );
  }
  return data;
};

const createRemotePairingProof = async ({ token, challenge, machineId, signal }) => {
  const data = await remotePairingProofRequest('POST', { challenge, machineId }, token, { signal });
  if (typeof data?.proof !== 'string' || !data.proof) {
    throw new Error('Orion Cloud returned an invalid remote pairing proof.');
  }
  return data.proof;
};

const verifyRemotePairingProof = async ({ proof, challenge, machineId, signal }) => {
  try {
    const data = await remotePairingProofRequest('PUT', { proof, challenge, machineId }, null, { signal });
    return typeof data?.userId === 'string' && data.userId ? data.userId : null;
  } catch {
    return null;
  }
};

// Remote control over the internet. Only reached when the user has switched
// remote control to relay mode; direct mode never calls any of this.
const getOrionRelayUrl = () => {
  const defaultRelayUrl = app.isPackaged ? 'wss://relay.orioncode.xyz' : 'ws://localhost:8787';
  return process.env.ORION_RELAY_URL || defaultRelayUrl;
};

/**
 * Bearer-authed call to the relay APIs on orion-next. The desktop account
 * token authenticates THESE calls and never leaves this function: what comes
 * back is a short-lived relay ticket, and that is all the relay ever sees.
 */
const relayApiRequest = async (apiPath, body, { signal, method, allowNotFound = false } = {}) => {
  const session = await readAccountSession();
  if (!session?.token) throw new Error('Sign in to your Orion account first.');
  const { response, data } = await fetchRelayApiJson({
    url: new URL(apiPath, getOrionWebUrl()),
    method,
    token: session.token,
    body,
    signal,
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      data?.error ||
        (response.status === 404
          ? 'Orion Cloud does not support internet remote control yet.'
          : 'Orion Cloud refused the relay request.')
    );
  }
  return data;
};

const registerRelayDevice = ({ machineId, name, platform, appVersion, signal }) =>
  relayApiRequest('/api/relay/devices', { machineId, name, platform, appVersion }, { signal });

// Removing a machine that is not registered (or was already removed) is the
// state the user asked for — treat the route's 404 as success rather than
// surfacing an error for an idempotent removal.
const deregisterRelayDevice = ({ machineId, signal }) =>
  relayApiRequest(`/api/relay/devices/${encodeURIComponent(machineId)}`, undefined, {
    method: 'DELETE',
    allowNotFound: true,
    signal,
  });

const mintRelayTicket = async ({ role, machineId, signal }) => {
  const data = await relayApiRequest('/api/relay/ticket', { role, machineId }, { signal });
  if (typeof data?.ticket !== 'string' || !data.ticket) {
    throw new Error('Orion Cloud returned an invalid relay ticket.');
  }
  const relayUrl =
    typeof data?.relayUrl === 'string' && data.relayUrl.trim() ? data.relayUrl.trim() : getOrionRelayUrl();
  try {
    const parsed = new URL(relayUrl);
    const allowedProtocols = app.isPackaged ? ['wss:', 'https:'] : ['ws:', 'wss:', 'http:', 'https:'];
    if (!allowedProtocols.includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error('Orion Cloud returned an invalid relay address.');
  }
  return { ticket: data.ticket, relayUrl };
};

const desktopAccountForRenderer = (session) => {
  if (!session?.token || !session?.user) {
    return { authenticated: false, user: null, expiresAt: null };
  }

  return {
    authenticated: true,
    user: session.user,
    expiresAt: session.expiresAt ?? null,
  };
};

// macOS ties keychain ACLs to the app's code signature. In development the app
// runs under the stock Electron binary, whose signature never matches the ACL
// on the "Orion Safe Storage" keychain item, so every safeStorage call triggers
// a login-keychain password prompt. Only use the keychain in packaged builds,
// which are signed with a stable Developer ID.
const canUseSafeStorage = () => app.isPackaged && safeStorage.isEncryptionAvailable();

const encryptAccountToken = (token) => {
  if (!canUseSafeStorage()) {
    return { encrypted: false, value: token };
  }
  return {
    encrypted: true,
    value: safeStorage.encryptString(token).toString('base64'),
  };
};

const decryptAccountToken = (storedToken) => {
  if (!storedToken || typeof storedToken !== 'object') return null;
  if (storedToken.encrypted) {
    // Decrypting in dev would re-trigger the keychain prompt; treat the
    // session as absent and let the user sign in again.
    if (!app.isPackaged) return null;
    return safeStorage.decryptString(Buffer.from(String(storedToken.value || ''), 'base64'));
  }
  return typeof storedToken.value === 'string' ? storedToken.value : null;
};

const readAccountSession = async () => {
  if (inMemoryAccountSession) return inMemoryAccountSession;

  try {
    const raw = await fs.readFile(getAccountSessionFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const token = decryptAccountToken(parsed.token);
    if (!token || !parsed.user) return null;
    return {
      token,
      user: parsed.user,
      expiresAt: parsed.expiresAt ?? null,
      createdAt: parsed.createdAt ?? null,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('account:load error', error);
    }
    return null;
  }
};

const writeAccountSession = async (session) => {
  inMemoryAccountSession = session;

  // In packaged builds, never persist account tokens without OS-backed
  // encryption. Development builds store the token unencrypted to avoid the
  // keychain password prompt on every launch.
  if (app.isPackaged && !safeStorage.isEncryptionAvailable()) {
    return;
  }

  const filePath = getAccountSessionFilePath();
  const payload = {
    token: encryptAccountToken(session.token),
    user: session.user,
    expiresAt: session.expiresAt ?? null,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
};

const clearAccountSession = async () => {
  inMemoryAccountSession = null;
  // Authorization ends when sign-out begins, not after the session file has
  // finished being removed. This synchronously closes remote listeners and
  // sessions before any account transition can await filesystem work.
  notifyRemoteControlAccountChanged(null, { reconcile: false });
  await fs.rm(getAccountSessionFilePath(), { force: true });
};

const publishAccountState = async (session) => {
  const effectiveSession = session === undefined ? await readAccountSession() : session;
  const account = desktopAccountForRenderer(effectiveSession);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('account:changed', account);
  }
  // Only real sign-in/out transitions invalidate account-scoped sync state.
  // Startup restoration and OAuth validation refreshes still update renderers
  // without forcing a full workspace backfill.
  if (
    lastPublishedAccountAuthenticated !== null &&
    lastPublishedAccountAuthenticated !== account.authenticated
  ) {
    notifyWorkspaceSyncAccountChanged();
  }
  lastPublishedAccountAuthenticated = account.authenticated;
  // Remote control is gated on the live session: sign-out must stop the
  // listener and drop every connection immediately, sign-in re-arms it.
  notifyRemoteControlAccountChanged(effectiveSession);
  return account;
};

const verifyAccountSession = async () => {
  const session = await readAccountSession();
  if (!session?.token) return desktopAccountForRenderer(null);

  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    await clearAccountSession();
    return publishAccountState(null);
  }

  try {
    const response = await fetch(new URL('/api/desktop-auth/session', getOrionWebUrl()), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    });

    if (response.status === 401) {
      await clearAccountSession();
      return publishAccountState(null);
    }

    if (!response.ok) {
      return desktopAccountForRenderer(session);
    }

    const data = await response.json();
    const nextSession = {
      token: session.token,
      user: data.user ?? session.user,
      expiresAt: data.expiresAt ?? session.expiresAt ?? null,
    };
    await writeAccountSession(nextSession);
    return publishAccountState(nextSession);
  } catch {
    return desktopAccountForRenderer(session);
  }
};

const buildDesktopAuthUrl = (state, codeChallenge) => {
  const url = new URL('/desktop/authorize', getOrionWebUrl());
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', `${appProtocol}://auth/callback`);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('app_version', app.getVersion());
  url.searchParams.set('platform', process.platform);
  return url;
};

const startDesktopAuth = async () => {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = sha256Base64Url(codeVerifier);
  pendingDesktopAuth = {
    state,
    codeVerifier,
    createdAt: Date.now(),
  };

  const url = buildDesktopAuthUrl(state, codeChallenge);
  await shell.openExternal(url.toString());
  return { ok: true, url: url.toString() };
};

const isDesktopAuthCallbackUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${appProtocol}:` && url.hostname === 'auth' && url.pathname === '/callback';
  } catch {
    return false;
  }
};

const exchangeDesktopAuthCode = async ({ code, state, codeVerifier }) => {
  const response = await fetch(new URL('/api/desktop-auth/exchange', getOrionWebUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      codeVerifier,
      appVersion: app.getVersion(),
      platform: process.platform,
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(data?.error || 'Could not authorize Orion Desktop.');
  }

  return data;
};

const handleDesktopAuthCallback = async (rawUrl) => {
  if (!isDesktopAuthCallbackUrl(rawUrl)) return false;

  const callbackUrl = new URL(rawUrl);
  const state = callbackUrl.searchParams.get('state');
  const code = callbackUrl.searchParams.get('code');
  const error = callbackUrl.searchParams.get('error');

  if (error) {
    await publishAccountState(await readAccountSession());
    return true;
  }

  const pending = pendingDesktopAuth;
  pendingDesktopAuth = null;

  if (!pending || !state || pending.state !== state || !code) {
    await publishAccountState(await readAccountSession());
    return true;
  }

  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    await publishAccountState(await readAccountSession());
    return true;
  }

  try {
    const session = await exchangeDesktopAuthCode({
      code,
      state,
      codeVerifier: pending.codeVerifier,
    });
    await writeAccountSession(session);
    await publishAccountState(session);
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  } catch (exchangeError) {
    console.error('account:exchange error', exchangeError);
    await publishAccountState(await readAccountSession());
  }

  return true;
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The single-instance lock is scoped to userData, and two live instances
// sharing one profile would clobber the store file. Give the dev build its
// own profile so it can run alongside the installed app instead of quitting
// immediately; seed it from the installed app's store on first run.
if (!app.isPackaged) {
  const liveUserData = app.getPath('userData');
  const devUserData = `${liveUserData} (dev)`;
  try {
    mkdirSync(devUserData, { recursive: true });
    // Seed only a brand-new dev profile — BOTH files absent. An existing dev
    // profile owns its history: copying just the installed profile's threads
    // file into it would graft the installed transcripts over the dev
    // store's embedded threads on hydration (the pre-split migration path),
    // and a surviving dev threads file next to a copied installed store
    // would graft dev transcripts onto unrelated projects/settings. A
    // partial dev profile recovers through the renderer's own hydration
    // fallbacks instead.
    if (
      !existsSync(path.join(devUserData, storageFileName)) &&
      !existsSync(path.join(devUserData, threadsFileName)) &&
      !existsSync(path.join(devUserData, threadsDirectoryName))
    ) {
      for (const fileName of [storageFileName, threadsFileName]) {
        const liveFile = path.join(liveUserData, fileName);
        const devFile = path.join(devUserData, fileName);
        if (!existsSync(devFile) && existsSync(liveFile)) {
          copyFileSync(liveFile, devFile);
        }
      }
      const liveThreadsDirectory = path.join(liveUserData, threadsDirectoryName);
      const devThreadsDirectory = path.join(devUserData, threadsDirectoryName);
      if (!existsSync(devThreadsDirectory) && existsSync(liveThreadsDirectory)) {
        cpSync(liveThreadsDirectory, devThreadsDirectory, { recursive: true });
      }
    }
  } catch (error) {
    console.warn('Could not seed dev profile, starting empty:', error);
  }
  app.setPath('userData', devUserData);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(appProtocol, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(appProtocol);
}

app.on('second-instance', (_event, argv) => {
  const callbackUrl = argv.find((arg) => isDesktopAuthCallbackUrl(arg));
  if (callbackUrl) {
    void handleDesktopAuthCallback(callbackUrl);
  }

  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  void handleDesktopAuthCallback(url);
});

const createWindow = () => {
  const macWindowChrome =
    process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 22, y: 22 },
        }
      : {};

  const appIcon = nativeImage.createFromPath(getAppIconPath());

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1451,
    height: 907,
    minWidth: 900,
    minHeight: 600,
    title: 'Orion',
    icon: appIcon,
    backgroundColor: '#101012',
    ...macWindowChrome,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security best practices: nodeIntegration false, contextIsolation true (default)
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // DevTools can still be opened manually from the Electron menu when needed.
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Hydrate the release guard before a renderer can launch work against a
  // stale path. The journal stays authoritative until renderer persistence is
  // acknowledged, including across full app restarts.
  try {
    await hydrateRiftReleaseJournal();
  } catch (error) {
    console.error('Could not hydrate Rift release protection', error);
  }
  // Orphan recovery first: the retention sweep reads the same journal, and
  // neither should hold the first window open.
  void retryOrphanedRiftCleanup().then(() => startRiftRetentionSweep());
  // Reinforce the app name (helps in some dev launch scenarios)
  app.setName('Orion');

  // Start maintenance immediately, but never hold the first window behind
  // shell startup or filesystem cleanup. Provider and MCP operations await
  // only the prerequisite they actually need.
  startShellPathSync();
  startLegacyMcpCleanup();

  // Workspace sync (opt-in, contract in orion-web/docs/workspace-sync.md).
  // Seed the engine from the persisted store so an enabled sync resumes after
  // restart without waiting for the renderer to hydrate; the renderer re-pushes
  // the settings over sync:configure on hydration and every change.
  initWorkspaceSync({
    getWebUrl: () => getOrionWebUrl(),
    readSession: () => readAccountSession(),
    readStoreState: () => readPersistedStoreState(),
    readThreadsIndex,
    readThreadsByIds,
    broadcast: (channel, payload) => sendToAllWindows(channel, payload),
  });
  void readPersistedStoreState().then((state) => {
    if (state?.workspaceSyncSettings) {
      configureWorkspaceSync(state.workspaceSyncSettings);
    }
  });

  // Remote control (opt-in): lets paired Orion instances on the same account
  // view and drive this one. Same seeding strategy as workspace sync.
  await initRemoteControl({
    readSession: () => readAccountSession(),
    readStoreState: () => readPersistedStoreState(),
    readThreadsIndex,
    readThreadById,
    // Cached-list entry point (same path as agent:listModels without `force`),
    // so a remote `models` request never triggers a CLI re-probe by itself.
    listAgentModels: () => listAgentModelsWithAvailability(),
    broadcast: (channel, payload) => sendToAllWindows(channel, payload),
    dispatchRendererCommand: (payload) => dispatchRemoteCommand(payload),
    createRemotePairingProof,
    verifyRemotePairingProof,
    registerRelayDevice,
    deregisterRelayDevice,
    mintRelayTicket,
    getAppVersion: () => app.getVersion(),
  });
  addAgentEventListener((event) => forwardAgentEventToRemote(event));
  void readPersistedStoreState()
    .then((state) =>
      state?.remoteControlSettings
        ? configureRemoteControl({
            ...state.remoteControlSettings,
            // Mirror the store's hydration lift (src/store.ts persist merge):
            // the UI has no separate allow-incoming toggle anymore, and this
            // startup path reads the raw persisted JSON before the renderer
            // has hydrated and reconfigured.
            allowIncoming:
              state.remoteControlSettings.enabled === true ||
              state.remoteControlSettings.allowIncoming === true,
          })
        : undefined
    )
    .catch((error) => {
      console.error('Could not restore remote control settings', error);
    });

  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Orion',
      applicationVersion: app.getVersion(),
      copyright: '© Complexia',
    });
  }

  protocol.handle(attachmentProtocol, async (request) => {
    try {
      const url = new URL(request.url);
      // The renderer may pass several `path` candidates for one media
      // reference (e.g. a relative markdown path resolved against the project
      // dir and against the grok session dir) — serve the first that exists.
      const requestedPaths = url.searchParams.getAll('path');
      const attachmentDir = path.resolve(getAttachmentDirectoryPath());
      const candidatePaths = requestedPaths.length
        ? requestedPaths.map((requestedPath) =>
            path.resolve(
              /^~[\\/]/.test(requestedPath)
                ? path.join(os.homedir(), requestedPath.slice(2))
                : requestedPath
            )
          )
        : [
            path.resolve(
              getAttachmentDirectoryPath(),
              path.basename(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
            ),
          ];

      let filePath = null;
      let stats = null;
      for (const candidate of candidatePaths) {
        const isSavedAttachment = candidate.startsWith(`${attachmentDir}${path.sep}`);
        const isMediaPreview = mediaPreviewExtensions.has(path.extname(candidate).toLowerCase());
        if (!isSavedAttachment && !isMediaPreview) continue;
        const candidateStats = await fs.stat(candidate).catch(() => null);
        if (candidateStats?.isFile()) {
          filePath = candidate;
          stats = candidateStats;
          break;
        }
      }
      if (!filePath) {
        return new Response('Not found', { status: 404 });
      }

      const headers = {
        'content-type': getMimeTypeForMediaPath(filePath),
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };

      if (stats.size === 0) {
        return new Response(new Uint8Array(), { headers });
      }

      // Honor Range requests so <video> can seek.
      let start = 0;
      let end = stats.size - 1;
      let status = 200;
      const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
      if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
        if (rangeMatch[1]) {
          start = Number(rangeMatch[1]);
          if (rangeMatch[2]) end = Math.min(end, Number(rangeMatch[2]));
        } else {
          start = Math.max(0, stats.size - Number(rangeMatch[2]));
        }
        if (start > end || start >= stats.size) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${stats.size}` },
          });
        }
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${stats.size}`;
      }
      headers['content-length'] = String(end - start + 1);

      return new Response(Readable.toWeb(createReadStream(filePath, { start, end })), {
        status,
        headers,
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();

  const startupAuthUrl = process.argv.find((arg) => isDesktopAuthCallbackUrl(arg));
  if (startupAuthUrl) {
    void handleDesktopAuthCallback(startupAuthUrl);
  } else {
    void publishAccountState(await readAccountSession());
  }

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(getAppIconPath());
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  scheduleAppUpdateChecks();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Closing the previous window can still be pausing a live /goal and
      // patching that state into the separately persisted transcripts. Do not
      // let a quickly reopened renderer hydrate the older active snapshot and
      // enqueue a newer save that overwrites the pause.
      void waitForPendingAgentShutdowns()
        .then(() => threadsSaveQueue.catch(() => {}))
        .then(() => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// Quit waits for tracked provider termination (including forced escalation)
// plus any /goal pause requested by a reap, so neither can be cut off by main
// process exit.

// A shutdown-time goal pause lands after the renderer (and its unload thread
// flush) is gone: the persisted thread still says goal.status 'active', so a
// relaunch would show an Active goal with no live run and offer Pause
// instead of Resume. Patch the persisted transcripts directly; serialized on
// the threads save queue with a fresh sequence so it cannot fight other
// writers.
const patchPersistedGoalPause = (threadIds) => {
  if (threadIds.length === 0) return;
  const seq = ++threadsWriteSeq;
  threadsSaveQueue = threadsSaveQueue
    .catch(() => {})
    .then(async () => {
      const threads = await readThreadsByIds(threadIds);
      const changed = [];
      for (const thread of threads) {
        if (thread?.goal?.status === 'active') {
          thread.goal.status = 'paused';
          thread.goal.updatedAt = Date.now();
          changed.push(thread);
        }
      }
      if (changed.length === 0 || seq <= threadsCommittedSeq) return;
      await writeThreadsPatch({ version: 2, upserts: changed });
      threadsCommittedSeq = Math.max(threadsCommittedSeq, seq);
    });
};

const reapActiveAgentRuns = () => {
  // A run can still be awaiting model/PATH/git setup and therefore have no
  // child or Claude turn to reap yet. Leave its startup entry in place for
  // the handler's post-await guard, but make that guard terminal: on macOS
  // the main process survives the last window and must not launch invisible
  // work after its renderer has gone away.
  for (const starting of startingAgentRuns.values()) {
    starting.aborted = true;
    starting.terminateBackground = true;
  }
  const shutdowns = [];
  const goalThreadIds = [];
  for (const [runId, run] of activeAgentRuns) {
    // Mark the kill as intentional BEFORE it lands: a resumed one-shot run
    // that dies with no output otherwise satisfies the resume-failure
    // fallback in its close handler, which would startAttempt(null) a fresh
    // invisible agent process after the renderer is gone.
    stoppedAgentRuns.add(runId);
    const goalDriver = codexGoalRunDrivers.get(runId);
    if (goalDriver) {
      codexGoalRunDrivers.delete(runId);
      goalThreadIds.push(run.threadId);
      // Mirror agent:stopTurn: ask the app-server to record the pause before
      // the process goes down — a raw kill leaves codex's goal DB claiming
      // an active goal that nothing is pursuing. Capped so teardown can't
      // hang on a wedged app-server.
      shutdowns.push(
        Promise.race([
          (async () => {
            try {
              await goalDriver.stopGoalRun();
            } catch {}
          })(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]).then(() => killAgentChild(run.child))
      );
    } else {
      shutdowns.push(killAgentChild(run.child));
    }
  }
  activeAgentRuns.clear();
  if (shutdowns.length > 0) {
    trackAgentShutdown(
      Promise.all(shutdowns)
        .then(() => {
          if (goalThreadIds.length === 0) return undefined;
          // Reflect goal pauses in the persisted threads too, and hold the
          // quit barrier open until they are on disk.
          patchPersistedGoalPause(goalThreadIds);
          return threadsSaveQueue.catch(() => {});
        })
    );
  }
};

app.on('window-all-closed', () => {
  // On macOS the main process remains alive after the last window closes.
  // Tear down persistent sessions so their output is not sent to destroyed
  // webContents and background agents cannot keep working invisibly.
  disposeAllClaudeSdkSessions();
  disposeAllTerminalSessions();
  disposeAllCodexGoalOps();
  disposeAllTitleGenerations();
  reapActiveAgentRuns();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Persistent claude sessions outlive individual turns; kill their CLI
// processes (and any background subagents inside them) when Orion exits.
const disposeForQuit = () => {
  appShutdownRequested = true;
  riftShutdownRequested = true;
  rememberRiftCleanupForQuit(
    [...pendingRiftCreations].map((creation) => creation.riftPath()).filter(Boolean)
  );
  cancelPendingRiftCreations();
  disposeAllClaudeSdkSessions();
  disposeAllTerminalSessions();
  disposeAllCodexGoalOps();
  disposeAllTitleGenerations();
  cancelActiveProviderUpdate();
  reapActiveAgentRuns();
};

// Resolves once active children have exited (including the SIGKILL fallback),
// any /goal pauses are recorded, and the latest transcript queue has settled.
// Waiting for the queue after agent shutdown matters: shutdown can enqueue a
// goal-pause persistence write of its own.
const waitForPendingQuitWork = () =>
  Promise.all([
    waitForPendingAgentShutdowns(),
    waitForProviderUpdateShutdown(),
    waitForPendingRiftCreations(),
    waitForRemoteControlPersistence(),
  ])
    .then(() => threadsSaveQueue.catch(() => {}));

app.on('will-quit', (event) => {
  shutdownWorkspaceSync();
  shutdownRemoteControl();
  disposeForQuit();
  if (quitBarrierSatisfied) return;

  // Hold quit open until the pending work above has landed.
  event.preventDefault();
  if (!quitAfterPendingWork) {
    quitAfterPendingWork = true;
    void waitForPendingQuitWork().finally(() => {
      quitAfterPendingWork = false;
      quitBarrierSatisfied = true;
      app.quit();
    });
  }
});

// The updater installs by quitting the app, and the barrier above answers that
// quit with preventDefault() — which cancels the terminate Squirrel is waiting
// on. Drain the same work up front so the installing quit runs straight
// through instead of being held (and possibly dropped).
const settleQuitBarrierForUpdate = async () => {
  if (quitBarrierSatisfied) return;
  // Stop remote lifecycle work before taking the persistence-queue snapshot.
  // Otherwise a pairing/revoke could start after this pre-drain and be skipped
  // when will-quit sees the already-satisfied updater barrier.
  shutdownWorkspaceSync();
  shutdownRemoteControl();
  disposeForQuit();
  // If a quit is already draining this same work, waiting on it here settles at
  // the same time; either way the barrier is open once the work has landed.
  await waitForPendingQuitWork().catch(() => {});
  quitBarrierSatisfied = true;
};

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// -------------------- IPC Handlers --------------------

ipcMain.handle('storage:load', async () => {
  try {
    const storagePath = getStorageFilePath();
    const value = await fs.readFile(storagePath, 'utf-8');
    const sanitized = sanitizeStoreValue(value);
    if (sanitized && sanitized !== value) {
      await fs.writeFile(storagePath, sanitized, 'utf-8');
    }
    return sanitized;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('storage:load error', error);
    }
    return null;
  }
});

ipcMain.handle('storage:save', async (_event, value) => {
  // Chain on the settled queue (.catch first): a failed write must not leave
  // the queue permanently rejected, or every later save would skip its write
  // callback and fail with the stale error even after storage recovers.
  const save = storageSaveQueue.catch(() => {}).then(async () => {
    const storagePath = getStorageFilePath();
    const tempPath = `${storagePath}.${process.pid}.tmp`;
    const sanitized = sanitizeStoreValue(value) ?? value;
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(tempPath, sanitized, 'utf-8');
    await fs.rename(tempPath, storagePath);
  });
  storageSaveQueue = save;

  try {
    await save;
    // Projects/epics/settings changed — nudge the (opt-in) workspace sync.
    notifyWorkspaceChanged();
    notifyRemoteWorkspaceChanged();
    return true;
  } catch (error) {
    console.error('storage:save error', error);
    return false;
  }
});

// Keep each startup response bounded. A single response containing every
// transcript made Electron's main process retain the large IPC backing
// allocations long after hydration completed.
ipcMain.handle('storage:loadThreadsPage', async (_event, input) => {
  try {
    return { ok: true, value: JSON.stringify(await readThreadsPage(input)) };
  } catch (error) {
    console.error('storage:loadThreadsPage error', error);
    return { ok: false };
  }
});

// Workspace sync surface. Configure carries the renderer's persisted opt-in
// settings; the engine itself no-ops while disabled or signed out.
ipcMain.handle('sync:configure', (_event, value) => configureWorkspaceSync(value));
ipcMain.handle('sync:now', () => workspaceSyncNow());
ipcMain.handle('sync:getState', () => getWorkspaceSyncStatus());

// Remote control surface. The engine no-ops while disabled or signed out;
// every mutating handler re-checks the live account session inside the
// engine, so a stale renderer can never act on a signed-out machine.
ipcMain.handle('remote:getState', () => getRemoteControlState());
ipcMain.handle('remote:configure', (_event, value) => configureRemoteControl(value));
ipcMain.handle('remote:startPairing', () => startRemotePairing());
ipcMain.handle('remote:cancelPairing', () => cancelRemotePairing());
ipcMain.handle('remote:revokeDevice', (_event, input) => revokeRemoteDevice(input));
ipcMain.handle('remote:relayDeregister', () => deregisterRelayMachine());
ipcMain.handle('remote:pair', (_event, input) => pairWithRemoteHost(input));
ipcMain.handle('remote:removeMachine', (_event, input) => removeRemoteMachine(input));
ipcMain.handle('remote:connectMachine', (_event, input) => connectRemoteMachine(input));
ipcMain.handle('remote:disconnectMachine', (_event, input) => disconnectRemoteMachine(input));
ipcMain.handle('remote:fetchSnapshot', (_event, input) => fetchRemoteSnapshot(input));
ipcMain.handle('remote:fetchThread', (_event, input) => fetchRemoteThread(input));
ipcMain.handle('remote:runTurn', (_event, input) => runRemoteTurn(input));
ipcMain.handle('remote:stopTurn', (_event, input) => stopRemoteTurn(input));
// Registered only after the renderer has installed onRemoteCommandRequest.
// did-start-loading/destroyed clear this authority until the next mount.
ipcMain.handle('remote:rendererReady', (event) => markRemoteCommandRendererReady(event.sender));
ipcMain.handle('remote:claimCommand', (event, input) =>
  event.sender === remoteCommandRenderer ? claimRemoteCommand(input) : { ok: false }
);
// The host renderer reports a remote command's outcome here, unblocking the
// controller's pending request (mirrors orchestration:subagentResult).
ipcMain.handle('remote:commandResult', (event, payload) =>
  event.sender === remoteCommandRenderer ? resolveRemoteCommand(payload) : { ok: false }
);

ipcMain.handle('storage:saveThreads', async (_event, value) => {
  // Same settled-queue chaining as storage:save above.
  const seq = ++threadsWriteSeq;
  const save = threadsSaveQueue.catch(() => {}).then(async () => {
    if (seq <= threadsCommittedSeq) return; // superseded by the sync flush
    await writeThreadsPatch(value);
    if (seq >= threadsCommittedSeq) {
      threadsCommittedSeq = seq;
      return;
    }
    // The quit-time sync flush committed a newer patch while our manifest
    // write was in flight and may have been superseded — reinstall it.
    const snapshot = threadsSyncSnapshot;
    if (snapshot && snapshot.seq > seq) {
      await writeThreadsPatch(snapshot.patch);
    }
  });
  threadsSaveQueue = save;

  try {
    await save;
    // A stored thread just changed — let the (opt-in) workspace sync
    // engine schedule a debounced pass. Inert while sync is disabled.
    notifyWorkspaceChanged();
    notifyRemoteWorkspaceChanged();
    return true;
  } catch (error) {
    console.error('storage:saveThreads error', error);
    return false;
  }
});

// Quit-time flush: an async save started from beforeunload would race app
// teardown (Electron can exit before the promise settles). The renderer
// blocks in sendSync until this returns, so the write is on disk before the
// window can be destroyed.
ipcMain.on('storage:saveThreadsSync', (event, value) => {
  try {
    const seq = ++threadsWriteSeq;
    writeThreadsPatchSync(value);
    threadsCommittedSeq = seq;
    // Retained so an in-flight async manifest commit can detect the
    // supersession and reinstall this patch.
    threadsSyncSnapshot = { seq, patch: value };
    event.returnValue = true;
  } catch (error) {
    console.error('storage:saveThreadsSync error', error);
    event.returnValue = false;
  }
});

ipcMain.handle('storage:clear', async () => {
  // Clear participates in both save queues so an older pending write cannot
  // recreate either file after this handler reports success. Threads also
  // take a sequence number because the unload-time synchronous flush can
  // jump the async queue.
  const threadsSeq = ++threadsWriteSeq;
  const clearStorage = storageSaveQueue.catch(() => {}).then(() =>
    fs.rm(getStorageFilePath(), { force: true })
  );
  storageSaveQueue = clearStorage;

  const clearThreads = threadsSaveQueue.catch(() => {}).then(async () => {
    if (threadsSeq <= threadsCommittedSeq) return;
    await clearThreadsStorage();
    if (threadsSeq < threadsCommittedSeq) {
      // A newer synchronous unload flush raced the removal. Reinstall its
      // snapshot in case the rm landed after that flush's rename.
      const snapshot = threadsSyncSnapshot;
      if (snapshot && snapshot.seq > threadsSeq) {
        await writeThreadsPatch(snapshot.patch);
      }
      return;
    }
    threadsCommittedSeq = threadsSeq;
    threadsSyncSnapshot = null;
  });
  threadsSaveQueue = clearThreads;

  try {
    await Promise.all([clearStorage, clearThreads]);
    return true;
  } catch (error) {
    console.error('storage:clear error', error);
    return false;
  }
});

const projectIconExtensions = new Set(['.png', '.jpg', '.jpeg', '.ico', '.webp', '.gif', '.svg']);

const projectIconCandidates = [
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'logo.png',
  'logo.svg',
  'icon.png',
  'public/favicon.ico',
  'public/favicon.png',
  'public/favicon.svg',
  'public/logo.png',
  'public/logo.svg',
  'public/icon.png',
  'public/apple-touch-icon.png',
  'app/favicon.ico',
  'src/app/favicon.ico',
  'src/app/icon.png',
  'src/app/icon.svg',
  'assets/logo.png',
  'assets/icon.png',
  'static/favicon.ico',
];

const pathExistsAsFile = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const isProjectIconFile = async (filePath) => {
  if (!(await pathExistsAsFile(filePath))) return false;
  const ext = path.extname(filePath).toLowerCase();
  return projectIconExtensions.has(ext);
};

const projectIconToDataUrl = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') {
    const content = await fs.readFile(filePath, 'utf-8');
    const encoded = Buffer.from(content).toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
  }

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;

  const { width, height } = image.getSize();
  const resized =
    width > 64 || height > 64 ? image.resize({ width: 32, height: 32 }) : image;
  return resized.toDataURL();
};

const resolveProjectIconHref = (baseDir, href) => {
  if (!href || typeof href !== 'string') return null;
  if (/^(?:https?:|data:|\/\/)/i.test(href)) return null;
  const cleanHref = href.split('?')[0].split('#')[0];
  return path.resolve(baseDir, cleanHref);
};

const findProjectIconInHtml = async (projectPath) => {
  const htmlPaths = ['index.html', 'public/index.html', 'src/index.html'];
  for (const relativePath of htmlPaths) {
    const htmlPath = path.join(projectPath, relativePath);
    if (!(await pathExistsAsFile(htmlPath))) continue;

    try {
      const html = await fs.readFile(htmlPath, 'utf-8');
      const iconLinks = html.match(/<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]*>/gi) ?? [];
      for (const linkTag of iconLinks) {
        const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        const iconPath = resolveProjectIconHref(path.dirname(htmlPath), hrefMatch[1]);
        if (iconPath && (await isProjectIconFile(iconPath))) return iconPath;
      }
    } catch {
      // ignore malformed html
    }
  }
  return null;
};

const findProjectIconInPackageJson = async (projectPath) => {
  const packagePath = path.join(projectPath, 'package.json');
  if (!(await pathExistsAsFile(packagePath))) return null;

  try {
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
    const iconRef = pkg.icon || pkg.logo;
    if (typeof iconRef !== 'string') return null;
    const iconPath = path.resolve(projectPath, iconRef);
    if (await isProjectIconFile(iconPath)) return iconPath;
  } catch {
    // ignore malformed package.json
  }
  return null;
};

const findProjectIcon = async (projectPath) => {
  if (!projectPath || typeof projectPath !== 'string') return null;

  const sources = [
    findProjectIconInHtml(projectPath),
    findProjectIconInPackageJson(projectPath),
    ...projectIconCandidates.map(async (candidate) => {
      const iconPath = path.join(projectPath, candidate);
      if (await isProjectIconFile(iconPath)) return iconPath;
      return null;
    }),
  ];

  for (const source of sources) {
    const iconPath = await source;
    if (!iconPath) continue;
    try {
      const dataUrl = await projectIconToDataUrl(iconPath);
      if (dataUrl) return dataUrl;
    } catch {
      // try next candidate
    }
  }

  return null;
};

// Open directory picker
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Read directory (returns files + dirs info for tree)
ipcMain.handle('fs:readDirectory', async (_event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const { directStatuses, aggregateStatuses } = await getGitStatusMap(dirPath);
    const items = entries
      .filter((entry) => !(entry.isDirectory() && hiddenSystemDirectories.has(entry.name)))
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const directStatus = directStatuses.get(fullPath);
        const aggregateStatus = aggregateStatuses.get(fullPath);
        const status = directStatus ?? aggregateStatus ?? null;

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          gitStatus: status?.kind ?? null,
          gitStatusLabel: status?.label ?? null,
          hasChildGitStatus: !directStatus && Boolean(aggregateStatus),
        };
      });
    // Sort: folders first then files, alpha
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  } catch (err) {
    console.error('readDirectory error', err);
    return [];
  }
});

// Read file content
ipcMain.handle('fs:readFile', async (_event, filePath) => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (e) {
    console.error('readFile error', e);
    return '';
  }
});

// Write file content
ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    invalidateTreeGitStatusCache();
    return true;
  } catch (e) {
    console.error('writeFile error', e);
    return false;
  }
});

// Create new file
ipcMain.handle('fs:createFile', async (_event, filePath, content = '') => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    invalidateTreeGitStatusCache();
    return true;
  } catch (e) {
    console.error('createFile error', e);
    return false;
  }
});

// Create directory
ipcMain.handle('fs:createDirectory', async (_event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    invalidateTreeGitStatusCache();
    return true;
  } catch (e) {
    console.error('createDirectory error', e);
    return false;
  }
});

// Delete file or dir
ipcMain.handle('fs:deletePath', async (_event, targetPath) => {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    invalidateTreeGitStatusCache();
    return true;
  } catch (e) {
    console.error('deletePath error', e);
    return false;
  }
});

// Rename/move file or dir
ipcMain.handle('fs:renamePath', async (_event, oldPath, newPath) => {
  try {
    try {
      await fs.access(newPath);
      return { ok: false, error: 'A file or folder with that name already exists.' };
    } catch {}
    await fs.rename(oldPath, newPath);
    invalidateTreeGitStatusCache();
    return { ok: true };
  } catch (e) {
    console.error('renamePath error', e);
    return { ok: false, error: e?.message ?? String(e) };
  }
});

const openPathInTerminal = async (targetPath) => {
  let dir = targetPath;
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) dir = path.dirname(targetPath);
  } catch {
    dir = path.dirname(targetPath);
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', 'Terminal', dir]);
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: dir, detached: true, shell: false });
  } else {
    spawn('x-terminal-emulator', [], { cwd: dir, detached: true });
  }
};

// Native context menu for the Code file tree. Resolves with the action the
// renderer must perform (rename/delete/new-file/new-folder) or null when the
// action was fully handled here (reveal, terminal, copy path) or dismissed.
ipcMain.handle('fileTree:showContextMenu', async (event, input) => {
  const { path: targetPath, isDirectory, rootPath } = input ?? {};
  if (!targetPath) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;

  const revealLabel =
    process.platform === 'darwin'
      ? 'Reveal in Finder'
      : process.platform === 'win32'
        ? 'Reveal in File Explorer'
        : 'Reveal in File Manager';

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const template = [];
    if (isDirectory) {
      template.push(
        { label: 'New File…', click: () => finish('new-file') },
        { label: 'New Folder…', click: () => finish('new-folder') },
        { type: 'separator' }
      );
    }
    template.push(
      { label: 'Rename…', click: () => finish('rename') },
      { label: 'Delete', click: () => finish('delete') },
      { type: 'separator' },
      {
        label: revealLabel,
        click: () => {
          shell.showItemInFolder(targetPath);
          finish(null);
        },
      },
      {
        label: 'Open in Terminal',
        click: () => {
          openPathInTerminal(targetPath).catch((error) =>
            console.error('openInTerminal error', error)
          );
          finish(null);
        },
      },
      { type: 'separator' },
      {
        label: 'Copy Path',
        click: () => {
          clipboard.writeText(targetPath);
          finish(null);
        },
      }
    );
    if (rootPath) {
      template.push({
        label: 'Copy Relative Path',
        click: () => {
          clipboard.writeText(path.relative(rootPath, targetPath));
          finish(null);
        },
      });
    }

    const menu = Menu.buildFromTemplate(template);
    // The close callback fires before item click handlers, so defer the
    // "dismissed" resolution one tick to let a click win the race.
    menu.popup({ window: win, callback: () => setTimeout(() => finish(null), 0) });
  });
});

// Native confirmation dialog before deleting a tree entry.
ipcMain.handle('fileTree:confirmDelete', async (event, input) => {
  const { path: targetPath, isDirectory } = input ?? {};
  if (!targetPath) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Delete “${path.basename(targetPath)}”?`,
    detail: isDirectory
      ? 'The folder and all of its contents will be deleted. This cannot be undone.'
      : 'This cannot be undone.',
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0;
});

ipcMain.handle('git:getState', async (_event, projectPath) => {
  try {
    if (!projectPath) {
      return { ok: false, branches: [], hasUncommittedChanges: false, error: 'Missing project path.' };
    }

    return await getGitStateForPath(projectPath);
  } catch (error) {
    return {
      ok: false,
      branches: [],
      hasUncommittedChanges: false,
      error: error?.message ?? String(error),
    };
  }
});

ipcMain.handle('git:checkoutBranch', async (_event, input) => {
  try {
    const projectPath = input?.projectPath;
    const branchName = String(input?.branchName ?? '').trim();
    const create = Boolean(input?.create);
    if (!projectPath || !branchName) {
      return { ok: false, error: 'Missing project path or branch name.' };
    }

    const gitRoot = await getGitRoot(projectPath);
    if (create) {
      const valid = await validateNewBranchName(branchName);
      if (!valid) {
        return { ok: false, error: 'Invalid branch name.' };
      }
      await execFileAsync('git', ['-C', gitRoot, 'checkout', '-b', branchName]);
    } else {
      const state = await getGitStateForPath(projectPath);
      if (state.hasUncommittedChanges) {
        return { ok: false, error: 'Commit or discard local changes before switching branches.' };
      }
      if (!state.branches.some((branch) => branch.name === branchName)) {
        return { ok: false, error: `Unknown branch: ${branchName}` };
      }
      await execFileAsync('git', ['-C', gitRoot, 'checkout', branchName]);
    }

    return { ok: true, state: await getGitStateForPath(projectPath) };
  } catch (error) {
    return { ok: false, error: error?.stderr?.toString().trim() || error?.message || String(error) };
  }
});

// The navbar action passes `{ projectPath, modelId, reasoningEffort }`; older
// callers passed the path alone and keep the diffstat-style fallback message.
ipcMain.handle('git:commitAndPush', async (_event, input) => {
  try {
    const request = typeof input === 'string' ? { projectPath: input } : (input ?? {});
    const { projectPath } = request;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }

    const gitRoot = await getGitRoot(projectPath);
    const state = await getGitStateForPath(projectPath);
    if (!state.currentBranch) {
      return { ok: false, error: 'Cannot push from a detached HEAD.' };
    }

    const entries = await readGitStatusEntries(gitRoot);
    if (entries.length === 0) {
      return { ok: false, error: 'No local changes to commit.' };
    }

    await execFileAsync('git', ['-C', gitRoot, 'add', '-A']);
    const stagedHasChanges = !(await commandSucceeds('git', ['-C', gitRoot, 'diff', '--cached', '--quiet']));
    if (!stagedHasChanges) {
      return { ok: false, error: 'No staged changes to commit.' };
    }

    // Freeze the index across the message turn, the same way the epic commit
    // does: staging keeps moving while the model writes, and committing after
    // that would ship changes the message never described.
    const indexTree = await readGitIndexTree(gitRoot);
    const stagedEntries = await readStagedGitEntries(gitRoot);
    const message = await writeGitCommitMessage({
      gitRoot,
      entries: stagedEntries,
      modelId: request.modelId,
      reasoningEffort: request.reasoningEffort,
    });
    if ((await readGitIndexTree(gitRoot)) !== indexTree) {
      return {
        ok: false,
        error: 'Staged changes changed while Orion was preparing the commit. Try again.',
      };
    }
    if ((await getCurrentGitBranch(gitRoot)) !== state.currentBranch) {
      return {
        ok: false,
        error: `The repository moved off ${state.currentBranch} while Orion was preparing the commit. Try again.`,
      };
    }

    await execFileAsync('git', ['-C', gitRoot, 'commit', '-m', message]);
    await execFileAsync('git', ['-C', gitRoot, 'push', '-u', 'origin', state.currentBranch]);

    return {
      ok: true,
      branch: state.currentBranch,
      message,
      state: await getGitStateForPath(projectPath),
    };
  } catch (error) {
    return { ok: false, error: error?.stderr?.toString().trim() || error?.message || String(error) };
  }
});

// --- Epics: git actions with LLM-written messages ------------------------

const truncateForPrompt = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text;

// Models answer with fences/labels no matter how firmly the prompt forbids
// them; strip the common wrappers so the raw message survives.
const cleanGeneratedGitMessage = (text) => {
  let candidate = (text || '').trim();
  candidate = candidate.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '');
  candidate = candidate.replace(/^(commit message|pr description|title)\s*[:：]\s*/i, '');
  return candidate.trim();
};

// Describe only the index snapshot that will be committed. Edits made while
// the model writes the message remain in the worktree for a later commit.
// The prompt only ever sees the first ~14k chars, so the diff read is bounded
// well below the full index and an oversized diff degrades to the diffstat
// (and then to the file list alone) instead of failing the commit.
const readStagedGitChangesContext = async (gitRoot, entries) => {
  const fileList = entries
    .map((entry) => `${entry.kind}\t${entry.relativePath}`)
    .join('\n');

  let diff = '';
  try {
    ({ stdout: diff } = await execFileAsync('git', ['-C', gitRoot, 'diff', '--cached'], {
      maxBuffer: 1024 * 1024 * 4,
    }));
  } catch {
    try {
      ({ stdout: diff } = await execFileAsync(
        'git',
        ['-C', gitRoot, 'diff', '--cached', '--stat'],
        { maxBuffer: 1024 * 1024 }
      ));
    } catch {
      diff = '';
    }
  }

  return `Staged files:\n${fileList}\nDiff:\n${truncateForPrompt(diff, 14000)}`;
};

const readStagedGitEntries = async (gitRoot) => {
  const { stdout } = await execFileAsync('git', [
    '-C',
    gitRoot,
    'diff',
    '--cached',
    '--name-status',
    '-z',
  ]);
  const fields = stdout.split('\0');
  const entries = [];
  let index = 0;

  while (index < fields.length) {
    const rawStatus = fields[index++];
    if (!rawStatus) break;
    const status = rawStatus[0];
    const sourcePath = fields[index++];
    const relativePath =
      status === 'R' || status === 'C' ? fields[index++] : sourcePath;
    if (!relativePath) continue;
    const kind = {
      A: 'added',
      C: 'copied',
      D: 'deleted',
      M: 'modified',
      R: 'renamed',
      U: 'conflicted',
    }[status] ?? 'modified';
    entries.push({ kind, relativePath });
  }

  return entries;
};

const readGitIndexTree = async (gitRoot) => {
  const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'write-tree']);
  return stdout.trim();
};

// origin/HEAD as the clone recorded it. Purely local, so the PR base picker
// can paint with it immediately; it can be stale, which is why
// resolveRemoteDefaultBranch below asks the remote first.
const readLocalDefaultBranch = async (gitRoot) => {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      gitRoot,
      'symbolic-ref',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    return '';
  }
};

// Ask the text-generation model for a commit message describing the staged
// entries. Without a model — or when the turn comes back empty because the
// model is unavailable or errored — this degrades to the mechanical
// "Update N files" summary rather than blocking the commit.
const writeGitCommitMessage = async ({ gitRoot, entries, epicName, modelId, reasoningEffort }) => {
  if (modelId) {
    const context = await readStagedGitChangesContext(gitRoot, entries);
    const prompt =
      'Write a git commit message for the changes below' +
      (epicName ? `, which are part of the epic "${epicName}"` : '') +
      '. First line: a specific summary under 72 characters. Then a blank line, then a short ' +
      'body of bullet points covering the substantive changes. Reply with ONLY the commit ' +
      'message — no quotes, no code fences, no commentary.\n\n' +
      context;
    const generated = cleanGeneratedGitMessage(
      await runOneShotForModelId(modelId, prompt, gitRoot, { reasoningEffort })
    );
    if (generated) return generated;
  }
  return commitMessageForEntries(entries);
};

const resolveRemoteDefaultBranch = async (gitRoot) => {
  // Ask the remote first: origin/HEAD is only locally recorded metadata and
  // can remain stale after the repository changes its default branch.
  try {
    // Cap the network round trip and refuse credential prompts: an
    // unreachable or auth-gated remote would otherwise never settle and pin
    // the epic action in its disabled-UI busy state. The fallbacks below are
    // local, so failing fast here degrades gracefully.
    const { stdout } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'ls-remote', '--symref', 'origin', 'HEAD'],
      { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
    );
    const branch = stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m)?.[1]?.trim();
    if (branch) return branch;
  } catch {
    // An offline or inaccessible remote may still have usable local metadata.
  }

  // No usable answer from the remote; local metadata may still be right.
  const localDefaultBranch = await readLocalDefaultBranch(gitRoot);
  if (localDefaultBranch) return localDefaultBranch;

  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'defaultBranchRef'],
      { cwd: gitRoot }
    );
    const branch = JSON.parse(stdout)?.defaultBranchRef?.name;
    return typeof branch === 'string' ? branch.trim() : '';
  } catch {
    return '';
  }
};

const canonicalGitPath = async (value) => {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
};

// Epic git actions are confined to one non-default branch in one repository.
// This prevents two epics (or a later project switch) from silently sharing a
// push target. A rift-backed epic owns its whole workspace, so the renderer
// sends no expected root/branch or foreign claims for it — only the
// default-branch guard, which still applies, runs.
const validateEpicGitTarget = async (gitRoot, branch, input) => {
  const canonicalRoot = await canonicalGitPath(gitRoot);
  const expectedBranch = String(input?.expectedBranch ?? '').trim();
  const expectedRoot = String(input?.expectedGitRoot ?? '').trim();

  if (expectedBranch && expectedBranch !== branch) {
    return {
      ok: false,
      error: `This epic is linked to ${expectedBranch}. Switch back to that branch before using its git actions.`,
    };
  }
  if (expectedRoot && (await canonicalGitPath(expectedRoot)) !== canonicalRoot) {
    return {
      ok: false,
      error: 'This epic is linked to a different repository. Use its original project for git actions.',
    };
  }

  for (const claim of Array.isArray(input?.claimedBranches) ? input.claimedBranches : []) {
    if (!claim?.gitRoot || !claim?.branch || claim.branch !== branch) continue;
    if ((await canonicalGitPath(claim.gitRoot)) !== canonicalRoot) continue;
    const owner = String(claim.epicName ?? '').trim();
    return {
      ok: false,
      error:
        `${branch} is already linked to another epic${owner ? ` (${owner})` : ''}. ` +
        'Switch to a dedicated feature branch for this epic.',
    };
  }

  const baseBranch = await resolveRemoteDefaultBranch(canonicalRoot);
  if (!baseBranch) {
    return {
      ok: false,
      error:
        'Could not determine the remote default branch. Check the origin remote and GitHub authentication.',
    };
  }
  if (baseBranch === branch) {
    return {
      ok: false,
      error: `You are on ${branch}, the repository default branch — switch to a dedicated feature branch first.`,
    };
  }

  return { ok: true, gitRoot: canonicalRoot, baseBranch };
};

const hasLocalCommitsToPush = async (gitRoot, branch, baseBranch) => {
  const branchRef = `refs/heads/${branch}`;
  const countAheadOf = async (revision) => {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C',
        gitRoot,
        'rev-list',
        '--count',
        `${revision}..${branchRef}`,
      ]);
      return Number.parseInt(stdout.trim(), 10) > 0;
    } catch {
      return null;
    }
  };

  const aheadOfRemoteBranch = await countAheadOf(`refs/remotes/origin/${branch}`);
  if (aheadOfRemoteBranch !== null) return aheadOfRemoteBranch;

  // A first push can fail before -u records an upstream. In that case, a
  // feature commit ahead of the default branch is still retryable without
  // requiring the user to stage and commit an unrelated change.
  for (const revision of [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`]) {
    const ahead = await countAheadOf(revision);
    if (ahead !== null) return ahead;
  }
  return false;
};

ipcMain.handle('epic:commitAndPush', async (_event, input) => {
  let gitRoot = '';
  let branch = '';
  let committed = false;
  try {
    if (typeof input?.epicId !== 'string' || !input.epicId) {
      return { ok: false, error: 'Missing epic id.' };
    }
    const riftSetupError = pendingRiftSetupError(input);
    if (riftSetupError) {
      return { ok: false, error: riftSetupError };
    }
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }

    gitRoot = await getGitRoot(projectPath);
    branch = (await getCurrentGitBranch(gitRoot)) ?? '';
    if (!branch) {
      return { ok: false, error: 'Cannot push from a detached HEAD.' };
    }

    // Refuse a drifted or shared target before touching the index.
    const target = await validateEpicGitTarget(gitRoot, branch, input);
    if (!target.ok) return target;
    gitRoot = target.gitRoot;
    const setupErrorAfterValidation = pendingRiftSetupError(input);
    if (setupErrorAfterValidation) {
      return { ok: false, gitRoot, branch, error: setupErrorAfterValidation };
    }

    // Stage everything. When the epic works inside a rift, the workspace only
    // ever contains this epic's changes; outside a rift, staging all local
    // changes is the accepted trade-off.
    await execFileAsync('git', ['-C', gitRoot, 'add', '-A']);
    const stagedHasChanges = !(
      await commandSucceeds('git', ['-C', gitRoot, 'diff', '--cached', '--quiet'])
    );
    if (!stagedHasChanges) {
      // Nothing new to commit — retry the push if a previous commit landed but
      // its push failed. Only for a branch this epic already owns: an
      // unclaimed epic must not adopt unrelated local commits as its own.
      const epicOwnsBranch = Boolean(
        input?.isRift ||
          (String(input?.expectedGitRoot ?? '').trim() && String(input?.expectedBranch ?? '').trim())
      );
      if (await hasLocalCommitsToPush(gitRoot, branch, target.baseBranch)) {
        if (!epicOwnsBranch) {
          return {
            ok: false,
            error: `${branch} has local commits, but this epic has not claimed it. Make this epic's first commit here to claim the branch.`,
          };
        }
        const setupErrorBeforePush = pendingRiftSetupError(input);
        if (setupErrorBeforePush) {
          return { ok: false, gitRoot, branch, error: setupErrorBeforePush };
        }
        await execFileAsync('git', ['-C', gitRoot, 'push', '-u', 'origin', branch]);
        return { ok: true, gitRoot, branch, message: 'Pushed existing local commits' };
      }
      return { ok: false, error: 'No local changes to commit.' };
    }

    // Freeze the index: the message model turn below takes seconds, during
    // which a running agent or the user can stage more work. Committing then
    // would ship changes the generated message never described.
    const indexTree = await readGitIndexTree(gitRoot);
    const entries = await readStagedGitEntries(gitRoot);
    // A message typed in the commit dialog is used verbatim — no model turn,
    // and no cleanup pass (that one strips artifacts of generated text).
    let message = String(input?.message ?? '').trim();
    if (!message) {
      message = await writeGitCommitMessage({
        gitRoot,
        entries,
        epicName: input?.epicName,
        modelId: input?.modelId,
        reasoningEffort: input?.reasoningEffort,
      });
    }

    // Re-verify what the commit will actually land, and where: `git commit`
    // uses the index and the current checkout, but the push below targets the
    // branch captured above.
    if ((await readGitIndexTree(gitRoot)) !== indexTree) {
      return {
        ok: false,
        gitRoot,
        branch,
        error: 'Staged changes changed while Orion was preparing the commit. Try again.',
      };
    }
    if ((await getCurrentGitBranch(gitRoot)) !== branch) {
      return {
        ok: false,
        gitRoot,
        branch,
        error: `The repository moved off ${branch} while Orion was preparing the commit. Switch back and try again.`,
      };
    }
    const setupErrorBeforeCommit = pendingRiftSetupError(input);
    if (setupErrorBeforeCommit) {
      return { ok: false, gitRoot, branch, error: setupErrorBeforeCommit };
    }

    await execFileAsync('git', ['-C', gitRoot, 'commit', '-m', message]);
    committed = true;
    await execFileAsync('git', ['-C', gitRoot, 'push', '-u', 'origin', branch]);

    return { ok: true, gitRoot, branch, message };
  } catch (error) {
    return {
      ok: false,
      ...(gitRoot ? { gitRoot, branch } : {}),
      ...(committed ? { committed: true } : {}),
      error: error?.stderr?.toString().trim() || error?.message || String(error),
    };
  }
});

const riftWorktreeChangesFailure = async (gitRoot, branch, input) => {
  if (!input?.isRift || (await readGitStatusEntries(gitRoot)).length === 0) return null;
  return {
    ok: false,
    gitRoot,
    branch,
    error:
      'This epic’s rift still has uncommitted changes. Commit and push them before opening a pull request.',
  };
};

// Everything the PR base picker can resolve without touching the network, so
// the dialog opens with a real base branch instead of waiting on origin. The
// full branch list follows over epic:listRemoteBranches while it is open.
ipcMain.handle('epic:localPrBase', async (_event, input) => {
  try {
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }
    const gitRoot = await getGitRoot(projectPath);
    const currentBranch = (await getCurrentGitBranch(gitRoot)) ?? null;
    let sourceBranch = null;
    if (input?.sourceProjectPath) {
      try {
        sourceBranch =
          (await getCurrentGitBranch(await getGitRoot(input.sourceProjectPath))) ?? null;
      } catch {
        // The source checkout may be gone; the picker just loses its default.
      }
    }
    return {
      ok: true,
      gitRoot,
      currentBranch,
      sourceBranch,
      defaultBranch: await readLocalDefaultBranch(gitRoot),
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

// Branches currently on origin, for the PR base picker. Asks the remote
// directly (not local tracking refs) so a stale clone still offers every
// branch a PR could actually target.
//
// sourceProjectPath is the epic's real repository checkout (the one a rift was
// cloned from). Its branch is what the PR should default to merging back into,
// so it is reported alongside the remote branches.
ipcMain.handle('epic:listRemoteBranches', async (_event, input) => {
  try {
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }
    const gitRoot = await getGitRoot(projectPath);
    const currentBranch = (await getCurrentGitBranch(gitRoot)) ?? null;
    let sourceBranch = null;
    if (input?.sourceProjectPath) {
      try {
        sourceBranch =
          (await getCurrentGitBranch(await getGitRoot(input.sourceProjectPath))) ?? null;
      } catch {
        // The source checkout may be gone; the picker just loses its default.
      }
    }
    const { stdout } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'ls-remote', '--heads', 'origin'],
      {
        timeout: 15_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 1024 * 1024 * 4,
      }
    );
    const branches = stdout
      .split('\n')
      .map((line) => line.match(/refs\/heads\/(.+)$/)?.[1]?.trim())
      .filter(Boolean);
    const defaultBranch = await resolveRemoteDefaultBranch(gitRoot);
    return { ok: true, gitRoot, currentBranch, sourceBranch, defaultBranch, branches };
  } catch (error) {
    return {
      ok: false,
      error: error?.stderr?.toString().trim() || error?.message || String(error),
    };
  }
});

ipcMain.handle('epic:createPr', async (_event, input) => {
  let gitRoot = '';
  let branch = '';
  try {
    if (typeof input?.epicId !== 'string' || !input.epicId) {
      return { ok: false, error: 'Missing epic id.' };
    }
    const riftSetupError = pendingRiftSetupError(input);
    if (riftSetupError) {
      return { ok: false, error: riftSetupError };
    }
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }
    if (!(await checkCommandAvailable('gh'))) {
      return {
        ok: false,
        error: 'The GitHub CLI (gh) is required to open PRs. Install it and run `gh auth login`.',
      };
    }

    gitRoot = await getGitRoot(projectPath);
    branch = (await getCurrentGitBranch(gitRoot)) ?? '';
    if (!branch) {
      return { ok: false, error: 'Cannot open a PR from a detached HEAD.' };
    }

    const target = await validateEpicGitTarget(gitRoot, branch, input);
    if (!target.ok) return target;
    gitRoot = target.gitRoot;
    // The renderer's base picker may target any origin branch; without a
    // choice, fall back to the remote default branch.
    const requestedBase = String(input?.baseBranch ?? '').trim();
    const baseBranch = requestedBase || target.baseBranch;
    if (baseBranch === branch) {
      return {
        ok: false,
        gitRoot,
        branch,
        error: `Cannot open a pull request from ${branch} into itself. Choose a different base branch.`,
      };
    }
    const setupErrorAfterValidation = pendingRiftSetupError(input);
    if (setupErrorAfterValidation) {
      return { ok: false, gitRoot, branch, error: setupErrorAfterValidation };
    }

    // Every local change in a rift belongs to this epic. Opening or reusing a
    // PR with any staged, unstaged, or untracked work would publish an
    // incomplete snapshot. Shared workspaces retain the narrower staged guard
    // because unrelated unstaged work can legitimately coexist there.
    const riftWorktreeFailure = await riftWorktreeChangesFailure(gitRoot, branch, input);
    const sharedWorkspaceHasStagedChanges =
      !input?.isRift &&
      !(await commandSucceeds('git', ['-C', gitRoot, 'diff', '--cached', '--quiet']));
    if (riftWorktreeFailure || sharedWorkspaceHasStagedChanges) {
      if (riftWorktreeFailure) return riftWorktreeFailure;
      return {
        ok: false,
        gitRoot,
        branch,
        error: 'This epic still has staged changes. Commit and push them before opening a pull request.',
      };
    }

    // Reuse an already-open PR for this branch instead of failing on create.
    // Check before pushing: a stale or diverged local branch can still have a
    // valid open PR even though its non-fast-forward push would fail. With no
    // selector, gh resolves the checked-out branch and its head repository;
    // filtering only by branch name could select a same-named fork PR.
    try {
      // `gh pr view` below intentionally relies on the checkout so it can
      // distinguish the current repository's head from a same-named fork.
      // Revalidate at the last possible moment so a concurrent agent or
      // terminal checkout cannot attach another branch's PR to this epic.
      if ((await getCurrentGitBranch(gitRoot)) !== branch) {
        return {
          ok: false,
          gitRoot,
          branch,
          error: `The repository moved off ${branch} while Orion was checking for its pull request. Switch back and try again.`,
        };
      }
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', '--json', 'url,state'],
        { cwd: gitRoot }
      );
      const existing = JSON.parse(stdout);
      if (existing?.url && existing?.state === 'OPEN') {
        const worktreeFailure = await riftWorktreeChangesFailure(gitRoot, branch, input);
        if (worktreeFailure) return worktreeFailure;
        const setupErrorBeforeReuse = pendingRiftSetupError(input);
        if (setupErrorBeforeReuse) {
          return { ok: false, gitRoot, branch, error: setupErrorBeforeReuse };
        }
        return {
          ok: true,
          url: existing.url,
          alreadyExists: true,
          gitRoot,
          branch,
          baseBranch,
        };
      }
    } catch {
      // No PR yet.
    }

    // The branch must exist on the remote before gh can target a new PR.
    const worktreeFailureBeforePush = await riftWorktreeChangesFailure(gitRoot, branch, input);
    if (worktreeFailureBeforePush) return worktreeFailureBeforePush;
    const setupErrorBeforePush = pendingRiftSetupError(input);
    if (setupErrorBeforePush) {
      return { ok: false, gitRoot, branch, error: setupErrorBeforePush };
    }
    await execFileAsync('git', ['-C', gitRoot, 'push', '-u', 'origin', branch]);

    let title = '';
    let body = '';
    // A message typed in the PR dialog replaces the generated one: its first
    // line is the title, the rest is the description.
    const userMessage = String(input?.message ?? '').trim();
    if (userMessage) {
      const newline = userMessage.indexOf('\n');
      title = (newline === -1 ? userMessage : userMessage.slice(0, newline)).trim();
      body = newline === -1 ? '' : userMessage.slice(newline + 1).trim();
    }
    if (!title && input?.modelId) {
      // Ensure the range used for message generation exists locally even when
      // the clone did not previously have an origin/HEAD tracking reference.
      // Only the generated message needs it — gh targets the remote directly,
      // and the push above already succeeded, so a failed fetch must not abort
      // the PR: fall through to the static title/body.
      let fetchedCurrentBase = false;
      try {
        await execFileAsync('git', [
          '-C',
          gitRoot,
          'fetch',
          '--no-tags',
          'origin',
          `refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
        ]);
        fetchedCurrentBase = true;
      } catch {}

      if (fetchedCurrentBase) {
        const baseRef = `refs/remotes/origin/${baseBranch}`;
        const branchRef = `refs/heads/${branch}`;
        let commits = '';
        let diffstat = '';
        try {
          ({ stdout: commits } = await execFileAsync('git', [
            '-C',
            gitRoot,
            'log',
            `${baseRef}..${branchRef}`,
            '--pretty=- %s',
          ]));
        } catch {}
        try {
          ({ stdout: diffstat } = await execFileAsync('git', [
            '-C',
            gitRoot,
            'diff',
            `${baseRef}...${branchRef}`,
            '--stat',
          ]));
        } catch {}
        const prompt =
          'Write a GitHub pull request title and description for the branch changes below' +
          (input?.epicName ? `, which deliver the epic "${input.epicName}"` : '') +
          '. First line: the PR title (specific, under 72 characters). Then a blank line, then the ' +
          'PR description in markdown: a short summary paragraph followed by a "## Changes" bullet ' +
          'list. Reply with ONLY the title and description — no quotes, no code fences, no commentary.\n\n' +
          `Commits:\n${truncateForPrompt(commits, 3000)}\n\nDiffstat:\n${truncateForPrompt(diffstat, 3000)}`;
        const text = cleanGeneratedGitMessage(
          await runOneShotForModelId(input.modelId, prompt, gitRoot, {
            reasoningEffort: input?.reasoningEffort,
          })
        );
        if (text) {
          const newline = text.indexOf('\n');
          title = (newline === -1 ? text : text.slice(0, newline)).trim();
          body = newline === -1 ? '' : text.slice(newline + 1).trim();
        }
      }
    }
    if (!title) title = input?.epicName || `Changes from ${branch}`;
    if (!body) body = `Changes from the Orion epic "${input?.epicName ?? branch}".`;

    const worktreeFailureBeforeCreate = await riftWorktreeChangesFailure(
      gitRoot,
      branch,
      input
    );
    if (worktreeFailureBeforeCreate) return worktreeFailureBeforeCreate;
    const setupErrorBeforeCreate = pendingRiftSetupError(input);
    if (setupErrorBeforeCreate) {
      return { ok: false, gitRoot, branch, error: setupErrorBeforeCreate };
    }
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--head', branch, '--base', baseBranch, '--title', title, '--body', body],
      { cwd: gitRoot }
    );
    const url = stdout.match(/https?:\/\/\S+/)?.[0] ?? '';
    return { ok: true, url, title, gitRoot, branch, baseBranch };
  } catch (error) {
    return {
      ok: false,
      ...(gitRoot ? { gitRoot, branch } : {}),
      error: error?.stderr?.toString().trim() || error?.message || String(error),
    };
  }
});

// Status backing the epic view's git buttons: whether "Commit & push" has
// anything to do, and — when the epic already has a PR — that PR's lifecycle
// state. The renderer polls this while an epic view is open, so the git
// checks stay local-only (no ls-remote/fetch); only the optional PR lookup
// talks to GitHub, and only when prUrl is passed.
ipcMain.handle('epic:gitStatus', async (_event, input) => {
  try {
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }

    const gitRoot = await getGitRoot(projectPath);
    const branch = (await getCurrentGitBranch(gitRoot)) ?? '';

    const { stdout: porcelain } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'status', '--porcelain'],
      { maxBuffer: 1024 * 1024 * 4 }
    );
    const hasChangesToCommit = porcelain.trim().length > 0;

    // Commits origin does not have yet, judged purely from local tracking
    // refs. With no origin refs at all every commit counts, which errs toward
    // keeping the commit button enabled.
    let hasUnpushedCommits = false;
    if (branch) {
      try {
        const { stdout } = await execFileAsync('git', [
          '-C',
          gitRoot,
          'rev-list',
          '--count',
          `refs/heads/${branch}`,
          '--not',
          '--remotes=origin',
        ]);
        hasUnpushedCommits = Number.parseInt(stdout.trim(), 10) > 0;
      } catch {
        hasUnpushedCommits = false;
      }
    }

    let pr;
    if (input?.prUrl && (await checkCommandAvailable('gh'))) {
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'view', String(input.prUrl), '--json', 'state,url'],
          { cwd: gitRoot, timeout: 15_000 }
        );
        const parsed = JSON.parse(stdout);
        if (parsed?.state) {
          pr = { state: parsed.state, url: parsed.url ?? String(input.prUrl) };
        }
      } catch {
        // Offline, gh unauthenticated, or the PR is gone — the renderer keeps
        // its last known state.
      }
    }

    return {
      ok: true,
      gitRoot,
      branch,
      hasChangesToCommit,
      hasUnpushedCommits,
      ...(pr ? { pr } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.stderr?.toString().trim() || error?.message || String(error),
    };
  }
});

// https://<host>/<owner>/<repo>/pull/<number>, allowing the trailing path or
// query GitHub adds for files/commits views on a copied URL.
const PR_URL_PATTERN = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/;

const parsePrUrl = (prUrl) => {
  const match = PR_URL_PATTERN.exec(String(prUrl));
  if (!match) return null;
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { host: match[1], owner: match[2], repo: match[3], number };
};

// GraphQL string literal. Owner/repo come from a URL, so they cannot contain a
// quote in practice, but the query is assembled by hand — escape anyway.
const graphqlString = (value) =>
  `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// One aliased query per host collapses every epic's PR into a single request
// (rate-limit cost 1, regardless of how many PRs are in it). Aliases must be
// synthetic: GraphQL names are /^[_A-Za-z][_0-9A-Za-z]*$/, and repo names
// routinely contain `-` and `.`.
const buildPrStateQuery = (repoGroups) => {
  const repoFields = repoGroups.map(
    (group, repoIndex) =>
      `  r${repoIndex}: repository(owner: ${graphqlString(group.owner)}, name: ${graphqlString(
        group.repo
      )}) {\n` +
      group.pulls
        .map((pull, pullIndex) => `    p${pullIndex}: pullRequest(number: ${pull.number}) { state }`)
        .join('\n') +
      '\n  }'
  );
  return `query {\n${repoFields.join('\n')}\n}`;
};

// Batch PR-state lookup behind the sidebar's epic icon colours. Deliberately
// not a loop over epic:gitStatus: that also runs `git status` and `rev-list`
// against each epic's workspace, which is wasted work here and throws for
// rifts that are pending or mid-removal. Per-epic failures are dropped from
// the response so the renderer keeps the state it already has.
ipcMain.handle('epic:prStates', async (_event, input) => {
  const requested = Array.isArray(input?.epics) ? input.epics : [];
  const targets = requested.filter((entry) => entry?.epicId && entry?.prUrl);
  if (targets.length === 0) return { ok: true, states: [] };
  if (!(await checkCommandAvailable('gh'))) {
    return { ok: false, error: 'The GitHub CLI (gh) is not available.' };
  }

  const states = [];

  // Several epics can point at one PR, so every pull carries the list of epics
  // waiting on it rather than a single id.
  const byHost = new Map();
  const unparsed = [];
  for (const target of targets) {
    const parsed = parsePrUrl(target.prUrl);
    if (!parsed) {
      unparsed.push(target);
      continue;
    }
    const repoKey = `${parsed.owner}/${parsed.repo}`;
    if (!byHost.has(parsed.host)) byHost.set(parsed.host, new Map());
    const repos = byHost.get(parsed.host);
    if (!repos.has(repoKey)) {
      repos.set(repoKey, { owner: parsed.owner, repo: parsed.repo, pulls: new Map() });
    }
    const group = repos.get(repoKey);
    if (!group.pulls.has(parsed.number)) {
      group.pulls.set(parsed.number, { number: parsed.number, epicIds: [] });
    }
    group.pulls.get(parsed.number).epicIds.push(target.epicId);
  }

  // Everything GraphQL could not resolve falls back to the per-PR `gh pr view`
  // path below, so an unfamiliar URL shape or a host without GraphQL access
  // degrades to the old behaviour instead of losing the epic entirely.
  const fallbackTargets = [...unparsed];

  await Promise.all(
    [...byHost.entries()].map(async ([host, repos]) => {
      const repoGroups = [...repos.values()].map((group) => ({
        owner: group.owner,
        repo: group.repo,
        pulls: [...group.pulls.values()],
      }));
      const hostTargets = repoGroups.flatMap((group) =>
        group.pulls.flatMap((pull) =>
          pull.epicIds.map((epicId) => ({
            epicId,
            prUrl: `https://${host}/${group.owner}/${group.repo}/pull/${pull.number}`,
          }))
        )
      );
      let payload;
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['api', 'graphql', '--hostname', host, '-f', `query=${buildPrStateQuery(repoGroups)}`],
          { timeout: 15_000 }
        );
        payload = JSON.parse(stdout);
      } catch (error) {
        // `gh api graphql` exits non-zero when the response carries `errors`,
        // but still prints a body that can hold partial `data` — one bad PR in
        // the batch must not discard the rest.
        try {
          payload = JSON.parse(error?.stdout?.toString() ?? '');
        } catch {
          payload = null;
        }
      }
      if (!payload?.data) {
        fallbackTargets.push(...hostTargets);
        return;
      }
      for (const [repoIndex, group] of repoGroups.entries()) {
        const repoData = payload.data[`r${repoIndex}`];
        for (const [pullIndex, pull] of group.pulls.entries()) {
          // A null repository or pullRequest means deleted or no access; leave
          // those epics on the state they already have.
          const state = repoData?.[`p${pullIndex}`]?.state;
          if (!state) continue;
          for (const epicId of pull.epicIds) states.push({ epicId, state });
        }
      }
    })
  );

  if (fallbackTargets.length > 0) {
    const queue = [...fallbackTargets];
    const byEpicId = new Map(targets.map((target) => [target.epicId, target]));
    const lookup = async () => {
      for (;;) {
        const target = queue.shift();
        if (!target) return;
        // prUrl is a full URL, so gh resolves the repo from it; cwd only
        // decides which credentials apply. Fall back to the app cwd when the
        // epic's workspace is gone rather than failing the lookup outright.
        const projectPath = byEpicId.get(target.epicId)?.projectPath;
        let cwd;
        try {
          cwd = projectPath ? await getGitRoot(projectPath) : undefined;
        } catch {
          cwd = undefined;
        }
        try {
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'view', String(target.prUrl), '--json', 'state'],
            { ...(cwd ? { cwd } : {}), timeout: 15_000 }
          );
          const parsed = JSON.parse(stdout);
          if (parsed?.state) states.push({ epicId: target.epicId, state: parsed.state });
        } catch {
          // Offline, gh unauthenticated, or the PR is gone.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, lookup));
  }

  return { ok: true, states };
});

// --- Epics: rift workspaces (experimental) -------------------------------

ipcMain.handle('rift:status', () => ({
  available: Boolean(riftBinaryPath()),
  version: riftPackageVersion(),
  pendingEpicIds: [...pendingRiftEpicIds],
  pendingRemovalEpicIds: [
    ...new Set([...riftRemovalCoordinator.pendingEpicIds(), ...pendingRiftReleaseEpicIds]),
  ],
  readyRifts: [...unacknowledgedRifts.values()],
}));

// Every branch an epic's rift creates is namespaced here, so rift work is
// recognizable at a glance next to hand-made `feat/`, `fix/` branches.
const EPIC_BRANCH_NAMESPACE = 'orion/';
const EPIC_BRANCH_NAMESPACE_REF = `refs/heads/${EPIC_BRANCH_NAMESPACE.slice(0, -1)}`;

ipcMain.handle('epic:createRift', async (event, input) => {
  if (riftShutdownRequested) {
    return { ok: false, error: 'Rift creation was cancelled because Orion is quitting.' };
  }
  const epicId = typeof input?.epicId === 'string' ? input.epicId : '';
  if (!epicId) {
    return { ok: false, error: 'Missing epic id.' };
  }
  if (pendingRiftEpicIds.has(epicId)) {
    return { ok: false, error: 'A rift is already being created for this epic.' };
  }
  if (riftRemovalCoordinator.hasEpic(epicId) || pendingRiftReleaseEpicIds.has(epicId)) {
    return { ok: false, error: 'This epic’s previous rift is still being removed.' };
  }
  // Register synchronously before the first await. Agent and terminal IPC
  // handlers consult this main-owned lock, so a recreated renderer cannot run
  // an epic thread in the source repository while setup is still pending.
  pendingRiftEpicIds.add(epicId);
  const abortController = new AbortController();
  const cancelForDestroyedSender = () => abortController.abort();
  event.sender.once('destroyed', cancelForDestroyedSender);
  let settlePendingCreation;
  const pendingCreation = new Promise((resolve) => {
    settlePendingCreation = resolve;
  });
  let createdRiftPath = '';
  let awaitingPersistenceAck = false;
  const pendingEntry = {
    epicId,
    epicName: typeof input?.epicName === 'string' ? input.epicName : '',
    promise: pendingCreation,
    cancel: () => abortController.abort(),
    riftPath: () => createdRiftPath,
  };
  pendingRiftCreations.add(pendingEntry);
  try {
    const projectPath = input?.projectPath;
    if (!projectPath) {
      return { ok: false, error: 'Missing project path.' };
    }
    if (!riftBinaryPath()) {
      return { ok: false, error: 'Rift is not available on this platform.' };
    }

    const gitRoot = await getGitRoot(projectPath);
    const [canonicalGitRoot, canonicalProjectPath] = await Promise.all([
      fs.realpath(gitRoot),
      fs.realpath(projectPath),
    ]);
    const projectRelativePath = path.relative(canonicalGitRoot, canonicalProjectPath);
    if (
      path.isAbsolute(projectRelativePath) ||
      projectRelativePath === '..' ||
      projectRelativePath.startsWith(`..${path.sep}`)
    ) {
      return { ok: false, error: 'The selected project is outside its Git repository.' };
    }
    const sourceChanges = await readGitStatusEntries(gitRoot);
    if (sourceChanges.length > 0) {
      const examples = sourceChanges
        .slice(0, 3)
        .map((entry) => entry.relativePath)
        .join(', ');
      return {
        ok: false,
        error:
          'The source repository has staged, unstaged, or untracked changes. ' +
          'Commit, stash, or remove them before creating a rift.' +
          (examples ? ` Changed: ${examples}${sourceChanges.length > 3 ? ', …' : ''}` : ''),
      };
    }
    const { stdout: sourceHeadOutput } = await execFileAsync('git', [
      '-C',
      gitRoot,
      'rev-parse',
      '--verify',
      'HEAD',
    ]);
    const sourceHead = sourceHeadOutput.trim();
    if (!sourceHead) {
      return { ok: false, error: 'The source repository does not have a commit to create a rift from.' };
    }

    // Optional base for the epic's feature branch. Resolved in the source
    // repository up front so a stale selection fails before the expensive
    // copy, but never checked out there — the switch happens inside the rift
    // below, so local work in the source checkout is never at risk.
    const requestedBaseBranch = String(input?.baseBranch ?? '').trim();
    if (requestedBaseBranch) {
      const baseExists = await commandSucceeds('git', [
        '-C',
        gitRoot,
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${requestedBaseBranch}`,
      ]);
      if (!baseExists) {
        return {
          ok: false,
          error: `The selected base branch ${requestedBaseBranch} no longer exists in the source repository.`,
        };
      }
    }

    // Restoring an epic whose rift was freed to reclaim disk. Normal Rift work
    // pushes from the isolated workspace, so the durable copy is usually
    // origin's branch rather than a local branch in the source checkout.
    const requestedExistingBranch = String(input?.existingBranch ?? '').trim();
    let requestedExistingBranchRef = '';
    let restoringFromPreservedRef = false;
    if (requestedExistingBranch) {
      const preservedBranchRef = releasedRiftRefForEpic(epicId);
      const localBranchRef = `refs/heads/${requestedExistingBranch}`;
      const remoteBranchRef = `refs/remotes/origin/${requestedExistingBranch}`;
      const preservedBranchExists = await commandSucceeds('git', [
        '-C',
        gitRoot,
        'rev-parse',
        '--verify',
        '--quiet',
        preservedBranchRef,
      ]);
      const localBranchExists = !preservedBranchExists && await commandSucceeds('git', [
        '-C',
        gitRoot,
        'rev-parse',
        '--verify',
        '--quiet',
        localBranchRef,
      ]);
      let remoteBranchExists = false;
      if (!preservedBranchExists && !localBranchExists) {
        remoteBranchExists = await commandSucceeds('git', [
          '-C',
          gitRoot,
          'rev-parse',
          '--verify',
          '--quiet',
          remoteBranchRef,
        ]);
      }
      if (!preservedBranchExists && !localBranchExists && !remoteBranchExists) {
        // A source checkout need not have fetched a branch pushed from its
        // Rift. Fetch only this explicit ref so restore also works after a
        // fresh launch without changing the source worktree.
        try {
          await execFileAsync('git', [
            '-C',
            gitRoot,
            'fetch',
            '--no-tags',
            'origin',
            `refs/heads/${requestedExistingBranch}:${remoteBranchRef}`,
          ]);
          remoteBranchExists = true;
        } catch {}
      }
      requestedExistingBranchRef = preservedBranchExists
        ? preservedBranchRef
        : localBranchExists
          ? localBranchRef
          : remoteBranchExists
            ? remoteBranchRef
            : '';
      restoringFromPreservedRef = preservedBranchExists;
      if (!requestedExistingBranchRef) {
        return {
          ok: false,
          error: `The branch ${requestedExistingBranch} no longer exists locally or on origin, so this epic's rift cannot be recreated.`,
        };
      }
    }

    // Git cannot store both `refs/heads/orion` and child refs such as
    // `refs/heads/orion/<name>`. Check the source before copying it so this
    // collision does not create an incomplete rift first.
    const namespaceBranchExists = await commandSucceeds('git', [
      '-C',
      gitRoot,
      'rev-parse',
      '--verify',
      '--quiet',
      EPIC_BRANCH_NAMESPACE_REF,
    ]);
    if (namespaceBranchExists) {
      return {
        ok: false,
        error:
          'The source repository has a local branch named orion, which conflicts with ' +
          "Orion's orion/... Rift branch namespace. Rename or delete the local orion branch " +
          'before creating a rift.',
      };
    }

    // Idempotent: registers the repo with Rift on first use.
    await riftInit(gitRoot, { signal: abortController.signal });

    const slug = riftSlug(input?.epicName);
    // The suffix is part of both the workspace and branch names. Always
    // suffixing the branch prevents collisions with remote branches and with
    // sibling rifts, whose local refs are intentionally isolated.
    const suffix = crypto.randomBytes(12).toString('hex');
    const riftName = `${slug}-${suffix}`;
    // Rift's default layout is deterministic. Pass it explicitly and retain
    // it before spawning so cancellations before Rift reports stdout can
    // still be located and moved to Rift-owned trash.
    const riftParentPath = path.join(
      path.dirname(canonicalGitRoot),
      '.rifts',
      path.basename(canonicalGitRoot)
    );
    const expectedRiftPath = path.resolve(riftParentPath, riftName);
    if (existsSync(expectedRiftPath)) {
      throw new Error(`The planned rift destination already exists: ${expectedRiftPath}`);
    }
    createdRiftPath = expectedRiftPath;
    // Persist the deterministic destination before spawning Rift. If Electron
    // or the machine exits after the CLI starts copying, startup recovery can
    // still find both markerful and markerless partial workspaces.
    await rememberRiftCleanup(expectedRiftPath);
    const reportedRiftPath = await riftCreate(gitRoot, {
      name: riftName,
      into: riftParentPath,
      signal: abortController.signal,
    });
    const resolvedReportedRiftPath = path.resolve(reportedRiftPath);
    if (resolvedReportedRiftPath !== expectedRiftPath) {
      throw new Error(`rift create reported an unexpected workspace path: ${resolvedReportedRiftPath}`);
    }
    createdRiftPath = resolvedReportedRiftPath;
    const riftWorkingDir = projectRelativePath
      ? path.join(createdRiftPath, projectRelativePath)
      : createdRiftPath;
    const workingDirStat = await fs.stat(riftWorkingDir).catch(() => null);
    if (!workingDirStat?.isDirectory()) {
      throw new Error('The new rift does not contain the selected project directory.');
    }
    if (riftShutdownRequested) {
      throw new Error('Rift creation was cancelled because Orion is quitting.');
    }

    // `--copy-all` copies the source worktree and index as well as ignored
    // dependencies. Pin the new workspace to the clean snapshot captured
    // above before exposing it: a source edit racing `rift create` cannot
    // leak into the epic's first `git add -A`.
    const { stdout: excludeOutput } = await execFileAsync('git', [
      '-C',
      createdRiftPath,
      'rev-parse',
      '--git-path',
      'info/exclude',
    ]);
    const excludePath = path.isAbsolute(excludeOutput.trim())
      ? excludeOutput.trim()
      : path.resolve(createdRiftPath, excludeOutput.trim());
    await fs.appendFile(excludePath, '\n# Orion Rift metadata\n.rift\n');
    await execFileAsync('git', ['-C', createdRiftPath, 'reset', '--hard', sourceHead]);
    await execFileAsync('git', [
      '-C',
      createdRiftPath,
      'clean',
      '-ffd',
      '-e',
      '.rift',
      '-e',
      '.rift/**',
    ]);
    const copiedChanges = await readGitStatusEntries(createdRiftPath);
    if (copiedChanges.length > 0) {
      throw new Error('The new rift could not be reset to a clean Git snapshot.');
    }
    if (riftShutdownRequested) {
      throw new Error('Rift creation was cancelled because Orion is quitting.');
    }

    // Recreating a freed epic's workspace: check its existing branch straight
    // out and skip both the base-branch switch and the branch-naming turn.
    if (requestedExistingBranch) {
      try {
        if (restoringFromPreservedRef) {
          // The source may carry a stale local branch with this name. Reset
          // only the newly copied Rift branch to the exact pre-release HEAD.
          await execFileAsync('git', [
            '-C',
            createdRiftPath,
            'checkout',
            '-B',
            requestedExistingBranch,
            requestedExistingBranchRef,
            '--',
          ]);
        } else if (requestedExistingBranchRef.startsWith('refs/remotes/')) {
          await execFileAsync('git', [
            '-C',
            createdRiftPath,
            'checkout',
            '--track',
            '-b',
            requestedExistingBranch,
            requestedExistingBranchRef,
          ]);
        } else {
          await execFileAsync('git', [
            '-C',
            createdRiftPath,
            'checkout',
            requestedExistingBranch,
            '--',
          ]);
        }
      } catch (checkoutError) {
        const detail = checkoutError?.stderr?.toString().trim();
        throw new Error(
          `The rift could not check out ${requestedExistingBranch}.` + (detail ? ` ${detail}` : '')
        );
      }
      const restoredChanges = await readGitStatusEntries(createdRiftPath);
      if (restoredChanges.length > 0) {
        throw new Error(`The rift could not switch cleanly to ${requestedExistingBranch}.`);
      }

      let senderGone = false;
      try {
        senderGone = event.senderFrame?.isDestroyed?.() === true;
      } catch {
        senderGone = true;
      }
      if (riftShutdownRequested || event.sender.isDestroyed() || senderGone) {
        const abandonedRiftPath = createdRiftPath;
        await riftRemove(abandonedRiftPath);
        await forgetRiftCleanup(abandonedRiftPath);
        createdRiftPath = '';
        return {
          ok: false,
          error: 'Rift creation was cancelled because its Orion window closed.',
        };
      }

      unacknowledgedRifts.set(epicId, {
        epicId,
        projectId: typeof input?.projectId === 'string' ? input.projectId : undefined,
        projectPath: canonicalProjectPath,
        riftPath: createdRiftPath,
        riftWorkingDir,
        gitRoot,
        branch: requestedExistingBranch,
      });
      awaitingPersistenceAck = true;
      return {
        ok: true,
        riftPath: createdRiftPath,
        riftWorkingDir,
        gitRoot,
        branch: requestedExistingBranch,
      };
    }

    // Start the feature branch from the requested base instead of the source
    // checkout's HEAD. The rift copied the source's local refs, so the branch
    // is switched here — inside the rift only.
    if (requestedBaseBranch) {
      // The trailing `--` forces the argument to be read as a ref. Without it a
      // branch name that also names a tracked path (`src`, `docs`) and is missing
      // from the copied refs restores that path instead: exit 0, HEAD unmoved,
      // clean tree — so the epic would silently branch off sourceHead.
      try {
        await execFileAsync('git', ['-C', createdRiftPath, 'checkout', requestedBaseBranch, '--']);
      } catch (checkoutError) {
        const detail = checkoutError?.stderr?.toString().trim();
        throw new Error(
          `The rift could not check out the base branch ${requestedBaseBranch}.` +
            (detail ? ` ${detail}` : '')
        );
      }
      const switchedChanges = await readGitStatusEntries(createdRiftPath);
      if (switchedChanges.length > 0) {
        throw new Error(`The rift could not switch cleanly to ${requestedBaseBranch}.`);
      }
    }

    // The rift starts on a detached HEAD with the source's working tree and
    // index reset above. Let the epic's message model pick the readable part
    // of the branch name; fall back to a slug of the epic title. Every epic
    // branch lives under the `orion/` namespace.
    let branchBase = '';
    if (input?.modelId) {
      try {
        const prompt =
          `Choose a git branch name for work on the epic "${input?.epicName ?? ''}"` +
          (input?.epicDescription ? ` (${truncateForPrompt(String(input.epicDescription), 500)})` : '') +
          '. Reply with ONLY the branch name: lowercase kebab-case, no namespace prefix ' +
          '(no "feat/", no "fix/"), under 50 characters. No quotes, no commentary.';
        const raw = cleanGeneratedGitMessage(
          await runOneShotForModelId(input.modelId, prompt, riftWorkingDir, {
            signal: abortController.signal,
            reasoningEffort: input?.reasoningEffort,
          })
        );
        const candidate = raw
          .split('\n')[0]
          ?.trim()
          .replace(/^["'`]+|["'`]+$/g, '')
          // The model still reaches for a `feat/` style prefix sometimes. Drop it
          // and flatten anything else it namespaced so `orion/` stays the only one.
          .replace(/^[^/]+\//, '')
          .replace(/\//g, '-')
          .slice(0, 60);
        if (candidate && (await validateNewBranchName(`${EPIC_BRANCH_NAMESPACE}${candidate}`))) {
          branchBase = candidate;
        }
      } catch {
        // Fall back to the slug below.
      }
    }
    if (abortController.signal.aborted || riftShutdownRequested) {
      throw new Error('Rift creation was cancelled because its Orion window closed.');
    }
    if (!branchBase) branchBase = slug;
    branchBase = branchBase.replace(/[-/.]+$/g, '').slice(0, 70) || slug;
    const branch = `${EPIC_BRANCH_NAMESPACE}${branchBase}-${suffix}`;
    await execFileAsync('git', ['-C', createdRiftPath, 'checkout', '-b', branch]);

    // The initiating renderer can reload or close while the copy/model turn
    // is in flight. If its frame is gone there is nobody left to persist the
    // returned path, so remove the completed workspace instead of orphaning
    // it. Explicit app quit sets the same condition and waits for this cleanup.
    let senderFrameDestroyed = false;
    try {
      senderFrameDestroyed = event.senderFrame?.isDestroyed?.() === true;
    } catch {
      // Electron can throw while resolving senderFrame after its frame is disposed.
      senderFrameDestroyed = true;
    }
    if (
      riftShutdownRequested ||
      event.sender.isDestroyed() ||
      senderFrameDestroyed
    ) {
      const abandonedRiftPath = createdRiftPath;
      await riftRemove(abandonedRiftPath);
      await forgetRiftCleanup(abandonedRiftPath);
      createdRiftPath = '';
      return {
        ok: false,
        error: 'Rift creation was cancelled because its Orion window closed.',
      };
    }

    // Keep the pre-create journal entry until the renderer proves the epic
    // binding reached disk. Until then pendingRiftEpicIds keeps all
    // source-fallback IPCs locked.
    unacknowledgedRifts.set(epicId, {
      epicId,
      projectId: typeof input?.projectId === 'string' ? input.projectId : undefined,
      projectPath: canonicalProjectPath,
      riftPath: createdRiftPath,
      riftWorkingDir,
      gitRoot,
      branch,
    });
    awaitingPersistenceAck = true;
    return { ok: true, riftPath: createdRiftPath, riftWorkingDir, gitRoot, branch };
  } catch (error) {
    const originalError = error?.stderr?.toString().trim() || error?.message || String(error);
    if (!createdRiftPath || !existsSync(createdRiftPath)) {
      if (createdRiftPath) await forgetRiftCleanup(createdRiftPath).catch(() => {});
      return { ok: false, error: originalError };
    }

    try {
      if (riftShutdownRequested) {
        // Quit has a bounded barrier. Record the path before attempting Rift's
        // recoverable removal so a forced app exit cannot lose cleanup state.
        await rememberRiftCleanup(createdRiftPath).catch(() => {});
      }
      await removeRememberedRiftCleanup(createdRiftPath, { allowMarkerless: true });
      await forgetRiftCleanup(createdRiftPath);
      return { ok: false, error: originalError };
    } catch (cleanupError) {
      const cleanupMessage =
        cleanupError?.stderr?.toString().trim() ||
        cleanupError?.message ||
        String(cleanupError);
      await rememberRiftCleanup(createdRiftPath).catch(() => {});
      return {
        ok: false,
        riftPath: createdRiftPath,
        error:
          `${originalError} Orion also could not move the incomplete rift to trash: ` +
          `${cleanupMessage}. Incomplete rift: ${createdRiftPath}`,
      };
    }
  } finally {
    event.sender.removeListener('destroyed', cancelForDestroyedSender);
    settlePendingCreation();
    pendingRiftCreations.delete(pendingEntry);
    if (!awaitingPersistenceAck) pendingRiftEpicIds.delete(epicId);
  }
});

ipcMain.handle('epic:acknowledgeRift', async (_event, input) => {
  const epicId = typeof input?.epicId === 'string' ? input.epicId : '';
  const riftPath = typeof input?.riftPath === 'string' ? input.riftPath : '';
  if (!epicId || !riftPath) {
    return { ok: false, error: 'Missing epic id or rift path.' };
  }
  const ownership = unacknowledgedRifts.get(epicId);
  if (!ownership) {
    // A duplicate acknowledgement may race recovery with the original invoke
    // continuation. It is safe once this exact epic owns the path on disk.
    const persistedOwners = await readPersistedRiftOwners();
    return persistedOwners.get(riftPath)?.epicId === epicId
      ? { ok: true, skipped: true }
      : { ok: false, error: 'No matching Rift creation is awaiting acknowledgement.' };
  }
  if (ownership.riftPath !== riftPath) {
    return { ok: false, error: 'The Rift acknowledgement does not match the created workspace.' };
  }

  const persistedOwners = await readPersistedRiftOwners();
  if (persistedOwners.get(riftPath)?.epicId !== epicId) {
    return {
      ok: false,
      error: 'The epic’s Rift ownership has not reached durable storage yet.',
    };
  }

  try {
    await forgetRiftCleanup(riftPath);
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  }
  unacknowledgedRifts.delete(epicId);
  pendingRiftEpicIds.delete(epicId);
  return { ok: true };
});

const deleteEpicRestoreRefBestEffort = async (input) => {
  const epicId = typeof input?.epicId === 'string' ? input.epicId : '';
  if (!epicId) {
    return { ok: true, skipped: true, warning: 'The epic had no restore-ref identity.' };
  }

  const candidateRoots = [];
  // Prefer the project's live path. `git update-ref -d` succeeds when a ref
  // is already absent, so trying a stale archived path first could falsely
  // appear to clean the real repository.
  if (typeof input?.projectPath === 'string' && input.projectPath) {
    try {
      candidateRoots.push(await getGitRoot(input.projectPath));
    } catch {}
  }
  if (typeof input?.gitRoot === 'string' && input.gitRoot) {
    candidateRoots.push(input.gitRoot);
  }

  const errors = [];
  for (const gitRoot of new Set(candidateRoots.map((value) => path.resolve(value)))) {
    try {
      await deleteRiftRestoreRef(gitRoot, epicId);
      return { ok: true };
    } catch (error) {
      errors.push(error?.stderr?.toString().trim() || error?.message || String(error));
    }
  }

  // The source checkout may have moved or been deleted since the Rift was
  // released. Its hidden ref is then unreachable anyway, so cleanup must not
  // make Orion metadata undeletable.
  const warning =
    errors.find(Boolean) ??
    'The source repository is unavailable, so its saved Rift restore ref could not be removed.';
  console.warn('Could not delete Rift restore ref during epic deletion', epicId, warning);
  return { ok: true, skipped: true, warning };
};

ipcMain.handle('epic:removeRift', async (_event, input) => {
  const epicId = typeof input?.epicId === 'string' ? input.epicId : '';
  if (!epicId) {
    return { ok: false, error: 'Missing epic id.' };
  }
  return riftRemovalCoordinator.run([epicId], async () => {
    try {
      const riftPath = input?.riftPath;
      if (!riftPath) {
        return { ok: false, error: 'Missing rift path.' };
      }
      // The restore ref may be the only surviving copy of a force-freed,
      // never-pushed branch. Never delete it (or move the active Rift) while
      // crash recovery can still resurrect the owning Epic.
      if (!isEpicDeletionPersisted(await readPersistedStoreState(), epicId)) {
        return {
          ok: false,
          error: 'The epic deletion has not reached durable storage.',
        };
      }
      const runtimeThreadIds = Array.isArray(input?.runtimeThreadIds)
        ? [
            ...new Set(
              input.runtimeThreadIds.filter(
                (threadId) => typeof threadId === 'string' && threadId
              )
            ),
          ]
        : [];
      // Join the shared removal queue before runtime teardown. Retention and
      // manual release cannot cross this deletion's disposal/ref/removal
      // sequence, and agent launches remain guarded for the full operation.
      await Promise.all(
        runtimeThreadIds.map((threadId) => disposeAgentThreadRuntime(threadId))
      );
      // A path already gone is an idempotent success.
      if (!existsSync(riftPath)) {
        try {
          await forgetRiftCleanup(riftPath);
        } catch (error) {
          console.error('Could not clear old deleted Rift cleanup entry', riftPath, error);
        }
        const restoreRefResult = await deleteEpicRestoreRefBestEffort(input);
        return { ok: true, skipped: true, warning: restoreRefResult.warning };
      }

      let allowMarkerless = false;
      if (!existsSync(path.join(riftPath, '.rift'))) {
        // Renderer input alone is not enough to authorize markerless removal.
        // Require the main-owned pre-create journal for this exact destination.
        allowMarkerless = await hasRememberedRiftCleanup(riftPath);
      }
      // `rift remove` moves the workspace into Rift-owned trash — nothing is
      // physically deleted until `rift gc`, and source roots are refused
      // without --force. Markerless partial creations go to the OS trash.
      await removeRememberedRiftCleanup(riftPath, { allowMarkerless });
      try {
        await forgetRiftCleanup(riftPath);
      } catch (error) {
        console.error('Could not clear deleted Rift cleanup entry', riftPath, error);
      }
      // The durable Epic deletion and recoverable Rift move are complete.
      // Ref cleanup can safely lag or fail from here without risking data.
      const restoreRefResult = await deleteEpicRestoreRefBestEffort(input);
      return { ok: true, warning: restoreRefResult.warning };
    } catch (error) {
      return {
        ok: false,
        error: error?.stderr?.toString().trim() || error?.message || String(error),
      };
    }
  });
});

ipcMain.handle('epic:deleteRiftRestoreRef', async (_event, input) => {
  const epicId = typeof input?.epicId === 'string' ? input.epicId : '';
  if (!epicId) return { ok: false, error: 'Missing epic id.' };
  return riftRemovalCoordinator.run([epicId], () => deleteEpicRestoreRefBestEffort(input));
});

// --- Rift storage (measurement and sweep) -------------------------------------

// Every rift is a `--copy-all` clone carrying its own node_modules and build
// output, and settling an epic only writes a timestamp — so a long-lived
// install accumulates one full repo copy per settled epic with nothing ever
// reclaiming them. These handlers measure that footprint and let the user
// sweep it, and they are the only code path in Orion that reaches `rift gc`.

let riftStorageState = {
  scanning: false,
  scanId: null,
  scannedAt: null,
  entries: [],
  trashBytes: null,
  error: null,
};
let riftStorageScanQueue = Promise.resolve();
// Rifts removed by manual or retention cleanup, held until a renderer confirms
// it has durably cleared both the owning epic pointer and stale thread session
// ids. The disk journal bridges process crashes as well as window recreation.
const pendingRetentionReleases = [];
let pendingRetentionRetentionDays = null;
let riftReleaseJournalQueue = Promise.resolve();
let riftReleaseJournalHydrated = false;
const riftReleaseJournalPath = () => path.join(app.getPath('userData'), 'released-rifts.json');

const updateRiftReleaseJournal = (update) => {
  riftReleaseJournalQueue = riftReleaseJournalQueue
    .catch(() => {})
    .then(async () => {
      const journalPath = riftReleaseJournalPath();
      let journal = { releases: [] };
      try {
        const parsed = JSON.parse(await fs.readFile(journalPath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.releases)) {
          journal = parsed;
        }
      } catch {}
      const next = await update(journal);
      const tempPath = `${journalPath}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(journalPath), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(next), 'utf-8');
      await fs.rename(tempPath, journalPath);
      return next;
    });
  return riftReleaseJournalQueue;
};

const syncPendingRiftReleases = (journal) => {
  pendingRiftReleaseEpicIds.clear();
  for (const epicId of guardedEpicIdsForRiftReleaseJournal(journal)) {
    pendingRiftReleaseEpicIds.add(epicId);
  }
  pendingRetentionReleases.length = 0;
  const released = journal.releases.filter(
    (entry) =>
      entry?.phase === 'released' &&
      typeof entry.riftPath === 'string' &&
      typeof entry.epicId === 'string'
  );
  pendingRetentionReleases.push(
    ...released.map(({ riftPath, epicId }) => ({ riftPath, epicId }))
  );
  const retentionDays = released
    .map((entry) => entry.retentionDays)
    .filter((value) => Number.isFinite(value) && value > 0);
  pendingRetentionRetentionDays =
    retentionDays.length > 0 && retentionDays.length === released.length
      ? Math.min(...retentionDays)
      : null;
};

const hydrateRiftReleaseJournal = async () => {
  if (riftReleaseJournalHydrated) {
    await riftReleaseJournalQueue.catch(() => {});
  }
  const journal = await updateRiftReleaseJournal((current) =>
    reconcileRiftReleaseJournal(current, {
      pathExists: existsSync,
      // A status request can overlap a real removal after its durable intent
      // lands. Keep that entry until the coordinator releases its reservation;
      // otherwise a poll could erase the only crash-recovery record.
      isEpicRemovalPending: (epicId) => riftRemovalCoordinator.hasEpic(epicId),
    })
  );
  syncPendingRiftReleases(journal);
  riftReleaseJournalHydrated = true;
};

const beginRiftRelease = async ({ riftPath, epicId, retentionDays = null }) => {
  await hydrateRiftReleaseJournal();
  const journal = await updateRiftReleaseJournal((current) => ({
    releases: [
      ...current.releases.filter((entry) => entry.riftPath !== riftPath),
      { riftPath, epicId, retentionDays, phase: 'removing' },
    ],
  }));
  syncPendingRiftReleases(journal);
  return journal;
};

const completeRiftRelease = async ({ riftPath, epicId, retentionDays = null }) => {
  const journal = await updateRiftReleaseJournal((current) => ({
    releases: [
      ...current.releases.filter((entry) => entry.riftPath !== riftPath),
      { riftPath, epicId, retentionDays, phase: 'released' },
    ],
  }));
  syncPendingRiftReleases(journal);
};

const cancelRiftRelease = async (riftPath) => {
  const journal = await updateRiftReleaseJournal((current) => ({
    releases: current.releases.filter((entry) => entry.riftPath !== riftPath),
  }));
  syncPendingRiftReleases(journal);
};

const acknowledgeRiftReleases = async (riftPaths) => {
  await hydrateRiftReleaseJournal();
  const acknowledged = new Set(riftPaths);
  const journal = await updateRiftReleaseJournal((current) => ({
    releases: current.releases.filter((entry) => !acknowledged.has(entry.riftPath)),
  }));
  syncPendingRiftReleases(journal);
};

const publishRiftStorageState = (patch) => {
  riftStorageState = { ...riftStorageState, ...patch };
  sendToAllWindows('riftStorage:state', riftStorageState);
  return riftStorageState;
};

// Uncommitted or unpushed work is the one thing a sweep must never destroy.
// Settling only *warns* about it, so a settled epic can still be the sole
// copy of real work. Mirrors the checks in `epic:gitStatus`.
const readRiftWorkState = async (riftPath) => {
  const workState = { hasUncommittedChanges: false, hasUnpushedCommits: false, branch: null };
  try {
    const { stdout } = await execFileAsync('git', ['-C', riftPath, 'status', '--porcelain'], {
      maxBuffer: 1024 * 1024 * 4,
    });
    workState.hasUncommittedChanges = stdout.trim().length > 0;
  } catch {
    // Not a readable git worktree. Treat that as "cannot prove it is safe".
    workState.hasUncommittedChanges = true;
    return workState;
  }
  try {
    workState.branch = (await getCurrentGitBranch(riftPath)) ?? null;
  } catch {}
  if (!workState.branch) {
    // Detached HEAD, or git would not say. `epic:gitStatus` errs toward
    // "nothing unpushed" to keep its commit button enabled; a sweep has to err
    // the other way, because the commits it cannot account for may be the only
    // copy of the work.
    workState.hasUnpushedCommits = true;
    return workState;
  }
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      riftPath,
      'rev-list',
      '--count',
      `refs/heads/${workState.branch}`,
      '--not',
      '--remotes=origin',
    ]);
    workState.hasUnpushedCommits = Number.parseInt(stdout.trim(), 10) > 0;
  } catch {
    workState.hasUnpushedCommits = true;
  }
  return workState;
};

// Rift roots reachable from persisted state: an epic's own rift parent, the
// root its source repository would use, and every project's. Unowned rifts
// left behind by crashes or deleted epics only turn up through the last two.
const collectRiftRoots = async (state) => {
  const roots = new Set();
  for (const epic of Array.isArray(state?.epics) ? state.epics : []) {
    if (typeof epic?.riftPath === 'string' && epic.riftPath) {
      roots.add(path.dirname(path.resolve(epic.riftPath)));
    }
    if (typeof epic?.gitRoot === 'string' && epic.gitRoot) {
      roots.add(riftRootForGitRoot(epic.gitRoot));
    }
  }
  await Promise.all(
    (Array.isArray(state?.projects) ? state.projects : []).map(async (project) => {
      if (typeof project?.path !== 'string' || !project.path) return;
      try {
        roots.add(riftRootForGitRoot(await getGitRoot(project.path)));
      } catch {
        // A removed or temporarily unreadable project cannot reveal a Git
        // root. Keep the old direct-root fallback so persisted repositories
        // remain discoverable when their path itself was the repository.
        roots.add(riftRootForGitRoot(project.path));
      }
    })
  );
  return [...roots];
};

const RIFT_SCAN_CONCURRENCY = 4;

// Runs `worker` over `items` with a bounded number in flight — sizing and
// `git status` are both IO-heavy enough that an unbounded fan-out over a
// couple of dozen multi-gigabyte trees just thrashes the disk.
const mapWithConcurrency = async (items, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(RIFT_SCAN_CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const scanRiftStorage = async ({ remeasure = false } = {}) => {
  const state = await readPersistedStoreState();
  const owners = await readPersistedRiftOwners(state);
  const cache = await loadSizeCache();
  const nextCache = {};

  const discovered = [];
  // Registry rows make `rift gc` machine-wide, including repositories Orion
  // has never persisted. Seed the scan with them, then add known `.trash`
  // roots and collapse parent/child overlaps before measuring.
  const trashCandidates = listRiftTrashPaths();
  for (const riftRoot of await collectRiftRoots(state)) {
    const { rifts, trashPath } = await listRiftRootEntries(riftRoot);
    if (trashPath) trashCandidates.push(trashPath);
    for (const riftPath of rifts) discovered.push({ riftPath, riftRoot });
  }
  const trashPaths = collapseNestedPaths(trashCandidates);

  const entries = await mapWithConcurrency(discovered, async ({ riftPath, riftRoot }) => {
    // Creation can advance while an IO-heavy scan is in flight, so consult
    // main-owned handshakes at classification time instead of snapshotting
    // them before directory discovery.
    const pendingOwner = collectPendingRiftOwnersByPath(
      unacknowledgedRifts,
      pendingRiftCreations
    ).get(riftPath);
    const owner = owners.get(riftPath) ?? pendingOwner;
    const cached = cache[riftPath];
    const reuseCached = !remeasure && typeof cached?.bytes === 'number';
    const bytes = reuseCached ? cached.bytes : await measurePathSize(riftPath);
    nextCache[riftPath] = {
      bytes,
      measuredAt: reuseCached ? cached.measuredAt : new Date().toISOString(),
    };

    let status = 'orphan';
    if (owner) {
      if (owner.cleanupPending) status = 'cleanupPending';
      else if (owner.settledAt) status = 'settled';
      else status = 'active';
    }

    // Individual row actions can manually free a Rift in any lifecycle state,
    // so every row needs an accurate unpublished-work warning and override.
    // The bulk/automatic candidate filters remain stricter.
    const workState = await readRiftWorkState(riftPath);

    return {
      riftPath,
      riftRoot,
      name: path.basename(riftPath),
      repoName: path.basename(riftRoot),
      bytes,
      status,
      hasMarker: await riftHasMarker(riftPath),
      epicId: owner?.epicId ?? null,
      epicName: owner?.name ?? null,
      settledAt: owner?.settledAt ?? null,
      gitBranch: owner?.gitBranch ?? workState?.branch ?? null,
      prUrl: owner?.prUrl ?? null,
      prState: owner?.prState ?? null,
      hasUncommittedChanges: workState?.hasUncommittedChanges ?? false,
      hasUnpushedCommits: workState?.hasUnpushedCommits ?? false,
    };
  });

  let trashBytes = null;
  for (const trashPath of trashPaths) {
    const bytes = await measurePathSize(trashPath);
    if (typeof bytes === 'number') trashBytes = (trashBytes ?? 0) + bytes;
  }

  await saveSizeCache(nextCache);
  entries.sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
  return { entries, trashBytes };
};

const runRiftStorageScan = ({ remeasure = false } = {}) => {
  riftStorageScanQueue = riftStorageScanQueue
    .catch(() => {})
    .then(async () => {
      publishRiftStorageState({ scanning: true, error: null });
      try {
        const { entries, trashBytes } = await scanRiftStorage({ remeasure });
        publishRiftStorageState({
          scanning: false,
          scanId: crypto.randomUUID(),
          scannedAt: new Date().toISOString(),
          entries,
          trashBytes,
          error: null,
        });
      } catch (error) {
        publishRiftStorageState({ scanning: false, error: error?.message || String(error) });
      }
      return riftStorageState;
    });
  return riftStorageScanQueue;
};

ipcMain.handle('riftStorage:getState', async () => {
  await hydrateRiftReleaseJournal();
  return {
    ...riftStorageState,
    pendingReleases: [...pendingRetentionReleases],
    pendingReleasesRetentionDays: pendingRetentionRetentionDays,
  };
});

// The renderer has cleared these freed epics' pointers and stale session ids,
// and has confirmed both persistence files reached disk.
ipcMain.handle('riftStorage:acknowledgeReleases', async (_event, input) => {
  const riftPaths = Array.isArray(input?.riftPaths)
    ? input.riftPaths.filter((value) => typeof value === 'string' && value)
    : [];
  if (riftPaths.length === 0) return { ok: false, error: 'No releases were acknowledged.' };
  try {
    await riftRemovalCoordinator.run([], () => acknowledgeRiftReleases(riftPaths));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('riftStorage:scan', async (_event, input) => {
  await runRiftStorageScan({ remeasure: input?.remeasure === true });
  return riftStorageState;
});

ipcMain.handle('riftStorage:release', async (_event, input) => {
  const requested = Array.isArray(input?.riftPaths) ? input.riftPaths : [];
  const runGc = input?.runGc === true;
  if (requested.length === 0 && !runGc) {
    return { ok: false, error: 'No rifts were selected.' };
  }
  const forcedPaths = new Set(Array.isArray(input?.forcePaths) ? input.forcePaths : []);
  const manuallyRequestedPaths = new Set(
    (Array.isArray(input?.manualPaths) ? input.manualPaths : []).filter(
      (value) => typeof value === 'string' && value
    )
  );
  const manualScanId = typeof input?.manualScanId === 'string' ? input.manualScanId : null;
  // The renderer knows about live runs the persisted store cannot show.
  const busyEpicIds = new Set(Array.isArray(input?.busyEpicIds) ? input.busyEpicIds : []);
  const runtimeThreadIdsByEpic =
    input?.runtimeThreadIdsByEpic &&
    typeof input.runtimeThreadIdsByEpic === 'object' &&
    !Array.isArray(input.runtimeThreadIdsByEpic)
      ? input.runtimeThreadIdsByEpic
      : {};
  const runtimeThreadIdsForEpic = (epicId) =>
    Array.isArray(runtimeThreadIdsByEpic[epicId])
      ? [
          ...new Set(
            runtimeThreadIdsByEpic[epicId].filter(
              (value) => typeof value === 'string' && value
            )
          ),
        ]
      : [];

  const reservationState = await readPersistedStoreState();
  const reservationOwners = await readPersistedRiftOwners(reservationState);
  const reservationPendingOwners = collectPendingRiftOwnersByPath(
    unacknowledgedRifts,
    pendingRiftCreations
  );
  const guardedEpicIds = new Set(
    requested
      .map(
        (riftPath) =>
          reservationOwners.get(riftPath)?.epicId ??
          reservationPendingOwners.get(riftPath)?.epicId
      )
      .filter((epicId) => typeof epicId === 'string' && epicId)
  );
  return riftRemovalCoordinator.run(guardedEpicIds, async () => {
  // Ownership may have changed while another destructive operation was ahead
  // of this one in the queue. Snapshot it only after exclusive ownership.
  const persistedState = await readPersistedStoreState();
  const owners = await readPersistedRiftOwners(persistedState);
  const pendingOwners = collectPendingRiftOwnersByPath(
    unacknowledgedRifts,
    pendingRiftCreations
  );
  // Manual overrides are accepted only for exact paths main published in the
  // scan the confirmation dialog displayed. Resolve them after taking the
  // destructive-operation queue so a rescan cannot silently substitute a
  // newer row while this request waits.
  const manuallyConfirmedEntries = collectCurrentManualRiftReleaseEntries(
    riftStorageState.entries,
    manuallyRequestedPaths,
    riftStorageState.scanId,
    manualScanId
  );
  const trashPaths = new Set(runGc ? listRiftTrashPaths() : []);
  if (runGc) {
    for (const riftRoot of await collectRiftRoots(persistedState)) {
      const { trashPath } = await listRiftRootEntries(riftRoot);
      if (trashPath) trashPaths.add(trashPath);
    }
  }
  const trashSamplePath = (trashPath) => {
    let current = path.resolve(trashPath);
    while (path.dirname(current) !== current && path.basename(current) !== '.trash') {
      current = path.dirname(current);
    }
    return path.basename(current) === '.trash' ? path.dirname(current) : path.dirname(trashPath);
  };
  const measurementPaths = [
    ...requested.flatMap((value) =>
      typeof value === 'string' && value ? [path.dirname(path.resolve(value))] : []
    ),
    ...[...trashPaths].map(trashSamplePath),
  ];
  const freeBefore = await readVolumeFreeSpace(measurementPaths);

  const results = [];
  for (const riftPath of requested) {
    const reject = (reason) => results.push({ riftPath, ok: false, reason });
    const manuallyConfirmedEntry = manuallyConfirmedEntries.get(riftPath);
    const manuallyConfirmed = Boolean(manuallyConfirmedEntry);
    if (typeof riftPath !== 'string' || !riftPath) {
      reject('unsafe-path');
      continue;
    }
    // A workspace still owned by the creation handshake is live even when the
    // renderer has not persisted it yet. Never let orphan cleanup race that
    // recovery path, including forced release requests.
    if (pendingOwners.has(riftPath)) {
      reject('epic-active');
      continue;
    }
    const owner = owners.get(riftPath);
    if (manuallyRequestedPaths.has(riftPath) && !manuallyConfirmedEntry) {
      reject(owner && !owner.settledAt && !owner.cleanupPending ? 'epic-active' : 'ownership-changed');
      continue;
    }
    if (manuallyConfirmedEntry && !isManualRiftReleaseEntryCurrent(manuallyConfirmedEntry, owner)) {
      // A row confirmation authorizes the lifecycle identity the user saw,
      // not a replacement owner or a same-Epic restore that raced the dialog.
      reject(owner && !owner.settledAt && !owner.cleanupPending ? 'epic-active' : 'ownership-changed');
      continue;
    }
    if (!existsSync(riftPath)) {
      // Already gone; let the renderer clear the epic's pointer anyway.
      await forgetRiftCleanup(riftPath);
      if (owner) {
        try {
          await Promise.all(
            runtimeThreadIdsForEpic(owner.epicId).map((threadId) =>
              disposeAgentThreadRuntime(threadId)
            )
          );
        } catch (error) {
          results.push({
            riftPath,
            ok: false,
            reason: 'runtime-dispose-failed',
            error: error?.message || String(error),
          });
          continue;
        }
        try {
          await beginRiftRelease({ riftPath, epicId: owner.epicId });
          await completeRiftRelease({ riftPath, epicId: owner.epicId });
        } catch (error) {
          results.push({
            riftPath,
            ok: false,
            reason: 'journal-failed',
            error: error?.message || String(error),
          });
          continue;
        }
      }
      results.push({ riftPath, ok: true, skipped: true, epicId: owner?.epicId ?? null });
      continue;
    }
    // Only ever remove something shaped exactly like an Orion-created rift.
    // The marker remains mandatory for automatic cleanup; an individually
    // confirmed path from main's current scan may also be an incomplete
    // markerless destination left by an interrupted create.
    if (!isRiftDirectoryPath(riftPath)) {
      reject('unsafe-path');
      continue;
    }
    const hasMarker = await riftHasMarker(riftPath);
    if (manuallyConfirmedEntry && hasMarker !== manuallyConfirmedEntry.hasMarker) {
      reject('ownership-changed');
      continue;
    }
    if (!hasMarker && !manuallyConfirmed) {
      reject('missing-marker');
      continue;
    }
    if (owner && !owner.settledAt && !owner.cleanupPending && !manuallyConfirmed) {
      reject('epic-active');
      continue;
    }
    if (owner && (busyEpicIds.has(owner.epicId) || pendingRiftEpicIds.has(owner.epicId))) {
      reject('epic-busy');
      continue;
    }
    if (!forcedPaths.has(riftPath)) {
      const workState = await readRiftWorkState(riftPath);
      if (workState.hasUncommittedChanges || workState.hasUnpushedCommits) {
        reject('unpushed-work');
        continue;
      }
    }
    if (owner && !owner.cleanupPending) {
      try {
        await preserveRiftHeadForRestore(riftPath, owner);
      } catch (error) {
        results.push({
          riftPath,
          ok: false,
          reason: 'restore-ref-failed',
          error: error?.message || String(error),
        });
        continue;
      }
    }
    if (owner) {
      try {
        // This is intentionally main-owned and immediately adjacent to
        // removal. It reaps idle terminals, resumable provider sessions,
        // untracked children, and startup races that a renderer "running"
        // flag cannot represent.
        await Promise.all(
          runtimeThreadIdsForEpic(owner.epicId).map((threadId) =>
            disposeAgentThreadRuntime(threadId)
          )
        );
      } catch (error) {
        results.push({
          riftPath,
          ok: false,
          reason: 'runtime-dispose-failed',
          error: error?.message || String(error),
        });
        continue;
      }
      try {
        // Write intent before moving the directory. If Orion crashes after
        // removal but before the completion write, startup infers completion
        // from the now-missing path and still clears the persisted pointer.
        await beginRiftRelease({ riftPath, epicId: owner.epicId });
      } catch (error) {
        results.push({
          riftPath,
          ok: false,
          reason: 'journal-failed',
          error: error?.message || String(error),
        });
        continue;
      }
    }
    // Restoring an archived epic only changes persisted renderer state; it
    // does not wait for this cleanup request. Re-read ownership after every
    // asynchronous guard and immediately before removal so a restored,
    // rebound, or freshly re-settled epic wins over this stale sweep entry.
    const currentOwner = (await readPersistedRiftOwners()).get(riftPath);
    if (!isRiftReleaseOwnerCurrent(currentOwner, owner)) {
      if (owner) {
        try {
          await cancelRiftRelease(riftPath);
        } catch (error) {
          console.error('Could not cancel stale Rift release journal entry', riftPath, error);
        }
      }
      reject(
        currentOwner && !currentOwner.settledAt && !currentOwner.cleanupPending
          ? 'epic-active'
          : 'ownership-changed'
      );
      continue;
    }
    // Runtime disposal and the durable journal write above can take long
    // enough for a terminal or external Git process to change the workspace.
    // Recheck unpublished work and repin the exact final HEAD at the
    // destructive boundary; the earlier checks are only preflight.
    if (!forcedPaths.has(riftPath)) {
      const finalWorkState = await readRiftWorkState(riftPath);
      if (finalWorkState.hasUncommittedChanges || finalWorkState.hasUnpushedCommits) {
        if (owner) {
          try {
            await cancelRiftRelease(riftPath);
          } catch (error) {
            console.error('Could not cancel changed Rift release journal entry', riftPath, error);
          }
        }
        reject('unpushed-work');
        continue;
      }
    }
    if (owner && !owner.cleanupPending) {
      try {
        await preserveRiftHeadForRestore(riftPath, owner);
      } catch (error) {
        try {
          await cancelRiftRelease(riftPath);
        } catch (journalError) {
          console.error(
            'Could not cancel unpreserved Rift release journal entry',
            riftPath,
            journalError
          );
        }
        results.push({
          riftPath,
          ok: false,
          reason: 'restore-ref-failed',
          error: error?.message || String(error),
        });
        continue;
      }
    }
    // The final Git checks above are asynchronous too. Revalidate lifecycle
    // ownership once more so a concurrent restore cannot cross removal.
    const boundaryOwner = (await readPersistedRiftOwners()).get(riftPath);
    if (!isRiftReleaseOwnerCurrent(boundaryOwner, owner)) {
      if (owner) {
        try {
          await cancelRiftRelease(riftPath);
        } catch (error) {
          console.error('Could not cancel stale Rift release journal entry', riftPath, error);
        }
      }
      reject(
        boundaryOwner && !boundaryOwner.settledAt && !boundaryOwner.cleanupPending
          ? 'epic-active'
          : 'ownership-changed'
      );
      continue;
    }
    try {
      if (hasMarker) {
        await riftRemove(riftPath);
      } else {
        // Markerless rows are incomplete Orion destinations rather than
        // registered Rift workspaces. The scan allowlist plus the strict path
        // shape above authorize this exact directory, and system Trash keeps
        // the manual removal recoverable.
        await shell.trashItem(riftPath);
      }
    } catch (error) {
      if (owner) {
        try {
          await cancelRiftRelease(riftPath);
        } catch (journalError) {
          console.error('Could not cancel failed Rift release journal entry', riftPath, journalError);
        }
      }
      results.push({
        riftPath,
        ok: false,
        reason: 'remove-failed',
        error: error?.message || String(error),
      });
      continue;
    }
    try {
      await forgetRiftCleanup(riftPath);
    } catch (error) {
      console.error('Could not clear old Rift cleanup journal entry', riftPath, error);
    }
    if (owner) {
      try {
        await completeRiftRelease({ riftPath, epicId: owner.epicId });
      } catch (error) {
        // The durable pre-removal intent is enough for startup recovery.
        // Keep reporting the successful move and retain the journal rather
        // than encouraging a second destructive attempt at a missing path.
        console.error('Could not mark Rift release complete', riftPath, error);
      }
    }
    results.push({ riftPath, ok: true, epicId: owner?.epicId ?? null });
  }

  // `rift remove` only relocates into Rift's trash — without this nothing is
  // actually reclaimed. Machine-wide and permanent, so it stays opt-in and
  // confirmed by the caller.
  let gcError = null;
  if (runGc) {
    try {
      await riftGc();
    } catch (error) {
      gcError = error?.message || String(error);
    }
  }

  const freeAfter = await readVolumeFreeSpace(
    [...freeBefore.values()].map((sample) => sample.path)
  );
  const reclaimedBytes = reclaimedBytesAcrossVolumes(freeBefore, freeAfter);

  void runRiftStorageScan({ remeasure: true });

  return {
    ok: results.some((result) => result.ok) || (runGc && !gcError),
    results,
    reclaimedBytes,
    gcError,
    releasedEpicIds: results.filter((result) => result.ok && result.epicId).map((r) => r.epicId),
  };
  });
});

// Age-based retention. Off unless the user picks a window in Settings, and
// deliberately never runs `rift gc`: an unattended sweep should stay
// recoverable, so it only moves settled rifts into Rift's trash.
const startRiftRetentionSweep = async () => {
  try {
    await hydrateRiftReleaseJournal();
    const state = await readPersistedStoreState();
    const retentionDays = state?.riftsSettings?.retentionDays;
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
    if (!riftBinaryPath()) return;

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const owners = await readPersistedRiftOwners(state);
    const ageCandidates = [];
    for (const [riftPath, owner] of owners) {
      if (!isRetainedRiftOwnerEligible(owner, { epicId: owner.epicId, cutoff })) continue;
      if (!existsSync(riftPath)) continue;
      ageCandidates.push({ riftPath, owner });
    }
    if (ageCandidates.length === 0) return;
    return await riftRemovalCoordinator.run(
      ageCandidates.map(({ owner }) => owner.epicId),
      async () => {
    const runtimeThreadIdsByEpic = await readPersistedRuntimeThreadIdsByEpic();
    const expired = [];
    for (const { riftPath, owner } of ageCandidates) {
      if (!isRiftDirectoryPath(riftPath) || !(await riftHasMarker(riftPath))) continue;
      const workState = await readRiftWorkState(riftPath);
      if (workState.hasUncommittedChanges || workState.hasUnpushedCommits) continue;
      try {
        await preserveRiftHeadForRestore(riftPath, owner);
      } catch (error) {
        console.error('Rift retention sweep could not preserve a restore ref', riftPath, error);
        continue;
      }
      expired.push({ riftPath, epicId: owner.epicId });
    }
    if (expired.length === 0) return;

    const released = [];
    for (const { riftPath, epicId } of expired) {
      try {
        await Promise.all(
          (runtimeThreadIdsByEpic.get(epicId) ?? []).map((threadId) =>
            disposeAgentThreadRuntime(threadId)
          )
        );
        await beginRiftRelease({ riftPath, epicId, retentionDays });
        // The window is already interactive while this startup sweep runs.
        // A restore flushes its now-active epic before doing any Rift setup,
        // so reread durable ownership at the destructive boundary. Missing,
        // replaced, newly settled, or restored ownership all cancel removal.
        const currentOwner = (await readPersistedRiftOwners()).get(riftPath);
        if (!isRetainedRiftOwnerEligible(currentOwner, { epicId, cutoff })) {
          await cancelRiftRelease(riftPath);
          continue;
        }
        // Disposal and journaling open the same work-state race as a manual
        // release. Retention is never forced, so newly unpublished work always
        // cancels the sweep and the exact final HEAD is pinned again.
        const finalWorkState = await readRiftWorkState(riftPath);
        if (finalWorkState.hasUncommittedChanges || finalWorkState.hasUnpushedCommits) {
          await cancelRiftRelease(riftPath);
          continue;
        }
        await preserveRiftHeadForRestore(riftPath, currentOwner);
        const boundaryOwner = (await readPersistedRiftOwners()).get(riftPath);
        if (!isRetainedRiftOwnerEligible(boundaryOwner, { epicId, cutoff })) {
          await cancelRiftRelease(riftPath);
          continue;
        }
        await riftRemove(riftPath);
      } catch (error) {
        try {
          await cancelRiftRelease(riftPath);
        } catch (journalError) {
          console.error(
            'Could not cancel failed retained Rift release journal entry',
            riftPath,
            journalError
          );
        }
        console.error('Rift retention sweep could not remove', riftPath, error);
        continue;
      }
      try {
        await forgetRiftCleanup(riftPath);
      } catch (error) {
        console.error('Could not clear old retained Rift cleanup journal entry', riftPath, error);
      }
      try {
        await completeRiftRelease({ riftPath, epicId, retentionDays });
      } catch (error) {
        // The durable removing phase plus a missing path is recoverable on
        // next launch even if this completion write cannot land.
        console.error('Could not mark retained Rift release complete', riftPath, error);
      }
      released.push({ riftPath, epicId });
    }
    if (released.length === 0) return;
    // This runs at startup, before any renderer has subscribed, so the
    // broadcast alone would be lost and the epics would keep pointing at
    // directories that no longer exist. Park the result until a renderer
    // acknowledges it, the same way unacknowledgedRifts does for creation.
    sendToAllWindows('riftStorage:released', { released, retentionDays });
      }
    );
  } catch (error) {
    console.error('Rift retention sweep failed', error);
  }
};

// --- Orion Cloud repositories -------------------------------------------------

const cloudErrorMessage = (error) => {
  if (error?.status === 401) return 'Your Orion session expired. Sign in again.';
  if (error?.status === 404) {
    // A real "repo not found" comes back as JSON from the git API; a bare 404
    // (HTML page) means this Orion Web deployment doesn't have the API at all.
    return error?.data?.error
      ? 'Cloud repository not found. It may have been deleted.'
      : `Orion Cloud at ${getOrionWebUrl().host} does not support repositories yet. Deploy the latest Orion Web, or point ORION_WEB_URL at a server that has it.`;
  }
  if (error?.message?.includes('fetch failed')) return 'Could not reach Orion Cloud.';
  return error?.stderr?.toString().trim() || error?.message || String(error);
};

const sanitizeCloudRepoName = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 100);

const cloudRepoWebUrl = (repoId) => new URL(`/repos/${repoId}`, getOrionWebUrl()).toString();

ipcMain.handle('cloud:getState', async (_event, projectPath) => {
  try {
    if (!projectPath) return { ok: false, error: 'Missing project path.' };
    const session = await readAccountSession();
    if (!session?.token) {
      return { ok: true, authenticated: false, linked: false };
    }
    const gitRoot = await getGitRoot(projectPath);
    const state = await getCloudState({
      gitRoot,
      baseUrl: getOrionWebUrl(),
      token: session.token,
    });
    return {
      ok: true,
      authenticated: true,
      ...state,
      webUrl: state.linked ? cloudRepoWebUrl(state.repoId) : null,
    };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('cloud:publish', async (_event, input) => {
  try {
    const projectPath = input?.projectPath;
    if (!projectPath) return { ok: false, error: 'Missing project path.' };
    const session = await readAccountSession();
    if (!session?.token) {
      return { ok: false, error: 'Sign in to your Orion account to publish.', needsAuth: true };
    }

    const gitRoot = await getGitRoot(projectPath);
    const existing = await getCloudRepoLink(gitRoot);
    if (existing) {
      // Already linked — publishing again just means updating the cloud copy.
      try {
        const result = await pushRepo({
          gitRoot,
          repoId: existing.repoId,
          baseUrl: getOrionWebUrl(),
          token: session.token,
        });
        return { ...result, alreadyLinked: true, webUrl: cloudRepoWebUrl(existing.repoId) };
      } catch (error) {
        if (error?.status !== 404) throw error;
        // The cloud repo is gone — drop the stale link and publish fresh.
        await clearCloudRepoLink(gitRoot);
      }
    }

    const name = sanitizeCloudRepoName(input?.name || path.basename(gitRoot));
    if (!name) return { ok: false, error: 'Invalid repository name.' };

    const result = await publishRepo({
      gitRoot,
      name,
      baseUrl: getOrionWebUrl(),
      token: session.token,
    });
    return { ...result, webUrl: result.repo ? cloudRepoWebUrl(result.repo.id) : null };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('cloud:push', async (_event, projectPath) => {
  try {
    if (!projectPath) return { ok: false, error: 'Missing project path.' };
    const session = await readAccountSession();
    if (!session?.token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const gitRoot = await getGitRoot(projectPath);
    const link = await getCloudRepoLink(gitRoot);
    if (!link) return { ok: false, error: 'This repository is not linked to Orion Cloud yet.' };

    return await pushRepo({
      gitRoot,
      repoId: link.repoId,
      baseUrl: getOrionWebUrl(),
      token: session.token,
    });
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('cloud:pull', async (_event, projectPath) => {
  try {
    if (!projectPath) return { ok: false, error: 'Missing project path.' };
    const session = await readAccountSession();
    if (!session?.token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const gitRoot = await getGitRoot(projectPath);
    const link = await getCloudRepoLink(gitRoot);
    if (!link) return { ok: false, error: 'This repository is not linked to Orion Cloud yet.' };

    return await pullRepo({
      gitRoot,
      repoId: link.repoId,
      baseUrl: getOrionWebUrl(),
      token: session.token,
    });
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

// --- Orion board tasks (kanban on the web app) --------------------------------

const boardTasksRequest = async (token, apiPath, options = {}) => {
  const response = await fetch(new URL(apiPath, getOrionWebUrl()), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // non-JSON error body
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Orion Cloud request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const downloadBoardTaskAttachments = async (token, task) => {
  const attachments = Array.isArray(task?.attachments) ? task.attachments : [];
  if (attachments.length === 0) return { ...task, attachments: [] };

  const attachmentDir = getAttachmentDirectoryPath();
  await fs.mkdir(attachmentDir, { recursive: true });
  const downloaded = await Promise.all(
    attachments.map(async (attachment) => {
      const attachmentId = String(attachment?.id ?? '');
      const taskId = String(task?.id ?? '');
      if (!attachmentId || !taskId) {
        return { ...attachment, downloadError: 'Invalid attachment metadata.' };
      }

      const originalName = sanitizeAttachmentName(attachment?.fileName || 'attachment');
      const filePath = path.join(
        attachmentDir,
        `board-${sanitizeAttachmentName(taskId)}-${sanitizeAttachmentName(attachmentId)}-${originalName}`
      );
      try {
        const expectedSize = Number(attachment?.size);
        const existing = await fs.stat(filePath).catch(() => null);
        if (!existing?.isFile() || (Number.isFinite(expectedSize) && existing.size !== expectedSize)) {
          const response = await fetch(
            new URL(
              `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
              getOrionWebUrl()
            ),
            { headers: { authorization: `Bearer ${token}` } }
          );
          if (!response.ok) {
            throw new Error(`Attachment download failed (${response.status}).`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          if (Number.isFinite(expectedSize) && expectedSize >= 0 && buffer.byteLength !== expectedSize) {
            throw new Error('Attachment download was incomplete.');
          }
          await fs.writeFile(filePath, buffer);
        }
        return { ...attachment, localPath: filePath };
      } catch (error) {
        return { ...attachment, downloadError: cloudErrorMessage(error) };
      }
    })
  );
  return { ...task, attachments: downloaded };
};

const requireAccountToken = async () => {
  const session = await readAccountSession();
  return session?.token ?? null;
};

ipcMain.handle('tasks:list', async () => {
  try {
    const token = await requireAccountToken();
    if (!token) {
      return { ok: false, error: 'Sign in to your Orion account to see board tasks.', needsAuth: true };
    }
    const board = await boardTasksRequest(token, '/api/tasks');
    return { ok: true, columns: board.columns ?? [], tasks: board.tasks ?? [] };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('tasks:get', async (_event, rawTaskId) => {
  try {
    const taskId = String(rawTaskId ?? '');
    if (!taskId) return { ok: false, error: 'Missing task id.' };
    const token = await requireAccountToken();
    if (!token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const result = await boardTasksRequest(token, `/api/tasks/${encodeURIComponent(taskId)}`);
    return { ok: true, task: await downloadBoardTaskAttachments(token, result.task) };
  } catch (error) {
    if (error?.status === 404) {
      return { ok: false, stale: true, error: cloudErrorMessage(error) };
    }
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('tasks:link', async (_event, input) => {
  try {
    const taskId = String(input?.taskId ?? '');
    const threadId = String(input?.threadId ?? '');
    if (!taskId || !threadId) return { ok: false, error: 'Missing task or thread id.' };
    const token = await requireAccountToken();
    if (!token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const result = await boardTasksRequest(token, `/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'link',
        threadId,
        threadTitle: input?.threadTitle,
        projectName: input?.projectName,
      }),
    });
    return { ok: true, task: await downloadBoardTaskAttachments(token, result.task) };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('tasks:unlink', async (_event, input) => {
  try {
    const taskId = String(input?.taskId ?? '');
    if (!taskId) return { ok: false, error: 'Missing task id.' };
    const token = await requireAccountToken();
    if (!token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const result = await boardTasksRequest(token, `/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'unlink' }),
    });
    return { ok: true, task: result.task };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('tasks:threadStatus', async (_event, input) => {
  try {
    const taskId = String(input?.taskId ?? '');
    const threadId = String(input?.threadId ?? '');
    const status = String(input?.status ?? '');
    if (!taskId || !threadId || !status) return { ok: false, error: 'Missing task status input.' };
    const token = await requireAccountToken();
    if (!token) {
      return { ok: false, error: 'Sign in to your Orion account first.', needsAuth: true };
    }
    const result = await boardTasksRequest(token, `/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'thread-status',
        threadId,
        status,
        ...(typeof input?.notes === 'string' ? { notes: input.notes } : {}),
      }),
    });
    return { ok: true, task: result.task };
  } catch (error) {
    // 409 = the card was unlinked/relinked on the web; tell the renderer to
    // drop its side of the link instead of retrying forever.
    if (error?.status === 409) {
      return { ok: false, stale: true, error: cloudErrorMessage(error) };
    }
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('app:openExternalUrl', async (_event, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only https URLs can be opened.' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false, error: 'Invalid URL.' };
  }
});

// Clicking a thread-finished notification lands here: surface the window
// even if it's minimized or behind another app.
ipcMain.handle('app:focusWindow', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
  return true;
});

// Computer use (codex's computer-use plugin and similar) needs macOS TCC
// grants — Accessibility, Screen Recording, Automation. TCC attributes child
// processes to their responsible process, so granting Orion covers every CLI
// it spawns. There is no API to query Automation without prompting, so its
// status is always reported as 'unknown'.
const computerUseSettingsPanes = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
};

// Automation state can only be learned by sending a real Apple Event: macOS
// prompts on the first-ever send, then answers silently (success or -1743)
// once the (Orion → System Events) pair is determined. So we remember on disk
// that the user requested it once, and only probe after that — the tab never
// pops the system prompt on its own.
const computerUseStateFile = () => path.join(app.getPath('userData'), 'computer-use.json');
const automationProbeCommand = `osascript -e 'tell application id "com.apple.systemevents" to count processes'`;
let automationRequestedCache = null;
let automationProbe = { checkedAt: 0, status: 'unknown' };

const readAutomationRequested = async () => {
  // Only a positive result is cached: markAutomationRequested() sets it in
  // this process, and a missing file is re-read so it stays cheap but correct.
  if (automationRequestedCache !== true) {
    try {
      automationRequestedCache = Boolean(JSON.parse(await fs.readFile(computerUseStateFile(), 'utf8'))?.automationRequested);
    } catch {
      automationRequestedCache = false;
    }
  }
  return automationRequestedCache;
};

const markAutomationRequested = async () => {
  automationRequestedCache = true;
  try {
    await fs.writeFile(computerUseStateFile(), JSON.stringify({ automationRequested: true }));
  } catch {
    // best effort; worst case the row falls back to 'Request access'
  }
};

const probeAutomationStatus = async (timeout = 5000) => {
  if (Date.now() - automationProbe.checkedAt < 15000) return automationProbe.status;
  let status;
  try {
    await runShellCommand(automationProbeCommand, timeout);
    status = 'granted';
  } catch {
    status = 'denied';
  }
  automationProbe = { checkedAt: Date.now(), status };
  return status;
};

// Chrome's remote-debugging server (the chrome://inspect/#remote-debugging
// toggle, Chrome 144+) writes DevToolsActivePort into the profile root while
// it runs. That server is what "Use your signed-in Chrome" (codex browser
// control via chrome-devtools-mcp --autoConnect) attaches to. File present +
// port answering = ready; file present but dead port = Chrome not running (or
// a stale file); no file = the toggle was never enabled.
const chromeDebugPortFile = () =>
  path.join(app.getPath('home'), 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort');
const chromeDebugSetupUrl = 'chrome://inspect/#remote-debugging';
let chromeDebugProbe = { checkedAt: 0, result: null };

const getChromeDebugStatus = async () => {
  if (process.platform !== 'darwin') return { status: 'unsupported' };
  if (Date.now() - chromeDebugProbe.checkedAt < 2500 && chromeDebugProbe.result) return chromeDebugProbe.result;
  let result;
  try {
    const port = Number.parseInt((await fs.readFile(chromeDebugPortFile(), 'utf8')).split('\n')[0], 10);
    if (!Number.isInteger(port) || port <= 0) throw new Error('no port');
    result = await new Promise((resolve) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1500 }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: 'enabled', browser: JSON.parse(body)?.Browser });
          } catch {
            resolve({ status: 'enabled' });
          }
        });
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', () => resolve({ status: 'stale' }));
    });
  } catch {
    result = { status: 'disabled' };
  }
  chromeDebugProbe = { checkedAt: Date.now(), result };
  return result;
};

const getComputerUsePermissions = async () => {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      accessibility: 'unsupported',
      screenRecording: 'unsupported',
      automation: 'unsupported',
      chromeDebug: { status: 'unsupported' },
    };
  }
  return {
    supported: true,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
    screenRecording: systemPreferences.getMediaAccessStatus('screen'),
    automation: (await readAutomationRequested()) ? await probeAutomationStatus() : 'not-determined',
    chromeDebug: await getChromeDebugStatus(),
  };
};

ipcMain.handle('computerUse:getPermissions', async () => getComputerUsePermissions());

ipcMain.handle('computerUse:requestPermission', async (_event, kind) => {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Computer use permissions only apply on macOS.', state: await getComputerUsePermissions() };
  }
  try {
    if (kind === 'accessibility') {
      // Shows the system dialog and registers Orion in the Accessibility pane
      // (unchecked) so the user has a row to toggle on.
      systemPreferences.isTrustedAccessibilityClient(true);
    } else if (kind === 'screen-recording') {
      // A capture attempt is what registers Orion in the Screen Recording pane
      // and shows the one-time system prompt; the thumbnail is discarded.
      await desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .catch(() => {});
    } else if (kind === 'automation') {
      // Trigger the Automation prompt; the long timeout leaves room for the
      // user to answer the dialog so the returned state reflects their choice.
      await markAutomationRequested();
      automationProbe = { checkedAt: 0, status: 'unknown' };
      await probeAutomationStatus(60000);
    } else {
      return { ok: false, error: `Unknown permission: ${kind}`, state: await getComputerUsePermissions() };
    }
    const pane = computerUseSettingsPanes[kind];
    if (pane) await shell.openExternal(pane);
    return { ok: true, state: await getComputerUsePermissions() };
  } catch (error) {
    return { ok: false, error: getProcessErrorMessage(error), state: await getComputerUsePermissions() };
  }
});

// Chrome refuses chrome:// URLs from outside contexts inconsistently, so this
// does both: copies the setup URL to the clipboard (paste works everywhere)
// and asks Chrome to open it, which at minimum brings Chrome to the front.
ipcMain.handle('computerUse:openChromeDebugSetup', async () => {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Chrome remote-debugging setup is only wired up on macOS.' };
  }
  try {
    clipboard.writeText(chromeDebugSetupUrl);
    await new Promise((resolve, reject) => {
      const child = spawn('open', ['-a', 'Google Chrome', chromeDebugSetupUrl], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Could not open Google Chrome. Is it installed?'));
      });
    });
    chromeDebugProbe = { checkedAt: 0, result: null };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: getProcessErrorMessage(error) };
  }
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
  return true;
});

ipcMain.handle('cloud:openInBrowser', async (_event, projectPath) => {
  try {
    if (!projectPath) return { ok: false, error: 'Missing project path.' };
    const gitRoot = await getGitRoot(projectPath);
    const link = await getCloudRepoLink(gitRoot);
    if (!link) return { ok: false, error: 'This repository is not linked to Orion Cloud yet.' };
    await shell.openExternal(cloudRepoWebUrl(link.repoId));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: cloudErrorMessage(error) };
  }
});

ipcMain.handle('attachment:saveImage', async (_event, input) => {
  try {
    const mimeType = String(input?.mimeType || '').toLowerCase();
    const originalName = sanitizeAttachmentName(input?.name);
    const data = input?.data;

    const isImage =
      mimeType.startsWith('image/') || /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(originalName);
    const isVideo =
      mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(originalName);
    if (!data || (!isImage && !isVideo)) {
      return { ok: false, error: 'Only image and video attachments are supported.' };
    }

    const id = crypto.randomUUID();
    const ext = extensionFromMediaInput(originalName, mimeType);
    const nameWithoutExtension = originalName.replace(/\.[^.]+$/, '') || 'file';
    const safeFileName = `${id}-${nameWithoutExtension}${ext}`;
    const attachmentDir = getAttachmentDirectoryPath();
    const filePath = path.join(attachmentDir, safeFileName);
    const buffer = Buffer.from(data);

    await fs.mkdir(attachmentDir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return {
      ok: true,
      attachment: {
        id,
        name: originalName,
        path: filePath,
        mimeType: mimeType || (isVideo ? 'video/*' : 'image/*'),
        size: buffer.byteLength,
      },
    };
  } catch (e) {
    console.error('saveImageAttachment error', e);
    return { ok: false, error: e?.message ?? String(e) };
  }
});

ipcMain.handle('agent:listModels', async (_event, input) => {
  if (input?.force === true) invalidateAgentModelsCache();
  return listAgentModelsWithAvailability();
});

ipcMain.handle('agent:supportsThreadReader', async (_event, providerId) =>
  providerSupportsThreadReader(providerId)
);

ipcMain.handle('agent:listSlashCommands', async (event, input) =>
  listClaudeSlashCommands({
    sender: event.sender,
    threadId: typeof input?.threadId === 'string' ? input.threadId : null,
    projectPath: typeof input?.projectPath === 'string' ? input.projectPath : null,
  })
);

// `/clear` in the composer: tear down only the thread's persistent Claude SDK
// session (not the terminal PTY / goal ops that full thread disposal reaps),
// so the next turn starts a fresh conversation.
ipcMain.handle('agent:clearClaudeSession', (_event, threadId) =>
  typeof threadId === 'string' && threadId ? disposeClaudeSdkSession(threadId) : false
);

ipcMain.handle('providers:getStatus', async () => getProviderStatuses());

ipcMain.handle('providers:checkUpdates', async (_event, input) => checkProviderUpdates(input));

ipcMain.handle('providers:getActiveUpdate', () =>
  activeProviderUpdate?.lastProgress ?? lastProviderUpdateProgress
);

ipcMain.handle('providers:cancelUpdate', (_event, operationId) => {
  const cancelled = cancelActiveProviderUpdate(
    typeof operationId === 'string' ? operationId : null
  );
  return cancelled
    ? { ok: true }
    : { ok: false, error: 'That provider update is no longer running.' };
});

ipcMain.handle('providers:updateAll', async (_event, input = {}) => {
  if (activeProviderUpdate) {
    return {
      ok: false,
      busy: true,
      operationId: activeProviderUpdate.id,
      error: 'Provider updates are already running.',
      results: [],
      state: await checkProviderUpdates(input),
    };
  }

  const operationId = crypto.randomUUID();
  const operation = {
    id: operationId,
    controller: new AbortController(),
    promise: null,
    lastProgress: {
      operationId,
      status: 'running',
      phase: 'checking',
      message: 'Checking provider updates…',
      output: '',
      providerId: null,
      providerLabel: null,
      current: 0,
      total: 0,
      percent: null,
      updatedAt: new Date().toISOString(),
    },
  };
  activeProviderUpdate = operation;

  const run = async () => {
    const enabledProviderIds = normalizeEnabledProviderIds(input);
    const results = [];
    publishProviderUpdateProgress(operation, {
      status: 'running',
      phase: 'checking',
      message: 'Checking provider updates…',
      output: '',
      providerId: null,
      providerLabel: null,
      current: 0,
      total: 0,
      percent: null,
    });

    const checkedState = await checkProviderUpdates(input);
    const stateById = new Map(checkedState.providers.map((provider) => [provider.id, provider]));
    const updateConfigs = providerUpdaterConfigs.filter(
      (config) => stateById.get(config.id)?.updateAvailable === true
    );
    let completedUpdates = 0;

    publishProviderUpdateProgress(operation, {
      phase: updateConfigs.length > 0 ? 'starting' : 'complete',
      message:
        updateConfigs.length > 0
          ? `Preparing ${updateConfigs.length} provider update${updateConfigs.length === 1 ? '' : 's'}…`
          : 'Provider CLIs are already up to date.',
      total: updateConfigs.length,
    });

    for (const config of providerUpdaterConfigs) {
      if (operation.controller.signal.aborted) break;

      if (enabledProviderIds && !enabledProviderIds.has(config.id)) {
        results.push({
          id: config.id,
          label: config.label,
          command: config.command,
          ok: true,
          skipped: true,
          message: `${config.label} is disabled.`,
        });
        continue;
      }

      const providerState = stateById.get(config.id);
      if (!providerState?.updateAvailable) {
        results.push({
          id: config.id,
          label: config.label,
          command: config.command,
          ok: true,
          skipped: true,
          message: `${config.label} has no available update.`,
        });
        continue;
      }

      let progressOutput = '';
      let phase = 'updating';
      let lastOutputPublishAt = 0;
      const publishCurrentProvider = (
        message,
        percent = null,
        cleanOutput = cleanProviderUpdateOutput(progressOutput)
      ) =>
        publishProviderUpdateProgress(operation, {
          status: operation.controller.signal.aborted ? 'cancelling' : 'running',
          phase,
          providerId: config.id,
          providerLabel: config.label,
          message,
          output: cleanOutput,
          current: completedUpdates,
          total: updateConfigs.length,
          percent,
        });

      publishCurrentProvider(`Updating ${config.label}…`);
      const result = await updateProviderTool(config, providerState.latestVersion, {
        signal: operation.controller.signal,
        onPhase: (nextPhase) => {
          phase = nextPhase;
          const message =
            nextPhase === 'verifying'
              ? `Verifying ${config.label}…`
              : nextPhase === 'installing'
                ? `Installing ${config.label}…`
                : `Updating ${config.label}…`;
          publishCurrentProvider(message);
        },
        onOutput: ({ chunk }) => {
          progressOutput = providerUpdateOutputTail(progressOutput, chunk);
          const now = Date.now();
          if (now - lastOutputPublishAt < PROVIDER_UPDATE_PROGRESS_INTERVAL_MS) return;
          lastOutputPublishAt = now;
          const cleanOutput = cleanProviderUpdateOutput(progressOutput);
          if (/download(?:ing)?|fetching/i.test(cleanOutput)) phase = 'downloading';
          publishCurrentProvider(
            providerUpdateProgressMessage(cleanOutput, `Updating ${config.label}…`),
            providerUpdatePercent(cleanOutput),
            cleanOutput
          );
        },
      });
      results.push(result);

      if (result.cancelled) {
        publishProviderUpdateProgress(operation, {
          status: 'cancelled',
          phase: 'cancelled',
          message: `${config.label} update cancelled.`,
          output: cleanProviderUpdateOutput(result.output || progressOutput),
          percent: null,
        });
        break;
      }

      completedUpdates += 1;
      publishProviderUpdateProgress(operation, {
        status: 'running',
        phase: result.ok ? 'complete' : 'error',
        message: result.ok
          ? `${config.label} updated successfully.`
          : (result.error ?? `${config.label} update failed.`),
        output: cleanProviderUpdateOutput(result.output || progressOutput),
        current: completedUpdates,
        percent: result.ok ? 100 : null,
      });
    }

    const cancelled = operation.controller.signal.aborted || results.some((result) => result.cancelled);
    invalidateAgentModelsCache();
    const state = cancelled ? checkedState : await checkProviderUpdates(input);
    const failed = results.filter((result) => !result.ok && !result.cancelled);
    const response = {
      ok: !cancelled && failed.length === 0,
      cancelled,
      operationId: operation.id,
      results,
      state,
      ...(failed.length > 0
        ? { error: failed.map((result) => result.error).filter(Boolean).join('\n') }
        : {}),
    };

    publishProviderUpdateProgress(operation, {
      status: cancelled ? 'cancelled' : failed.length > 0 ? 'failed' : 'completed',
      phase: cancelled ? 'cancelled' : failed.length > 0 ? 'error' : 'complete',
      message: cancelled
        ? 'Provider updates cancelled.'
        : failed.length > 0
          ? (response.error || 'Some provider updates failed.')
          : updateConfigs.length > 0
            ? 'Provider CLIs updated.'
            : 'Provider CLIs are already up to date.',
      current: completedUpdates,
      total: updateConfigs.length,
      percent: cancelled || failed.length > 0 ? null : 100,
    });
    return response;
  };

  operation.promise = run().catch((error) => {
    publishProviderUpdateProgress(operation, {
      status: operation.controller.signal.aborted ? 'cancelled' : 'failed',
      phase: operation.controller.signal.aborted ? 'cancelled' : 'error',
      message: operation.controller.signal.aborted
        ? 'Provider updates cancelled.'
        : getProcessErrorMessage(error),
      percent: null,
    });
    throw error;
  });
  try {
    return await operation.promise;
  } finally {
    if (activeProviderUpdate === operation) activeProviderUpdate = null;
  }
});

ipcMain.handle('providers:authenticate', async (event, providerId) => {
  const { result, completion } = await authenticateProviderTool(providerId);
  if (result?.ok) {
    invalidateAgentModelsCache();
    const sender = event.sender;
    const generation = (providerAuthenticationGenerations.get(providerId) ?? 0) + 1;
    providerAuthenticationGenerations.set(providerId, generation);
    void waitForProviderAuthentication(providerId, completion).then((authenticated) => {
      if (providerAuthenticationGenerations.get(providerId) !== generation) return;
      providerAuthenticationGenerations.delete(providerId);
      if (!authenticated) return;
      invalidateAgentModelsCache();
      if (!sender.isDestroyed()) {
        sender.send('providers:authenticated', { providerId });
      }
    });
  }
  return result;
});

ipcMain.handle('account:getSession', async () => verifyAccountSession());

ipcMain.handle('account:startAuth', async () => {
  try {
    return await startDesktopAuth();
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle('account:signOut', async () => {
  await clearAccountSession();
  return publishAccountState(null);
});

ipcMain.handle('appUpdate:getState', async () => appUpdateState);

ipcMain.handle('appUpdate:check', async (_event, input) =>
  checkForAppUpdate({ force: input?.force === true })
);

ipcMain.handle('appUpdate:download', async () => {
  if (!app.isPackaged) return appUpdateState;
  const autoUpdater = await initializeAppUpdater();
  // downloadUpdate() fetches whatever the last check found, and that check
  // can be hours old — newer releases may have shipped since, and the feed's
  // signed download URLs expire minutes after each check. Re-check first so
  // we always download the latest version from a fresh URL.
  const checkResult = await autoUpdater.checkForUpdates();
  if (!checkResult?.isUpdateAvailable) return appUpdateState;
  const targetVersion = checkResult?.updateInfo?.version ?? null;
  if (targetVersion && targetVersion === appUpdateDownloadedVersion) {
    // This version is already downloaded and staged; go straight back to
    // "Restart to update" instead of fetching the same bytes again.
    return publishAppUpdateState({ status: 'downloaded', availableVersion: targetVersion, progress: null, error: null });
  }
  publishAppUpdateState({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, error: null });
  await autoUpdater.downloadUpdate(checkResult.cancellationToken);
  return appUpdateState;
});

let appUpdateRestartRequested = false;

const restartForAppUpdate = async () => {
  if (appUpdateRestartRequested) return { ok: true };
  appUpdateRestartRequested = true;
  publishAppUpdateState({ status: 'restarting', progress: null, error: null });

  try {
    // "Downloaded" only means the zip is on disk; Squirrel still has to pull it
    // through electron-updater's proxy server and stage it. quitAndInstall()
    // before that finishes is swallowed — the click looks like a no-op — so
    // wait for the update to actually be installable first.
    const staged = await waitForAppUpdateStagedForInstall();
    if (!staged) {
      appUpdateRestartRequested = false;
      invalidateAppUpdateDownload();
      const error =
        appUpdateState.error ??
        'Orion could not prepare the update. Try downloading it again.';
      publishAppUpdateState({ status: 'error', progress: null, error });
      return { ok: false, error };
    }

    await settleQuitBarrierForUpdate();
    const autoUpdater = await initializeAppUpdater();
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    appUpdateRestartRequested = false;
    publishAppUpdateState({ status: 'downloaded', progress: null, error: null });
    return { ok: false, error: error?.message ?? 'Could not restart to update' };
  }
};

ipcMain.handle('appUpdate:restart', async () => {
  if (appUpdateState.status !== 'downloaded' && appUpdateState.status !== 'restarting') {
    return { ok: false, error: 'No update is ready to install' };
  }
  return restartForAppUpdate();
});

// The renderer reports a spawned subagent's outcome here, unblocking the
// spawn_subagent MCP tool call that requested it.
ipcMain.handle('orchestration:subagentResult', (_event, payload) => {
  const pending = pendingSubagentSpawns.get(payload?.spawnId);
  if (!pending) return { ok: false };
  pendingSubagentSpawns.delete(payload.spawnId);
  pending.resolve(
    payload.ok
      ? payload.result || '(subagent returned no output)'
      : `Subagent failed: ${payload.result || 'unknown error'}`
  );
  return { ok: true };
});

// The renderer reports a subagent stop's outcome here, unblocking the
// stop_subagent MCP tool call that requested it.
ipcMain.handle('orchestration:subagentStopResult', (_event, payload) => {
  const pending = pendingSubagentStops.get(payload?.stopId);
  if (!pending) return { ok: false };
  pendingSubagentStops.delete(payload.stopId);
  pending.resolve(
    payload.ok
      ? payload.result || 'Subagent stopped.'
      : `Could not stop subagent: ${payload.result || 'unknown error'}`
  );
  return { ok: true };
});

ipcMain.handle('agent:runTurn', async (event, input) => {
  if (appShutdownRequested) {
    return { ok: false, error: 'Orion is restarting to install an update.' };
  }
  const runId = input?.runId || crypto.randomUUID();
  // Synchronous, before the first await: IPC handlers start in arrival
  // order, so a stop/steer sent after this runTurn is guaranteed to see the
  // entry (or the fully registered run).
  startingAgentRuns.set(runId, {
    aborted: false,
    threadId: input?.threadId,
  });
  try {
    if (!input?.threadId || !input?.projectPath || !input?.prompt || !input?.modelId) {
      return { ok: false, error: 'Missing threadId, projectPath, prompt, or modelId.' };
    }
    const riftSetupError = pendingRiftSetupError(input);
    if (riftSetupError) {
      return { ok: false, error: riftSetupError };
    }

    // A newly opened window can submit a turn while startup cleanup is still
    // running. Do not let a provider load the stale persistent MCP entries
    // that cleanup is removing.
    await legacyMcpCleanupPromise;

    const models = await getAgentModels();
    const model = models.find((candidate) => candidate.id === input.modelId);
    if (!model) {
      return { ok: false, error: `Unknown model: ${input.modelId}` };
    }

    // Safety net: the renderer resolves the Orion pseudo-model to its
    // configured main-driver model before ever calling runTurn.
    if (model.providerId === 'orion' || input.modelId === 'orion:orchestrator') {
      return { ok: false, error: 'Orion orchestrator was not resolved to a driver model' };
    }

    // Safety net: Claude Code CLI threads run in an embedded terminal
    // (terminal:* IPC), never as one-shot turns — its slug is not a model.
    if (input.modelId === 'claude:claude-code-cli') {
      return { ok: false, error: 'Claude Code CLI runs in the embedded terminal, not as agent turns' };
    }

    const available = await checkCommandAvailable(model.command);
    if (!available) {
      return { ok: false, error: `${model.command} is not installed or not on PATH.` };
    }

    // Capture before Orion's own managed-file writes so they remain visible
    // in the run's changed-files summary. Read only must not mutate the
    // project at all, so it relies solely on the injected prompt context.
    const shouldSyncOrchestrationFiles =
      input.orchestration?.isOrchestrator && input.accessMode !== 'read-only';
    const orchestrationSnapshot = shouldSyncOrchestrationFiles
      ? await captureGitChangeSnapshot(input.projectPath)
      : undefined;
    if (shouldSyncOrchestrationFiles) {
      try {
        await syncOrchestrationInstructionFiles(input.projectPath, input.orchestration);
      } catch (error) {
        console.warn('agent:runTurn: syncing orchestration instruction files failed', error);
      }
    }

    // Claude turns run on a persistent Agent SDK session (one CLI process per
    // thread) so background subagents and their task notifications survive
    // turn boundaries. `/btw` asides must not touch the thread's live
    // session, so they keep the one-shot forked-CLI path below.
    if (model.providerId === 'claude' && !input.aside) {
      return await runClaudeSdkTurn({
        sender: event.sender,
        input,
        model,
        runId,
        initialSnapshot: orchestrationSnapshot,
      });
    }

    const beforeSnapshot =
      orchestrationSnapshot === undefined
        ? await captureGitChangeSnapshot(input.projectPath)
        : orchestrationSnapshot;
    const jsonMode = sendsJsonEvents(model.providerId);
    const adapter = jsonAdapterForProvider(model.providerId);
    const reasoningActivityKey = `${runId}:reasoning`;
    const REASONING_EMIT_INTERVAL_MS = 150;

    // A branched thread's first turn must not resume the parent's session in
    // place. claude forks natively via --fork-session; codex/cursor/grok
    // sessions are copied on disk here and the copy is resumed instead. If
    // the copy fails, start fresh — never touch the parent's session.
    let initialResumeId =
      typeof input.resumeSessionId === 'string' && input.resumeSessionId
        ? input.resumeSessionId
        : null;
    const forkRequested = Boolean(input.forkSession) && Boolean(initialResumeId);
    const forkWithNativeFlag = forkRequested && model.providerId === 'claude';
    if (forkRequested && !forkWithNativeFlag) {
      initialResumeId = await forkSessionOnDisk(model.providerId, initialResumeId);
      if (!initialResumeId) {
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: "_Couldn't copy the parent thread's session; starting this branch fresh._\n\n",
        });
      }
    }

    // One spawn of the provider CLI. If resuming a prior session fails before
    // producing output, close() falls back to a single fresh attempt.
    const useAcp = model.providerId === 'grok' || model.providerId === 'kimi';
    // Codex goal runs (/goal) are driven over `codex app-server` JSON-RPC —
    // the goal runtime auto-continues turns only inside a live app-server.
    const useCodexGoal =
      model.providerId === 'codex' && Boolean(input.codexGoal) && typeof input.codexGoal === 'object';
    const useCodexReview =
      model.providerId === 'codex' &&
      Boolean(input.codexReview) &&
      typeof input.codexReview === 'object';
    // spawn_subagent for non-Claude drivers: hand the CLI the bridge shim as
    // an `orion` MCP server. One token per runTurn call — a resume-fallback
    // reattempt reuses it; the last attempt's finalizeRun releases it.
    const bridgeProvider = isMcpBridgeProvider(model.providerId);
    const supportsRunPlugin =
      bridgeProvider && (await providerSupportsRunPlugin(model.providerId));
    const orionMcp =
      input.aside || input.codexReview || !bridgeProvider || !supportsRunPlugin
        ? null
        : await registerMcpBridgeForRun({
            getSender: () => event.sender,
            threadId: input.threadId,
            projectPath: input.projectPath,
            providerId: model.providerId,
            accessMode: input.accessMode || 'full-access',
          });
    const openCodeConfig =
      model.providerId === 'opencode'
        ? openCodeMcpConfigContent(orionMcp, process.env.OPENCODE_CONFIG_CONTENT)
        : null;
    // The renderer's capability probe only establishes that this provider can
    // accept the bridge. A referenced-thread turn also needs this run's shim,
    // socket token, and provider-specific plugin/config registration to have
    // succeeded. OpenCode registration is not effective unless its inline MCP
    // config could also be merged and passed to the child.
    const effectiveThreadReaderBridgeReady = isEffectiveThreadReaderBridgeReady(
      model.providerId,
      Boolean(orionMcp),
      Boolean(openCodeConfig)
    );
    if (
      isRequiredThreadReaderBridgeMissing(
        model.providerId,
        input.hasThreadMentions,
        effectiveThreadReaderBridgeReady
      )
    ) {
      orionMcp?.release();
      return {
        ok: false,
        error:
          'Orion could not make read_thread available for this run. Try the referenced-thread turn again.',
      };
    }
    const startAttempt = (resumeSessionId) => {
    const args = commandForModel(model, {
      ...input,
      acp: useAcp,
      resumeSessionId,
      forkSession: forkWithNativeFlag && Boolean(resumeSessionId),
      orionMcp,
    });
    const commandString = args.map(shellQuote).join(' ');
    const child = spawn(loginShell, ['-lc', commandString], {
      cwd: input.projectPath,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...(openCodeConfig ? { OPENCODE_CONFIG_CONTENT: openCodeConfig } : {}),
      },
      // ACP and app-server runs speak JSON-RPC over stdin; one-shot CLIs
      // take no input.
      stdio: [useAcp || useCodexGoal || useCodexReview ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutSeen = false;
    let jsonBuffer = '';
    const streamContext = { textSeen: false };
    const knownToolActivities = new Map();

    // codex's exec --json stream emits no item at all when the model spawns a
    // collaboration subagent — only bare "Waiting for subagents" rows once it
    // waits on them — so the parent's steps never said what was delegated.
    // Mirror each tracked subagent as a step naming it and its task, matching
    // how claude's Task tool_use row reads.
    const emitCodexSubagentStep = (meta) => {
      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'activity',
        activity: {
          key: `subagent:${meta.id}`,
          type: 'tool',
          kind: 'task',
          title: `Subagent - ${meta.title || meta.kind || 'codex agent'}`,
          detail: stringifySummary(meta.prompt ?? '', 300),
          status: meta.status === 'error' ? 'error' : meta.status === 'running' ? 'running' : 'done',
        },
      });
    };

    // Native subagents (codex collaboration spawns, cursor Task tool): tail
    // each spawned subagent's on-disk transcript and stream it to the
    // renderer as its own switchable thread.
    const subagentTracker = createSubagentTracker({
      providerId: model.providerId,
      threadId: input.threadId,
      getSender: () => event.sender,
      getRunId: () => runId,
      onMeta: model.providerId === 'codex' ? emitCodexSubagentStep : undefined,
    });
    let codexSpawnWatcher = null;
    let kimiSpawnWatcher = null;
    // Kimi subagents live under the session's own directory; watching can
    // only start once the ACP dialog reports the session id.
    const ensureKimiSpawnWatcher = async (sessionId, baselineExisting) => {
      if (kimiSpawnWatcher || model.providerId !== 'kimi' || !sessionId) return;
      // A brand-new session's index entry may lag the session/new response by
      // a moment — retry briefly before giving up on subagent tracking.
      let entry = null;
      for (let attempt = 0; attempt < 10 && !entry; attempt += 1) {
        entry = await findKimiSessionIndexEntry(sessionId);
        if (!entry) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (finalized) return;
      }
      if (!entry?.sessionDir || kimiSpawnWatcher || finalized) return;
      kimiSpawnWatcher = watchKimiSubagentSpawns({
        sessionDir: entry.sessionDir,
        baselineExisting,
        onSpawn: (spawn) => {
          subagentTracker.start(
            {
              id: spawn.agentId,
              title: 'Kimi subagent',
              kind: 'kimi agent',
            },
            {
              resolveFile: async () => (existsSync(spawn.wirePath) ? spawn.wirePath : null),
              handleLine: handleKimiSubagentLine,
            }
          );
        },
      });
    };
    // provisional cursor agentId -> { realAgentId } (see the completed event)
    const cursorSubagentFileRefs = new Map();
    const ensureCodexSpawnWatcher = (parentThreadId) => {
      if (codexSpawnWatcher || model.providerId !== 'codex' || !parentThreadId) return;
      codexSpawnWatcher = watchCodexSubagentSpawns({
        parentThreadId,
        // A codex subagent can spawn its own subagents; those name the
        // subagent, not the run's thread, as their spawn parent.
        isTrackedThread: (threadId) => subagentTracker.has(threadId),
        onSpawn: (spawn) => {
          subagentTracker.start(
            {
              id: spawn.threadId,
              title: codexSubagentTitle(spawn),
              kind: spawn.role || 'codex agent',
              // Nest under the spawning subagent rather than flattening every
              // descendant onto the run's thread.
              ...(spawn.parentThreadId !== parentThreadId
                ? { parentSubagentId: spawn.parentThreadId }
                : {}),
            },
            {
              resolveFile: async () => spawn.filePath,
              handleLine: handleCodexRolloutLine,
            }
          );
        },
      });
    };
    // Resumed codex runs emit no thread.started — the resumed session id IS
    // the parent thread id.
    if (model.providerId === 'codex' && resumeSessionId) ensureCodexSpawnWatcher(resumeSessionId);

    const inspectForSubagents = (parsed) => {
      if (model.providerId === 'codex') {
        if (parsed?.type === 'thread.started' && typeof parsed.thread_id === 'string') {
          ensureCodexSpawnWatcher(parsed.thread_id);
        }
        return;
      }
      if (model.providerId !== 'cursor' || parsed?.type !== 'tool_call') return;
      const task = parsed.tool_call?.taskToolCall;
      if (!task) return;
      const args = task.args ?? {};
      const agentId = typeof args.agentId === 'string' ? args.agentId : null;
      if (!agentId) return;
      if (parsed.subtype === 'started') {
        const subagentType =
          args.subagentType && typeof args.subagentType === 'object'
            ? Object.keys(args.subagentType).find((key) => key !== 'unspecified')
            : undefined;
        // The started event's agentId is provisional — the transcript on disk
        // is keyed by the REAL agent id, which only arrives on the completed
        // event (result.success.agentId). Try both.
        const fileRef = { realAgentId: null };
        cursorSubagentFileRefs.set(agentId, fileRef);
        subagentTracker.start(
          {
            id: agentId,
            title: typeof args.description === 'string' && args.description ? args.description : 'Subagent',
            kind: subagentType,
            model: typeof args.model === 'string' ? args.model : undefined,
            prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
          },
          {
            resolveFile: async () =>
              (fileRef.realAgentId
                ? await cursorAgentTranscriptFile(input.projectPath, fileRef.realAgentId)
                : null) ?? (await cursorAgentTranscriptFile(input.projectPath, agentId)),
            handleLine: handleCursorSubagentLine,
          }
        );
      } else if (parsed.subtype === 'completed') {
        const result = task.result ?? {};
        const realAgentId = result.success?.agentId;
        const fileRef = cursorSubagentFileRefs.get(agentId);
        if (fileRef && typeof realAgentId === 'string' && realAgentId) {
          fileRef.realAgentId = realAgentId;
        }
        subagentTracker.finish(agentId, { status: result.success ? 'done' : 'error' });
      }
    };
    let pendingReasoning = '';
    let reasoningEmitted = false;
    let reasoningEmitTimer = null;
    let lastReasoningEmitAt = 0;
    let sessionIdReported = false;
    let finalized = false;
    let exitFallbackTimer = null;
    let terminalEventTimer = null;
    let runStats = null;
    // Set once the stream signals a completed turn — a nonzero exit after
    // that (e.g. from the SIGTERM that reaps a lingering agent process) must
    // not trigger the resume-failed retry.
    let turnCompleted = false;
    activeAgentRuns.set(runId, { child, threadId: input.threadId });

    const clearFinalizeTimers = () => {
      if (exitFallbackTimer) {
        clearTimeout(exitFallbackTimer);
        exitFallbackTimer = null;
      }
      if (terminalEventTimer) {
        clearTimeout(terminalEventTimer);
        terminalEventTimer = null;
      }
    };

    const finalizeRun = async (exitCode, options = {}) => {
      if (finalized) return;
      finalized = true;
      // The run is about to be forgotten while its terminal event still
      // awaits git summarization — advertise the gap so a racing steer can
      // wait for the real outcome (agent:isRunFinalizing).
      finalizingAgentRuns.add(runId);
      try {
        await finalizeRunInner(exitCode, options);
      } finally {
        finalizingAgentRuns.delete(runId);
      }
    };

    const finalizeRunInner = async (exitCode, { wasStopped = false } = {}) => {
      // Stopping a goal run is a successful pause, not a provider failure.
      // The renderer normally untracks explicit stops, but normalizing here
      // keeps any other caller from receiving a false error event.
      const finalExitCode = wasStopped && useCodexGoal ? 0 : exitCode;
      clearFinalizeTimers();
      // The run owns its CLI process; whatever path finalized the run, the
      // process must not outlive it (ACP servers idle forever on their own).
      // No-op when the process already exited.
      killAgentChild(child, input.threadId);
      activeAgentRuns.delete(runId);
      stoppedAgentRuns.delete(runId);
      codexGoalRunDrivers.delete(runId);
      orionMcp?.release();
      codexSpawnWatcher?.stop();
      kimiSpawnWatcher?.stop();
      subagentTracker.dispose(
        wasStopped ? 'stopped' : finalExitCode === 0 ? 'done' : 'error'
      );
      if (jsonMode && jsonBuffer.trim()) {
        try {
          const parsed = JSON.parse(jsonBuffer.trim());
          if (acpDriver) acpDriver.handleMessage(parsed);
          else emitParsedJsonEvent(parsed);
        } catch {}
        jsonBuffer = '';
      }
      finishReasoningActivity();

      if (finalExitCode !== 0 && stderr.trim()) {
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: `${stdoutSeen ? '\n\n' : ''}${stderr.trim()}\n`,
        });
      }

      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: finalExitCode === 0 ? 'done' : 'error',
        exitCode: finalExitCode,
        changedFiles: await summarizeChangedFiles(input.projectPath, beforeSnapshot),
        ...(runStats ? { stats: runStats } : {}),
        ...(finalExitCode === 0
          ? {}
          : {
              error: `${model.label} exited with code ${finalExitCode}.`,
              // Lets the renderer offer the right provider's Authenticate
              // button when the failure text reads as a logged-out CLI.
              providerId: model.providerId,
            }),
      });
    };

    const maybeEmitSessionId = (parsed) => {
      if (sessionIdReported) return;
      const sessionId = extractSessionIdFromJsonEvent(model.providerId, parsed);
      if (!sessionId) return;
      sessionIdReported = true;
      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'session',
        providerId: model.providerId,
        sessionId,
      });
    };

    const sendReasoningActivity = (status = 'running') => {
      const detailDelta = pendingReasoning;
      pendingReasoning = '';
      if (!detailDelta && !reasoningEmitted) return;
      reasoningEmitted = true;

      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'activity',
        activity: {
          key: reasoningActivityKey,
          type: 'thought',
          title: 'Reasoning',
          detailDelta,
          status,
        },
      });
    };

    // Thinking deltas arrive per token; cap reasoning updates so each one
    // doesn't turn into an IPC message and a renderer store write.
    const queueReasoningActivity = () => {
      const elapsed = Date.now() - lastReasoningEmitAt;
      if (elapsed >= REASONING_EMIT_INTERVAL_MS) {
        lastReasoningEmitAt = Date.now();
        sendReasoningActivity();
        return;
      }
      if (reasoningEmitTimer) return;
      reasoningEmitTimer = setTimeout(() => {
        reasoningEmitTimer = null;
        lastReasoningEmitAt = Date.now();
        sendReasoningActivity();
      }, REASONING_EMIT_INTERVAL_MS - elapsed);
    };

    const finishReasoningActivity = () => {
      if (reasoningEmitTimer) {
        clearTimeout(reasoningEmitTimer);
        reasoningEmitTimer = null;
      }
      sendReasoningActivity('done');
    };

    const emitActivity = (activity) => {
      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'activity',
        activity,
      });
    };

    const emitParsedJsonEvent = (parsed) => {
      maybeEmitSessionId(parsed);
      inspectForSubagents(parsed);

      const reasoningDelta = adapter.reasoning(parsed, streamContext);
      if (reasoningDelta) {
        pendingReasoning = `${pendingReasoning}${reasoningDelta}`;
        queueReasoningActivity();
      }

      for (const { updateForKey, ...activity } of adapter.activities(parsed)) {
        if (updateForKey) {
          // A tool result: flip the original step to done/error in place
          // instead of appending a detached "Tool result" row. What the tool
          // returned only appears here, so fold it onto that row — the
          // expanded step shows the call and its output together.
          const known = knownToolActivities.get(updateForKey);
          if (known) {
            if (activity.output) known.output = activity.output;
            emitActivity({
              ...known,
              key: updateForKey,
              status: activity.status === 'error' || activity.type === 'error' ? 'error' : 'done',
            });
            continue;
          }
        }
        if (activity.key) {
          const { key, status, ...rest } = activity;
          knownToolActivities.set(key, rest);
        }
        emitActivity(activity);
      }

      const text = adapter.text(parsed, streamContext);
      if (text) {
        stdoutSeen = true;
        streamContext.textSeen = true;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: text,
        });
      }

      if (!terminalEventTimer && !finalized && isTerminalJsonEvent(model.providerId, parsed)) {
        // Give the process a moment to exit on its own; if it (or something
        // holding its pipes) lingers, complete the run from the stream event.
        turnCompleted = true;
        terminalEventTimer = setTimeout(() => {
          terminalEventTimer = null;
          killAgentChild(child);
          finalizeRun(0);
        }, 2000);
      }
    };

    // ACP and app-server runs bypass the pure-function adapters: the driver
    // owns the JSON-RPC dialog (it must answer requests over stdin) and feeds
    // the same emit helpers the adapter path uses.
    const sharedDriverCallbacks = {
      onSessionId: (sessionId) => {
        if (sessionIdReported) return;
        sessionIdReported = true;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'session',
          providerId: model.providerId,
          sessionId,
        });
      },
      onReasoning: (delta) => {
        pendingReasoning = `${pendingReasoning}${delta}`;
        queueReasoningActivity();
      },
      onText: (text) => {
        stdoutSeen = true;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: text,
        });
      },
      onActivity: emitActivity,
      onResumeFallback: () => {
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: '_Could not resume the previous session; starting a fresh one._\n\n',
        });
      },
      onFatal: (message) => {
        if (finalized) return;
        stdoutSeen = true;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: `${message}\n`,
        });
        killAgentChild(child);
        finalizeRun(1);
      },
    };
    // The driver's completion signal: the server process idles once the work
    // resolves, so kill it shortly after and finalize the run as done.
    const finishDriverRun = () => {
      turnCompleted = true;
      if (!terminalEventTimer && !finalized) {
        terminalEventTimer = setTimeout(() => {
          terminalEventTimer = null;
          killAgentChild(child);
          finalizeRun(0);
        }, 400);
      }
    };

    const acpDriver =
      model.providerId === 'kimi'
        ? createKimiAcpDriver({
            child,
            cwd: input.projectPath,
            model,
            promptText: input.prompt,
            attachments: input.attachments,
            resumeSessionId,
            accessMode: input.accessMode || 'full-access',
            mcpServers: orionAcpMcpServers(orionMcp),
            callbacks: {
              ...sharedDriverCallbacks,
              onSessionId: (sessionId, sessionMeta) => {
                sharedDriverCallbacks.onSessionId(sessionId);
                void ensureKimiSpawnWatcher(sessionId, sessionMeta?.resumed === true);
              },
              onTurnEnd: (_result, sessionId) => {
                // The ACP prompt response carries no usage metadata — pull
                // cumulative session totals from the on-disk wire log before
                // the run finalizes. kimi flushes the turn's final
                // usage.record right around the prompt response, so give the
                // write a moment to land before reading.
                void (async () => {
                  await new Promise((resolve) => setTimeout(resolve, 350));
                  const stats = await kimiStatsFromSessionDisk(sessionId);
                  if (stats) runStats = stats;
                  finishDriverRun();
                })();
              },
            },
          })
        : useAcp
      ? createGrokAcpDriver({
          child,
          cwd: input.projectPath,
          promptText: input.prompt,
          resumeSessionId,
          accessMode: input.accessMode || 'full-access',
          callbacks: {
            ...sharedDriverCallbacks,
            onTurnEnd: (result) => {
              const stats = grokStatsFromPromptMeta(result?._meta);
              if (stats) runStats = stats;
              finishDriverRun();
            },
            onSubagent: (update) => {
              const childId =
                (typeof update.child_session_id === 'string' && update.child_session_id) ||
                (typeof update.subagent_id === 'string' && update.subagent_id) ||
                null;
              if (!childId) return;
              if (update.sessionUpdate === 'subagent_spawned') {
                subagentTracker.start(
                  {
                    id: childId,
                    title:
                      typeof update.description === 'string' && update.description
                        ? update.description
                        : 'Subagent',
                    kind:
                      typeof update.subagent_type === 'string' ? update.subagent_type : undefined,
                    model: typeof update.model === 'string' ? update.model : undefined,
                  },
                  {
                    resolveFile: async () => {
                      const file = grokSubagentUpdatesFile(input.projectPath, childId);
                      return existsSync(file) ? file : null;
                    },
                    handleLine: handleGrokSubagentLine,
                  }
                );
              } else if (update.sessionUpdate === 'subagent_finished') {
                subagentTracker.finish(childId, {
                  status: update.status === 'completed' ? 'done' : 'error',
                  stats:
                    typeof update.tokens_used === 'number'
                      ? { totalTokens: update.tokens_used }
                      : undefined,
                  summary:
                    typeof update.output === 'string' ? update.output.slice(0, 4000) : undefined,
                });
              }
            },
          },
        })
      : useCodexGoal || useCodexReview
        ? createCodexAppServerDriver({
            child,
            cwd: input.projectPath,
            model,
            input: { ...input, orionMcp },
            goal: input.codexGoal,
            review: input.codexReview,
            resumeSessionId,
            accessMode: input.accessMode || 'full-access',
            callbacks: {
              ...sharedDriverCallbacks,
              onStats: (stats) => {
                runStats = stats;
              },
              onGoal: (goal) => {
                emitAgentEvent(event.sender, {
                  runId,
                  threadId: input.threadId,
                  type: 'goal',
                  goal,
                });
              },
              onRunEnd: finishDriverRun,
            },
          })
        : null;
    if (useCodexGoal && acpDriver) codexGoalRunDrivers.set(runId, acpDriver);

    emitAgentEvent(event.sender, {
      runId,
      threadId: input.threadId,
      type: 'started',
      // App-server runs have no trailing prompt to strip.
      command: `${model.command} ${(
        useCodexGoal || useCodexReview ? args.slice(1) : args.slice(1, -1)
      ).join(' ')}`,
    });

    child.stdout.on('data', (data) => {
      if (finalized) return;
      const raw = data.toString();
      if (!jsonMode) {
        stdoutSeen = stdoutSeen || raw.trim().length > 0;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: raw,
        });
        return;
      }

      jsonBuffer += raw;
      const lines = jsonBuffer.split(/\r?\n/);
      jsonBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (acpDriver) acpDriver.handleMessage(parsed);
          else emitParsedJsonEvent(parsed);
        } catch {
          stdoutSeen = true;
          // Never leak raw agent protocol JSON (e.g. {"type":"thought",...}) into the chat transcript
          const looksLikeProtocol =
            /^\s*[\{\[]/.test(trimmed) &&
            (/"type"\s*:/i.test(trimmed) ||
              /"data"\s*:/i.test(trimmed) ||
              /"thought"/i.test(trimmed) ||
              /"jsonrpc"/i.test(trimmed));
          if (!looksLikeProtocol) {
            emitAgentEvent(event.sender, {
              runId,
              threadId: input.threadId,
              type: 'chunk',
              chunk: `${trimmed}\n`,
            });
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      activeAgentRuns.delete(runId);
      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'error',
        error: error.message,
      });
    });

    // 'close' waits for the stdio pipes to drain, not just process exit. An
    // agent-spawned background process (e.g. a dev server left running for
    // the user) inherits those pipes and can hold them open forever, so
    // finalize from 'exit' if 'close' doesn't follow shortly.
    child.on('exit', (exitCode, signal) => {
      if (finalized || exitFallbackTimer) return;
      exitFallbackTimer = setTimeout(() => {
        exitFallbackTimer = null;
        finalizeRun(exitCode ?? (signal ? 1 : 0), {
          wasStopped: stoppedAgentRuns.has(runId),
        });
      }, 2000);
    });

    child.on('close', async (exitCode) => {
      activeAgentRuns.delete(runId);
      const wasStopped = stoppedAgentRuns.delete(runId);
      if (finalized) return;

      // The stored session may be gone (harness cache cleared, expired, or a
      // CLI update). If resuming produced no output at all, run fresh once.
      if (exitCode !== 0 && resumeSessionId && !stdoutSeen && !wasStopped && !turnCompleted) {
        finalized = true;
        clearFinalizeTimers();
        codexSpawnWatcher?.stop();
        kimiSpawnWatcher?.stop();
        subagentTracker.dispose('error');
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: '_Could not resume the previous session; starting a fresh one._\n\n',
        });
        startAttempt(null);
        return;
      }

      await finalizeRun(exitCode, { wasStopped });
    });

    acpDriver?.start();
    };

    // A stop/steer raced the startup above and aborted the run before any
    // process existed — honor it instead of launching a run the renderer
    // already settled and untracked.
    if (startingAgentRuns.get(runId)?.aborted) {
      orionMcp?.release();
      return { ok: true, runId };
    }

    try {
      startAttempt(initialResumeId);
    } catch (error) {
      orionMcp?.release();
      throw error;
    }

    return { ok: true, runId };
  } catch (error) {
    console.error('agent:runTurn error', error);
    return { ok: false, error: error?.message ?? String(error) };
  } finally {
    startingAgentRuns.delete(runId);
  }
});

// Steer = deliver a follow-up into the run in flight without interrupting
// it. Only providers with a live mid-turn input channel support this (claude's
// persistent SDK session); false tells the renderer to queue the message for
// end-of-turn dispatch instead. Never kills a process.
ipcMain.handle('agent:steerTurn', (_event, runId, text) => {
  if (typeof runId !== 'string' || typeof text !== 'string' || !text) return false;
  return steerClaudeSdkRun(runId, text);
});

ipcMain.handle('agent:stopTurn', async (_event, runId, options) => {
  if (await interruptClaudeSdkRun(runId, options)) return true;
  const run = activeAgentRuns.get(runId);
  if (!run) {
    // Still in agent:runTurn's async startup: nothing to kill yet — mark the
    // startup aborted (it checks before spawning / registering the turn) and
    // report the run as interrupted.
    const starting = startingAgentRuns.get(runId);
    if (starting) {
      starting.aborted = true;
      starting.terminateBackground = Boolean(options?.terminateBackground);
      return true;
    }
    return false;
  }
  stoppedAgentRuns.add(runId);
  // Stopping a goal run = pausing the goal: ask the app-server to record the
  // pause (so the stored goal matches reality and /goal resume works) before
  // the process goes down.
  const goalDriver = codexGoalRunDrivers.get(runId);
  if (goalDriver) {
    codexGoalRunDrivers.delete(runId);
    try {
      await goalDriver.stopGoalRun();
    } catch {}
  }
  const shutdown = killAgentChild(run.child, run.threadId);
  activeAgentRuns.delete(runId);
  // Rift deletion uses terminateBackground and must not move the process's
  // cwd until SIGTERM/SIGKILL has actually reaped it. Ordinary Stop/Steer
  // remains responsive and lets the global shutdown tracker finish the reap.
  if (options?.terminateBackground) await shutdown;
  return true;
});

// True while a run's terminal event is still being prepared (the run itself
// is already forgotten). Terminal events are sent before this flips back to
// false, and IPC preserves ordering — so once this returns false, either the
// renderer has already received the outcome or none is coming.
ipcMain.handle('agent:isRunFinalizing', (_event, runId) => finalizingAgentRuns.has(runId));

ipcMain.handle('agent:codexGoal', async (_event, input) => {
  const threadId = typeof input?.threadId === 'string' ? input.threadId : '';
  try {
    if (appShutdownRequested) {
      return { ok: false, error: 'Orion is restarting to install an update.' };
    }
    if (!input?.sessionId || !threadId || !input?.projectPath || !input?.action) {
      return { ok: false, error: 'Missing sessionId, threadId, projectPath, or action.' };
    }
    if (!['pause', 'clear', 'get'].includes(input.action)) {
      return { ok: false, error: `Unsupported goal action: ${input.action}` };
    }
    const riftSetupError = pendingRiftSetupError(input);
    if (riftSetupError) {
      return { ok: false, error: riftSetupError };
    }
    const controller = new AbortController();
    const operationEntry = { controller, promise: null };
    let threadOperations = codexGoalOpsByThread.get(threadId);
    if (!threadOperations) {
      threadOperations = new Set();
      codexGoalOpsByThread.set(threadId, threadOperations);
    }
    threadOperations.add(operationEntry);
    const operation = (async () => {
      const available = await checkCommandAvailable('codex');
      if (controller.signal.aborted) {
        return { ok: false, error: 'Codex goal operation was cancelled.' };
      }
      if (!available) return { ok: false, error: 'codex is not installed or not on PATH.' };
      return await runCodexGoalOp({
        sessionId: input.sessionId,
        threadId,
        cwd: input.projectPath,
        action: input.action,
        signal: controller.signal,
      });
    })();
    operationEntry.promise = operation;
    try {
      return await operation;
    } finally {
      threadOperations.delete(operationEntry);
      if (threadOperations.size === 0) codexGoalOpsByThread.delete(threadId);
    }
  } catch (error) {
    console.error('agent:codexGoal error', error);
    return { ok: false, error: error?.message ?? String(error) };
  }
});

async function disposeAgentThreadRuntime(threadId) {
  if (typeof threadId !== 'string' || !threadId) return false;
  // Cancel and drain startup work too. It may not own a child process yet,
  // but it can still be resolving sessions or snapshotting the soon-to-move
  // workspace, and must not spawn after the rift is removed.
  let cancelledStartup = false;
  for (const starting of startingAgentRuns.values()) {
    if (starting.threadId !== threadId) continue;
    starting.aborted = true;
    starting.terminateBackground = true;
    cancelledStartup = true;
  }
  invalidateTerminalSession(threadId);
  const terminalShutdown = disposeTerminalSessionAndWait(threadId);
  const goalShutdown = disposeCodexGoalOpsForThread(threadId);
  const titleShutdown = disposeTitleGenerationsForThread(threadId);
  // Also reap any live run process for the thread (e.g. a wedged ACP server
  // whose run the renderer no longer tracks): thread teardown must not leave
  // an orphaned CLI behind.
  const runShutdowns = [];
  for (const [runId, run] of activeAgentRuns) {
    if (run.threadId !== threadId) continue;
    // Marks the exit as intentional so the run finalizes as stopped, not as a
    // provider error.
    stoppedAgentRuns.add(runId);
    runShutdowns.push(killAgentChild(run.child, threadId));
    activeAgentRuns.delete(runId);
  }
  const [disposedTerminal, disposedClaude, disposedGoals, disposedTitles, disposedAgent] =
    await Promise.all([
      terminalShutdown,
      disposeClaudeSdkSessionAndWait(threadId),
      goalShutdown,
      titleShutdown,
      waitForAgentThreadShutdowns(threadId),
      ...runShutdowns,
    ]);
  if (cancelledStartup) {
    const deadline = Date.now() + 3000;
    while (
      [...startingAgentRuns.values()].some((starting) => starting.threadId === threadId) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if ([...startingAgentRuns.values()].some((starting) => starting.threadId === threadId)) {
      throw new Error(`Agent startup for thread ${threadId} did not stop in time.`);
    }
  }
  // A Claude startup can install a session after the first disposal snapshot
  // but before it observes the aborted startup flag. Repeat the acknowledged
  // disposal after startup drain so no late session outlives Rift removal.
  const disposedLateClaude = await disposeClaudeSdkSessionAndWait(threadId);
  return (
    disposedClaude ||
    disposedLateClaude ||
    disposedTerminal ||
    disposedGoals ||
    disposedTitles ||
    disposedAgent ||
    runShutdowns.length > 0 ||
    cancelledStartup
  );
}

ipcMain.handle('agent:disposeThread', (_event, threadId) =>
  disposeAgentThreadRuntime(threadId)
);

// -------------------- Claude Code CLI terminal sessions --------------------
// One PTY per thread hosting the interactive `claude` TUI. The PTY lives in
// main and survives view remounts/thread switches; the renderer reattaches by
// replaying the scrollback snapshot, then applying data events whose seq is
// newer than the snapshot's (invoke replies and pushed events aren't strictly
// ordered, so the per-session seq disambiguates).

const terminalSessions = new Map(); // threadId -> { pty, scrollback, seq, exited, exitCode, accessMode, projectPath, claudeSessionId }
const terminatingTerminalSessions = new Map(); // threadId -> Set<session>
// Explicit teardown (model switch/thread deletion) can race an async
// terminal:ensure before it has installed a session. Epochs let teardown
// invalidate those pending starts so they cannot spawn an invisible PTY.
const terminalSessionEpochs = new Map();
const TERMINAL_SCROLLBACK_LIMIT = 400_000; // chars kept for reattach replay

const invalidateTerminalSession = (threadId) => {
  terminalSessionEpochs.set(threadId, (terminalSessionEpochs.get(threadId) ?? 0) + 1);
};

const disposeTerminalSession = (threadId) => {
  const session = terminalSessions.get(threadId);
  if (!session) return false;
  terminalSessions.delete(threadId);
  if (!session.exited) {
    let terminating = terminatingTerminalSessions.get(threadId);
    if (!terminating) {
      terminating = new Set();
      terminatingTerminalSessions.set(threadId, terminating);
    }
    terminating.add(session);
  }
  if (session.sessionWatcher) clearInterval(session.sessionWatcher);
  disposeTerminalHookSignals(session);
  try {
    if (!session.exited) session.pty.kill();
  } catch {
    // already gone
  }
  return true;
};

const disposeTerminalSessionAndWait = async (threadId, timeoutMs = 3000) => {
  const sessions = new Set(terminatingTerminalSessions.get(threadId) ?? []);
  const activeSession = terminalSessions.get(threadId);
  if (activeSession) {
    disposeTerminalSession(threadId);
    sessions.add(activeSession);
  }
  if (sessions.size === 0) return false;
  if ([...sessions].every((session) => session.exited)) return true;

  let timeoutId;
  const exited = await Promise.race([
    Promise.all([...sessions].map((session) => session.exitPromise)).then(() => true),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  if (!exited) {
    throw new Error(`Claude terminal for thread ${threadId} did not stop in time.`);
  }
  return true;
};

// claude's per-project session store (~/.claude/projects/<encoded-cwd>).
// The encoding is the realpath'd cwd with every non-alphanumeric replaced by
// '-'; realpath matters because claude records its own resolved cwd (e.g.
// /tmp -> /private/tmp on macOS).
const claudeProjectDirFor = async (projectPath) => {
  let realProjectPath = projectPath;
  try {
    realProjectPath = await fs.realpath(projectPath);
  } catch {
    // keep the raw path
  }
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    realProjectPath.replace(/[^a-zA-Z0-9]/g, '-')
  );
};

// A distinctive plain-text slice of a prompt that will appear verbatim inside
// the session's JSONL (JSON string escaping mangles quotes/newlines/etc., so
// pick the longest run of unescaped characters).
const terminalPromptMarker = (text) => {
  const segments = String(text)
    .split(/[\\"\n\r\t\u0000-\u001f]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 12);
  segments.sort((a, b) => b.length - a.length);
  return segments[0]?.slice(0, 120) ?? null;
};

const rememberTerminalPrompt = (session, text) => {
  const marker = terminalPromptMarker(text);
  if (!marker) return;
  session.sentPrompts.push(marker);
  if (session.sentPrompts.length > 5) session.sentPrompts.shift();
};

// xterm's onData stream is usually one character at a time, but paste and
// IME input can arrive in larger chunks. Keep a lightweight approximation of
// the current prompt so pressing Enter through the terminal itself records the
// same transcript marker as the GUI composer. Exact cursor editing is not
// required for attribution: a distinctive unchanged slice is enough to match
// the prompt in Claude's JSONL session file.
const trackTerminalPromptInput = (session, rawData) => {
  const data = String(rawData ?? '');
  let submittedPrompt = false;
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];

    if (char === '\x1b') {
      // Ignore terminal control sequences (arrows, bracketed-paste markers,
      // function keys). A bare Meta prefix leaves the following character to
      // be processed normally.
      const csi = data.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
      if (csi) {
        index += csi[0].length - 1;
        continue;
      }
      if (data[index + 1] === 'O' && data[index + 2]) {
        index += 2;
        continue;
      }
      continue;
    }

    if (char === '\r' || char === '\n') {
      submittedPrompt ||= Boolean(session.inputBuffer.trim());
      rememberTerminalPrompt(session, session.inputBuffer);
      session.inputBuffer = '';
      continue;
    }
    if (char === '\x7f' || char === '\b') {
      session.inputBuffer = [...session.inputBuffer].slice(0, -1).join('');
      continue;
    }
    if (char === '\x03' || char === '\x15') {
      // Ctrl+C / Ctrl+U clear the pending line.
      session.inputBuffer = '';
      continue;
    }
    if (char === '\x17') {
      // Ctrl+W deletes the previous word.
      session.inputBuffer = session.inputBuffer.replace(/\S+\s*$/u, '');
      continue;
    }
    if (char === '\t') {
      session.inputBuffer += '\t';
      continue;
    }
    if (char < ' ') continue;

    session.inputBuffer += char;
    if (session.inputBuffer.length > 8000) {
      session.inputBuffer = session.inputBuffer.slice(-8000);
    }
  }
  return submittedPrompt;
};

// The interactive claude TUI ignores --session-id (verified: conversations
// persist under their own fresh id), so the thread's resumable session id has
// to be discovered from claude's session store: a
// ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl written after this PTY
// spawned. Other writers share that directory (SDK threads, other terminals,
// the user's own claude runs — and claude can flush transcripts minutes
// late), so a candidate only counts when it contains a prompt this terminal
// actually submitted. Markers come from both the GUI composer and raw xterm
// input, avoiding an unsafe "newest transcript wins" guess.
const startTerminalSessionWatcher = (threadId, session, projectPath) => {
  const spawnedAt = Date.now();
  const projectDirPromise = claudeProjectDirFor(projectPath);
  session.sessionWatcher = setInterval(() => {
    void (async () => {
      if (session.exited || session.claudeSessionId) {
        clearInterval(session.sessionWatcher);
        session.sessionWatcher = null;
        return;
      }
      // Never guess from the newest project transcript. Multiple Orion and
      // external Claude processes can write this directory concurrently.
      if (session.sentPrompts.length === 0) return;
      try {
        const dir = await projectDirPromise;
        const entries = await fs.readdir(dir).catch(() => []);
        const candidates = [];
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue;
          const stats = await fs.stat(path.join(dir, entry)).catch(() => null);
          if (!stats || stats.mtimeMs < spawnedAt) continue;
          candidates.push({ id: entry.slice(0, -'.jsonl'.length), mtimeMs: stats.mtimeMs });
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const candidate of candidates) {
          const content = await fs
            .readFile(path.join(dir, `${candidate.id}.jsonl`), 'utf-8')
            .catch(() => '');
          if (!session.sentPrompts.some((marker) => content.includes(marker))) continue;
          session.claudeSessionId = candidate.id;
          sendToAllWindows('terminal:session', { threadId, sessionId: candidate.id });
          clearInterval(session.sessionWatcher);
          session.sessionWatcher = null;
          break;
        }
      } catch {
        // transient fs error; retry next tick
      }
    })();
  }, 2500);
};

// The PTY stays alive between turns, so process exit says nothing about turn
// completion — the reliable lifecycle signal is Claude Code's own hooks. Each
// session gets a private settings file (passed via --settings, which layers on
// top of the user's settings so their own hooks still run) whose
// UserPromptSubmit/Stop hooks append one line to a per-session signal file.
// Main watches that file and forwards the lines as terminal:activity events,
// letting the renderer flip the thread between running and done while the TUI
// keeps running. Stop does not fire on a user interrupt (esc) — an interrupted
// thread stays "running" until its next completed turn or PTY exit.
const TERMINAL_HOOK_DIR = path.join(os.tmpdir(), 'orion-claude-hooks');

const createTerminalHookFiles = async (threadId, epoch) => {
  const base = `${threadId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${epoch}`;
  const signalPath = path.join(TERMINAL_HOOK_DIR, `${base}.signals`);
  const settingsPath = path.join(TERMINAL_HOOK_DIR, `${base}.settings.json`);
  const appendSignal = (kind) => `printf '${kind}\\n' >> ${shellQuote(signalPath)}`;
  await fs.mkdir(TERMINAL_HOOK_DIR, { recursive: true });
  await fs.writeFile(signalPath, '');
  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: appendSignal('prompt') }] }],
        Stop: [{ hooks: [{ type: 'command', command: appendSignal('stop') }] }],
      },
    })
  );
  return { signalPath, settingsPath };
};

const startTerminalSignalWatcher = (threadId, session) => {
  let draining = false;
  let queued = false;
  const drain = async () => {
    if (draining) {
      queued = true;
      return;
    }
    draining = true;
    try {
      do {
        queued = false;
        if (terminalSessions.get(threadId) !== session) return;
        const content = await fs.readFile(session.signalPath, 'utf-8').catch(() => '');
        // The hooks only ever append; replay lines past the last read offset.
        const fresh = content.slice(session.signalReadOffset);
        session.signalReadOffset = content.length;
        for (const line of fresh.split('\n')) {
          const kind = line.trim();
          if (!kind) continue;
          if (terminalSessions.get(threadId) !== session) return;
          if (kind === 'prompt') {
            sendToAllWindows('terminal:activity', { threadId, kind: 'prompt' });
          } else if (kind === 'stop') {
            sendToAllWindows('terminal:activity', { threadId, kind: 'turn-complete' });
          }
        }
      } while (queued);
    } finally {
      draining = false;
    }
  };
  try {
    session.signalWatcher = watchFsPath(session.signalPath, () => void drain());
  } catch (error) {
    console.warn('terminal hook signal watch failed, polling instead', error);
    const timer = setInterval(() => void drain(), 1000);
    session.signalWatcher = { close: () => clearInterval(timer) };
  }
};

const disposeTerminalHookSignals = (session) => {
  if (session.signalWatcher) {
    try {
      session.signalWatcher.close();
    } catch {
      // already closed
    }
    session.signalWatcher = null;
  }
  if (session.signalPath) void fs.unlink(session.signalPath).catch(() => {});
  if (session.settingsPath) void fs.unlink(session.settingsPath).catch(() => {});
};

const disposeAllTerminalSessions = () => {
  for (const threadId of terminalSessionEpochs.keys()) {
    invalidateTerminalSession(threadId);
  }
  for (const threadId of [...terminalSessions.keys()]) {
    disposeTerminalSession(threadId);
  }
};

// Spawn (or reattach to) the thread's claude TUI. Composer-sent prompts let
// the watcher discover the CLI's persisted session id for restart/resume.
ipcMain.handle('terminal:ensure', async (_event, input) => {
  try {
    if (appShutdownRequested) {
      return { ok: false, error: 'Orion is restarting to install an update.' };
    }
    const threadId = typeof input?.threadId === 'string' ? input.threadId : '';
    const projectPath = typeof input?.projectPath === 'string' ? input.projectPath : '';
    const accessMode = ['read-only', 'workspace-write', 'full-access'].includes(
      input?.accessMode
    )
      ? input.accessMode
      : 'full-access';
    if (!threadId || !projectPath) {
      return { ok: false, error: 'threadId and projectPath are required' };
    }
    const riftSetupError = pendingRiftSetupError(input);
    if (riftSetupError) {
      return { ok: false, error: riftSetupError };
    }
    // A newer ensure supersedes any older pending start for the same thread
    // (for example, when access mode changes while node-pty is still loading).
    const ensureEpoch = (terminalSessionEpochs.get(threadId) ?? 0) + 1;
    terminalSessionEpochs.set(threadId, ensureEpoch);

    let session = terminalSessions.get(threadId);
    if (
      session &&
      (input?.fresh ||
        input?.restart ||
        session.accessMode !== accessMode ||
        session.projectPath !== projectPath)
    ) {
      disposeTerminalSession(threadId);
      session = null;
    }
    if (session) {
      if (!session.exited) {
        sendToAllWindows('terminal:activity', { threadId, kind: 'started' });
      }
      return {
        ok: true,
        reattached: true,
        claudeSessionId: session.claudeSessionId,
        snapshot: session.scrollback,
        seq: session.seq,
        ...(session.exited
          ? { exited: true, exitCode: session.exitCode ?? null }
          : {}),
      };
    }

    if (!(await checkCommandAvailable('claude'))) {
      return { ok: false, error: 'claude is not installed or not on PATH.' };
    }

    let ptyModule;
    try {
      ptyModule = await import('node-pty');
    } catch (error) {
      console.error('terminal:ensure node-pty load failed', error);
      return {
        ok: false,
        error: `Terminal support unavailable (node-pty failed to load): ${error?.message ?? error}`,
      };
    }

    const isUuid = (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-skip-permissions']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    const args = ['claude', ...accessArgs];
    let claudeSessionId = null;
    if (!input?.fresh && isUuid(input?.resumeSessionId)) {
      // Only resume when claude actually persisted that conversation: it
      // buffers transcripts in memory and can flush minutes late (or never,
      // for sessions killed early), and --resume on a missing id exits(1).
      const transcriptPath = path.join(
        await claudeProjectDirFor(projectPath),
        `${input.resumeSessionId}.jsonl`
      );
      const transcriptExists = await fs
        .stat(transcriptPath)
        .then((stats) => stats.isFile())
        .catch(() => false);
      if (transcriptExists) {
        const forkSession = input?.forkSession === true;
        // A branch resumes the inherited transcript only as the source for a
        // new conversation. Keep the id unknown until the watcher discovers
        // Claude's newly-created fork and reports it to the renderer.
        claudeSessionId = forkSession ? null : input.resumeSessionId;
        args.push('--resume', input.resumeSessionId);
        if (forkSession) args.push('--fork-session');
      }
    }

    const hookFiles = await createTerminalHookFiles(threadId, ensureEpoch).catch((error) => {
      // Turn-lifecycle signals are an enhancement; a temp-dir failure should
      // not block the terminal itself.
      console.warn('terminal hook settings unavailable', error);
      return null;
    });
    if (hookFiles) args.push('--settings', hookFiles.settingsPath);

    if ((terminalSessionEpochs.get(threadId) ?? 0) !== ensureEpoch) {
      return { ok: false, error: 'Terminal start was cancelled.' };
    }

    const commandString = args.map(shellQuote).join(' ');
    const cols = Math.max(20, Math.floor(Number(input?.cols)) || 120);
    const rows = Math.max(5, Math.floor(Number(input?.rows)) || 30);
    const ptyProcess = ptyModule.spawn(loginShell, ['-lc', commandString], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectPath,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });

    let resolveExit;
    const exitPromise = new Promise((resolve) => {
      resolveExit = resolve;
    });
    session = {
      pty: ptyProcess,
      scrollback: '',
      seq: 0,
      exited: false,
      exitCode: null,
      accessMode,
      projectPath,
      claudeSessionId,
      sessionWatcher: null,
      // Markers from composer- and xterm-submitted prompts, used by the
      // session watcher to attribute an on-disk transcript to this terminal.
      sentPrompts: [],
      // Best-effort current input line for prompts typed directly into xterm.
      inputBuffer: '',
      // Turn-lifecycle signal file appended to by the injected Claude hooks.
      signalPath: hookFiles?.signalPath ?? null,
      settingsPath: hookFiles?.settingsPath ?? null,
      signalReadOffset: 0,
      signalWatcher: null,
      exitPromise,
      resolveExit,
    };
    terminalSessions.set(threadId, session);
    startTerminalSessionWatcher(threadId, session, projectPath);
    if (session.signalPath) startTerminalSignalWatcher(threadId, session);
    sendToAllWindows('terminal:activity', { threadId, kind: 'started' });

    ptyProcess.onData((data) => {
      // A fresh start/access-mode/project change can replace this PTY before its
      // final callbacks drain. Never let the superseded process write into
      // the replacement terminal's renderer stream.
      if (terminalSessions.get(threadId) !== session) return;
      session.seq += 1;
      session.scrollback = (session.scrollback + data).slice(-TERMINAL_SCROLLBACK_LIMIT);
      sendToAllWindows('terminal:data', { threadId, data, seq: session.seq });
    });
    ptyProcess.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode ?? null;
      session.resolveExit?.();
      const terminating = terminatingTerminalSessions.get(threadId);
      if (terminating) {
        terminating.delete(session);
        if (terminating.size === 0) terminatingTerminalSessions.delete(threadId);
      }
      // disposeTerminalSession removes the old session before killing it. If
      // another PTY now owns this thread id, its view must not receive the
      // old process's delayed exit event.
      if (terminalSessions.get(threadId) !== session) return;
      if (session.sessionWatcher) {
        clearInterval(session.sessionWatcher);
        session.sessionWatcher = null;
      }
      // Exit is itself the terminal status signal; hook signals are moot now.
      disposeTerminalHookSignals(session);
      sendToAllWindows('terminal:exit', { threadId, exitCode: exitCode ?? null });
    });

    return {
      ok: true,
      reattached: false,
      claudeSessionId,
      snapshot: session.scrollback,
      seq: session.seq,
    };
  } catch (error) {
    console.error('terminal:ensure error', error);
    return { ok: false, error: error?.message ?? String(error) };
  }
});

// Raw keystrokes from the embedded xterm.
ipcMain.handle('terminal:input', (_event, input) => {
  const session = terminalSessions.get(input?.threadId);
  if (!session || session.exited) return false;
  const data = String(input?.data ?? '');
  const submittedPrompt = trackTerminalPromptInput(session, data);
  session.pty.write(data);
  if (submittedPrompt) {
    sendToAllWindows('terminal:activity', { threadId: input.threadId, kind: 'prompt' });
  }
  return true;
});

ipcMain.handle('terminal:resize', (_event, input) => {
  const session = terminalSessions.get(input?.threadId);
  if (!session || session.exited) return false;
  const cols = Math.floor(Number(input?.cols));
  const rows = Math.floor(Number(input?.rows));
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return false;
  try {
    session.pty.resize(cols, rows);
  } catch {
    return false;
  }
  return true;
});

// GUI composer → TUI: deliver the draft as a bracketed paste (so multi-line
// prompts land as one input) and press Enter once the TUI has ingested it —
// exactly as if the user had typed it in the terminal.
ipcMain.handle('terminal:sendPrompt', async (_event, input) => {
  const session = terminalSessions.get(input?.threadId);
  if (!session || session.exited) {
    return { ok: false, error: 'The Claude Code terminal is not running.' };
  }
  const text = String(input?.text ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return { ok: false, error: 'Nothing to send' };
  rememberTerminalPrompt(session, text);
  session.inputBuffer = '';
  session.pty.write(`\x1b[200~${text}\x1b[201~`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (session.exited) return { ok: false, error: 'The Claude Code terminal exited.' };
  session.pty.write('\r');
  sendToAllWindows('terminal:activity', { threadId: input.threadId, kind: 'prompt' });
  return { ok: true };
});

ipcMain.handle('terminal:kill', (_event, threadId) => {
  if (typeof threadId !== 'string' || !threadId) return false;
  invalidateTerminalSession(threadId);
  return disposeTerminalSession(threadId);
});

// Normalize a raw model response into a usable one-line thread title,
// or '' when nothing title-shaped survives.
const titleFromResponseText = (responseText) => {
  let candidate = (responseText || '').split(/[\r\n]+/)[0] || '';
  candidate = candidate.trim();
  if (!candidate) return '';

  // Clean model output
  // Strip markdown formatting first (Kimi wraps titles in **bold** / headings)
  // so the quote/prefix cleanups below see plain text.
  candidate = candidate.replace(/^#{1,6}\s+/, '');
  // Paired code/strike/bold delimiters unwrap safely anywhere (the content
  // survives; bold requires non-space at the inner edges, per Markdown, so a
  // literal `**kwargs and **args` stays intact). Single * and __ pairs only
  // unwrap when they enclose the whole title — interior ones are likely
  // literal (glob patterns like *.ts, identifiers like __init__).
  candidate = candidate.replace(/`([^`]+)`/g, '$1');
  candidate = candidate.replace(/~~([^~]+)~~/g, '$1');
  candidate = candidate.replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '$1');
  candidate = candidate.replace(/^\*([^*]+)\*$/, '$1');
  candidate = candidate.replace(/^__(.+)__$/, '$1');
  candidate = candidate.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
  candidate = candidate.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  candidate = candidate.replace(/^(title\s*[:：]\s*|here\s*(is|is a)\s*(a\s+)?(concise\s+)?title\s*[:：]?\s*|the title (is|should be)\s*[:：]?\s*)/i, '');
  candidate = candidate.replace(/\s+/g, ' ').trim();
  candidate = candidate.split(/[\.!?]\s/)[0].trim();
  if (candidate.length > 70) candidate = candidate.slice(0, 67).trim() + '…';

  // Hard guard: never accept raw protocol / JSON / thought lines as a title
  if (!candidate || /^[\{\[]/.test(candidate) || /"type"\s*:/i.test(candidate) || /"data"\s*:/i.test(candidate) || /\btype["\s]*:["\s]*thought\b/i.test(candidate)) {
    return '';
  }
  return candidate;
};

// Run a single non-streaming prompt through a provider CLI in read-only mode
// and return the model's plain-text reply ('' on any failure). Backs the
// hidden utility turns: thread titles and epic commit/PR messages.
const runOneShotAgentText = async (
  model,
  prompt,
  projectPath,
  { signal, threadId, reasoningEffort } = {}
) => {
  const cwd = projectPath || process.cwd();
  if (signal?.aborted) return '';

  // OpenCode's non-interactive command does not currently expose a mode that
  // Orion can enforce as read-only. Hidden utility turns must fail closed
  // instead of inheriting the user's normal repository permissions.
  if (model.providerId === 'opencode') {
    return '';
  }

  // kimi's prompt mode auto-approves every tool and rejects --plan, so a
  // one-shot `kimi -p` would silently run this hidden turn with full write
  // access. Drive the turn over ACP plan mode instead, which disables tool
  // execution.
  if (model.providerId === 'kimi') {
    return (await kimiPlanModeOneShot(model, prompt, cwd, { signal, threadId })) || '';
  }

  // Reuse the command builder but force read-only access for the hidden turn.
  // The effort comes from Settings → Text generation (which defaults to the
  // cheapest tier) rather than the provider default: inheriting GPT-5.6's
  // 'high' spends and stalls far more than a title or commit message is worth.
  const effort = reasoningEffort || 'low';
  const args = commandForModel(model, {
    prompt,
    projectPath: cwd,
    accessMode: 'read-only',
    // Utility turns generate disposable metadata. Never let them consume local
    // or Chronicle memories, or become source material for future memories.
    ...(model.providerId === 'codex'
      ? { providerOptions: codexUtilityPrivacyOptions }
      : {}),
    ...(model.providerId === 'codex' ? { codexReasoningEffort: effort } : {}),
    ...(model.providerId === 'claude' ? { claudeReasoningEffort: effort } : {}),
    ...(model.providerId === 'grok' ? { grokReasoningEffort: effort } : {}),
  });

  const commandString = args.map(shellQuote).join(' ');
  return await new Promise((resolve) => {
    const child = spawn(loginShell, ['-lc', commandString], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let deadline = null;
    const cleanup = () => {
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    // Cancellation is stronger than ordinary completion: do not release the
    // caller until the provider child has actually exited, because the caller
    // may remove the child's working directory next.
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void killAgentChild(child, threadId).then(() => resolve(''));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    // A provider CLI stalled on auth or network input would otherwise pin the
    // awaiting caller forever — the epic git actions hold their disabled-UI
    // busy state on this promise. Cap the turn and reap the child; callers
    // fall back to their non-LLM message.
    deadline = setTimeout(abort, 120_000);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    // Drain diagnostics so a chatty failed CLI cannot block on a full pipe.
    // They are never valid generated text.
    child.stderr.resume();

    child.on('error', () => finish(''));

    child.on('close', (code) => {
      if (code !== 0) {
        finish('');
        return;
      }

      const jsonMode = sendsJsonEvents(model.providerId);
      let responseText = '';

      if (jsonMode) {
        // Parse NDJSON / streaming-json output and extract only real text (ignore thoughts etc.)
        const adapter = jsonAdapterForProvider(model.providerId);
        const textContext = { textSeen: false };
        const lines = stdout.split(/\r?\n/);
        let partial = '';
        for (const rawLine of lines) {
          const line = partial ? partial + rawLine : rawLine;
          const trimmed = line.trim();
          if (!trimmed) {
            partial = '';
            continue;
          }
          try {
            const parsed = JSON.parse(trimmed);
            const t = adapter.text(parsed, textContext);
            if (t) {
              responseText += t;
              textContext.textSeen = true;
              partial = '';
            } else {
              // parsed but no text content (e.g. thought) — discard this line
              partial = '';
            }
          } catch {
            // Not (yet) valid JSON. If it doesn't look like start of JSON, treat as plain text.
            if (!/^\s*[\{\[]/.test(trimmed)) {
              responseText += rawLine + '\n';
              partial = '';
            } else {
              partial = line; // keep for potential multi-line object (rare)
            }
          }
        }
        // flush last partial if it parses
        if (partial.trim()) {
          try {
            const p = JSON.parse(partial.trim());
            const t = adapter.text(p, textContext);
            if (t) responseText += t;
          } catch {
            if (!/^\s*[\{\[]/.test(partial)) responseText += partial;
          }
        }
      } else {
        responseText = stdout;
      }

      finish(responseText);
    });
  });
};

// Look up a model id, verify its CLI is on PATH, and run a one-shot prompt.
// `options.reasoningEffort` comes from Settings → Text generation.
const runOneShotForModelId = async (modelId, prompt, projectPath, options) => {
  if (!modelId) return '';
  if (options?.signal?.aborted) return '';
  const models = await getAgentModels();
  if (options?.signal?.aborted) return '';
  const model = models.find((candidate) => candidate.id === modelId);
  if (!model) return '';
  if (!(await checkCommandAvailable(model.command))) return '';
  if (options?.signal?.aborted) return '';
  return runOneShotAgentText(model, prompt, projectPath, options);
};

// Generate a short, relevant title for a thread based on the first user prompt.
// This runs a lightweight non-streaming call and returns just the title string.
ipcMain.handle('agent:generateTitle', async (_event, input) => {
  if (appShutdownRequested) return '';
  const threadId = typeof input?.threadId === 'string' ? input.threadId : '';
  if (!threadId || !input?.prompt || !input?.modelId) return '';
  const controller = new AbortController();
  const generation = { controller, promise: null };
  let threadGenerations = titleGenerationsByThread.get(threadId);
  if (!threadGenerations) {
    threadGenerations = new Set();
    titleGenerationsByThread.set(threadId, threadGenerations);
  }
  threadGenerations.add(generation);
  const operation = (async () => {
    if (pendingRiftSetupError(input)) return '';
    const models = await getAgentModels();
    if (controller.signal.aborted) return '';
    const model = models.find((candidate) => candidate.id === input.modelId);
    if (!model) return '';

    const available = await checkCommandAvailable(model.command);
    if (!available || controller.signal.aborted) return '';

    const titleInstruction =
      'Reply with ONLY a concise, specific title (3-8 words) for the following user request. ' +
      'No quotes, no explanations, no trailing punctuation. Just the title.\n\n' +
      'Request:\n' +
      input.prompt;

    return titleFromResponseText(
      await runOneShotAgentText(model, titleInstruction, input.projectPath, {
        signal: controller.signal,
        threadId,
        reasoningEffort: input.reasoningEffort,
      })
    );
  })();
  generation.promise = operation;
  try {
    return await operation;
  } catch (e) {
    console.error('agent:generateTitle error', e);
    return '';
  } finally {
    threadGenerations.delete(generation);
    if (threadGenerations.size === 0) titleGenerationsByThread.delete(threadId);
  }
});

// Path helpers (so renderer doesn't need node path)
ipcMain.handle('project:findIcon', async (_event, projectPath) => {
  try {
    return await findProjectIcon(projectPath);
  } catch (error) {
    console.error('project:findIcon error', error);
    return null;
  }
});

// "Open with" apps (macOS): detect installed apps and open the project in them.
// cliRelPaths: VS Code-fork CLI binaries inside the bundle. Launching through
// them opens the folder in an editor window; `open -a` can land on the app's
// agents/dashboard view instead (e.g. Cursor).
const OPEN_WITH_CANDIDATES = [
  {
    id: 'cursor',
    name: 'Cursor',
    bundles: ['Cursor.app'],
    cliRelPaths: ['Contents/Resources/app/bin/cursor', 'Contents/Resources/app/bin/code'],
  },
  // Prefer the code-editor app ("Antigravity IDE.app") over the agents app ("Antigravity.app").
  {
    id: 'antigravity',
    name: 'Antigravity',
    bundles: ['Antigravity IDE.app', 'Antigravity.app'],
    cliRelPaths: ['Contents/Resources/app/bin/antigravity-ide'],
  },
  { id: 'ghostty', name: 'Ghostty', bundles: ['Ghostty.app'] },
  {
    id: 'terminal',
    name: 'Terminal',
    bundles: [],
    absolutePaths: [
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Utilities/Terminal.app',
    ],
  },
  {
    id: 'finder',
    name: 'Finder',
    bundles: [],
    absolutePaths: ['/System/Library/CoreServices/Finder.app'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    bundles: ['Visual Studio Code.app'],
    cliRelPaths: ['Contents/Resources/app/bin/code'],
  },
];

let openWithAppsCache = null;

function resolveOpenWithAppPath(candidate) {
  const roots = [path.join(app.getPath('home'), 'Applications'), '/Applications'];
  const candidatePaths = [
    ...(candidate.absolutePaths ?? []),
    ...candidate.bundles.flatMap((bundle) => roots.map((root) => path.join(root, bundle))),
  ];
  return candidatePaths.find((appPath) => existsSync(appPath)) ?? null;
}

// app.getFileIcon returns a generic document icon for .app bundles on macOS,
// so pull the real icon out of the bundle (Info.plist -> .icns -> png via sips).
async function extractMacAppIcon(appPath) {
  try {
    const resourcesDir = path.join(appPath, 'Contents', 'Resources');
    const candidates = [];
    try {
      const { stdout } = await execFileAsync('plutil', [
        '-extract', 'CFBundleIconFile', 'raw', '-o', '-',
        path.join(appPath, 'Contents', 'Info.plist'),
      ]);
      const iconFile = stdout.trim();
      if (iconFile) {
        candidates.push(
          path.join(resourcesDir, iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`)
        );
      }
    } catch {
      // No CFBundleIconFile entry; fall through to common icon names.
    }
    candidates.push(path.join(resourcesDir, 'AppIcon.icns'));
    let icnsPath = candidates.find((candidate) => existsSync(candidate));
    if (!icnsPath) {
      const entries = await fs.readdir(resourcesDir).catch(() => []);
      const firstIcns = entries.find((name) => name.endsWith('.icns'));
      if (firstIcns) icnsPath = path.join(resourcesDir, firstIcns);
    }
    if (!icnsPath) return null;

    const outPath = path.join(app.getPath('temp'), `orion-openwith-${crypto.randomUUID()}.png`);
    try {
      await execFileAsync('sips', [
        '-s', 'format', 'png', '--resampleHeightWidthMax', '64',
        icnsPath, '--out', outPath,
      ]);
      const image = nativeImage.createFromPath(outPath);
      return image.isEmpty() ? null : image.toDataURL();
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  } catch {
    return null;
  }
}

ipcMain.handle('openWith:listApps', async () => {
  if (process.platform !== 'darwin') return [];
  if (openWithAppsCache) return openWithAppsCache;

  const apps = [];
  for (const candidate of OPEN_WITH_CANDIDATES) {
    const appPath = resolveOpenWithAppPath(candidate);
    if (!appPath) continue;
    // Icon is optional; the renderer falls back to a generic glyph.
    const icon = await extractMacAppIcon(appPath);
    apps.push({ id: candidate.id, name: candidate.name, icon });
  }
  openWithAppsCache = apps;
  return apps;
});

ipcMain.handle('openWith:open', async (_event, input) => {
  const { appId, projectPath } = input ?? {};
  try {
    if (typeof projectPath !== 'string' || !existsSync(projectPath)) {
      return { ok: false, error: 'Project folder not found' };
    }
    const candidate = OPEN_WITH_CANDIDATES.find((entry) => entry.id === appId);
    if (!candidate) return { ok: false, error: 'Unknown app' };

    if (candidate.id === 'finder') {
      const error = await shell.openPath(projectPath);
      return error ? { ok: false, error } : { ok: true };
    }

    const appPath = resolveOpenWithAppPath(candidate);
    if (!appPath) return { ok: false, error: `${candidate.name} is not installed` };

    const cliPath = (candidate.cliRelPaths ?? [])
      .map((rel) => path.join(appPath, rel))
      .find((cli) => existsSync(cli));
    if (cliPath) {
      try {
        await execFileAsync(cliPath, [projectPath]);
        return { ok: true };
      } catch (error) {
        console.error(`openWith: ${candidate.id} CLI failed, falling back to open -a`, error);
      }
    }
    await execFileAsync('open', ['-a', appPath, projectPath]);
    return { ok: true };
  } catch (error) {
    console.error('openWith:open error', error);
    return { ok: false, error: error?.message ?? 'Failed to open' };
  }
});

// --- Agent skills (Settings → Skills) -----------------------------------------

ipcMain.handle('skills:list', async () => listSkills());

ipcMain.handle('skills:import', async (event, input) =>
  importSkills({
    window: BrowserWindow.fromWebContents(event.sender),
    paths: input?.paths,
  })
);

ipcMain.handle('skills:setEnabled', async (_event, input) =>
  setSkillEnabled({ id: input?.id, enabled: input?.enabled })
);

ipcMain.handle('skills:delete', async (event, input) =>
  deleteSkill({
    window: BrowserWindow.fromWebContents(event.sender),
    id: input?.id,
    skillPath: input?.path,
    enabled: input?.enabled,
    confirm: input?.confirm !== false,
  })
);

ipcMain.handle('skills:reveal', async (_event, input) =>
  revealSkill({ id: input?.id, skillPath: input?.path, enabled: input?.enabled })
);

ipcMain.handle('skills:openFolder', async () => openSkillsFolder());

// --- Dev servers (Settings → Dev Servers) --------------------------------------

ipcMain.handle('devServers:list', async (_event, input) => {
  // Snapshot the live registries here — the scanner module stays free of
  // main.js state. Ancestry roots: agent CLI children and thread PTYs.
  const agentPidThreads = [];
  for (const run of activeAgentRuns.values()) {
    if (run?.child?.pid) agentPidThreads.push({ pid: run.child.pid, threadId: run.threadId });
  }
  const terminalPidThreads = [];
  for (const [threadId, session] of terminalSessions) {
    if (session?.pty?.pid && !session.exited) terminalPidThreads.push({ pid: session.pty.pid, threadId });
  }
  // Claude SDK sessions spawn their CLI internally (no pid we can see), so
  // they contribute a cwd match instead of an ancestry root.
  const sessionThreadCwds = [];
  for (const [threadId, session] of claudeSdkSessions) {
    if (session?.projectPath && !session.ended && !session.disposed) {
      sessionThreadCwds.push({ cwd: session.projectPath, threadId });
    }
  }
  return listDevServers({
    roots: Array.isArray(input?.roots) ? input.roots.filter((root) => typeof root === 'string') : [],
    agentPidThreads,
    terminalPidThreads,
    sessionThreadCwds,
  });
});

ipcMain.handle('devServers:open', async (_event, input) => {
  try {
    await shell.openExternal(devServerUrlForPort(input?.port));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('devServers:kill', async (_event, input) =>
  killDevServers({ targets: Array.isArray(input?.targets) ? input.targets : [] })
);

ipcMain.handle('path:basename', (_e, p) => path.basename(p));
ipcMain.handle('path:dirname', (_e, p) => path.dirname(p));
ipcMain.handle('path:join', (_e, ...parts) => path.join(...parts));
