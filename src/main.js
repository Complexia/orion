import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, dialog, Menu, nativeImage, protocol, safeStorage, shell, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
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
import { appUpdateDownloadedVersion, appUpdateState, checkForAppUpdate, getAppIconPath, initializeAppUpdater, publishAppUpdateState, scheduleAppUpdateChecks } from './main/app-updater.js';
import { disposeAllClaudeSdkSessions, disposeClaudeSdkSession, interruptClaudeSdkRun, runClaudeSdkTurn } from './main/claude-driver.js';
import { codexGoalRunDrivers, createCodexAppServerDriver, runCodexGoalOp } from './main/codex-driver.js';
import { commandForModel } from './main/command-for-model.js';
import { captureGitChangeSnapshot, commandSucceeds, commitMessageForEntries, getGitRoot, getGitStateForPath, getGitStatusMap, invalidateTreeGitStatusCache, readGitStatusEntries, summarizeChangedFiles, validateNewBranchName } from './main/git-utils.js';
import { createKimiAcpDriver, handleKimiSubagentLine, kimiPlanModeOneShot, kimiStatsFromSessionDisk, watchKimiSubagentSpawns } from './main/kimi-driver.js';
import { legacyMcpCleanupPromise, openCodeMcpConfigContent, orionAcpMcpServers, pendingSubagentSpawns, pendingSubagentStops, providerSupportsRunPlugin, registerMcpBridgeForRun, startLegacyMcpCleanup } from './main/mcp-bridge.js';
import { extensionFromMediaInput, getMimeTypeForMediaPath, mediaPreviewExtensions, sanitizeAttachmentName } from './main/media.js';
import { getAgentModels, invalidateAgentModelsCache } from './main/models.js';
import { appProtocol, attachmentProtocol, getAccountSessionFilePath, getAttachmentDirectoryPath, getStorageFilePath, getThreadsFilePath, storageFileName, threadsFileName } from './main/paths.js';
import { authenticateProviderTool, checkProviderUpdate, checkProviderUpdates, getProcessErrorMessage, getProviderStatuses, normalizeEnabledProviderIds, providerAuthenticationGenerations, providerUpdaterConfigs, updateProviderTool, waitForProviderAuthentication } from './main/provider-updates.js';
import { activeAgentRuns, finalizingAgentRuns, killAgentChild, startingAgentRuns, stoppedAgentRuns, trackAgentShutdown, waitForPendingAgentShutdowns } from './main/run-registry.js';
import { checkCommandAvailable, execFileAsync, loginShell, runShellCommand, shellQuote, startShellPathSync } from './main/shell-env.js';
import { extractSessionIdFromJsonEvent, isTerminalJsonEvent, jsonAdapterForProvider, sendsJsonEvents } from './main/stream-adapters.js';
import { syncOrchestrationInstructionFiles } from './main/orchestration-files.js';
import { findKimiSessionIndexEntry, forkSessionOnDisk } from './main/session-fork.js';
import { emitAgentEvent, sendToAllWindows } from './main/events.js';
import { createSubagentTracker, cursorAgentTranscriptFile, handleCodexRolloutLine, handleCursorSubagentLine, watchCodexSubagentSpawns } from './main/subagent-trackers.js';
import { createGrokAcpDriver, grokStatsFromPromptMeta, grokSubagentUpdatesFile, handleGrokSubagentLine } from './main/grok-driver.js';

// Set the application name as early as possible.
// This helps the Dock, menu bar, and tooltips show "Orion" instead of "Electron"
// especially during development (`npm start`).
app.setName('Orion');
app.setAppUserModelId('com.complexia.orion');

const hiddenSystemDirectories = new Set(['.git']);
let quitAfterPendingWork = false;
let quitBarrierSatisfied = false;

let pendingDesktopAuth = null;
let inMemoryAccountSession = null;
let storageSaveQueue = Promise.resolve();
let threadsSaveQueue = Promise.resolve();
// The quit-time synchronous threads flush jumps the async save queue; the
// sequence pair lets a stale queued write detect it has been superseded so
// its rename cannot clobber the newer quit-time snapshot. An async rename
// already submitted to the fs when the sync flush runs can still land after
// it — the retained sync snapshot lets that writer notice (post-rename seq
// check) and reinstall the newer data, which matters on macOS where the main
// process outlives the window and the clobbered file would persist.
let threadsWriteSeq = 0;
let threadsCommittedSeq = 0;
let threadsSyncSnapshot = null; // { seq, value } from the latest sync flush

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
  await fs.rm(getAccountSessionFilePath(), { force: true });
};

const publishAccountState = async (session) => {
  const account = desktopAccountForRenderer(session ?? (await readAccountSession()));
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('account:changed', account);
  }
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
      !existsSync(path.join(devUserData, threadsFileName))
    ) {
      for (const fileName of [storageFileName, threadsFileName]) {
        const liveFile = path.join(liveUserData, fileName);
        const devFile = path.join(devUserData, fileName);
        if (!existsSync(devFile) && existsSync(liveFile)) {
          copyFileSync(liveFile, devFile);
        }
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
  // Reinforce the app name (helps in some dev launch scenarios)
  app.setName('Orion');

  // Start maintenance immediately, but never hold the first window behind
  // shell startup or filesystem cleanup. Provider and MCP operations await
  // only the prerequisite they actually need.
  startShellPathSync();
  startLegacyMcpCleanup();

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
      const threadsPath = getThreadsFilePath();
      let parsed;
      try {
        parsed = JSON.parse(await fs.readFile(threadsPath, 'utf-8'));
      } catch {
        return; // no threads file yet — nothing to patch
      }
      if (!Array.isArray(parsed?.threads)) return;
      let changed = false;
      for (const thread of parsed.threads) {
        if (threadIds.includes(thread?.id) && thread?.goal?.status === 'active') {
          thread.goal.status = 'paused';
          thread.goal.updatedAt = Date.now();
          changed = true;
        }
      }
      if (!changed || seq <= threadsCommittedSeq) return;
      const tempPath = `${threadsPath}.${process.pid}.goal.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(parsed), 'utf-8');
      await fs.rename(tempPath, threadsPath);
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
  reapActiveAgentRuns();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Persistent claude sessions outlive individual turns; kill their CLI
// processes (and any background subagents inside them) when Orion exits.
app.on('will-quit', (event) => {
  disposeAllClaudeSdkSessions();
  disposeAllTerminalSessions();
  reapActiveAgentRuns();
  if (quitBarrierSatisfied) return;

  // Hold quit open until active children exit (including the SIGKILL
  // fallback), any /goal pauses are recorded, and the latest transcript
  // queue has settled. Waiting for the queue after agent shutdown matters:
  // shutdown can enqueue a goal-pause persistence write of its own.
  event.preventDefault();
  if (!quitAfterPendingWork) {
    quitAfterPendingWork = true;
    void waitForPendingAgentShutdowns()
      .then(() => threadsSaveQueue.catch(() => {}))
      .finally(() => {
        quitAfterPendingWork = false;
        quitBarrierSatisfied = true;
        app.quit();
      });
  }
});

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
    return true;
  } catch (error) {
    console.error('storage:save error', error);
    return false;
  }
});

// Threads (whole chat transcripts) dominate the store and are persisted to
// their own file on a slower cadence than the lightweight settings state —
// see the renderer's orionStorage for the split.
// Returns { ok: true, value } with value null for a genuinely absent file.
// A read failure or an unrepairable file returns { ok: false } instead — the
// renderer must be able to tell the two apart, because "absent" lets it
// persist a fresh snapshot while "failed" must suppress persistence (an
// unconditional post-hydration flush would overwrite the transcripts with
// the empty hydrated state).
ipcMain.handle('storage:loadThreads', async () => {
  try {
    const threadsPath = getThreadsFilePath();
    const value = await fs.readFile(threadsPath, 'utf-8');
    const sanitized = sanitizeStoreValue(value);
    if (sanitized === null) return { ok: false };
    if (sanitized !== value) {
      await fs.writeFile(threadsPath, sanitized, 'utf-8');
    }
    return { ok: true, value: sanitized };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, value: null };
    console.error('storage:loadThreads error', error);
    return { ok: false };
  }
});

ipcMain.handle('storage:saveThreads', async (_event, value) => {
  // Same settled-queue chaining as storage:save above.
  const seq = ++threadsWriteSeq;
  const save = threadsSaveQueue.catch(() => {}).then(async () => {
    if (seq <= threadsCommittedSeq) return; // superseded by the sync flush
    const threadsPath = getThreadsFilePath();
    const tempPath = `${threadsPath}.${process.pid}.tmp`;
    const sanitized = sanitizeStoreValue(value) ?? value;
    await fs.mkdir(path.dirname(threadsPath), { recursive: true });
    await fs.writeFile(tempPath, sanitized, 'utf-8');
    if (seq <= threadsCommittedSeq) {
      await fs.rm(tempPath, { force: true });
      return;
    }
    await fs.rename(tempPath, threadsPath);
    if (seq >= threadsCommittedSeq) {
      threadsCommittedSeq = seq;
      return;
    }
    // The quit-time sync flush committed a newer snapshot while our rename
    // was in flight, and our rename may have just clobbered it — reinstall
    // the newer data (idempotent if our rename actually landed first).
    const snapshot = threadsSyncSnapshot;
    if (snapshot && snapshot.seq > seq) {
      const restorePath = `${threadsPath}.${process.pid}.restore.tmp`;
      await fs.writeFile(restorePath, snapshot.value, 'utf-8');
      await fs.rename(restorePath, threadsPath);
    }
  });
  threadsSaveQueue = save;

  try {
    await save;
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
    const threadsPath = getThreadsFilePath();
    // Distinct temp name: an in-flight async save may hold the .tmp path.
    const tempPath = `${threadsPath}.${process.pid}.sync.tmp`;
    const sanitized = sanitizeStoreValue(value) ?? value;
    mkdirSync(path.dirname(threadsPath), { recursive: true });
    writeFileSync(tempPath, sanitized, 'utf-8');
    renameSync(tempPath, threadsPath);
    threadsCommittedSeq = seq;
    // Retained so an in-flight async rename that lands after us can detect
    // the supersession and reinstall this snapshot.
    threadsSyncSnapshot = { seq, value: sanitized };
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
    const threadsPath = getThreadsFilePath();
    await fs.rm(threadsPath, { force: true });
    if (threadsSeq < threadsCommittedSeq) {
      // A newer synchronous unload flush raced the removal. Reinstall its
      // snapshot in case the rm landed after that flush's rename.
      const snapshot = threadsSyncSnapshot;
      if (snapshot && snapshot.seq > threadsSeq) {
        const restorePath = `${threadsPath}.${process.pid}.restore.tmp`;
        await fs.writeFile(restorePath, snapshot.value, 'utf-8');
        await fs.rename(restorePath, threadsPath);
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

ipcMain.handle('git:commitAndPush', async (_event, projectPath) => {
  try {
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

    await execFileAsync('git', ['-C', gitRoot, 'add', '.']);
    const stagedHasChanges = !(await commandSucceeds('git', ['-C', gitRoot, 'diff', '--cached', '--quiet']));
    if (!stagedHasChanges) {
      return { ok: false, error: 'No staged changes to commit.' };
    }

    const message = commitMessageForEntries(entries);
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
  const models = await getAgentModels();
  const uniqueCommands = [...new Set(models.map((model) => model.command).filter(Boolean))];
  const availability = new Map(
    await Promise.all(
      uniqueCommands.map(async (command) => [command, await checkCommandAvailable(command)])
    )
  );

  return models.map(({ command, ...model }) => {
    // Pseudo-models (Orion orchestrator) have no CLI to probe.
    if (!command) return { ...model, available: true };
    const available = availability.get(command) === true;
    return {
      ...model,
      available,
      ...(available ? {} : { unavailableReason: `Install or authenticate ${command} on PATH.` }),
    };
  });
});

ipcMain.handle('providers:getStatus', async () => getProviderStatuses());

ipcMain.handle('providers:checkUpdates', async (_event, input) => checkProviderUpdates(input));

ipcMain.handle('providers:updateAll', async (_event, input = {}) => {
  const enabledProviderIds = normalizeEnabledProviderIds(input);
  const results = [];

  for (const config of providerUpdaterConfigs) {
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

    const state = await checkProviderUpdate(config, enabledProviderIds);
    if (!state.updateAvailable) {
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

    results.push(await updateProviderTool(config, state.latestVersion));
  }

  invalidateAgentModelsCache();
  const state = await checkProviderUpdates(input);
  const failed = results.filter((result) => !result.ok);

  return {
    ok: failed.length === 0,
    results,
    state,
    ...(failed.length > 0 ? { error: failed.map((result) => result.error).filter(Boolean).join('\n') } : {}),
  };
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

ipcMain.handle('appUpdate:restart', async () => {
  if (appUpdateState.status !== 'downloaded') return false;
  const autoUpdater = await initializeAppUpdater();
  autoUpdater.quitAndInstall(false, true);
  return true;
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
  // Synchronous, before the first await: IPC handlers start in arrival
  // order, so a stop/steer sent after this runTurn is guaranteed to see the
  // entry (or the fully registered run).
  if (input?.runId) startingAgentRuns.set(input.runId, { aborted: false });
  try {
    if (!input?.threadId || !input?.projectPath || !input?.prompt || !input?.modelId) {
      return { ok: false, error: 'Missing threadId, projectPath, prompt, or modelId.' };
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

    const runId = input.runId || crypto.randomUUID();

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
    const bridgeProvider = ['codex', 'cursor', 'grok', 'kimi', 'opencode'].includes(
      model.providerId
    );
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
    const startAttempt = (resumeSessionId) => {
    const args = commandForModel(model, {
      ...input,
      acp: useAcp,
      resumeSessionId,
      forkSession: forkWithNativeFlag && Boolean(resumeSessionId),
      orionMcp,
    });
    const commandString = args.map(shellQuote).join(' ');
    const openCodeConfig =
      model.providerId === 'opencode'
        ? openCodeMcpConfigContent(orionMcp, process.env.OPENCODE_CONFIG_CONTENT)
        : null;
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

    // Native subagents (codex collaboration spawns, cursor Task tool): tail
    // each spawned subagent's on-disk transcript and stream it to the
    // renderer as its own switchable thread.
    const subagentTracker = createSubagentTracker({
      providerId: model.providerId,
      threadId: input.threadId,
      getSender: () => event.sender,
      getRunId: () => runId,
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
        onSpawn: (spawn) => {
          subagentTracker.start(
            {
              id: spawn.threadId,
              title: spawn.nickname || 'Codex subagent',
              kind: spawn.role || 'codex agent',
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
    let reasoningText = '';
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
      killAgentChild(child);
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
      // Send the full thought stream; the renderer shows a one-line tail
      // preview when the row is collapsed and the full text when expanded.
      const detail = reasoningText.trim();
      if (!detail) return;

      emitAgentEvent(event.sender, {
        runId,
        threadId: input.threadId,
        type: 'activity',
        activity: {
          key: reasoningActivityKey,
          type: 'thought',
          title: 'Reasoning',
          detail,
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
        reasoningText = `${reasoningText}${reasoningDelta}`;
        queueReasoningActivity();
      }

      for (const { updateForKey, ...activity } of adapter.activities(parsed)) {
        if (updateForKey) {
          // A tool result: flip the original step to done/error in place
          // instead of appending a detached "Tool result" row.
          const known = knownToolActivities.get(updateForKey);
          if (known) {
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
        reasoningText = `${reasoningText}${delta}`;
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
    if (input?.runId) startingAgentRuns.delete(input.runId);
  }
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
  killAgentChild(run.child);
  activeAgentRuns.delete(runId);
  return true;
});

// True while a run's terminal event is still being prepared (the run itself
// is already forgotten). Terminal events are sent before this flips back to
// false, and IPC preserves ordering — so once this returns false, either the
// renderer has already received the outcome or none is coming.
ipcMain.handle('agent:isRunFinalizing', (_event, runId) => finalizingAgentRuns.has(runId));

ipcMain.handle('agent:codexGoal', async (_event, input) => {
  try {
    if (!input?.sessionId || !input?.projectPath || !input?.action) {
      return { ok: false, error: 'Missing sessionId, projectPath, or action.' };
    }
    if (!['pause', 'clear', 'get'].includes(input.action)) {
      return { ok: false, error: `Unsupported goal action: ${input.action}` };
    }
    const available = await checkCommandAvailable('codex');
    if (!available) return { ok: false, error: 'codex is not installed or not on PATH.' };
    return await runCodexGoalOp({
      sessionId: input.sessionId,
      cwd: input.projectPath,
      action: input.action,
    });
  } catch (error) {
    console.error('agent:codexGoal error', error);
    return { ok: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle('agent:disposeThread', async (_event, threadId) => {
  if (typeof threadId !== 'string' || !threadId) return false;
  invalidateTerminalSession(threadId);
  const disposedTerminal = disposeTerminalSession(threadId);
  // Also reap any live run process for the thread (e.g. a wedged ACP server
  // whose run the renderer no longer tracks): thread teardown must not leave
  // an orphaned CLI behind.
  let killedRun = false;
  for (const [runId, run] of activeAgentRuns) {
    if (run.threadId !== threadId) continue;
    // Marks the exit as intentional so the run finalizes as stopped, not as a
    // provider error.
    stoppedAgentRuns.add(runId);
    activeAgentRuns.delete(runId);
    killAgentChild(run.child);
    killedRun = true;
  }
  return disposeClaudeSdkSession(threadId) || disposedTerminal || killedRun;
});

// -------------------- Claude Code CLI terminal sessions --------------------
// One PTY per thread hosting the interactive `claude` TUI. The PTY lives in
// main and survives view remounts/thread switches; the renderer reattaches by
// replaying the scrollback snapshot, then applying data events whose seq is
// newer than the snapshot's (invoke replies and pushed events aren't strictly
// ordered, so the per-session seq disambiguates).

const terminalSessions = new Map(); // threadId -> { pty, scrollback, seq, exited, exitCode, accessMode, projectPath, claudeSessionId }
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
  if (session.sessionWatcher) clearInterval(session.sessionWatcher);
  disposeTerminalHookSignals(session);
  try {
    if (!session.exited) session.pty.kill();
  } catch {
    // already gone
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
      // disposeTerminalSession removes the old session before killing it. If
      // another PTY now owns this thread id, its view must not receive the
      // old process's delayed exit event.
      if (terminalSessions.get(threadId) !== session) return;
      session.exited = true;
      session.exitCode = exitCode ?? null;
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

// Generate a short, relevant title for a thread based on the first user prompt.
// This runs a lightweight non-streaming call and returns just the title string.
ipcMain.handle('agent:generateTitle', async (_event, input) => {
  try {
    if (!input?.prompt || !input?.modelId) {
      return '';
    }
    const models = await getAgentModels();
    const model = models.find((candidate) => candidate.id === input.modelId);
    if (!model) return '';

    const available = await checkCommandAvailable(model.command);
    if (!available) return '';

    const titleInstruction =
      'Reply with ONLY a concise, specific title (3-8 words) for the following user request. ' +
      'No quotes, no explanations, no trailing punctuation. Just the title.\n\n' +
      'Request:\n' +
      input.prompt;

    // kimi's prompt mode auto-approves every tool and rejects --plan, so a
    // one-shot `kimi -p` would silently run this hidden turn with full write
    // access. Drive the title turn over ACP plan mode instead, which
    // disables tool execution.
    if (model.providerId === 'kimi') {
      const text = await kimiPlanModeOneShot(
        model,
        titleInstruction,
        input.projectPath || process.cwd()
      );
      return titleFromResponseText(text);
    }

    // Reuse command builder but force a read-only-ish access where possible for title gen
    const args = commandForModel(model, {
      prompt: titleInstruction,
      projectPath: input.projectPath || process.cwd(),
      accessMode: 'read-only',
    });

    const commandString = args.map(shellQuote).join(' ');
    return await new Promise((resolve) => {
      const child = spawn(loginShell, ['-lc', commandString], {
        cwd: input.projectPath || process.cwd(),
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', () => resolve(''));

      child.on('close', () => {
        const jsonMode = sendsJsonEvents(model.providerId);
        let responseText = '';

        if (jsonMode) {
          // Parse NDJSON / streaming-json output and extract only real text (ignore thoughts etc.)
          const adapter = jsonAdapterForProvider(model.providerId);
          const titleContext = { textSeen: false };
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
              const t = adapter.text(parsed, titleContext);
              if (t) {
                responseText += t;
                titleContext.textSeen = true;
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
              const t = adapter.text(p, titleContext);
              if (t) responseText += t;
            } catch {
              if (!/^\s*[\{\[]/.test(partial)) responseText += partial;
            }
          }
        } else {
          responseText = stdout;
        }

        if (!responseText.trim() && stderr.trim()) {
          responseText = stderr;
        }

        resolve(titleFromResponseText(responseText));
      });
    });
  } catch (e) {
    console.error('agent:generateTitle error', e);
    return '';
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

ipcMain.handle('path:basename', (_e, p) => path.basename(p));
ipcMain.handle('path:dirname', (_e, p) => path.dirname(p));
ipcMain.handle('path:join', (_e, ...parts) => path.join(...parts));
