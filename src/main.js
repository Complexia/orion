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
  watch as watchFsPath,
} from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import started from 'electron-squirrel-startup';
import { z } from 'zod';
import { autoUpdater } from 'electron-updater';
import {
  clearCloudRepoLink,
  getCloudRepoLink,
  getCloudState,
  publishRepo,
  pullRepo,
  pushRepo,
} from './cloud-sync.js';
import mcpBridgeShimSource from './mcp-bridge-shim.cjs?raw';

// Set the application name as early as possible.
// This helps the Dock, menu bar, and tooltips show "Orion" instead of "Electron"
// especially during development (`npm start`).
app.setName('Orion');
app.setAppUserModelId('com.complexia.orion');

const execFileAsync = promisify(execFile);
const hiddenSystemDirectories = new Set(['.git']);
const storageFileName = 'orion-store.json';
const accountSessionFileName = 'orion-account-session.json';
const attachmentDirectoryName = 'attachments';
const attachmentProtocol = 'orion-attachment';
const appProtocol = 'orion';
const loginShell = process.env.SHELL || '/bin/zsh';
const activeAgentRuns = new Map();
// Runs killed on purpose (stop / steer) — their nonzero exit must not trigger
// the "resume failed, retry fresh" fallback in agent:runTurn.
const stoppedAgentRuns = new Set();
let pendingDesktopAuth = null;
let inMemoryAccountSession = null;
let storageSaveQueue = Promise.resolve();
let appUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  checkedAt: null,
  availableVersion: null,
  progress: null,
  error: null,
};
let appUpdateInitialized = false;
let appUpdateCheckTimer = null;
let appUpdateDownloadedVersion = null;

const defaultCodexReasoningEffort = 'medium';
// The GPT-5.6 family defaults to high effort and is the only one that accepts
// "ultra" as a model_reasoning_effort value.
const gpt56CodexModelSlugs = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const codexReasoningEffortForModel = (model, effort) => {
  const isGpt56 = gpt56CodexModelSlugs.has(model.slug);
  if (!effort) return isGpt56 ? 'high' : defaultCodexReasoningEffort;
  if (effort === 'ultra' && !isGpt56) return 'xhigh';
  return effort;
};
const defaultCodexServiceTier = 'default';
const defaultClaudeReasoningEffort = 'high';
const defaultClaudeContextWindow = '200k';
const claudeOneMillionContextModels = new Set([
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]);

const cursorFallbackModels = [
  {
    id: 'cursor:composer-2.5',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Composer 2.5',
    slug: 'composer-2.5',
    command: 'cursor-agent',
    favorite: true,
  },
  {
    id: 'cursor:composer-2.5-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Composer 2.5 Fast',
    slug: 'composer-2.5-fast',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:gpt-5.5-high-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.5 High Fast',
    slug: 'gpt-5.5-high-fast',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:gpt-5',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5',
    slug: 'gpt-5',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:sonnet-4-thinking',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Sonnet 4 Thinking',
    slug: 'sonnet-4-thinking',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:sonnet-4',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Sonnet 4',
    slug: 'sonnet-4',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:claude-opus-4-8',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Opus 4.8',
    slug: 'claude-opus-4-8',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:gemini-3.1-pro',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Gemini 3.1 Pro',
    slug: 'gemini-3.1-pro',
    command: 'cursor-agent',
  },
  {
    id: 'cursor:grok-4.3',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Grok 4.3',
    slug: 'grok-4.3',
    command: 'cursor-agent',
  },
];

// Kimi Code CLI ships these three managed models out of the box; the live
// list (including any user-added providers) is discovered per launch via
// `kimi provider list --json` and replaces this block when available.
const kimiFallbackModels = [
  {
    id: 'kimi:kimi-code/k3',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K3',
    slug: 'kimi-code/k3',
    command: 'kimi',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'kimi:kimi-code/kimi-for-coding',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K2.7 Coding',
    slug: 'kimi-code/kimi-for-coding',
    command: 'kimi',
    shortcut: '⌘2',
  },
  {
    id: 'kimi:kimi-code/kimi-for-coding-highspeed',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K2.7 Coding Highspeed',
    slug: 'kimi-code/kimi-for-coding-highspeed',
    command: 'kimi',
    shortcut: '⌘3',
  },
];

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

const agentModels = [
  // Pseudo-model: the renderer resolves it to the configured main-driver
  // model (and attaches an `orchestration` payload) before agent:runTurn.
  // No `command` — agent:listModels reports it as always available.
  {
    id: 'orion:orchestrator',
    providerId: 'orion',
    providerLabel: 'Orion',
    label: 'Orion',
    slug: 'orion',
  },
  {
    id: 'grok:grok-4.5',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Grok 4.5',
    slug: 'grok-4.5',
    command: 'grok',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'grok:grok-composer-2.5-fast',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Composer 2.5 Fast',
    slug: 'grok-composer-2.5-fast',
    command: 'grok',
    shortcut: '⌘2',
    favorite: true,
  },
  {
    id: 'codex:gpt-5.6-sol',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Sol',
    slug: 'gpt-5.6-sol',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.6-terra',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Terra',
    slug: 'gpt-5.6-terra',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.6-luna',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Luna',
    slug: 'gpt-5.6-luna',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.5',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.5',
    slug: 'gpt-5.5',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.4',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.4',
    slug: 'gpt-5.4',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.4-mini',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.4 Mini',
    slug: 'gpt-5.4-mini',
    command: 'codex',
  },
  {
    id: 'codex:gpt-5.3-codex-spark',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.3 Codex Spark',
    slug: 'gpt-5.3-codex-spark',
    command: 'codex',
  },
  {
    id: 'claude:claude-fable-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Fable 5',
    slug: 'claude-fable-5',
    command: 'claude',
    shortcut: '⌘1',
  },
  {
    id: 'claude:claude-opus-4-8',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.8',
    slug: 'claude-opus-4-8',
    command: 'claude',
    shortcut: '⌘2',
  },
  {
    id: 'claude:claude-sonnet-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 5',
    slug: 'claude-sonnet-5',
    command: 'claude',
    shortcut: '⌘3',
  },
  {
    id: 'claude:claude-opus-4-7',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.7',
    slug: 'claude-opus-4-7',
    command: 'claude',
    shortcut: '⌘4',
  },
  {
    id: 'claude:claude-opus-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.6',
    slug: 'claude-opus-4-6',
    command: 'claude',
    shortcut: '⌘5',
  },
  {
    id: 'claude:claude-opus-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.5',
    slug: 'claude-opus-4-5',
    command: 'claude',
    shortcut: '⌘6',
  },
  {
    id: 'claude:claude-sonnet-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 4.6',
    slug: 'claude-sonnet-4-6',
    command: 'claude',
    shortcut: '⌘7',
  },
  {
    id: 'claude:claude-haiku-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Haiku 4.5',
    slug: 'claude-haiku-4-5',
    command: 'claude',
    shortcut: '⌘8',
  },
  {
    // Embedded-terminal pseudo-model: the thread runs the interactive
    // `claude` TUI in a PTY (see the terminal:* IPC handlers), never
    // agent:runTurn.
    id: 'claude:claude-code-cli',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Code CLI',
    slug: 'claude-code-cli',
    command: 'claude',
  },
  ...kimiFallbackModels,
  ...cursorFallbackModels,
  {
    id: 'opencode:anthropic/claude-sonnet-4-6',
    providerId: 'opencode',
    providerLabel: 'OpenCode',
    label: 'Claude Sonnet 4.6',
    slug: 'anthropic/claude-sonnet-4-6',
    command: 'opencode',
  },
];

const getStorageFilePath = () => path.join(app.getPath('userData'), storageFileName);
const getAccountSessionFilePath = () => path.join(app.getPath('userData'), accountSessionFileName);
const getAttachmentDirectoryPath = () => path.join(app.getPath('userData'), attachmentDirectoryName);

const imageExtensionsByMimeType = {
  'image/apng': '.apng',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};
const imageMimeTypeByExtension = Object.fromEntries(
  Object.entries(imageExtensionsByMimeType).map(([mimeType, ext]) => [ext, mimeType])
);

const videoMimeTypeByExtension = {
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
};

// Media the renderer may load from arbitrary local paths (agent-referenced
// images/videos in markdown), beyond files saved in the attachment dir.
const mediaMimeTypeByExtension = {
  ...imageMimeTypeByExtension,
  '.jpeg': 'image/jpeg',
  ...videoMimeTypeByExtension,
};
const mediaPreviewExtensions = new Set(Object.keys(mediaMimeTypeByExtension));

const getMimeTypeForMediaPath = (filePath) =>
  mediaMimeTypeByExtension[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

const videoExtensionsByMimeType = Object.fromEntries(
  Object.entries(videoMimeTypeByExtension).map(([ext, mimeType]) => [mimeType, ext])
);

const extensionFromMediaInput = (name, mimeType) => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const fromMime =
    imageExtensionsByMimeType[normalizedMimeType] || videoExtensionsByMimeType[normalizedMimeType];
  if (fromMime) return fromMime;

  const ext = path.extname(String(name || '')).toLowerCase();
  if (/^\.(apng|avif|gif|jpe?g|png|svg|webp|mp4|webm|mov|m4v|ogv|mkv|avi)$/.test(ext)) return ext;
  return normalizedMimeType.startsWith('video/') ? '.mp4' : '.png';
};

const sanitizeAttachmentName = (name) => {
  const baseName = path.basename(String(name || 'image')).replace(/[^\w.-]+/g, '-');
  const trimmed = baseName.replace(/^-+|-+$/g, '');
  return trimmed || 'image';
};

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

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

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

const humanizeModelSlug = (slug) =>
  String(slug)
    .replace(/^[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bAi\b/g, 'AI');

const cleanCursorModelLabel = (label) =>
  String(label || '')
    .replace(/\s+\((?:current|default|selected)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const cursorModelFromCliRow = (slug, label, index = 0) => {
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) return null;
  const cleanLabel = cleanCursorModelLabel(label) || humanizeModelSlug(cleanSlug);
  return {
    id: `cursor:${cleanSlug}`,
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: cleanLabel,
    slug: cleanSlug,
    command: 'cursor-agent',
    favorite: index < 2,
  };
};

const parseCursorModelObject = (value, index) => {
  if (!value || typeof value !== 'object') return null;
  const slug =
    value.id ||
    value.model ||
    value.name ||
    value.slug ||
    value.modelId ||
    value.sku ||
    value.value;
  const label =
    value.label ||
    value.displayName ||
    value.display_name ||
    value.title ||
    value.name ||
    value.model ||
    slug;
  return cursorModelFromCliRow(slug, label, index);
};

const parseCursorModelsOutput = (output) => {
  const text = String(output || '').trim();
  if (!text || /no models available/i.test(text) || /authentication required/i.test(text)) return [];

  try {
    const parsed = JSON.parse(text);
    const values = Array.isArray(parsed) ? parsed : parsed.models || parsed.data || parsed.items;
    if (Array.isArray(values)) {
      return values.map(parseCursorModelObject).filter(Boolean);
    }
  } catch {}

  const models = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[-\s|]+$/.test(trimmed) || /^id\s+/i.test(trimmed)) continue;

    const dashMatch = trimmed.match(/^(\S+)\s+-\s+(.+)$/);
    if (dashMatch) {
      const model = cursorModelFromCliRow(dashMatch[1], dashMatch[2], models.length);
      if (model) models.push(model);
      continue;
    }

    const columns = trimmed.split(/\s{2,}/).filter(Boolean);
    if (columns.length >= 2) {
      const model = cursorModelFromCliRow(columns[0], columns.slice(1).join(' '), models.length);
      if (model) models.push(model);
      continue;
    }

    if (/^[a-z0-9][a-z0-9._:/[\]=,-]*$/i.test(trimmed)) {
      const model = cursorModelFromCliRow(trimmed, trimmed, models.length);
      if (model) models.push(model);
    }
  }

  const seen = new Set();
  return models.filter((model) => {
    if (seen.has(model.slug)) return false;
    seen.add(model.slug);
    return true;
  });
};

const listCursorAgentModels = async () => {
  if (!(await checkCommandAvailable('cursor-agent'))) return [];

  for (const args of [['--list-models'], ['models']]) {
    try {
      const { stdout, stderr } = await execFileAsync('cursor-agent', args, {
        timeout: 15000,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });
      const models = parseCursorModelsOutput(`${stdout || ''}\n${stderr || ''}`);
      if (models.length > 0) return models;
    } catch (error) {
      const models = parseCursorModelsOutput(`${error?.stdout || ''}\n${error?.stderr || ''}`);
      if (models.length > 0) return models;
    }
  }

  return [];
};

// Kimi models come from the CLI's own provider registry (managed kimi-code
// models plus any custom providers the user imported). Aliases double as
// model slugs: they are what `-m` and the ACP model config option accept.
const listKimiModels = async () => {
  if (!(await checkCommandAvailable('kimi'))) return [];
  try {
    const { stdout } = await execFileAsync('kimi', ['provider', 'list', '--json'], {
      timeout: 15000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const parsed = JSON.parse(String(stdout || '').trim());
    const models = parsed?.models && typeof parsed.models === 'object' ? parsed.models : {};
    // The CLI registry's key order puts newer models last; pin K3 to the top
    // of the picker (stable sort keeps the rest in registry order).
    return Object.entries(models)
      .sort(([a], [b]) => Number(b === 'kimi-code/k3') - Number(a === 'kimi-code/k3'))
      .map(([alias, value], index) => {
        if (!alias || typeof alias !== 'string') return null;
        const label =
          (value && typeof value === 'object' && typeof value.displayName === 'string' && value.displayName) ||
          humanizeModelSlug(alias);
        return {
          id: `kimi:${alias}`,
          providerId: 'kimi',
          providerLabel: 'Kimi',
          label,
          slug: alias,
          command: 'kimi',
          ...(index < 9 ? { shortcut: `⌘${index + 1}` } : {}),
          favorite: alias === 'kimi-code/k3',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

// Replace a provider's static catalog block with its discovered models,
// keeping the block's position in the picker order.
const spliceProviderModels = (models, providerId, replacements) => {
  if (replacements.length === 0) return models;
  const firstIndex = models.findIndex((model) => model.providerId === providerId);
  if (firstIndex === -1) return [...models, ...replacements];
  return [
    ...models.slice(0, firstIndex).filter((model) => model.providerId !== providerId),
    ...replacements,
    ...models.slice(firstIndex).filter((model) => model.providerId !== providerId),
  ];
};

const getAgentModels = async () => {
  const [discoveredCursorModels, discoveredKimiModels] = await Promise.all([
    listCursorAgentModels(),
    listKimiModels(),
  ]);
  let models = spliceProviderModels(agentModels, 'cursor', discoveredCursorModels);
  models = spliceProviderModels(models, 'kimi', discoveredKimiModels);
  return models;
};

const claudeEffortForCli = (reasoningEffort = defaultClaudeReasoningEffort) => {
  if (reasoningEffort === 'ultracode') return 'xhigh';
  if (reasoningEffort === 'ultrathink') return defaultClaudeReasoningEffort;
  return reasoningEffort;
};

const claudeModelArgForContextWindow = (modelArg, contextWindow = defaultClaudeContextWindow) => {
  if (contextWindow !== '1m' || !claudeOneMillionContextModels.has(modelArg)) return modelArg;
  return `${modelArg}[1m]`;
};

// Tokenize a user-provided flags string, respecting single/double quotes.
const parseExtraArgs = (value) => {
  const text = String(value || '').trim();
  if (!text) return [];
  const args = [];
  const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = tokenPattern.exec(text))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
};

// Browser control runs through npx rather than Orion's bundled node_modules,
// so keep the reviewed MCP release explicit. Never use @latest here: that
// would let a published Orion build silently execute different third-party
// code on a later run.
const chromeDevtoolsMcpPackage = 'chrome-devtools-mcp@1.6.0';

const commandForModel = (model, input) => {
  const prompt =
    model.providerId === 'claude' && input.claudeReasoningEffort === 'ultrathink'
      ? `ultrathink\n\n${input.prompt}`
      : input.prompt;
  const cwd = input.projectPath;
  const modelArg = model.slug;
  const accessMode = input.accessMode || 'full-access';
  const options = input.providerOptions && typeof input.providerOptions === 'object' ? input.providerOptions : {};
  const extraArgs = parseExtraArgs(options.extraArgs);
  const resumeSessionId =
    typeof input.resumeSessionId === 'string' && input.resumeSessionId ? input.resumeSessionId : null;

  if (model.providerId === 'codex') {
    // Goal runs (/goal) speak JSON-RPC over `codex app-server` — model,
    // sandbox, and config overrides travel in the dialog, not argv.
    if (input.codexGoal) return ['codex', 'app-server'];
    const reasoningEffort = codexReasoningEffortForModel(model, input.codexReasoningEffort);
    // Code reviews (/review) run codex's dedicated reviewer. Same JSONL event
    // stream as `codex exec --json`, so the normal adapter handles it. The
    // review session is throwaway (--ephemeral): it must never become the
    // thread's resumable session (session events are suppressed in runTurn).
    if (input.codexReview && typeof input.codexReview === 'object') {
      const review = input.codexReview;
      const reviewAccessArgs =
        accessMode === 'full-access'
          ? ['--dangerously-bypass-approvals-and-sandbox']
          : [
              '--config',
              `sandbox_mode="${accessMode === 'read-only' ? 'read-only' : 'workspace-write'}"`,
            ];
      const reviewArgs = [
        'codex',
        'exec',
        'review',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        '--model',
        modelArg,
        '--config',
        `model_reasoning_effort="${reasoningEffort}"`,
        // GPT-5.6 models default to model_reasoning_summary="none" on the
        // CLI, which silences the reviewer's narration between commands (the
        // desktop app requests summaries). Ask for them explicitly.
        '--config',
        'model_reasoning_summary="detailed"',
        '--config',
        `service_tier="${input.codexServiceTier || defaultCodexServiceTier}"`,
        ...reviewAccessArgs,
      ];
      if (review.mode === 'base' && review.base) reviewArgs.push('--base', review.base);
      else if (review.mode === 'commit' && review.commit) reviewArgs.push('--commit', review.commit);
      else if (review.mode !== 'custom') reviewArgs.push('--uncommitted');
      if (typeof review.instructions === 'string' && review.instructions.trim()) {
        reviewArgs.push(review.instructions.trim());
      }
      return reviewArgs;
    }
    const serviceTier = input.codexServiceTier || defaultCodexServiceTier;
    const configArgs = [
      '--config',
      `model_reasoning_effort="${reasoningEffort}"`,
      // GPT-5.6 models default to no reasoning summaries on the CLI — request
      // them so the Reasoning activity streams like the desktop app.
      '--config',
      'model_reasoning_summary="detailed"',
      '--config',
      `service_tier="${serviceTier}"`,
    ];
    if (options.networkAccess) configArgs.push('--config', 'sandbox_workspace_write.network_access=true');
    if (options.webSearch) configArgs.push('--config', 'tools.web_search=true');
    // Browser control: the ChatGPT-extension browser backend is hard-gated to
    // the ChatGPT.app process tree (code-sign ancestry check on its
    // /tmp/codex-browser-use sockets), so codex spawned by Orion can never use
    // it. Instead expose Google's chrome-devtools-mcp as a purpose-built
    // browser connector — the codex chrome plugin docs explicitly prefer
    // purpose-built connectors over the Chrome plugin. Uses a persistent
    // profile (~/.cache/chrome-devtools-mcp/chrome-profile), so logins stick
    // across runs.
    const browserControlEnabled =
      options.browserControl === true && accessMode !== 'read-only';
    if (browserControlEnabled) {
      // autoConnect attaches to the user's real signed-in Chrome profile
      // (Chrome 144+, after the one-time chrome://inspect/#remote-debugging
      // toggle); otherwise chrome-devtools-mcp launches a dedicated Chrome
      // with its own persistent profile.
      const mcpArgs = JSON.stringify([
        '-y',
        chromeDevtoolsMcpPackage,
        ...(options.browserAutoConnect ? ['--autoConnect'] : []),
      ]);
      configArgs.push(
        '--config',
        'mcp_servers.chrome_devtools.command="npx"',
        '--config',
        `mcp_servers.chrome_devtools.args=${mcpArgs}`,
        '--config',
        'mcp_servers.chrome_devtools.startup_timeout_sec=90',
      );
    }
    // Orion's spawn_subagent bridge (@-mention delegation / orchestration).
    // A spawned subagent can run for a long time, so lift codex's 60s default
    // MCP tool timeout well clear of real runs.
    if (input.orionMcp) {
      configArgs.push(
        '--config',
        `mcp_servers.orion.command=${JSON.stringify(input.orionMcp.command)}`,
        '--config',
        `mcp_servers.orion.args=${JSON.stringify(input.orionMcp.args)}`,
        '--config',
        'mcp_servers.orion.env={ELECTRON_RUN_AS_NODE = "1"}',
        '--config',
        'mcp_servers.orion.startup_timeout_sec=30',
        '--config',
        'mcp_servers.orion.tool_timeout_sec=7200',
        // codex 0.144 gates MCP tools behind an approval prompt that headless
        // exec runs auto-cancel ("user cancelled MCP tool call") — pre-approve
        // Orion's own tool. The spawned subthread runs with the driver
        // thread's access mode, so this grants nothing extra.
        '--config',
        'mcp_servers.orion.default_tools_approval_mode="approve"',
      );
    }
    // Without this steer, codex's bundled control-chrome skill grabs browser
    // tasks, hits the dead extension backend, and gives up without ever trying
    // the chrome_devtools tools (verified empirically). The skill defers to a
    // user-named alternative, which this note provides.
    const browserNote = !browserControlEnabled
      ? ''
      : options.browserAutoConnect
        ? `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search); they attach to the user's real signed-in Chrome, so treat open tabs and logins with care and do not close tabs you did not open. If those tools report "Could not connect to Chrome", tell the user to open chrome://inspect/#remote-debugging in Chrome, turn the remote debugging toggle on, quit and reopen Chrome (the server only starts on launch), and retry — do not attempt workarounds.]\n\n`
        : `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search).]\n\n`;
    const codexPrompt = `${browserNote}${prompt}`;

    if (resumeSessionId) {
      // `exec resume` has no --cd/--sandbox/--color flags: cwd comes from the
      // spawn cwd and the sandbox from a config override.
      const accessArgs =
        accessMode === 'full-access'
          ? ['--dangerously-bypass-approvals-and-sandbox']
          : ['--config', `sandbox_mode="${accessMode === 'read-only' ? 'read-only' : 'workspace-write'}"`];
      return [
        'codex',
        'exec',
        'resume',
        resumeSessionId,
        '--json',
        '--skip-git-repo-check',
        '--model',
        modelArg,
        ...configArgs,
        ...accessArgs,
        ...extraArgs,
        codexPrompt,
      ];
    }

    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', accessMode === 'read-only' ? 'read-only' : 'workspace-write'];
    return [
      'codex',
      'exec',
      '--json',
      '--cd',
      cwd,
      '--skip-git-repo-check',
      '--color',
      'never',
      '--model',
      modelArg,
      ...configArgs,
      ...accessArgs,
      ...extraArgs,
      codexPrompt,
    ];
  }

  if (model.providerId === 'claude') {
    const reasoningEffort = input.claudeReasoningEffort || defaultClaudeReasoningEffort;
    const contextWindow = input.claudeContextWindow || defaultClaudeContextWindow;
    const claudeModelArg = claudeModelArgForContextWindow(modelArg, contextWindow);
    const settingsArgs = reasoningEffort === 'ultracode' ? ['--settings', JSON.stringify({ ultracode: true })] : [];
    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-skip-permissions']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    // Headless runs can't show permission prompts, so tools outside the
    // permission mode's defaults must be pre-approved here. Claude in Chrome
    // tools are MCP tools, so enabling --chrome also pre-approves its server.
    const chromeEnabled = options.chrome === true && accessMode !== 'read-only';
    const chromeArgs = chromeEnabled ? ['--chrome'] : [];
    const configuredAllowedTools = String(options.allowedTools || '')
      .split(',')
      .map((tool) => tool.trim())
      .filter(
        (tool) =>
          Boolean(tool) &&
          (accessMode !== 'read-only' || !tool.startsWith('mcp__claude-in-chrome'))
      );
    const allowedTools = [...configuredAllowedTools, chromeEnabled ? 'mcp__claude-in-chrome' : '']
      .filter(Boolean)
      .join(',');
    // MUST be the single-token --flag=value form: --allowedTools is variadic
    // (space-separated), so `--allowedTools a,b <prompt>` swallows the prompt.
    const allowedToolsArgs =
      accessMode !== 'full-access' && allowedTools ? [`--allowedTools=${allowedTools}`] : [];
    const resumeArgs = resumeSessionId
      ? ['--resume', resumeSessionId, ...(input.forkSession ? ['--fork-session'] : [])]
      : [];
    return [
      'claude',
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--model',
      claudeModelArg,
      '--effort',
      claudeEffortForCli(reasoningEffort),
      ...settingsArgs,
      ...accessArgs,
      ...chromeArgs,
      ...allowedToolsArgs,
      ...resumeArgs,
      ...extraArgs,
      prompt,
    ];
  }

  if (model.providerId === 'cursor') {
    const accessArgs = accessMode === 'read-only' ? ['--mode', 'plan'] : ['--force'];
    const resumeArgs = resumeSessionId ? ['--resume', resumeSessionId] : [];
    const pluginArgs = input.orionMcp?.pluginDir
      ? ['--plugin-dir', input.orionMcp.pluginDir]
      : [];
    return [
      'cursor-agent',
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--workspace',
      cwd,
      '--model',
      modelArg,
      ...pluginArgs,
      ...accessArgs,
      ...resumeArgs,
      ...extraArgs,
      prompt,
    ];
  }

  if (model.providerId === 'grok') {
    // Real turns speak ACP (JSON-RPC over `grok agent stdio`): the prompt,
    // cwd, session resume, and permission answers travel over the dialog, not
    // flags. The headless streaming-json format only ever emits thought/text/
    // end, so ACP is the only way to stream tool calls, plans, and diffs.
    if (input.acp) {
      const effortArgs = input.grokReasoningEffort
        ? ['--reasoning-effort', input.grokReasoningEffort]
        : [];
      const pluginArgs = input.orionMcp?.pluginDir
        ? ['--plugin-dir', input.orionMcp.pluginDir]
        : [];
      return [
        'grok',
        'agent',
        '-m',
        modelArg,
        ...effortArgs,
        ...pluginArgs,
        ...(accessMode === 'full-access' ? ['--always-approve'] : []),
        ...extraArgs,
        'stdio',
      ];
    }

    // One-shot text-only path (thread title generation).
    const accessArgs =
      accessMode === 'full-access'
        ? ['--permission-mode', 'bypassPermissions', '--always-approve']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    const resumeArgs = resumeSessionId
      ? ['--resume', resumeSessionId, ...(input.forkSession ? ['--fork-session'] : [])]
      : [];
    return [
      'grok',
      '--cwd',
      cwd,
      '--model',
      modelArg,
      '--output-format',
      'streaming-json',
      ...accessArgs,
      ...resumeArgs,
      ...extraArgs,
      '--single',
      prompt,
    ];
  }

  if (model.providerId === 'kimi') {
    // kimi always speaks ACP (JSON-RPC over `kimi acp`): the prompt, cwd,
    // session resume (session/load), model selection (session/set_config_option)
    // and permission mode (session/set_mode: plan/default/yolo) all travel
    // over the dialog, not argv. Prompt mode (`kimi -p`) is never used, even
    // for hidden one-shot turns: it auto-approves every tool and rejects
    // --plan ("Cannot combine --prompt with --plan" on 0.26), so it cannot
    // honor any access mode below Full access. Title generation goes through
    // kimiPlanModeOneShot (ACP plan mode) instead.
    return ['kimi', ...extraArgs, 'acp'];
  }

  return ['opencode', 'run', '--model', modelArg, ...extraArgs, prompt];
};

// -------------------- Orion orchestration instruction files --------------------

// Managed blocks written into the project's CLAUDE.md / AGENTS.md so the main
// driver of an orchestrator turn knows its role table and how to delegate.
// Everything outside the markers is left untouched.
const orchestrationBlockStartMarker = '<!-- ORION:ORCHESTRATION:START -->';
const orchestrationBlockEndMarker = '<!-- ORION:ORCHESTRATION:END -->';

const orchestrationRoleLabels = {
  mainDriver: 'Main driver',
  computerUse: 'Computer use',
  exploring: 'Exploring',
  implementation: 'Implementation',
  imageVideoGen: 'Image/video generation',
};

const buildOrchestrationBlock = (orchestration) => {
  const roles = Array.isArray(orchestration?.roles) ? orchestration.roles : [];
  const lines = [
    orchestrationBlockStartMarker,
    '# Orion Orchestration',
    '',
    'These instructions apply only when this session is the Orion orchestrator (main driver), which is indicated by an `[Orion orchestration]` context block in the user prompt. Otherwise ignore this section entirely.',
    '',
    '## Roles',
    '',
    '| Role | Model | Provider | Model slug |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of roles) {
    const roleLabel = entry.roleLabel || orchestrationRoleLabels[entry.role] || entry.role || '';
    const suffix = entry.role === 'mainDriver' ? ' (this agent)' : '';
    lines.push(
      `| ${roleLabel}${suffix} | ${entry.modelLabel || entry.modelId || ''} | ${entry.providerId || ''} | ${entry.slug || ''} |`
    );
  }
  lines.push(
    '',
    '## Delegating to subagents',
    '',
    '1. **Preferred — the `spawn_subagent` tool.** Current Orion drivers expose a `spawn_subagent` tool from Orion\'s MCP server (the fully-qualified name varies by provider and may be `mcp__orion__spawn_subagent`, `orion.spawn_subagent`, or a plugin-prefixed equivalent). Call it with `{ model, prompt, title?, role? }`. `model` accepts a model id like `codex:gpt-5.6-sol`, a slug, or a label. The task runs on that model as a visible subthread in Orion, and the call blocks until the subagent finishes, returning its final report. Delegate computer-use tasks to the computerUse model, code exploration to the exploring model, code changes to the implementation model, and image/video generation to the imageVideoGen model — unless the user explicitly says otherwise (e.g. via @model mentions).',
    '2. **Fallback — run the provider CLI from the shell.** Only if the spawn_subagent tool is genuinely absent from your tool list, run the target provider CLI directly as a blocking one-shot command and read its output. The current `[Orion orchestration]` prompt supplies mandatory access flags; preserve them exactly and never grant a subagent more access than the driver:',
    '   - codex: `codex exec --json --cd <cwd> --skip-git-repo-check --color never --model <slug> <access flags> "<task>"`',
    '   - claude: `claude --print --model <slug> <access flags> "<task>"`',
    '   - cursor: `cursor-agent --print --trust --workspace <cwd> --model <slug> <access flags> "<task>"`',
    '   - grok: `grok --cwd <cwd> --model <slug> <access flags> --single "<task>"`',
    '   - kimi: `kimi -m <slug> -p "<task>"` — prompt mode auto-approves every tool and cannot be sandboxed, so only delegate to kimi when the access mode is Full access.',
    '',
    '   Iterate: inspect stdout when the command finishes, and follow up with a refined invocation if the result is incomplete.'
  );
  const generalInstructions = String(orchestration?.generalInstructions || '').trim();
  if (generalInstructions) {
    lines.push('', '## General orchestration instructions', '', orchestration.generalInstructions);
  }
  lines.push(orchestrationBlockEndMarker);
  return lines.join('\n');
};

const syncOrchestrationInstructionFiles = async (projectPath, orchestration) => {
  const block = buildOrchestrationBlock(orchestration);
  for (const fileName of ['CLAUDE.md', 'AGENTS.md']) {
    const filePath = path.join(projectPath, fileName);
    let existing = null;
    try {
      existing = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    let next;
    if (existing === null) {
      next = `${block}\n`;
    } else {
      const startIndex = existing.indexOf(orchestrationBlockStartMarker);
      // The END marker only counts if it closes this START; an END before the
      // START (or none at all) means the block is corrupt.
      const endIndex =
        startIndex === -1
          ? -1
          : existing.indexOf(
              orchestrationBlockEndMarker,
              startIndex + orchestrationBlockStartMarker.length
            );
      if (startIndex !== -1 && endIndex !== -1) {
        next =
          existing.slice(0, startIndex) +
          block +
          existing.slice(endIndex + orchestrationBlockEndMarker.length);
      } else {
        // Strip any orphaned markers so repeated runs converge on exactly one
        // well-formed block instead of growing the file.
        const stripped = existing
          .split(orchestrationBlockStartMarker)
          .join('')
          .split(orchestrationBlockEndMarker)
          .join('');
        const trimmed = stripped.replace(/\s+$/u, '');
        next = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
      }
    }

    if (next !== existing) await fs.writeFile(filePath, next, 'utf-8');
  }
};

// Branched threads inherit the parent's session id but must never resume it
// in place — codex and cursor append resumed turns to the parent's own
// on-disk record. claude exposes --fork-session for this; for codex, cursor,
// and grok (whose ACP agent mode has no fork flag) the session is forked by
// copying that record under a new uuid.
const forkCodexSessionFile = async (sessionId) => {
  const sessionsRoot = path.join(app.getPath('home'), '.codex', 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  const entries = await fs.readdir(sessionsRoot, { recursive: true });
  const relativePath = entries.find((entry) => entry.endsWith(suffix));
  if (!relativePath) return null;

  const sourcePath = path.join(sessionsRoot, relativePath);
  const newId = crypto.randomUUID();
  const lines = (await fs.readFile(sourcePath, 'utf8')).split('\n');
  // Line 1 is session_meta; codex matches resume ids against both the
  // filename and this embedded id.
  const meta = JSON.parse(lines[0]);
  meta.payload.id = newId;
  lines[0] = JSON.stringify(meta);
  await fs.writeFile(sourcePath.replace(suffix, `-${newId}.jsonl`), lines.join('\n'));
  return newId;
};

const forkCursorChatDir = async (sessionId) => {
  // Chats live at ~/.cursor/chats/<workspace-hash>/<chatId>/; resume resolves
  // the chat by directory name.
  const chatsRoot = path.join(app.getPath('home'), '.cursor', 'chats');
  for (const workspaceHash of await fs.readdir(chatsRoot)) {
    const sourceDir = path.join(chatsRoot, workspaceHash, sessionId);
    const isChatDir = await fs
      .stat(sourceDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!isChatDir) continue;

    const newId = crypto.randomUUID();
    await fs.cp(sourceDir, path.join(chatsRoot, workspaceHash, newId), { recursive: true });
    return newId;
  }
  return null;
};

// Grok sessions live at ~/.grok/sessions/<urlencoded-cwd>/<sessionId>/ as a
// directory of jsonl/json files; `session/load` accepts a copied directory
// under a fresh uuid (verified live on grok 0.2.93).
const forkGrokSessionDir = async (sessionId) => {
  const sessionsRoot = path.join(app.getPath('home'), '.grok', 'sessions');
  for (const encodedCwd of await fs.readdir(sessionsRoot)) {
    const sourceDir = path.join(sessionsRoot, encodedCwd, sessionId);
    const isSessionDir = await fs
      .stat(sourceDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!isSessionDir) continue;

    const newId = crypto.randomUUID();
    await fs.cp(sourceDir, path.join(sessionsRoot, encodedCwd, newId), { recursive: true });
    return newId;
  }
  return null;
};

// Kimi sessions live at ~/.kimi-code/sessions/<wd-hash>/<sessionId>/ and are
// located through ~/.kimi-code/session_index.jsonl (append-only; last entry
// for an id wins). `session/load` accepts a copied directory registered under
// a fresh id (verified live on kimi-code 0.26.0).
const kimiHomeDir = () =>
  process.env.KIMI_CODE_HOME || path.join(app.getPath('home'), '.kimi-code');

const findKimiSessionIndexEntry = async (sessionId) => {
  const indexPath = path.join(kimiHomeDir(), 'session_index.jsonl');
  let content;
  try {
    content = await fs.readFile(indexPath, 'utf8');
  } catch {
    return null;
  }
  let entry = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.sessionId === sessionId) entry = parsed;
    } catch {}
  }
  return entry;
};

const forkKimiSessionDir = async (sessionId) => {
  const entry = await findKimiSessionIndexEntry(sessionId);
  if (!entry?.sessionDir) return null;
  const isSessionDir = await fs
    .stat(entry.sessionDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!isSessionDir) return null;

  const newId = `session_${crypto.randomUUID()}`;
  const newDir = path.join(path.dirname(entry.sessionDir), newId);
  await fs.cp(entry.sessionDir, newDir, { recursive: true });
  // state.json embeds absolute per-agent homedirs under the old session dir;
  // repoint them at the copy so nothing in the fork references the parent.
  const statePath = path.join(newDir, 'state.json');
  try {
    const state = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, state.split(sessionId).join(newId));
  } catch {}
  await fs.appendFile(
    path.join(kimiHomeDir(), 'session_index.jsonl'),
    `${JSON.stringify({ ...entry, sessionId: newId, sessionDir: newDir })}\n`
  );
  return newId;
};

const forkSessionOnDisk = async (providerId, sessionId) => {
  try {
    if (providerId === 'codex') return await forkCodexSessionFile(sessionId);
    if (providerId === 'cursor') return await forkCursorChatDir(sessionId);
    if (providerId === 'grok') return await forkGrokSessionDir(sessionId);
    if (providerId === 'kimi') return await forkKimiSessionDir(sessionId);
  } catch (error) {
    console.error(`Failed to fork ${providerId} session ${sessionId}`, error);
  }
  return null;
};

// Pull the harness's session/thread id out of its stream so follow-up turns
// can resume the same conversation.
const extractSessionIdFromJsonEvent = (providerId, value) => {
  if (!value || typeof value !== 'object') return null;
  if (providerId === 'codex') {
    return value.type === 'thread.started' && typeof value.thread_id === 'string'
      ? value.thread_id
      : null;
  }
  if (providerId === 'grok') {
    return typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : null;
  }
  // claude / cursor stream-json events carry session_id (init event onwards)
  return typeof value.session_id === 'string' && value.session_id ? value.session_id : null;
};

const extractTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  const direct = [];

  if (value.type === 'thought') return '';
  if (value.type === 'text' && typeof value.data === 'string') direct.push(value.data);
  if (value.type === 'error' && typeof value.data === 'string') direct.push(value.data);
  if (typeof value.text === 'string') direct.push(value.text);
  if (typeof value.delta === 'string') direct.push(value.delta);
  if (typeof value.content === 'string') direct.push(value.content);
  if (typeof value.result === 'string') direct.push(value.result);
  if (typeof value.response === 'string') direct.push(value.response);

  const message = value.message;
  if (message && typeof message === 'object') {
    if (typeof message.content === 'string') direct.push(message.content);
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          direct.push(part.text);
        }
      }
    }
  }

  const delta = value.delta;
  if (delta && typeof delta === 'object') {
    if (typeof delta.text === 'string') direct.push(delta.text);
    if (typeof delta.content === 'string') direct.push(delta.content);
  }

  return direct.join('');
};

// Claude Code stream-json emits the same text three ways: incremental
// stream_event deltas, a complete 'assistant' message per turn, and the final
// 'result' event. Render only the deltas so text isn't repeated; keep the
// 'result' payload only when it carries an error that was never streamed.
// Text blocks separated by tool use are distinct paragraphs, so a new text
// block after earlier text gets a blank line instead of gluing onto it.
const extractClaudeTextFromJsonEvent = (value, context = {}) => {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'stream_event') {
    if (value.parent_tool_use_id) return '';
    const streamEvent = value.event;
    if (
      streamEvent?.type === 'content_block_start' &&
      streamEvent.content_block?.type === 'text' &&
      context.textSeen
    ) {
      context.pendingTextBreak = true;
      return '';
    }
    const delta = streamEvent?.delta;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      const prefix = context.pendingTextBreak ? '\n\n' : '';
      context.pendingTextBreak = false;
      return `${prefix}${delta.text}`;
    }
    return '';
  }
  if (value.type === 'result' && value.is_error && typeof value.result === 'string') {
    return value.result;
  }
  return '';
};

const claudeStreamEventDelta = (value) =>
  value?.type === 'stream_event' && !value.parent_tool_use_id ? value.event?.delta : null;

// Claude thinking arrives as incremental thinking_delta stream events. Older
// CLIs without partial messages only include complete thinking blocks on each
// assistant message, so fall back to those until the first delta is seen.
const extractClaudeReasoningFromJsonEvent = (value, context = {}) => {
  const delta = claudeStreamEventDelta(value);
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    context.thinkingDeltaSeen = true;
    return delta.thinking;
  }

  if (
    !context.thinkingDeltaSeen &&
    value?.type === 'assistant' &&
    !value.parent_tool_use_id &&
    Array.isArray(value.message?.content)
  ) {
    return value.message.content
      .filter((part) => part?.type === 'thinking' && typeof part.thinking === 'string')
      .map((part) => `${part.thinking}\n\n`)
      .join('');
  }

  return '';
};

// cursor-agent stream-json mirrors Claude Code's: assistant events carry the
// streamed text and a final 'result' event repeats the whole response.
const extractCursorTextFromJsonEvent = (value, context = {}) => {
  if (!value || typeof value !== 'object') return '';

  if (value.type === 'assistant') {
    const parts = Array.isArray(value.message?.content) ? value.message.content : [];
    const text = parts
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
    if (!text) return '';

    // A new assistant message (id changed) after earlier text is a separate
    // paragraph — insert a blank line and stop prefix-matching against the
    // previous message's text.
    const messageId = typeof value.message?.id === 'string' ? value.message.id : null;
    const isNewMessage =
      messageId && context.lastAssistantMessageId && messageId !== context.lastAssistantMessageId;
    if (messageId) context.lastAssistantMessageId = messageId;
    if (isNewMessage) context.lastAssistantText = '';
    const prefix = isNewMessage && context.textSeen ? '\n\n' : '';

    // --stream-partial-output may resend a message's text cumulatively;
    // append only the new suffix. Genuine deltas fail the prefix test and
    // are appended whole.
    const previous = context.lastAssistantText ?? '';
    context.lastAssistantText = text;
    if (previous && text.startsWith(previous)) return `${prefix}${text.slice(previous.length)}`;
    return `${prefix}${text}`;
  }

  // Only use the final aggregate when nothing streamed, so the response
  // isn't duplicated at the end of the message.
  if (value.type === 'result' && !context.textSeen && typeof value.result === 'string') {
    return value.result;
  }

  return '';
};

const extractGrokTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text' && typeof value.data === 'string') return value.data;
  if (value.type === 'error' && typeof value.data === 'string') return value.data;
  return '';
};

// codex exec --json emits JSONL: thread.started, turn.started/completed/failed,
// and item.started/updated/completed for items typed agent_message, reasoning,
// command_execution, file_change, mcp_tool_call, web_search, todo_list, error.
const extractCodexTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  if (
    value.type === 'item.completed' &&
    value.item?.type === 'agent_message' &&
    typeof value.item.text === 'string'
  ) {
    return `${value.item.text}\n\n`;
  }
  if (value.type === 'turn.failed' && typeof value.error?.message === 'string') {
    return `${value.error.message}\n`;
  }
  return '';
};

const extractCodexReasoningFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object' || value.type !== 'item.completed') return '';
  if (value.item?.type !== 'reasoning') return '';
  const text = value.item.text ?? value.item.summary;
  return typeof text === 'string' && text ? `${text}\n\n` : '';
};

const codexActivityFromItem = (item, eventType) => {
  if (!item || typeof item !== 'object') return null;

  const failed =
    item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
  const status = failed
    ? 'error'
    : eventType === 'item.completed' || item.status === 'completed'
      ? 'done'
      : 'running';
  const base = { key: typeof item.id === 'string' ? item.id : undefined, status };

  if (item.type === 'command_execution') {
    return {
      ...base,
      type: 'command',
      title: `Command - ${stringifySummary(item.command, 80)}`,
      detail: stringifySummary(item.command),
    };
  }
  if (item.type === 'file_change') {
    const paths = Array.isArray(item.changes)
      ? item.changes.map((change) => change?.path).filter(Boolean)
      : [];
    return {
      ...base,
      type: 'tool',
      title: `File changes (${paths.length})`,
      detail: stringifySummary(paths.join(', ')),
    };
  }
  if (item.type === 'mcp_tool_call') {
    const name = [item.server, item.tool].filter(Boolean).join('.');
    return {
      ...base,
      type: 'tool',
      title: `Tool - ${name || 'MCP'}`,
      detail: stringifySummary(item.arguments ?? ''),
    };
  }
  if (item.type === 'web_search') {
    return {
      ...base,
      type: 'tool',
      title: 'Web search',
      detail: stringifySummary(item.query ?? ''),
    };
  }
  if (item.type === 'todo_list') {
    const todos = Array.isArray(item.items) ? item.items : [];
    const doneCount = todos.filter((todo) => todo?.completed).length;
    return {
      ...base,
      type: 'tool',
      title: `Plan - ${doneCount}/${todos.length} done`,
      detail: stringifySummary(todos.map((todo) => todo?.text).filter(Boolean).join(' · ')),
      status: 'done',
    };
  }
  if (item.type === 'collab_tool_call') {
    // Multi-agent collaboration calls (spawn_agent/wait/send_message). The
    // items carry no receiver thread ids on current codex, so the actual
    // subagents are detected from their rollout files; this row just shows
    // the parent's collaboration step.
    const tool = String(item.tool ?? 'collaboration');
    const titles = {
      spawn_agent: 'Spawning subagent',
      wait: 'Waiting for subagents',
      send_message: 'Messaging subagent',
      interrupt_agent: 'Interrupting subagent',
      close_agent: 'Closing subagent',
    };
    return {
      ...base,
      type: 'tool',
      kind: 'task',
      title: titles[tool] ?? `Subagents - ${tool}`,
      detail: stringifySummary(item.prompt ?? '', 160),
    };
  }
  if (item.type === 'error') {
    // Codex emits its experimental-feature warning ("Under-development features
    // enabled: ...") as an error item on every turn; it is noise, not a failure.
    if (/under-development features/i.test(String(item.message ?? ''))) return null;
    return {
      ...base,
      type: 'error',
      title: 'Codex notice',
      detail: stringifySummary(item.message, 300),
      status: 'error',
    };
  }

  return null;
};

const extractCodexActivitiesFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'turn.failed' && typeof value.error?.message === 'string') {
    return [
      {
        type: 'error',
        title: 'Turn failed',
        detail: stringifySummary(value.error.message, 300),
        status: 'error',
      },
    ];
  }
  if (!String(value.type || '').startsWith('item.')) return [];
  const activity = codexActivityFromItem(value.item, value.type);
  return activity ? [activity] : [];
};

const stringifySummary = (value, maxLength = 180) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);

  try {
    return JSON.stringify(value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  } catch {
    return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }
};

const extractReasoningText = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return '';

  const data = candidate.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    if (typeof data.text === 'string') return data.text;
    if (typeof data.thinking === 'string') return data.thinking;
    if (typeof data.content === 'string') return data.content;
  }

  if (typeof candidate.thinking === 'string') return candidate.thinking;
  if (typeof candidate.reasoning === 'string') return candidate.reasoning;
  if (typeof candidate.summary === 'string') return candidate.summary;
  if (typeof candidate.text === 'string') return candidate.text;
  if (typeof candidate.content === 'string') return candidate.content;
  if (typeof candidate.delta === 'string') return candidate.delta;

  const delta = candidate.delta;
  if (delta && typeof delta === 'object') {
    if (typeof delta.thinking === 'string') return delta.thinking;
    if (typeof delta.reasoning === 'string') return delta.reasoning;
    if (typeof delta.text === 'string') return delta.text;
    if (typeof delta.content === 'string') return delta.content;
  }

  return '';
};

const extractReasoningFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';

  const thoughts = [];
  const visit = (candidate, depth = 0) => {
    if (!candidate || typeof candidate !== 'object' || depth > 3) return;

    const rawType = String(candidate.type || candidate.kind || candidate.event || '').toLowerCase();
    if (
      rawType.includes('thought') ||
      rawType.includes('thinking') ||
      rawType.includes('reasoning')
    ) {
      const text = extractReasoningText(candidate);
      if (text) thoughts.push(text);
    }

    if (Array.isArray(candidate.content)) {
      for (const part of candidate.content) visit(part, depth + 1);
    }
    if (Array.isArray(candidate.message?.content)) {
      for (const part of candidate.message.content) visit(part, depth + 1);
    }
    if (candidate.message && typeof candidate.message === 'object') visit(candidate.message, depth + 1);
    if (candidate.delta && typeof candidate.delta === 'object') visit(candidate.delta, depth + 1);
  };

  visit(value);
  return thoughts.join('');
};

const summarizeToolInput = (input) => {
  if (!input || typeof input !== 'object') return stringifySummary(input);

  const command = input.command || input.cmd || input.shell_command;
  if (typeof command === 'string') return command;

  const pathLike =
    input.file_path ||
    input.filePath ||
    input.path ||
    input.cwd ||
    input.pattern ||
    input.glob ||
    input.query;
  if (typeof pathLike === 'string') return pathLike;

  return stringifySummary(input);
};

const activityFromCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;

  const rawType = String(candidate.type || candidate.kind || candidate.event || '').toLowerCase();
  const rawName = String(
    candidate.name ||
      candidate.tool_name ||
      candidate.toolName ||
      candidate.function?.name ||
      candidate.command_name ||
      ''
  );
  const input = candidate.input || candidate.arguments || candidate.args || candidate.params;
  const output = candidate.output || candidate.result || candidate.content || candidate.data;
  const command = candidate.command || input?.command || input?.cmd;

  const looksLikeTool =
    rawType.includes('tool') ||
    rawType.includes('function') ||
    rawType.includes('command') ||
    rawType.includes('shell') ||
    Boolean(rawName && input);

  if (!looksLikeTool) return null;

  const isResult =
    rawType.includes('result') ||
    rawType.includes('output') ||
    rawType.includes('observation') ||
    candidate.is_error === true;
  const isCommand = rawType.includes('command') || rawType.includes('shell') || Boolean(command);
  const name = rawName || (isCommand ? 'Command' : 'Tool');
  const detail = summarizeToolInput(input) || stringifySummary(output);
  const title = isResult
    ? `${name} result`
    : isCommand
      ? `Command - ${stringifySummary(command || name, 80)}`
      : `Tool - ${name}`;

  const activity = {
    type: candidate.is_error === true ? 'error' : isResult ? 'result' : isCommand ? 'command' : 'tool',
    title,
    detail,
    status: candidate.is_error === true ? 'error' : isResult ? 'done' : 'running',
  };

  // Claude/cursor tool_use blocks carry an id and tool_result blocks point
  // back at it via tool_use_id — used to flip the original step to done.
  if (!isResult && typeof candidate.id === 'string' && candidate.id) {
    activity.key = candidate.id;
  }
  if (isResult && typeof candidate.tool_use_id === 'string' && candidate.tool_use_id) {
    activity.updateForKey = candidate.tool_use_id;
  }

  return activity;
};

const extractActivitiesFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return [];

  const activities = [];
  const maybeAdd = (candidate) => {
    const activity = activityFromCandidate(candidate);
    if (activity) activities.push(activity);
  };

  maybeAdd(value);

  const message = value.message;
  if (message && typeof message === 'object') {
    maybeAdd(message);
    if (Array.isArray(message.content)) {
      for (const part of message.content) maybeAdd(part);
    }
  }

  if (Array.isArray(value.content)) {
    for (const part of value.content) maybeAdd(part);
  }

  if (value.delta && typeof value.delta === 'object') {
    maybeAdd(value.delta);
    if (Array.isArray(value.delta.content)) {
      for (const part of value.delta.content) maybeAdd(part);
    }
  }

  const seen = new Set();
  return activities.filter((activity) => {
    const key = `${activity.type}:${activity.title}:${activity.detail ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// kimi's prompt-mode stream-json emits whole chat messages per line:
// {"role":"assistant","content":...,"tool_calls":[...]}, {"role":"tool",...}
// and a trailing {"role":"meta","type":"session.resume_hint",...}. Only the
// assistant text is transcript-worthy. Unused in practice — every kimi turn,
// including title generation, now speaks ACP (prompt mode can't be
// sandboxed) — but kept so kimi stays covered if a stream-json path returns.
const extractKimiTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object' || value.role !== 'assistant') return '';
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
};

const providerJsonAdapters = {
  claude: {
    text: extractClaudeTextFromJsonEvent,
    reasoning: extractClaudeReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  codex: {
    text: extractCodexTextFromJsonEvent,
    reasoning: extractCodexReasoningFromJsonEvent,
    activities: extractCodexActivitiesFromJsonEvent,
  },
  cursor: {
    text: extractCursorTextFromJsonEvent,
    reasoning: extractReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  grok: {
    text: extractGrokTextFromJsonEvent,
    reasoning: extractReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  kimi: {
    text: extractKimiTextFromJsonEvent,
    reasoning: () => '',
    activities: () => [],
  },
};

const genericJsonAdapter = {
  text: extractTextFromJsonEvent,
  reasoning: extractReasoningFromJsonEvent,
  activities: extractActivitiesFromJsonEvent,
};

const jsonAdapterForProvider = (providerId) => providerJsonAdapters[providerId] ?? genericJsonAdapter;

// ---------------------------------------------------------------------------
// Native provider subagents. Every provider CLI can spawn subagents (claude
// Agent/Task tool, codex collaboration.spawn_agent, cursor Task tool, grok
// spawn_subagent), and each one leaves a live transcript on disk:
//   claude — <tmp>/claude-<uid>/<cwd-slug>/<session>/tasks/<task_id>.output
//            (session-transcript JSONL; announced by system:task_started)
//   codex  — ~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread_id>.jsonl whose
//            session_meta.source.subagent.thread_spawn.parent_thread_id links
//            it to the parent (exec --json's collab items carry no ids)
//   cursor — ~/.cursor/projects/<cwd-slug>/agent-transcripts/<agentId>/…jsonl
//            (announced by the taskToolCall stream event)
//   grok   — ~/.grok/sessions/<encodeURIComponent(cwd)>/<child_session_id>/
//            updates.jsonl (raw session/update lines; announced by the
//            _x.ai subagent_spawned notification)
// A tracker per run tails those files and re-emits them as subagent-scoped
// turn events, so the renderer can show every subagent as a switchable live
// thread — uniformly across providers.

const SUBAGENT_TAIL_POLL_MS = 300;
const SUBAGENT_FILE_WAIT_MS = 30000;

// Poll-tail a JSONL file: wait for it to exist (resolveFile), then stream
// appended lines. fs.watch is unreliable across the tmp/home dirs involved,
// and a 300ms poll is imperceptible next to model latency.
const createJsonlTailer = ({ resolveFile, onLine }) => {
  let stopped = false;
  let filePath = null;
  let offset = 0;
  let carry = '';
  let waitedMs = 0;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      if (!filePath) {
        try {
          filePath = await resolveFile();
        } catch {
          filePath = null;
        }
        if (!filePath) {
          waitedMs += SUBAGENT_TAIL_POLL_MS;
          if (waitedMs >= SUBAGENT_FILE_WAIT_MS) stop();
          return;
        }
      }
      let handle;
      try {
        handle = await fs.open(filePath, 'r');
      } catch {
        return;
      }
      try {
        const { size } = await handle.stat();
        if (size <= offset) return;
        const length = size - offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        offset = size;
        const text = `${carry}${buffer.toString('utf8')}`;
        const lines = text.split(/\r?\n/);
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }
          try {
            onLine(parsed);
          } catch {}
        }
      } finally {
        await handle.close();
      }
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), SUBAGENT_TAIL_POLL_MS);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  return {
    stop,
    // One last read before stopping — catches lines flushed to disk just
    // before the provider announced the subagent finished.
    finish: async () => {
      await poll();
      stop();
    },
  };
};

const SUBAGENT_REASONING_EMIT_MS = 200;

const createSubagentTracker = ({ providerId, threadId, getSender, getRunId }) => {
  const subagents = new Map();

  const emit = (event) => {
    const sender = getSender();
    if (!sender || sender.isDestroyed()) return;
    emitAgentEvent(sender, { runId: getRunId(), threadId, ...event });
  };

  const emitMeta = (sub, patch = {}) => {
    Object.assign(sub.meta, patch);
    emit({ type: 'subagent', subagent: { ...sub.meta } });
  };

  const sendReasoning = (sub, status = 'running') => {
    const detail = sub.reasoningText.trim();
    if (!detail) return;
    emit({
      type: 'subagent-activity',
      subagentId: sub.meta.id,
      activity: { key: 'reasoning', type: 'thought', title: 'Reasoning', detail, status },
    });
  };

  const flushReasoning = (sub, status) => {
    if (sub.reasoningTimer) {
      clearTimeout(sub.reasoningTimer);
      sub.reasoningTimer = null;
    }
    sendReasoning(sub, status);
  };

  // The stream helpers each subagent's line handler writes through. Mirrors
  // the main-run pipeline: text chunks, throttled reasoning card, tool
  // activities resolved in place via key/updateForKey.
  const createApi = (sub) => ({
    text: (chunk) => {
      if (!chunk) return;
      emit({ type: 'subagent-chunk', subagentId: sub.meta.id, chunk });
    },
    reasoning: (delta) => {
      if (!delta) return;
      sub.reasoningText = `${sub.reasoningText}${delta}`;
      const elapsed = Date.now() - sub.lastReasoningAt;
      if (elapsed >= SUBAGENT_REASONING_EMIT_MS) {
        sub.lastReasoningAt = Date.now();
        sendReasoning(sub);
        return;
      }
      if (sub.reasoningTimer) return;
      sub.reasoningTimer = setTimeout(() => {
        sub.reasoningTimer = null;
        sub.lastReasoningAt = Date.now();
        sendReasoning(sub);
      }, SUBAGENT_REASONING_EMIT_MS - elapsed);
    },
    activity: ({ updateForKey, ...activity }) => {
      if (updateForKey) {
        const known = sub.knownToolActivities.get(updateForKey);
        if (known) {
          emit({
            type: 'subagent-activity',
            subagentId: sub.meta.id,
            activity: {
              ...known,
              key: updateForKey,
              status: activity.status === 'error' || activity.type === 'error' ? 'error' : 'done',
            },
          });
          return;
        }
      }
      if (activity.key) {
        const { key, status, ...rest } = activity;
        sub.knownToolActivities.set(key, rest);
      }
      emit({ type: 'subagent-activity', subagentId: sub.meta.id, activity });
    },
    stats: (stats) => {
      sub.meta.stats = { ...sub.meta.stats, ...stats };
    },
    prompt: (prompt) => {
      if (!sub.meta.prompt && prompt) emitMeta(sub, { prompt });
    },
    finish: (info) => finish(sub.meta.id, info),
  });

  const start = (meta, { resolveFile, handleLine }) => {
    if (!meta?.id || subagents.has(meta.id)) return;
    const sub = {
      meta: { providerId, status: 'running', startedAt: Date.now(), ...meta },
      knownToolActivities: new Map(),
      reasoningText: '',
      reasoningTimer: null,
      lastReasoningAt: 0,
      ctx: {},
      finished: false,
      finishTimer: null,
    };
    subagents.set(meta.id, sub);
    emitMeta(sub);
    const api = createApi(sub);
    sub.tailer = createJsonlTailer({
      resolveFile,
      onLine: (value) => handleLine(value, api, sub.ctx),
    });
  };

  const finish = (id, { status = 'done', stats, summary } = {}) => {
    const sub = subagents.get(id);
    if (!sub || sub.finished) return;
    sub.finished = true;
    if (sub.finishTimer) {
      clearTimeout(sub.finishTimer);
      sub.finishTimer = null;
    }
    void (async () => {
      // Some CLIs (cursor) flush the subagent transcript to disk only at
      // completion, so the "finished" signal can beat the file write. Give
      // the file a moment before the final read.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await sub.tailer?.finish();
      } catch {}
      flushReasoning(sub, 'done');
      emitMeta(sub, {
        status,
        completedAt: Date.now(),
        ...(stats ? { stats: { ...sub.meta.stats, ...stats } } : {}),
        ...(summary ? { summary } : {}),
      });
    })();
  };

  // Finish after a short delay unless a richer signal (one carrying stats or
  // a summary) lands first — e.g. claude's task_updated vs task_notification.
  const finishSoon = (id, info, delayMs = 2500) => {
    const sub = subagents.get(id);
    if (!sub || sub.finished || sub.finishTimer) return;
    sub.finishTimer = setTimeout(() => {
      sub.finishTimer = null;
      finish(id, info);
    }, delayMs);
  };

  const dispose = (status = 'done') => {
    for (const [id, sub] of subagents) {
      if (!sub.finished) finish(id, { status });
    }
  };

  return {
    start,
    finish,
    finishSoon,
    has: (id) => subagents.has(id),
    ids: () => [...subagents.keys()],
    dispose,
  };
};

// --- claude: the task output file is session-transcript JSONL ---------------

const claudeTaskOutputCandidates = (projectPath, sessionId, taskId) => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const slug = String(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
  const bases = [];
  if (uid !== null) bases.push(path.join('/tmp', `claude-${uid}`));
  bases.push(path.join(os.tmpdir(), uid !== null ? `claude-${uid}` : 'claude'));
  return [...new Set(bases)].map((base) =>
    path.join(base, slug, sessionId, 'tasks', `${taskId}.output`)
  );
};

const handleClaudeSubagentLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'assistant' && Array.isArray(value.message?.content)) {
    for (const part of value.message.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string' && part.text) {
        api.text(ctx.textSeen ? `\n\n${part.text}` : part.text);
        ctx.textSeen = true;
      } else if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking) {
        api.reasoning(`${part.thinking}\n\n`);
      }
    }
  }
  // tool_use blocks (assistant lines) and tool_result blocks (user lines).
  for (const activity of extractActivitiesFromJsonEvent(value)) api.activity(activity);
};

// --- cursor: agent-transcripts/<agentId>/<agentId>.jsonl --------------------

const cursorAgentTranscriptFile = async (projectPath, agentId) => {
  const projectsDir = path.join(os.homedir(), '.cursor', 'projects');
  const slug = String(projectPath).replace(/^\//, '').replace(/\//g, '-');
  const direct = path.join(projectsDir, slug, 'agent-transcripts', agentId, `${agentId}.jsonl`);
  if (existsSync(direct)) return direct;
  // Slug rules vary across cursor versions; the agentId is globally unique,
  // so scan the project dirs for it.
  try {
    const entries = await fs.readdir(projectsDir);
    for (const entry of entries) {
      const candidate = path.join(
        projectsDir,
        entry,
        'agent-transcripts',
        agentId,
        `${agentId}.jsonl`
      );
      if (existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
};

const handleCursorSubagentLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'turn_ended') {
    api.finish({ status: !value.status || value.status === 'success' ? 'done' : 'error' });
    return;
  }
  if (value.role === 'assistant' && Array.isArray(value.message?.content)) {
    const text = value.message.content
      .map((part) =>
        part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
          ? part.text
          : ''
      )
      .join('')
      // cursor redacts tool-call payloads inside transcript text blocks.
      .replace(/\n?\[REDACTED\]/g, '')
      .trim();
    if (text) {
      api.text(ctx.textSeen ? `\n\n${text}` : text);
      ctx.textSeen = true;
    }
  }
  for (const activity of extractActivitiesFromJsonEvent(value)) api.activity(activity);
};

// --- codex: subagent rollout files under ~/.codex/sessions ------------------

const codexSessionDayDirs = () => {
  const dirs = [];
  const now = Date.now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(now - dayOffset * 86400000);
    dirs.push(
      path.join(
        os.homedir(),
        '.codex',
        'sessions',
        String(day.getFullYear()),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0')
      )
    );
  }
  return dirs;
};

const readFirstJsonLine = async (filePath) => {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    // A rollout's session_meta line embeds the full harness instructions and
    // can run well past any fixed small buffer — read chunks until the first
    // newline (capped so a corrupt file can't balloon memory).
    const CHUNK = 65536;
    const MAX = 4 * 1024 * 1024;
    let collected = Buffer.alloc(0);
    let offset = 0;
    while (collected.length < MAX) {
      const buffer = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, offset);
      if (bytesRead <= 0) return null;
      collected = Buffer.concat([collected, buffer.subarray(0, bytesRead)]);
      const newline = collected.indexOf(0x0a);
      if (newline >= 0) return JSON.parse(collected.toString('utf8', 0, newline));
      if (bytesRead < CHUNK) return null;
      offset += bytesRead;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
};

// exec --json's collab items never carry receiver thread ids (experimental
// serialization gap, verified on codex 0.144.5), so spawns are detected from
// the filesystem: a new rollout whose session_meta names this thread as its
// spawn parent is a subagent of this run.
const watchCodexSubagentSpawns = ({ parentThreadId, onSpawn }) => {
  const seen = new Set();
  // Baseline every rollout that already exists before this run starts. A
  // resumed parent keeps the same thread id across turns, so a time-window
  // lookback would rediscover the previous turn's recent subagents and tail
  // their transcripts again from offset zero.
  for (const dir of codexSessionDayDirs()) {
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('rollout-') && name.endsWith('.jsonl')) seen.add(name);
      }
    } catch {
      // Missing day directory; the poller will pick it up if it appears.
    }
  }
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      for (const dir of codexSessionDayDirs()) {
        let entries;
        try {
          entries = await fs.readdir(dir);
        } catch {
          continue;
        }
        for (const name of entries) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl') || seen.has(name)) continue;
          const filePath = path.join(dir, name);
          const head = await readFirstJsonLine(filePath);
          // First line not flushed yet — leave it for the next poll.
          if (!head) continue;
          seen.add(name);
          const spawn = head?.payload?.source?.subagent?.thread_spawn;
          const childThreadId = head?.payload?.id;
          if (!spawn || !childThreadId || spawn.parent_thread_id !== parentThreadId) continue;
          onSpawn({
            threadId: childThreadId,
            nickname: typeof spawn.agent_nickname === 'string' ? spawn.agent_nickname : undefined,
            role: typeof spawn.agent_role === 'string' ? spawn.agent_role : undefined,
            filePath,
          });
        }
      }
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), 1000);
  void poll();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};

const codexRolloutCommandSummary = (raw) => {
  const command = Array.isArray(raw) ? raw.join(' ') : raw;
  return stringifySummary(command, 80);
};

// Subagent rollouts come in two shapes. Fresh-context, role-based spawns hold
// only the subagent's own transcript (their thread_spawn has agent_role but no
// agent_path). Collaboration spawns carry an agent_path and replay the parent
// history before inter_agent_communication_metadata, where the NEW_TASK
// envelope starts the subagent's own work. Current Codex rollouts do not add a
// second session_meta before that replay, so the source metadata — not the
// number of session_meta lines — must decide whether the prefix is live.
const handleCodexRolloutLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'session_meta') {
    const spawn = value.payload?.source?.subagent?.thread_spawn;
    if (spawn && typeof spawn === 'object') {
      ctx.forked = typeof spawn.agent_path === 'string' && spawn.agent_path.length > 0;
      ctx.decided = true;
      ctx.live = !ctx.forked;
    }
    return;
  }
  if (!ctx.decided) {
    // Older/unknown rollout sources have no thread_spawn metadata. Preserve
    // the historical fresh-context behavior for those files.
    ctx.decided = true;
    ctx.live = true;
  }
  if (value.type === 'inter_agent_communication_metadata') {
    ctx.live = true;
    return;
  }
  if (!ctx.live) return;
  const payload = value.payload;
  if (!payload || typeof payload !== 'object') return;

  if (value.type === 'event_msg') {
    switch (payload.type) {
      case 'agent_message': {
        if (typeof payload.message === 'string' && payload.message) {
          api.text(ctx.textSeen ? `\n\n${payload.message}` : payload.message);
          ctx.textSeen = true;
        }
        return;
      }
      case 'agent_reasoning': {
        if (typeof payload.text === 'string' && payload.text) api.reasoning(`${payload.text}\n\n`);
        return;
      }
      case 'user_message': {
        // Fresh-context spawns deliver the spawn prompt as the first user
        // message of the subagent's own transcript.
        if (!ctx.promptSeen && typeof payload.message === 'string' && payload.message) {
          ctx.promptSeen = true;
          api.prompt(payload.message);
        }
        return;
      }
      case 'exec_command_begin': {
        api.activity({
          key: typeof payload.call_id === 'string' ? payload.call_id : undefined,
          type: 'command',
          title: `Command - ${codexRolloutCommandSummary(payload.command)}`,
          detail: codexRolloutCommandSummary(payload.command),
          status: 'running',
        });
        return;
      }
      case 'exec_command_end': {
        if (typeof payload.call_id === 'string') {
          api.activity({
            updateForKey: payload.call_id,
            type: 'result',
            title: 'Command finished',
            status:
              typeof payload.exit_code === 'number' && payload.exit_code !== 0
                ? 'error'
                : 'done',
          });
        }
        return;
      }
      case 'patch_apply_end': {
        api.activity({ type: 'tool', title: 'File changes applied', status: 'done' });
        return;
      }
      case 'token_count': {
        const total = payload.info?.total_token_usage?.total_tokens;
        if (typeof total === 'number') api.stats({ totalTokens: total });
        return;
      }
      case 'task_complete': {
        api.finish({ status: 'done' });
        return;
      }
      default:
        return;
    }
  }

  if (value.type === 'response_item') {
    if (payload.type === 'agent_message' && typeof payload.message === 'string') {
      // The NEW_TASK envelope repeats the spawn prompt — surface it as the
      // subagent's prompt, not as transcript text.
      if (!ctx.promptSeen && payload.message.startsWith('Message Type:')) {
        ctx.promptSeen = true;
        const idx = payload.message.indexOf('Payload:');
        if (idx >= 0) api.prompt(payload.message.slice(idx + 'Payload:'.length).trim());
      }
      return;
    }
    if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
      const input = typeof payload.input === 'string' ? payload.input : payload.arguments;
      api.activity({
        key: typeof payload.call_id === 'string' ? payload.call_id : undefined,
        type: payload.name === 'exec' ? 'command' : 'tool',
        title:
          payload.name === 'exec'
            ? `Command - ${stringifySummary(input, 80)}`
            : `Tool - ${payload.name ?? 'call'}`,
        detail: stringifySummary(input),
        status: 'running',
      });
      return;
    }
    if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      if (typeof payload.call_id === 'string') {
        api.activity({
          updateForKey: payload.call_id,
          type: 'result',
          title: 'Tool result',
          status: 'done',
        });
      }
    }
  }
};

// --- grok: <session dir>/updates.jsonl holds raw session/update lines -------

const grokSubagentUpdatesFile = (projectPath, childSessionId) =>
  path.join(
    os.homedir(),
    '.grok',
    'sessions',
    encodeURIComponent(String(projectPath)),
    childSessionId,
    'updates.jsonl'
  );

// Compact sibling of the ACP driver's upsertToolCall — same update shapes,
// minus streaming-argument previews and permission states, which never
// appear in a subagent's persisted updates file.
const handleGrokSubagentLine = (value, api, ctx) => {
  const update = value?.params?.update;
  if (!update || typeof update !== 'object') return;
  const kind = update.sessionUpdate;

  if (kind === 'user_message_chunk') {
    // The first user message is the spawn prompt — surface it as metadata
    // (the subagent_spawned notification itself only carries a description).
    if (!ctx.promptSeen) {
      ctx.promptSeen = true;
      const text = update.content?.text;
      if (typeof text === 'string' && text) api.prompt(text);
    }
    return;
  }
  if (kind === 'agent_thought_chunk') {
    const text = update.content?.text;
    if (typeof text === 'string' && text) api.reasoning(text);
    return;
  }
  if (kind === 'agent_message_chunk') {
    const text = update.content?.text;
    if (typeof text !== 'string' || !text) return;
    api.text(ctx.pendingBreak && ctx.textSeen ? `\n\n${text}` : text);
    ctx.pendingBreak = false;
    ctx.textSeen = true;
    return;
  }
  if (kind === 'plan') {
    const list = Array.isArray(update.entries) ? update.entries : [];
    const completed = list.filter((entry) => entry?.status === 'completed').length;
    api.activity({
      key: 'plan',
      type: 'plan',
      kind: 'plan',
      title: `Tasks (${completed}/${list.length})`,
      status: list.length > 0 && completed === list.length ? 'done' : 'running',
      plan: list.map((entry) => ({
        content: String(entry?.content ?? ''),
        status:
          entry?.status === 'completed'
            ? 'completed'
            : entry?.status === 'in_progress'
              ? 'in_progress'
              : 'pending',
      })),
    });
    return;
  }
  if (kind !== 'tool_call' && kind !== 'tool_call_update') return;

  if (ctx.textSeen) ctx.pendingBreak = true;
  const id = update.toolCallId;
  if (typeof id !== 'string' || !id) return;
  if (!ctx.calls) ctx.calls = new Map();
  let state = ctx.calls.get(id);
  if (!state) {
    state = { status: 'running' };
    ctx.calls.set(id, state);
  }

  const meta = update._meta?.['x.ai/tool'] ?? null;
  if (typeof meta?.name === 'string') state.toolName = meta.name;
  else if (kind === 'tool_call' && typeof update.title === 'string' && GROK_TOOL_LABELS[update.title]) {
    state.toolName = update.title;
  }
  const toolKind = update.kind ?? meta?.kind ?? state.kind ?? grokToolKindForName(state.toolName);
  if (toolKind) state.kind = toolKind === 'write' ? 'edit' : toolKind;
  if (typeof update.title === 'string' && update.title) state.grokTitle = update.title;

  const rawInput = update.rawInput;
  if (rawInput && typeof rawInput === 'object') {
    if (typeof rawInput.command === 'string') state.command = rawInput.command;
    const filePath = rawInput.file_path ?? rawInput.path;
    if (typeof filePath === 'string') state.filePath = filePath;
    if (typeof rawInput.query === 'string') state.query = rawInput.query;
    if (typeof rawInput.url === 'string') state.query = rawInput.url;
  }
  if (Array.isArray(update.content)) {
    for (const entry of update.content) {
      if (entry?.type === 'diff' && typeof entry.path === 'string') {
        state.filePath = entry.path;
        state.diff = {
          path: entry.path,
          additions: countDiffLines(entry.newText),
          deletions: countDiffLines(entry.oldText),
        };
      }
      if (entry?.type === 'content' && typeof entry.content?.text === 'string' && entry.content.text) {
        state.output = entry.content.text;
      }
    }
  }
  const rawOutput = update.rawOutput;
  if (rawOutput && typeof rawOutput === 'object') {
    if (typeof rawOutput.exit_code === 'number') state.exitCode = rawOutput.exit_code;
    if (
      !state.output &&
      typeof rawOutput.output_for_prompt === 'string' &&
      rawOutput.output_for_prompt.trim()
    ) {
      state.output = rawOutput.output_for_prompt;
    }
  }
  if (update.status === 'completed') state.status = 'done';
  else if (update.status === 'failed' || update.status === 'cancelled') state.status = 'error';
  if (typeof state.exitCode === 'number' && state.exitCode !== 0) state.status = 'error';

  const label = state.toolName
    ? grokToolLabel(state.toolName)
    : { execute: 'Command', edit: 'Edit', read: 'Read', search: 'Web search', fetch: 'Web fetch', task: 'Subagent' }[
        state.kind
      ] ?? 'Tool';
  const activity = {
    key: id,
    type: state.kind === 'execute' ? 'command' : 'tool',
    title:
      state.kind === 'execute' && state.command
        ? `Command - ${stringifySummary(state.command, 80)}`
        : (state.kind === 'search' || state.kind === 'fetch') && state.query
          ? `${label} - ${stringifySummary(state.query, 80)}`
          : state.filePath
            ? `${label} - ${stringifySummary(state.filePath, 80)}`
            : state.grokTitle || label,
    status: state.status,
  };
  if (state.kind) activity.kind = state.kind;
  if (state.command) activity.detail = state.command;
  else if (state.query) activity.detail = state.query;
  else if (state.filePath) activity.detail = state.filePath;
  if (state.output) activity.output = state.output.slice(-4000);
  if (typeof state.exitCode === 'number') activity.exitCode = state.exitCode;
  if (state.diff) activity.diff = state.diff;
  api.activity(activity);
};

// ---------------------------------------------------------------------------
// Grok ACP driver. grok's headless streaming-json format only ever emits
// token-level thought/text events — no tool calls — so real turns run
// `grok agent stdio` and speak ACP (line-delimited JSON-RPC) instead. That
// stream carries tool calls with live terminal output and file diffs, plan
// (todo-list) updates, streaming tool-argument deltas, permission requests
// Orion answers programmatically, and per-turn token counts. The driver
// translates ACP messages into the same normalized turn events the other
// providers' adapters produce.

const GROK_TOOL_LABELS = {
  write: 'Write',
  edit: 'Edit',
  read: 'Read',
  run_terminal_command: 'Command',
  web_search: 'Web search',
  web_fetch: 'Web fetch',
  task: 'Subagent',
};

const grokToolKindForName = (name) => {
  if (name === 'write' || name === 'edit') return 'edit';
  if (name === 'run_terminal_command') return 'execute';
  if (name === 'read') return 'read';
  if (name === 'web_search') return 'search';
  if (name === 'web_fetch') return 'fetch';
  if (name === 'task') return 'task';
  return undefined;
};

const grokToolLabel = (name) => {
  if (!name) return 'Tool';
  return (
    GROK_TOOL_LABELS[name] ??
    name.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
  );
};

const countDiffLines = (text) => {
  if (typeof text !== 'string' || !text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};

const grokStatsFromPromptMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const stats = {};
  for (const key of [
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cachedReadTokens',
    'reasoningTokens',
  ]) {
    if (typeof meta[key] === 'number') stats[key] = meta[key];
  }
  if (typeof meta.modelId === 'string') stats.modelId = meta.modelId;
  return Object.keys(stats).length ? stats : null;
};

const createGrokAcpDriver = ({ child, cwd, promptText, resumeSessionId, accessMode, callbacks }) => {
  let nextRequestId = 1;
  const pendingRequests = new Map();
  const toolCalls = new Map();
  const toolIndexToCallId = new Map();
  // session/load replays the whole prior conversation as session/update
  // notifications before its response resolves; Orion keeps its own
  // transcript, so the replay is suppressed.
  let replayingSession = false;
  let textSeen = false;
  let pendingTextBreak = false;

  const write = (message) => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {}
  };

  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextRequestId++;
      pendingRequests.set(id, resolve);
      write({ jsonrpc: '2.0', id, method, params });
    });

  const toolMeta = (value) =>
    value && typeof value === 'object' ? value._meta?.['x.ai/tool'] ?? null : null;

  const buildActivity = (state) => {
    const activity = {
      key: state.id,
      type: state.kind === 'execute' ? 'command' : 'tool',
      title: state.title || grokToolLabel(state.toolName),
      status: state.status ?? 'running',
    };
    if (state.kind) activity.kind = state.kind;
    if (state.detail) activity.detail = state.detail;
    // Cap live output so a chatty command doesn't bloat the persisted store.
    if (state.output) activity.output = state.output.slice(-4000);
    if (typeof state.exitCode === 'number') activity.exitCode = state.exitCode;
    if (state.diff) activity.diff = state.diff;
    if (state.sources?.length) activity.sources = state.sources;
    return activity;
  };

  // Streaming terminal output can update many times a second; throttle
  // output-only refreshes like the reasoning card, but always emit status
  // changes immediately.
  const TOOL_EMIT_INTERVAL_MS = 130;
  const emitToolActivity = (state, immediate) => {
    const send = () => {
      state.emitTimer = null;
      state.lastEmitAt = Date.now();
      callbacks.onActivity(buildActivity(state));
    };
    if (immediate || Date.now() - (state.lastEmitAt ?? 0) >= TOOL_EMIT_INTERVAL_MS) {
      if (state.emitTimer) {
        clearTimeout(state.emitTimer);
        state.emitTimer = null;
      }
      send();
      return;
    }
    if (!state.emitTimer) state.emitTimer = setTimeout(send, TOOL_EMIT_INTERVAL_MS);
  };

  const flushToolEmits = () => {
    for (const state of toolCalls.values()) {
      if (state.emitTimer) {
        clearTimeout(state.emitTimer);
        state.emitTimer = null;
        callbacks.onActivity(buildActivity(state));
      }
    }
  };

  const refreshToolPresentation = (state) => {
    // Backend tools (web search) never stream a tool name — fall back to a
    // label derived from the ACP kind.
    const kindLabels = {
      execute: 'Command',
      edit: 'Edit',
      read: 'Read',
      search: 'Web search',
      fetch: 'Web fetch',
      task: 'Subagent',
    };
    const label = state.toolName
      ? grokToolLabel(state.toolName)
      : kindLabels[state.kind] ?? 'Tool';
    // Drop the transient "Preparing…" detail once the real tool call lands —
    // tools with no path/command/query (e.g. todo updates) would otherwise
    // keep it forever.
    if (!state.preparing && state.preparingDetail) {
      state.detail = undefined;
      state.preparingDetail = false;
    }
    if (state.kind === 'execute' && state.command) {
      state.title = `Command - ${stringifySummary(state.command, 80)}`;
      state.detail = state.command;
    } else if ((state.kind === 'search' || state.kind === 'fetch') && state.query) {
      state.title = `${label} - ${stringifySummary(state.query, 80)}`;
      state.detail = state.query;
    } else if (state.filePath) {
      state.title = `${label} - ${stringifySummary(state.filePath, 80)}`;
      state.detail = state.filePath;
    } else if (state.preparing) {
      // Argument deltas stream before the tool_call lands — show the tool as
      // soon as the model starts writing its input (a large file write can
      // take a while to generate).
      state.title = label;
      state.detail = state.argsLength
        ? `Preparing… (${state.argsLength.toLocaleString()} chars)`
        : 'Preparing…';
      state.preparingDetail = true;
    } else if (state.grokTitle) {
      state.title = state.grokTitle;
    }
  };

  const getToolState = (id) => {
    let state = toolCalls.get(id);
    if (!state) {
      state = { id, status: 'running', preparing: false, argsLength: 0 };
      toolCalls.set(id, state);
    }
    return state;
  };

  const upsertToolCall = (update, isNew) => {
    const id = update.toolCallId;
    if (typeof id !== 'string' || !id) return;
    const created = !toolCalls.has(id);
    const state = getToolState(id);
    const previousStatus = state.status;
    state.preparing = false;

    const meta = toolMeta(update);
    if (typeof meta?.name === 'string') state.toolName = meta.name;
    else if (isNew && typeof update.title === 'string' && GROK_TOOL_LABELS[update.title]) {
      state.toolName = update.title;
    }
    const kind = update.kind ?? meta?.kind ?? state.kind ?? grokToolKindForName(state.toolName);
    if (kind) state.kind = kind === 'write' ? 'edit' : kind;
    if (typeof update.title === 'string' && update.title) state.grokTitle = update.title;

    const rawInput = update.rawInput;
    if (rawInput && typeof rawInput === 'object') {
      if (typeof rawInput.command === 'string') state.command = rawInput.command;
      const filePath = rawInput.file_path ?? rawInput.path;
      if (typeof filePath === 'string') state.filePath = filePath;
      if (typeof rawInput.query === 'string') state.query = rawInput.query;
      if (typeof rawInput.url === 'string') state.query = rawInput.url;
      // use_tool indirection: the real MCP tool name (e.g.
      // orion__spawn_subagent) only appears here, and answerPermission needs
      // it to recognize Orion's own spawn tool.
      if (typeof rawInput.tool_name === 'string') state.rawInputToolName = rawInput.tool_name;
    }

    if (Array.isArray(update.content)) {
      for (const entry of update.content) {
        if (entry?.type === 'diff' && typeof entry.path === 'string') {
          state.filePath = entry.path;
          state.diff = {
            path: entry.path,
            additions: countDiffLines(entry.newText),
            deletions: countDiffLines(entry.oldText),
          };
        }
        // Terminal output streams as cumulative text snapshots.
        if (entry?.type === 'content' && typeof entry.content?.text === 'string' && entry.content.text) {
          state.output = entry.content.text;
        }
      }
    }

    const rawOutput = update.rawOutput;
    if (rawOutput && typeof rawOutput === 'object') {
      if (typeof rawOutput.exit_code === 'number') state.exitCode = rawOutput.exit_code;
      if (
        !state.output &&
        typeof rawOutput.output_for_prompt === 'string' &&
        rawOutput.output_for_prompt.trim()
      ) {
        state.output = rawOutput.output_for_prompt;
      }
      const action = rawOutput.action;
      if (action && typeof action === 'object') {
        if (typeof action.query === 'string') state.query = action.query;
        if (Array.isArray(action.sources)) {
          const sources = action.sources
            .map((source) => (typeof source?.url === 'string' ? { url: source.url } : null))
            .filter(Boolean);
          if (sources.length) state.sources = sources;
        }
      }
    }

    if (update.status === 'completed') state.status = 'done';
    else if (update.status === 'failed' || update.status === 'cancelled') state.status = 'error';
    else if (update.status === 'pending' || update.status === 'in_progress') {
      if (state.status !== 'error') state.status = 'running';
    }
    if (typeof state.exitCode === 'number' && state.exitCode !== 0) state.status = 'error';

    refreshToolPresentation(state);
    emitToolActivity(state, created || state.status !== previousStatus);
  };

  const handlePlanUpdate = (entries) => {
    const list = Array.isArray(entries) ? entries : [];
    const total = list.length;
    const completed = list.filter((entry) => entry?.status === 'completed').length;
    const active = list.find((entry) => entry?.status === 'in_progress');
    callbacks.onActivity({
      key: 'plan',
      type: 'plan',
      kind: 'plan',
      title: active
        ? `Tasks (${completed}/${total}) - ${stringifySummary(active.content, 60)}`
        : `Tasks (${completed}/${total})`,
      status: total > 0 && completed === total ? 'done' : 'running',
      plan: list.map((entry) => ({
        content: String(entry?.content ?? ''),
        status:
          entry?.status === 'completed'
            ? 'completed'
            : entry?.status === 'in_progress'
              ? 'in_progress'
              : 'pending',
      })),
    });
  };

  const handleXaiUpdate = (update) => {
    const kind = update?.sessionUpdate;
    if (kind === 'tool_call_delta_chunk') {
      if (typeof update.tool_index === 'number' && typeof update.tool_call_id === 'string') {
        toolIndexToCallId.set(update.tool_index, update.tool_call_id);
      }
      const callId =
        typeof update.tool_call_id === 'string'
          ? update.tool_call_id
          : toolIndexToCallId.get(update.tool_index);
      if (!callId) return;
      const created = !toolCalls.has(callId);
      const state = getToolState(callId);
      if (created) state.preparing = true;
      if (!state.preparing) return;
      if (typeof update.name === 'string' && update.name) {
        state.toolName = update.name;
        state.kind = grokToolKindForName(update.name);
      }
      if (typeof update.arguments_delta === 'string') {
        state.argsLength = (state.argsLength ?? 0) + update.arguments_delta.length;
      }
      refreshToolPresentation(state);
      emitToolActivity(state, created);
      return;
    }
    if (kind === 'pending_interaction' && update.kind === 'permission') {
      const state = toolCalls.get(update.tool_call_id);
      if (state && state.status === 'running') {
        state.status = 'waiting';
        emitToolActivity(state, true);
      }
      return;
    }
    if (kind === 'interaction_resolved') {
      const state = toolCalls.get(update.tool_call_id);
      if (state && state.status === 'waiting') {
        state.status = 'running';
        emitToolActivity(state, true);
      }
    }
  };

  // Approvals are answered by access-mode policy: Read only allows read-only
  // tools; Workspace write additionally allows edits but not commands. This
  // replaces the old headless behavior where a denied tool cancelled the
  // whole turn — now the model is told no and keeps going.
  const answerPermission = (message) => {
    const params = message.params ?? {};
    const toolCall = params.toolCall ?? {};
    const meta = toolMeta(toolCall);
    const known = typeof toolCall.toolCallId === 'string' ? toolCalls.get(toolCall.toolCallId) : null;
    const kind = toolCall.kind ?? meta?.kind ?? known?.kind;
    const readOnly =
      meta?.read_only === true || kind === 'read' || kind === 'search' || kind === 'fetch';
    // Orion's own spawn_subagent MCP tool is safe in every mode: the spawned
    // subthread runs with the driver thread's access mode, never more. Grok
    // routes MCP calls through use_tool, whose rawInput.tool_name is the
    // qualified MCP identity. Titles and wrapper metadata are presentation
    // fields and must not grant an exemption.
    const grokMcpToolName =
      typeof toolCall.rawInput?.tool_name === 'string'
        ? toolCall.rawInput.tool_name
        : known?.rawInputToolName;
    const isOrionSpawn = grokMcpToolName === 'orion__spawn_subagent';
    const allow =
      isOrionSpawn || accessMode === 'full-access'
        ? true
        : accessMode === 'workspace-write'
          ? readOnly || kind !== 'execute'
          : readOnly;

    const options = Array.isArray(params.options) ? params.options : [];
    const pick = (kinds, pattern) =>
      kinds.map((wanted) => options.find((option) => option?.kind === wanted)).find(Boolean) ??
      options.find((option) => pattern.test(`${option?.optionId ?? ''} ${option?.name ?? ''}`));
    const chosen = allow
      ? pick(['allow_once', 'allow_always'], /allow|approve|yes/i) ?? options[0]
      : pick(['reject_once', 'reject_always'], /reject|deny|no/i);

    write(
      chosen
        ? {
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: chosen.optionId } },
          }
        : { jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }
    );

    if (!allow && known) {
      known.status = 'error';
      known.output = `Skipped — ${
        accessMode === 'read-only' ? 'Read only' : 'Workspace write'
      } mode doesn't permit this tool. Switch to Full Access to allow it.`;
      emitToolActivity(known, true);
    }
  };

  const fail = (error) => {
    flushToolEmits();
    callbacks.onFatal(
      typeof error === 'string' ? error : error?.message ?? 'Grok agent protocol error.'
    );
  };

  const start = async () => {
    const init = await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    if (init.error) return fail(init.error);

    let sessionId = null;
    if (resumeSessionId) {
      replayingSession = true;
      const loaded = await request('session/load', {
        sessionId: resumeSessionId,
        cwd,
        mcpServers: [],
      });
      replayingSession = false;
      if (loaded.error) callbacks.onResumeFallback?.();
      else sessionId = resumeSessionId;
    }
    if (!sessionId) {
      const created = await request('session/new', { cwd, mcpServers: [] });
      if (created.error || typeof created.result?.sessionId !== 'string') {
        return fail(created.error ?? 'Grok agent did not return a session id.');
      }
      sessionId = created.result.sessionId;
    }
    callbacks.onSessionId(sessionId);

    // grok agent's default permission mode auto-approves "safe" operations,
    // which is too permissive for Orion's gated modes — pin the session to
    // the mode matching the thread's access level (verified live: set_mode
    // 'plan' blocks writes even though session/new advertises no modes).
    // Full access is covered by --always-approve at spawn.
    if (accessMode !== 'full-access') {
      await request('session/set_mode', {
        sessionId,
        modeId: accessMode === 'read-only' ? 'plan' : 'acceptEdits',
      });
    }

    const response = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    });
    flushToolEmits();
    if (response.error) return fail(response.error);
    callbacks.onTurnEnd(response.result ?? {});
  };

  const handleMessage = (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && !message.method) {
      const resolve = pendingRequests.get(message.id);
      if (resolve) {
        pendingRequests.delete(message.id);
        resolve(message);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      if (message.method === 'session/request_permission') return answerPermission(message);
      write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not supported' },
      });
      return;
    }

    if (replayingSession) return;
    const update =
      message.method === 'session/update' || message.method === '_x.ai/session_notification'
        ? message.params?.update
        : null;
    if (!update || typeof update !== 'object') return;

    const kind = update.sessionUpdate;
    if (kind === 'agent_thought_chunk') {
      const text = update.content?.text;
      if (typeof text === 'string' && text) callbacks.onReasoning(text);
      return;
    }
    if (kind === 'agent_message_chunk') {
      const text = update.content?.text;
      if (typeof text !== 'string' || !text) return;
      const prefix = pendingTextBreak && textSeen ? '\n\n' : '';
      pendingTextBreak = false;
      textSeen = true;
      callbacks.onText(`${prefix}${text}`);
      return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      // Text resuming after tool activity is a new paragraph.
      if (textSeen) pendingTextBreak = true;
      upsertToolCall(update, kind === 'tool_call');
      return;
    }
    if (kind === 'plan') {
      handlePlanUpdate(update.entries);
      return;
    }
    // Subagent lifecycle (_x.ai notifications): handled by the run's
    // subagent tracker, which tails the child session's updates.jsonl.
    if (kind === 'subagent_spawned' || kind === 'subagent_finished') {
      callbacks.onSubagent?.(update);
      return;
    }
    handleXaiUpdate(update);
  };

  return { start, handleMessage };
};

// ---------------------------------------------------------------------------
// Kimi ACP driver. kimi's prompt mode (`kimi -p --output-format stream-json`)
// only emits whole chat messages — no streaming deltas, thinking, tool
// progress, or permission dialog — so real turns run `kimi acp` and speak ACP
// (line-delimited JSON-RPC) instead. That stream carries token-level text and
// thought chunks, tool calls with streamed argument previews, live status and
// terminal output, plan (todo) updates, and permission requests Orion answers
// programmatically. Model (session/set_config_option, configId "model") and
// permission mode (session/set_mode: plan/default/yolo) are pinned per
// session over the dialog; verified live on kimi-code 0.26.0.

const KIMI_TOOL_KINDS = {
  Bash: 'execute',
  Read: 'read',
  ReadMediaFile: 'read',
  Write: 'edit',
  Edit: 'edit',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  FetchURL: 'fetch',
  Agent: 'task',
  AgentSwarm: 'task',
};

const KIMI_TOOL_LABELS = {
  Bash: 'Command',
  Read: 'Read',
  ReadMediaFile: 'Read media',
  Write: 'Write',
  Edit: 'Edit',
  Grep: 'Grep',
  Glob: 'Glob',
  WebSearch: 'Web search',
  FetchURL: 'Web fetch',
  Agent: 'Subagent',
  AgentSwarm: 'Subagent swarm',
  TodoList: 'Tasks',
  Skill: 'Skill',
  AskUserQuestion: 'Question',
};

const kimiToolLabel = (name) => {
  if (!name) return 'Tool';
  return (
    KIMI_TOOL_LABELS[name] ??
    String(name)
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^\w/, (letter) => letter.toUpperCase())
  );
};

// Cumulative session token usage from the session's on-disk wire log — the
// ACP prompt response carries no usage metadata, but kimi appends a
// usage.record entry per LLM step. Summing the whole file gives cumulative
// totals for the session, matching how codex reports thread token usage.
const kimiStatsFromSessionDisk = async (sessionId) => {
  try {
    const entry = await findKimiSessionIndexEntry(sessionId);
    if (!entry?.sessionDir) return null;
    const wirePath = path.join(entry.sessionDir, 'agents', 'main', 'wire.jsonl');
    const content = await fs.readFile(wirePath, 'utf8');
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedReadTokens = 0;
    let modelId = null;
    let seen = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('"usage.record"')) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const record = parsed?.type === 'context.append_loop_event' ? parsed.event : parsed;
      if (record?.type !== 'usage.record' || !record.usage || typeof record.usage !== 'object') {
        continue;
      }
      seen = true;
      const usage = record.usage;
      inputTokens +=
        (usage.inputOther ?? 0) + (usage.inputCacheRead ?? 0) + (usage.inputCacheCreation ?? 0);
      outputTokens += usage.output ?? 0;
      cachedReadTokens += usage.inputCacheRead ?? 0;
      if (typeof record.model === 'string' && record.model) modelId = record.model;
    }
    if (!seen) return null;
    const stats = {
      inputTokens,
      outputTokens,
      cachedReadTokens,
      totalTokens: inputTokens + outputTokens,
    };
    if (modelId) stats.modelId = modelId;
    return stats;
  } catch {
    return null;
  }
};

// kimi's ACP layer reports a failed turn as a clean `end_turn` unless the
// failure is an auth error (turnEndReasonToStopReason maps `failed` →
// `end_turn`, verified on kimi-code 0.26.0), so a provider outage or API
// error looks identical to a successful empty response on the wire. The
// real error is only recorded in the session's log file:
//   WARN  acp: turn ended with failed reason  error="{\"code\":...}"
// Capture the current end of the session log before prompting so the
// completion check can inspect only records appended by this turn. A byte
// cursor avoids timestamp tolerances that can accidentally include a prior
// failed turn when the user retries quickly.
const kimiTurnFailureLogCursor = async (sessionId) => {
  try {
    const entry = await findKimiSessionIndexEntry(sessionId);
    if (!entry?.sessionDir) return 0;
    const logPath = path.join(entry.sessionDir, 'logs', 'kimi-code.log');
    const stat = await fs.stat(logPath);
    return stat.size;
  } catch {
    return 0;
  }
};

// Returns the error appended after `logCursor`, or null if this turn added no
// failure. If kimi rotates/truncates the log during the turn, scan the new
// file from its beginning rather than retaining an invalid cursor.
const kimiTurnFailureFromSessionDisk = async (sessionId, logCursor = 0) => {
  try {
    const entry = await findKimiSessionIndexEntry(sessionId);
    if (!entry?.sessionDir) return null;
    const logPath = path.join(entry.sessionDir, 'logs', 'kimi-code.log');
    const bytes = await fs.readFile(logPath);
    const offset =
      Number.isSafeInteger(logCursor) && logCursor >= 0 && logCursor <= bytes.length
        ? logCursor
        : 0;
    const content = bytes.subarray(offset).toString('utf8');
    const marker = 'acp: turn ended with failed reason';
    let lastError = null;
    for (const line of content.split('\n')) {
      if (!line.includes(marker)) continue;
      const match = line.match(/error="(.*)"\s*$/);
      if (!match) {
        lastError = 'Kimi turn failed.';
        continue;
      }
      try {
        // The logged value is a JSON object with backslash-escaped quotes —
        // a valid JSON string body, so unescape it with one string parse
        // and then parse the object it contains.
        const parsed = JSON.parse(JSON.parse(`"${match[1]}"`));
        lastError = typeof parsed?.message === 'string' && parsed.message ? parsed.message : 'Kimi turn failed.';
      } catch {
        lastError = 'Kimi turn failed.';
      }
    }
    return lastError;
  } catch {
    return null;
  }
};

// --- kimi native subagents (Agent / AgentSwarm tools) ------------------------
// Each spawned subagent runs as an in-process loop with its own wire log at
// <sessionDir>/agents/<agentId>/wire.jsonl (the main agent's transcript lives
// under agents/main/). Spawns are detected by watching the agents/ directory;
// pre-existing agents are baselined only for resumed sessions. For new
// sessions, an agent may appear while the session-index watcher is attaching,
// so existing directories must still be emitted.

const watchKimiSubagentSpawns = ({ sessionDir, baselineExisting, onSpawn }) => {
  const seen = new Set(['main']);
  const agentsDir = path.join(sessionDir, 'agents');
  if (baselineExisting) {
    try {
      for (const name of readdirSync(agentsDir)) seen.add(name);
    } catch {
      // agents/ not created yet; the poller picks it up when it appears.
    }
  }
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      let entries;
      try {
        entries = await fs.readdir(agentsDir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (seen.has(name)) continue;
        seen.add(name);
        onSpawn({
          agentId: name,
          wirePath: path.join(agentsDir, name, 'wire.jsonl'),
        });
      }
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), 1000);
  void poll();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};

// Translate a subagent's wire.jsonl into subagent turn events. Loop events
// are wrapped in context.append_loop_event envelopes; unwrap before matching.
const handleKimiSubagentLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  const event = value.type === 'context.append_loop_event' ? value.event : value;
  if (!event || typeof event !== 'object') return;

  if (event.type === 'turn.prompt') {
    if (!ctx.promptSeen) {
      ctx.promptSeen = true;
      const text = (Array.isArray(event.input) ? event.input : [])
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
      if (text) api.prompt(text);
    }
    return;
  }

  if (event.type === 'content.part') {
    const part = event.part;
    if (part?.type === 'think' && typeof part.think === 'string' && part.think) {
      api.reasoning(`${part.think}\n\n`);
    } else if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
      api.text(ctx.textSeen ? `\n\n${part.text}` : part.text);
      ctx.textSeen = true;
    }
    return;
  }

  if (event.type === 'tool.call') {
    const name = typeof event.name === 'string' ? event.name : '';
    const args = event.args && typeof event.args === 'object' ? event.args : {};
    const kind = KIMI_TOOL_KINDS[name];
    const label = kimiToolLabel(name);
    const detail =
      typeof args.command === 'string'
        ? args.command
        : typeof args.path === 'string'
          ? args.path
          : typeof args.query === 'string'
            ? args.query
            : typeof args.url === 'string'
              ? args.url
              : undefined;
    const activity = {
      key: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
      type: kind === 'execute' ? 'command' : 'tool',
      title: detail ? `${label} - ${stringifySummary(detail, 80)}` : label,
      status: 'running',
    };
    if (kind) activity.kind = kind;
    if (detail) activity.detail = detail;
    api.activity(activity);
    return;
  }

  if (event.type === 'tool.result') {
    if (typeof event.toolCallId === 'string') {
      api.activity({
        updateForKey: event.toolCallId,
        type: 'result',
        title: 'Tool result',
        status: event.result?.isError ? 'error' : 'done',
      });
    }
    return;
  }

  if (event.type === 'usage.record') {
    const usage = event.usage;
    if (usage && typeof usage === 'object') {
      ctx.totalTokens =
        (ctx.totalTokens ?? 0) +
        (usage.inputOther ?? 0) +
        (usage.inputCacheRead ?? 0) +
        (usage.inputCacheCreation ?? 0) +
        (usage.output ?? 0);
      api.stats({ totalTokens: ctx.totalTokens });
    }
    return;
  }

  // A step that ends without requesting tools is the end of the subagent's
  // loop — there is no dedicated finish marker in the wire log.
  if (event.type === 'step.end') {
    if (typeof event.finishReason === 'string' && event.finishReason !== 'tool_use') {
      api.finish({ status: 'done' });
    }
  }
};

const createKimiAcpDriver = ({ child, cwd, model, promptText, resumeSessionId, accessMode, mcpServers = [], callbacks }) => {
  let nextRequestId = 1;
  const pendingRequests = new Map();
  const toolCalls = new Map();
  // session/load replays the whole prior conversation as session/update
  // notifications before its response resolves; Orion keeps its own
  // transcript, so the replay is suppressed.
  let replayingSession = false;
  let textSeen = false;
  let pendingTextBreak = false;

  const write = (message) => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {}
  };

  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextRequestId++;
      pendingRequests.set(id, resolve);
      write({ jsonrpc: '2.0', id, method, params });
    });

  const buildActivity = (state) => {
    const activity = {
      key: state.id,
      type: state.kind === 'execute' ? 'command' : 'tool',
      title: state.title || kimiToolLabel(state.toolName),
      status: state.status ?? 'running',
    };
    if (state.kind) activity.kind = state.kind;
    if (state.detail) activity.detail = state.detail;
    // Cap live output so a chatty command doesn't bloat the persisted store.
    if (state.output) activity.output = state.output.slice(-4000);
    if (typeof state.exitCode === 'number') activity.exitCode = state.exitCode;
    if (state.diff) activity.diff = state.diff;
    return activity;
  };

  // Streamed argument previews and terminal output can update many times a
  // second; throttle output-only refreshes like the reasoning card, but
  // always emit status changes immediately.
  const TOOL_EMIT_INTERVAL_MS = 130;
  const emitToolActivity = (state, immediate) => {
    const send = () => {
      state.emitTimer = null;
      state.lastEmitAt = Date.now();
      callbacks.onActivity(buildActivity(state));
    };
    if (immediate || Date.now() - (state.lastEmitAt ?? 0) >= TOOL_EMIT_INTERVAL_MS) {
      if (state.emitTimer) {
        clearTimeout(state.emitTimer);
        state.emitTimer = null;
      }
      send();
      return;
    }
    if (!state.emitTimer) state.emitTimer = setTimeout(send, TOOL_EMIT_INTERVAL_MS);
  };

  const flushToolEmits = () => {
    for (const state of toolCalls.values()) {
      if (state.emitTimer) {
        clearTimeout(state.emitTimer);
        state.emitTimer = null;
        callbacks.onActivity(buildActivity(state));
      }
    }
  };

  const refreshToolPresentation = (state) => {
    const label = kimiToolLabel(state.toolName);
    // Drop the transient "Preparing…" detail once the real input lands.
    if (!state.preparing && state.preparingDetail) {
      state.detail = undefined;
      state.preparingDetail = false;
    }
    if (state.kind === 'execute' && state.command) {
      state.title = `Command - ${stringifySummary(state.command, 80)}`;
      state.detail = state.command;
    } else if ((state.kind === 'search' || state.kind === 'fetch') && state.query) {
      state.title = `${label} - ${stringifySummary(state.query, 80)}`;
      state.detail = state.query;
    } else if (state.filePath) {
      state.title = `${label} - ${stringifySummary(state.filePath, 80)}`;
      state.detail = state.filePath;
    } else if (state.preparing) {
      // Argument previews stream before the full input lands — show the tool
      // as soon as the model starts writing its input (a large file write can
      // take a while to generate).
      state.title = label;
      state.detail = state.argsLength
        ? `Preparing… (${state.argsLength.toLocaleString()} chars)`
        : 'Preparing…';
      state.preparingDetail = true;
    } else if (state.kimiTitle && !KIMI_TOOL_LABELS[state.kimiTitle]) {
      state.title = state.kimiTitle;
    }
  };

  const upsertToolCall = (update, isNew) => {
    const id = update.toolCallId;
    if (typeof id !== 'string' || !id) return;
    const created = !toolCalls.has(id);
    let state = toolCalls.get(id);
    if (!state) {
      state = { id, status: 'running', preparing: true, argsLength: 0 };
      toolCalls.set(id, state);
    }
    const previousStatus = state.status;

    // The initial tool_call announces the tool by name in its title; later
    // updates may replace the title with a human summary ("Running: …").
    if (typeof update.title === 'string' && update.title) {
      if (isNew || KIMI_TOOL_LABELS[update.title]) state.toolName = state.toolName ?? update.title;
      state.kimiTitle = update.title;
    }
    const kind = update.kind ?? state.kind ?? KIMI_TOOL_KINDS[state.toolName];
    if (kind) state.kind = kind === 'write' ? 'edit' : kind;

    const rawInput = update.rawInput;
    if (rawInput && typeof rawInput === 'object') {
      state.preparing = false;
      if (typeof rawInput.command === 'string') state.command = rawInput.command;
      const filePath = rawInput.file_path ?? rawInput.path;
      if (typeof filePath === 'string') state.filePath = filePath;
      if (typeof rawInput.query === 'string') state.query = rawInput.query;
      if (typeof rawInput.url === 'string') state.query = rawInput.url;
    }

    const terminal =
      update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled';
    if (Array.isArray(update.content)) {
      for (const entry of update.content) {
        if (entry?.type === 'diff' && typeof entry.path === 'string') {
          state.filePath = entry.path;
          state.diff = {
            path: entry.path,
            additions: countDiffLines(entry.newText),
            deletions: countDiffLines(entry.oldText),
          };
        }
        if (entry?.type === 'content' && typeof entry.content?.text === 'string' && entry.content.text) {
          if (state.preparing && !terminal) {
            // Streamed tool-argument preview (partial JSON), not output.
            // Kept whole: it is the only place the target path is visible
            // when the permission request arrives (rawInput lands only after
            // the tool is approved).
            state.argsLength = entry.content.text.length;
            state.argsPreview = entry.content.text;
          } else {
            state.output = entry.content.text;
          }
        }
      }
    }

    // kimi's rawOutput is the tool's output snapshot (string or object).
    const rawOutput = update.rawOutput;
    if (typeof rawOutput === 'string' && rawOutput.trim()) {
      state.output = rawOutput;
    } else if (rawOutput && typeof rawOutput === 'object') {
      if (typeof rawOutput.exit_code === 'number') state.exitCode = rawOutput.exit_code;
      if (typeof rawOutput.output === 'string' && rawOutput.output.trim()) {
        state.output = rawOutput.output;
      }
    }

    if (update.status === 'completed') state.status = 'done';
    else if (update.status === 'failed' || update.status === 'cancelled') state.status = 'error';
    else if (update.status === 'pending' || update.status === 'in_progress') {
      if (state.status !== 'error') state.status = 'running';
    }
    if (typeof state.exitCode === 'number' && state.exitCode !== 0) state.status = 'error';
    if (terminal) state.preparing = false;

    refreshToolPresentation(state);
    emitToolActivity(state, created || state.status !== previousStatus);
  };

  const handlePlanUpdate = (entries) => {
    const list = Array.isArray(entries) ? entries : [];
    const total = list.length;
    const completed = list.filter((entry) => entry?.status === 'completed').length;
    const active = list.find((entry) => entry?.status === 'in_progress');
    callbacks.onActivity({
      key: 'plan',
      type: 'plan',
      kind: 'plan',
      title: active
        ? `Tasks (${completed}/${total}) - ${stringifySummary(active.content, 60)}`
        : `Tasks (${completed}/${total})`,
      status: total > 0 && completed === total ? 'done' : 'running',
      plan: list.map((entry) => ({
        content: String(entry?.content ?? ''),
        status:
          entry?.status === 'completed'
            ? 'completed'
            : entry?.status === 'in_progress'
              ? 'in_progress'
              : 'pending',
      })),
    });
  };

  // Approvals are answered by access-mode policy, mirroring the grok driver:
  // Read only allows read-only tools; Full access runs in yolo mode and never
  // asks. Workspace write allows file mutations only inside the workspace —
  // kimi has no filesystem sandbox of its own, so the boundary is enforced
  // here by resolving every reported target path against cwd, including any
  // symlinked ancestors. Mutations that report no target path fail closed,
  // and commands are denied outright since their filesystem reach is
  // unknowable.
  const workspaceRoot = path.resolve(cwd || '.');
  let canonicalWorkspaceRoot = null;
  try {
    canonicalWorkspaceRoot = realpathSync(workspaceRoot);
  } catch {}

  // realpathSync requires the final target to exist, but Write commonly
  // creates a new file. Canonicalize the deepest existing ancestor and append
  // the missing suffix. lstatSync intentionally detects broken symlinks too:
  // following one can still create its target outside the workspace.
  const canonicalizeMutationTarget = (candidate, depth = 0) => {
    if (depth > 40) throw new Error('Too many symbolic links');
    const resolved = path.resolve(candidate);
    let ancestor = resolved;
    let stats;
    while (true) {
      try {
        stats = lstatSync(ancestor);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }

    const missingSuffix = path.relative(ancestor, resolved);
    let canonicalAncestor;
    try {
      canonicalAncestor = realpathSync(ancestor);
    } catch (error) {
      if (!stats.isSymbolicLink()) throw error;
      const canonicalParent = canonicalizeMutationTarget(path.dirname(ancestor), depth + 1);
      canonicalAncestor = canonicalizeMutationTarget(
        path.resolve(canonicalParent, readlinkSync(ancestor)),
        depth + 1
      );
    }
    return path.resolve(canonicalAncestor, missingSuffix);
  };
  const isInsideWorkspace = (candidate) => {
    if (!canonicalWorkspaceRoot) return false;
    try {
      const resolvedCandidate = path.resolve(workspaceRoot, candidate);
      const canonicalCandidate = canonicalizeMutationTarget(resolvedCandidate);
      const relative = path.relative(canonicalWorkspaceRoot, canonicalCandidate);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  };
  // kimi 0.26's permission payload carries no kind/rawInput/locations, and
  // rawInput on tool_call updates lands only after approval — at ask time the
  // target path lives solely in the completed argument preview (verified
  // live), so that is the fallback of last resort.
  const mutationTargets = (toolCall, known) => {
    const targets = [];
    const pushFrom = (record) => {
      if (!record || typeof record !== 'object') return;
      for (const key of ['file_path', 'path', 'old_path', 'new_path', 'source', 'destination']) {
        if (typeof record[key] === 'string' && record[key]) targets.push(record[key]);
      }
    };
    pushFrom(toolCall.rawInput);
    for (const location of Array.isArray(toolCall.locations) ? toolCall.locations : []) {
      if (typeof location?.path === 'string' && location.path) targets.push(location.path);
    }
    if (!targets.length && typeof known?.filePath === 'string' && known.filePath) {
      targets.push(known.filePath);
    }
    if (!targets.length && typeof known?.argsPreview === 'string') {
      try {
        pushFrom(JSON.parse(known.argsPreview));
      } catch {}
    }
    return targets;
  };
  const answerPermission = (message) => {
    const params = message.params ?? {};
    const toolCall = params.toolCall ?? {};
    const known = typeof toolCall.toolCallId === 'string' ? toolCalls.get(toolCall.toolCallId) : null;
    const kind =
      toolCall.kind ??
      known?.kind ??
      KIMI_TOOL_KINDS[typeof toolCall.title === 'string' ? toolCall.title : ''];
    const readOnly = kind === 'read' || kind === 'search' || kind === 'fetch' || kind === 'think';
    // Orion's own spawn_subagent MCP tool is safe in every mode: the spawned
    // subthread runs with the driver thread's access mode, never more. Kimi's
    // initial ACP tool_call records the qualified MCP identity in toolName;
    // permission titles are presentation fields and must not grant access.
    const isOrionSpawn = known?.toolName === 'mcp__orion__spawn_subagent';
    let allow;
    let denialDetail = "mode doesn't permit this tool.";
    if (isOrionSpawn) {
      allow = true;
    } else if (accessMode === 'full-access') {
      allow = true;
    } else if (accessMode !== 'workspace-write') {
      allow = readOnly;
    } else if (readOnly) {
      allow = true;
    } else if (kind === 'execute') {
      allow = false;
    } else {
      const targets = mutationTargets(toolCall, known);
      allow = targets.length > 0 && targets.every(isInsideWorkspace);
      if (!allow) {
        denialDetail = targets.length
          ? 'mode only permits file changes inside the workspace.'
          : 'mode requires a known target path for file changes.';
      }
    }

    // A path-gated approval must never persist: choosing an "always allow"
    // option would let kimi self-approve later calls of the same tool without
    // asking, including ones that target paths outside the workspace.
    const pathGated = allow && accessMode === 'workspace-write' && !readOnly;
    const options = (Array.isArray(params.options) ? params.options : []).filter(
      (option) =>
        !pathGated ||
        (option?.kind !== 'allow_always' &&
          !/always/i.test(`${option?.optionId ?? ''} ${option?.name ?? ''}`))
    );
    const pick = (kinds, pattern) =>
      kinds.map((wanted) => options.find((option) => option?.kind === wanted)).find(Boolean) ??
      options.find((option) => pattern.test(`${option?.optionId ?? ''} ${option?.name ?? ''}`));
    const chosen = allow
      ? pick(['allow_once', 'allow_always'], /allow|approve|yes/i) ?? options[0]
      : pick(['reject_once', 'reject_always'], /reject|deny|no/i);

    write(
      chosen
        ? {
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: chosen.optionId } },
          }
        : { jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }
    );

    if (!allow && known) {
      known.status = 'error';
      known.output = `Skipped — ${
        accessMode === 'read-only' ? 'Read only' : 'Workspace write'
      } ${denialDetail} Switch to Full Access to allow it.`;
      emitToolActivity(known, true);
    }
  };

  const fail = (error) => {
    flushToolEmits();
    callbacks.onFatal(
      typeof error === 'string' ? error : error?.message ?? 'Kimi agent protocol error.'
    );
  };

  const start = async () => {
    const init = await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    if (init.error) return fail(init.error);

    let sessionId = null;
    let resumed = false;
    if (resumeSessionId) {
      replayingSession = true;
      const loaded = await request('session/load', {
        sessionId: resumeSessionId,
        cwd,
        mcpServers,
      });
      replayingSession = false;
      if (loaded.error) callbacks.onResumeFallback?.();
      else {
        sessionId = resumeSessionId;
        resumed = true;
      }
    }
    if (!sessionId) {
      const created = await request('session/new', { cwd, mcpServers });
      if (created.error || typeof created.result?.sessionId !== 'string') {
        return fail(created.error ?? 'Kimi agent did not return a session id.');
      }
      sessionId = created.result.sessionId;
    }
    callbacks.onSessionId(sessionId, { resumed });

    // Pin the thread's model: sessions open on the CLI's default_model.
    const setModel = await request('session/set_config_option', {
      sessionId,
      configId: 'model',
      value: model.slug,
    });
    if (setModel.error) {
      return fail(setModel.error.message ?? `Kimi rejected model "${model.slug}".`);
    }

    // Pin the permission mode to the thread's access level. Full access uses
    // yolo (auto-approve everything, no permission round-trips); Read only
    // uses plan (no tool execution at all). Workspace write uses default —
    // kimi's auto mode self-approves writes and commands on any path the
    // process can reach, not just the workdir, so default (ask-first) is the
    // only mode that routes every mutation through answerPermission, where
    // the workspace boundary is enforced by path.
    const modeId =
      accessMode === 'full-access' ? 'yolo' : accessMode === 'read-only' ? 'plan' : 'default';
    const setMode = await request('session/set_mode', { sessionId, modeId });
    if (setMode.error) {
      return fail(
        setMode.error.message ?? `Kimi could not enable ${accessMode} permission mode.`
      );
    }

    const failureLogCursor = await kimiTurnFailureLogCursor(sessionId);
    const response = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    });
    flushToolEmits();
    if (response.error) return fail(response.error);
    const stopReason = response.result?.stopReason;
    if (stopReason && stopReason !== 'end_turn') {
      const detail =
        stopReason === 'refusal'
          ? 'was refused'
          : stopReason === 'cancelled'
            ? 'was cancelled'
            : stopReason === 'max_tokens'
              ? 'reached the model token limit'
              : stopReason === 'max_turn_requests'
                ? 'reached the maximum turn limit'
                : `stopped (${stopReason})`;
      return fail(`Kimi turn ${detail}.`);
    }
    // kimi reports a non-auth provider failure (e.g. an API 403/5xx) as a
    // clean `end_turn` — including mid-turn failures after tool calls and
    // text already streamed (a quota 403 twelve steps in looks like a
    // finished turn on the wire). The error only lands in the session's log
    // file; give the write a moment, then surface it instead of finishing a
    // successful-looking turn.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const failure = await kimiTurnFailureFromSessionDisk(sessionId, failureLogCursor);
    if (failure) return fail(failure);
    callbacks.onTurnEnd(response.result ?? {}, sessionId);
  };

  const handleMessage = (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && !message.method) {
      const resolve = pendingRequests.get(message.id);
      if (resolve) {
        pendingRequests.delete(message.id);
        resolve(message);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      if (message.method === 'session/request_permission') return answerPermission(message);
      write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not supported' },
      });
      return;
    }

    if (replayingSession) return;
    const update = message.method === 'session/update' ? message.params?.update : null;
    if (!update || typeof update !== 'object') return;

    const kind = update.sessionUpdate;
    if (kind === 'agent_thought_chunk') {
      const text = update.content?.text;
      if (typeof text === 'string' && text) callbacks.onReasoning(text);
      return;
    }
    if (kind === 'agent_message_chunk') {
      const text = update.content?.text;
      if (typeof text !== 'string' || !text) return;
      const prefix = pendingTextBreak && textSeen ? '\n\n' : '';
      pendingTextBreak = false;
      textSeen = true;
      callbacks.onText(`${prefix}${text}`);
      return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      // Text resuming after tool activity is a new paragraph.
      if (textSeen) pendingTextBreak = true;
      upsertToolCall(update, kind === 'tool_call');
      return;
    }
    if (kind === 'plan') {
      handlePlanUpdate(update.entries);
    }
    // available_commands_update / config_option_update / current_mode_update
    // are session bookkeeping — nothing to surface.
  };

  return { start, handleMessage };
};

// One-shot, tool-free kimi text turn over ACP, used for title generation.
// Prompt mode (`kimi -p`) auto-approves every tool and rejects --plan
// ("Cannot combine --prompt with --plan" on 0.26), so hidden background
// prompts must go through ACP plan mode, which disables tool execution
// entirely (the driver's read-only permission policy backstops it).
// Resolves with the accumulated response text, or '' on failure.
const kimiPlanModeOneShot = (model, promptText, cwd) =>
  new Promise((resolve) => {
    const child = spawn(loginShell, ['-lc', 'kimi acp'], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let text = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        child.kill('SIGTERM');
      } catch {}
      resolve(text);
    };
    // The ACP server idles after the prompt resolves and never exits on its
    // own; cap the whole turn so a wedged server can't leak a process.
    const deadline = setTimeout(finish, 60_000);
    const driver = createKimiAcpDriver({
      child,
      cwd,
      model,
      promptText,
      resumeSessionId: null,
      accessMode: 'read-only',
      callbacks: {
        onSessionId: () => {},
        onReasoning: () => {},
        onActivity: () => {},
        onResumeFallback: () => {},
        onText: (delta) => {
          text += delta;
        },
        onTurnEnd: finish,
        onFatal: finish,
      },
    });
    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          driver.handleMessage(JSON.parse(trimmed));
        } catch {}
      }
    });
    child.stderr.resume();
    child.on('error', finish);
    child.on('close', finish);
    driver.start();
  });

// ---------------------------------------------------------------------------
// Codex goal runs (/goal). Codex's goals feature — a persistent objective the
// agent pursues autonomously across turns, with token budgets and a status
// machine (active/paused/blocked/usageLimited/budgetLimited/complete) stored
// in ~/.codex/goals_1.sqlite — lives in the app-server's live thread manager:
// the goal runtime auto-starts continuation turns while the goal is active,
// so `codex exec` (which exits at turn end) can never drive it. Goal runs
// therefore speak JSON-RPC (JSONL over stdio) to `codex app-server` and treat
// the whole pursuit (N turns) as one Orion run. Verified live on codex
// 0.144.1: thread/goal/set immediately starts a "Pursuing goal" turn, and the
// app-server resumes exec-created threads, so the thread's existing session
// id keeps working with `codex exec resume` after the goal run ends.

// Mirrors the --config overrides the codex exec path builds in
// commandForModel; app-server takes them as a config map on thread/start.
const codexAppServerConfig = (model, input) => {
  const options =
    input.providerOptions && typeof input.providerOptions === 'object' ? input.providerOptions : {};
  const config = {
    model_reasoning_effort: codexReasoningEffortForModel(model, input.codexReasoningEffort),
    // Same override as the exec paths: 5.6 models default summaries to none.
    model_reasoning_summary: 'detailed',
    service_tier: input.codexServiceTier || defaultCodexServiceTier,
  };
  if (options.networkAccess) config['sandbox_workspace_write.network_access'] = true;
  if (options.webSearch) config['tools.web_search'] = true;
  if (options.browserControl && input.accessMode !== 'read-only') {
    config['mcp_servers.chrome_devtools.command'] = 'npx';
    config['mcp_servers.chrome_devtools.args'] = options.browserAutoConnect
      ? ['-y', chromeDevtoolsMcpPackage, '--autoConnect']
      : ['-y', chromeDevtoolsMcpPackage];
    config['mcp_servers.chrome_devtools.startup_timeout_sec'] = 90;
  }
  // Orion's spawn_subagent bridge — same overrides as the exec path builds.
  if (input.orionMcp) {
    config['mcp_servers.orion.command'] = input.orionMcp.command;
    config['mcp_servers.orion.args'] = input.orionMcp.args;
    config['mcp_servers.orion.env'] = { ELECTRON_RUN_AS_NODE: '1' };
    config['mcp_servers.orion.startup_timeout_sec'] = 30;
    config['mcp_servers.orion.tool_timeout_sec'] = 7200;
    config['mcp_servers.orion.default_tools_approval_mode'] = 'approve';
  }
  return config;
};

// thread/tokenUsage/updated carries cumulative totals for the thread's loaded
// turns — map the total breakdown onto Orion's TurnTokenStats.
const codexStatsFromTokenUsage = (tokenUsage, modelId) => {
  const total = tokenUsage?.total;
  if (!total || typeof total !== 'object') return null;
  const stats = { modelId };
  if (typeof total.totalTokens === 'number') stats.totalTokens = total.totalTokens;
  if (typeof total.inputTokens === 'number') stats.inputTokens = total.inputTokens;
  if (typeof total.outputTokens === 'number') stats.outputTokens = total.outputTokens;
  if (typeof total.cachedInputTokens === 'number') stats.cachedReadTokens = total.cachedInputTokens;
  if (typeof total.reasoningOutputTokens === 'number') stats.reasoningTokens = total.reasoningOutputTokens;
  return stats;
};

// Wire goal → the shape persisted on Thread.goal in the renderer store.
const codexGoalForRenderer = (goal) => ({
  objective: String(goal.objective ?? ''),
  status: goal.status,
  tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
  tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : 0,
  timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : 0,
  updatedAt: typeof goal.updatedAt === 'number' ? goal.updatedAt : undefined,
});

// v2 app-server thread items are the camelCase cousins of the exec --json
// items codexActivityFromItem maps; completion carries aggregated output.
const codexAppServerActivityFromItem = (item, completed) => {
  if (!item || typeof item !== 'object') return null;
  const failed =
    item.status === 'failed' ||
    item.status === 'declined' ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const status = failed ? 'error' : completed || item.status === 'completed' ? 'done' : 'running';
  const base = { key: typeof item.id === 'string' ? item.id : undefined, status };

  if (item.type === 'commandExecution') {
    const activity = {
      ...base,
      type: 'command',
      kind: 'execute',
      title: `Command - ${stringifySummary(item.command, 80)}`,
      detail: stringifySummary(item.command),
    };
    if (completed && typeof item.aggregatedOutput === 'string' && item.aggregatedOutput) {
      activity.output = item.aggregatedOutput.slice(-4000);
    }
    if (typeof item.exitCode === 'number') activity.exitCode = item.exitCode;
    return activity;
  }
  if (item.type === 'fileChange') {
    const paths = Array.isArray(item.changes)
      ? item.changes.map((change) => change?.path).filter(Boolean)
      : [];
    return {
      ...base,
      type: 'tool',
      kind: 'edit',
      title: `File changes (${paths.length})`,
      detail: stringifySummary(paths.join(', ')),
    };
  }
  if (item.type === 'mcpToolCall') {
    const name = [item.server, item.tool].filter(Boolean).join('.');
    return {
      ...base,
      type: 'tool',
      title: `Tool - ${name || 'MCP'}`,
      detail: stringifySummary(item.arguments ?? ''),
    };
  }
  if (item.type === 'webSearch') {
    return {
      ...base,
      type: 'tool',
      kind: 'search',
      title: `Web search - ${stringifySummary(item.query ?? '', 80)}`,
      detail: stringifySummary(item.query ?? ''),
    };
  }
  if (item.type === 'imageGeneration') {
    return { ...base, type: 'tool', title: 'Image generation' };
  }
  return null;
};

const CODEX_GOAL_END_NOTES = {
  complete: '\n\n_Goal achieved._',
  paused: '\n\n_Goal paused — send `/goal resume` to continue._',
  blocked: '\n\n_Goal blocked — the agent can’t make progress without help. `/goal resume` to retry._',
  usageLimited: '\n\n_Goal hit usage limits — `/goal resume` once limits reset._',
  budgetLimited: '\n\n_Goal token budget exhausted — `/goal resume` to keep going._',
};

const createCodexAppServerDriver = ({
  child,
  cwd,
  model,
  input,
  goal,
  resumeSessionId,
  accessMode,
  callbacks,
}) => {
  let nextRequestId = 1;
  const pendingRequests = new Map();
  let threadId = null;
  let textSeen = false;
  let pendingTextBreak = false;
  // Items whose text already streamed via deltas — their item.completed
  // payload must not be emitted a second time.
  const streamedTextItems = new Set();
  const streamedReasoningItems = new Set();
  let goalStatus = null;
  let turnActive = false;
  let activeTurnId = null;
  let continuationTimer = null;
  let ended = false;

  // The goal runtime decides whether to continue after each turn; give it
  // this long to start the next turn (or flip the goal status) before Orion
  // concludes the pursuit stalled and pauses it.
  const CONTINUATION_GRACE_MS = 90_000;

  const write = (message) => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {}
  };

  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextRequestId++;
      pendingRequests.set(id, resolve);
      write({ jsonrpc: '2.0', id, method, params });
    });

  const emitText = (text) => {
    if (!text) return;
    const prefix = pendingTextBreak && textSeen ? '\n\n' : '';
    pendingTextBreak = false;
    textSeen = true;
    callbacks.onText(`${prefix}${text}`);
  };

  const clearContinuationTimer = () => {
    if (continuationTimer) {
      clearTimeout(continuationTimer);
      continuationTimer = null;
    }
  };

  const endRun = (note) => {
    if (ended) return;
    ended = true;
    clearContinuationTimer();
    if (note) emitText(note);
    callbacks.onGoalRunEnd();
  };

  const fail = (error) => {
    if (ended) return;
    ended = true;
    clearContinuationTimer();
    callbacks.onFatal(
      typeof error === 'string' ? error : error?.message ?? 'Codex app-server protocol error.'
    );
  };

  const armContinuationTimer = () => {
    clearContinuationTimer();
    continuationTimer = setTimeout(async () => {
      continuationTimer = null;
      if (ended || turnActive) return;
      // The runtime declined to keep going (idle work rejected, nothing left
      // to do, …) without flipping the goal status. Pause the stored goal so
      // it matches the fact that nothing is running, then end gracefully.
      if (goalStatus === 'active' && threadId) {
        try {
          await request('thread/goal/set', { threadId, status: 'paused' });
        } catch {}
      }
      endRun('\n\n_Goal run went idle — paused. Send `/goal resume` to continue._');
    }, CONTINUATION_GRACE_MS);
  };

  const handleGoalUpdated = (wireGoal) => {
    goalStatus = wireGoal.status;
    callbacks.onGoal(codexGoalForRenderer(wireGoal));
    if (wireGoal.status !== 'active') {
      clearContinuationTimer();
      if (!turnActive) endRun(CODEX_GOAL_END_NOTES[wireGoal.status] ?? '');
    }
  };

  const handleTurnCompleted = (params) => {
    turnActive = false;
    activeTurnId = null;
    const turn = params.turn ?? {};
    if (turn.status === 'failed') {
      const message = turn.error?.message ?? 'Codex turn failed.';
      callbacks.onActivity({
        type: 'error',
        title: 'Turn failed',
        detail: stringifySummary(message, 300),
        status: 'error',
      });
      // The goal runtime skips continuation after turn errors — pause the
      // stored goal so its status matches reality, then end the run.
      void (async () => {
        if (goalStatus === 'active' && threadId) {
          try {
            const paused = await Promise.race([
              request('thread/goal/set', { threadId, status: 'paused' }),
              new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
            ]);
            // The adjacent goal-updated notification normally handles this,
            // but apply the response too in case process output was delayed.
            if (paused?.result?.goal) handleGoalUpdated(paused.result.goal);
          } catch {}
        }
        endRun('\n\n_Goal run stopped on an error — `/goal resume` to retry._');
      })();
      return;
    }
    if (ended) return;
    if (goalStatus && goalStatus !== 'active') {
      endRun(CODEX_GOAL_END_NOTES[goalStatus] ?? '');
      return;
    }
    // Goal still active: the runtime should start a continuation turn.
    armContinuationTimer();
  };

  const handleItem = (params, completed) => {
    const item = params.item;
    if (!item || typeof item !== 'object') return;
    if (item.type === 'agentMessage') {
      if (completed) {
        if (!streamedTextItems.has(item.id) && typeof item.text === 'string' && item.text) {
          emitText(item.text);
        }
        pendingTextBreak = true;
      }
      return;
    }
    if (item.type === 'reasoning') {
      if (completed && !streamedReasoningItems.has(item.id)) {
        const parts = [
          ...(Array.isArray(item.summary) ? item.summary : []),
          ...(Array.isArray(item.content) ? item.content : []),
        ].filter((part) => typeof part === 'string' && part);
        if (parts.length) callbacks.onReasoning(`${parts.join('\n\n')}\n\n`);
      }
      return;
    }
    const activity = codexAppServerActivityFromItem(item, completed);
    if (activity) {
      // Text resuming after tool activity is a new paragraph.
      if (textSeen) pendingTextBreak = true;
      callbacks.onActivity(activity);
    }
  };

  const handlePlanUpdate = (params) => {
    const list = Array.isArray(params.plan) ? params.plan : [];
    const total = list.length;
    const completedCount = list.filter((step) => step?.status === 'completed').length;
    const isActive = (step) => step?.status === 'inProgress' || step?.status === 'in_progress';
    const active = list.find(isActive);
    callbacks.onActivity({
      key: 'plan',
      type: 'plan',
      kind: 'plan',
      title: active
        ? `Tasks (${completedCount}/${total}) - ${stringifySummary(active.step, 60)}`
        : `Tasks (${completedCount}/${total})`,
      status: total > 0 && completedCount === total ? 'done' : 'running',
      plan: list.map((step) => ({
        content: String(step?.step ?? ''),
        status: step?.status === 'completed' ? 'completed' : isActive(step) ? 'in_progress' : 'pending',
      })),
    });
  };

  // approvalPolicy 'never' means these should not fire; answer defensively by
  // access-mode policy so a stray request can never deadlock the run.
  const answerServerRequest = (message) => {
    const method = message.method;
    const respond = (result) => write({ jsonrpc: '2.0', id: message.id, result });
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      return respond({ decision: accessMode === 'full-access' ? 'accept' : 'decline' });
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      return respond({ decision: accessMode === 'read-only' ? 'decline' : 'accept' });
    }
    if (method === 'item/permissions/requestApproval') {
      return respond({ decision: accessMode === 'full-access' ? 'accept' : 'decline' });
    }
    write({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not supported' },
    });
  };

  const start = async () => {
    const init = await request('initialize', {
      clientInfo: { name: 'orion', title: 'Orion', version: app.getVersion?.() ?? '0.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    if (init.error) return fail(init.error);
    write({ jsonrpc: '2.0', method: 'initialized', params: {} });

    const sandbox =
      accessMode === 'full-access'
        ? 'danger-full-access'
        : accessMode === 'read-only'
          ? 'read-only'
          : 'workspace-write';
    const threadParams = {
      cwd,
      model: model.slug,
      sandbox,
      approvalPolicy: 'never',
      config: codexAppServerConfig(model, input),
    };

    let resolvedThreadId = null;
    if (resumeSessionId) {
      const resumed = await request('thread/resume', { threadId: resumeSessionId, ...threadParams });
      if (resumed.error) callbacks.onResumeFallback?.();
      else resolvedThreadId = resumed.result?.thread?.id ?? resumeSessionId;
    }
    if (!resolvedThreadId) {
      const started = await request('thread/start', threadParams);
      resolvedThreadId = started.result?.thread?.id;
      if (started.error || typeof resolvedThreadId !== 'string') {
        return fail(started.error ?? 'Codex app-server did not return a thread id.');
      }
    }
    threadId = resolvedThreadId;
    callbacks.onSessionId(threadId);

    // Goals require a persistent thread; setting one active immediately
    // starts the pursuit turn — no turn/start call needed.
    const setParams =
      goal.action === 'resume'
        ? { threadId, status: 'active' }
        : {
            threadId,
            objective: goal.objective,
            ...(typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0
              ? { tokenBudget: Math.round(goal.tokenBudget) }
              : {}),
          };
    const set = await request('thread/goal/set', setParams);
    if (set.error) return fail(set.error);
    if (set.result?.goal) handleGoalUpdated(set.result.goal);
    // If no turn starts (e.g. the runtime immediately declines idle work),
    // the continuation watchdog pauses the goal and ends the run.
    if (!turnActive) armContinuationTimer();
  };

  // User stop = pause: the goal stays resumable and its stored status
  // matches the fact that nothing is running anymore.
  const stopGoalRun = async () => {
    ended = true;
    clearContinuationTimer();
    if (!threadId) return;
    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
    try {
      const paused = await withTimeout(
        request('thread/goal/set', { threadId, status: 'paused' }),
        1500
      );
      // Do not depend solely on the adjacent notification: Stop may reap the
      // app-server before that notification is delivered to the renderer.
      if (paused?.result?.goal) handleGoalUpdated(paused.result.goal);
      await withTimeout(
        request('turn/interrupt', {
          threadId,
          ...(activeTurnId ? { turnId: activeTurnId } : {}),
        }),
        1000
      );
    } catch {}
  };

  const handleMessage = (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && !message.method) {
      const resolve = pendingRequests.get(message.id);
      if (resolve) {
        pendingRequests.delete(message.id);
        resolve(message);
      }
      return;
    }

    if (message.id !== undefined && message.method) return answerServerRequest(message);

    const params = message.params ?? {};
    // Defensive: the app-server can host many threads; only ours matters.
    if (params.threadId && threadId && params.threadId !== threadId) return;

    switch (message.method) {
      case 'item/agentMessage/delta': {
        if (typeof params.itemId === 'string') streamedTextItems.add(params.itemId);
        if (typeof params.delta === 'string') emitText(params.delta);
        return;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        if (typeof params.itemId === 'string') streamedReasoningItems.add(params.itemId);
        if (typeof params.delta === 'string' && params.delta) callbacks.onReasoning(params.delta);
        return;
      }
      case 'item/reasoning/summaryPartAdded':
        callbacks.onReasoning('\n\n');
        return;
      case 'item/started':
        handleItem(params, false);
        return;
      case 'item/completed':
        handleItem(params, true);
        return;
      case 'turn/started': {
        turnActive = true;
        activeTurnId = typeof params.turn?.id === 'string' ? params.turn.id : null;
        clearContinuationTimer();
        if (textSeen) pendingTextBreak = true;
        return;
      }
      case 'turn/completed':
        handleTurnCompleted(params);
        return;
      case 'turn/plan/updated':
        handlePlanUpdate(params);
        return;
      case 'thread/tokenUsage/updated': {
        const stats = codexStatsFromTokenUsage(params.tokenUsage, model.id);
        if (stats) callbacks.onStats(stats);
        return;
      }
      case 'thread/goal/updated': {
        if (params.goal) handleGoalUpdated(params.goal);
        return;
      }
      case 'thread/goal/cleared': {
        goalStatus = 'cleared';
        callbacks.onGoal(null);
        clearContinuationTimer();
        if (!turnActive) endRun('\n\n_Goal cleared._');
        return;
      }
      case 'error': {
        const detail = stringifySummary(params.error?.message ?? '', 300);
        if (detail) {
          callbacks.onActivity({
            type: 'error',
            title: params.willRetry ? 'Codex retrying' : 'Codex error',
            detail,
            status: 'error',
          });
        }
        return;
      }
      default:
        return;
    }
  };

  return { start, handleMessage, stopGoalRun };
};

// Goal runs whose driver must be asked to pause before the process is killed
// (agent:stopTurn). Keyed by runId; cleaned up in finalizeRun.
const codexGoalRunDrivers = new Map();

// ---------------------------------------------------------------------------
// Claude persistent sessions (Agent SDK). The one-shot `claude --print` spawn
// ends the harness process with every turn, which kills any background
// subagents the model left running and silences the task notifications that
// are supposed to re-invoke it — long multi-phase runs died at each turn
// boundary. Claude turns therefore run on a persistent Agent SDK session per
// thread: one CLI process spans the whole conversation, user turns are pushed
// over stream-json stdin, steer/stop interrupt the turn in place instead of
// SIGTERMing the process, and turns the harness starts on its own (a
// background task finishing) are emitted as `started` events flagged
// `background` so the renderer can grow the transcript. `/btw` asides and
// title generation keep the one-shot CLI path.

let claudeSdkModulePromise = null;
const loadClaudeSdk = () => {
  claudeSdkModulePromise ??= import('@anthropic-ai/claude-agent-sdk');
  return claudeSdkModulePromise;
};

// The SDK defaults to its own pinned CLI binary; prefer the claude the user
// installed so persistent sessions run the same version, login, and settings
// the one-shot spawn path used. Falls back to the SDK's binary if missing.
let claudeBinaryPromise = null;
const resolveClaudeBinary = () => {
  claudeBinaryPromise ??= execFileAsync(loginShell, ['-lc', 'command -v claude'], { timeout: 4000 })
    .then(({ stdout }) => stdout.trim().split('\n').pop()?.trim() || null)
    .catch(() => null);
  return claudeBinaryPromise;
};

const claudeSdkSessions = new Map(); // threadId -> session
// A foreground turn can finish while Claude-owned background agents keep
// running. Retain that completed run id as a cancellable handle until the
// background work settles or a new turn takes over.
const claudeBackgroundRunSessions = new Map(); // runId -> session

const clearClaudeBackgroundRun = (session) => {
  if (!session.backgroundRunId) return;
  if (claudeBackgroundRunSessions.get(session.backgroundRunId) === session) {
    claudeBackgroundRunSessions.delete(session.backgroundRunId);
  }
  session.backgroundRunId = null;
};

const retainClaudeBackgroundRun = (session, runId) => {
  clearClaudeBackgroundRun(session);
  session.backgroundRunId = runId;
  claudeBackgroundRunSessions.set(runId, session);
};

// Orchestration: spawn_subagent calls waiting on the renderer to run the
// subthread and report back via the orchestration:subagentResult invoke.
const pendingSubagentSpawns = new Map(); // spawnId -> { resolve }

// Ask the renderer to run a subagent subthread and resolve with its final
// report. Failures resolve as text (never reject) so every caller — the
// Claude SDK tool and the socket bridge below — hands the model a readable
// outcome instead of a protocol error.
const requestSubagentSpawn = ({ getSender, threadId, projectPath, accessMode }, args) =>
  new Promise((resolve) => {
    // Read the sender at call time: sessions rebind it when the window
    // closes and reopens.
    const sender = getSender();
    if (!sender || sender.isDestroyed()) {
      resolve('Unable to spawn subagent: the Orion window is no longer available.');
      return;
    }
    const spawnId = crypto.randomUUID();
    pendingSubagentSpawns.set(spawnId, { resolve });
    try {
      sender.send('orchestration:spawnRequest', {
        spawnId,
        threadId,
        projectPath,
        accessMode,
        model: String(args.model ?? ''),
        prompt: String(args.prompt ?? ''),
        ...(args.title ? { title: String(args.title) } : {}),
        ...(args.role ? { role: String(args.role) } : {}),
      });
    } catch {
      pendingSubagentSpawns.delete(spawnId);
      resolve('Unable to spawn subagent: the Orion window is no longer available.');
    }
  });

// -------------------- Orion MCP bridge (non-Claude providers) --------------------
// Claude turns get spawn_subagent from the in-process SDK MCP server below;
// every other provider CLI is handed the dependency-free stdio shim written
// to userData. Cursor and Grok receive it through process-only plugins;
// Codex, Kimi, and OpenCode accept per-run MCP configuration directly. Every
// path carries an exact token, so concurrent runs never route by cwd.
const mcpBridgeSessions = new Map(); // token -> { getSender, threadId, projectPath, accessMode }

const mcpBridgeInstanceId = crypto
  .createHash('sha256')
  // The single-instance lock already prevents two processes from sharing one
  // profile. Hashing userData keeps dev and packaged profiles distinct while
  // leaving one stable socket path that can be unlinked on restart.
  .update(app.getPath('userData'))
  .digest('hex')
  .slice(0, 16);
const mcpBridgeSocketPath = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\orion-mcp-${mcpBridgeInstanceId}`
    : path.join(app.getPath('userData'), `orion-mcp-${mcpBridgeInstanceId}.sock`);

const handleMcpBridgeConnection = (socket) => {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message = null;
      try {
        message = JSON.parse(line);
      } catch {}
      if (!message || message.id === undefined) continue;
      const reply = (ok, text) => {
        try {
          socket.write(`${JSON.stringify({ id: message.id, ok, text })}\n`);
        } catch {}
      };
      const session =
        typeof message.token === 'string' && message.token
          ? mcpBridgeSessions.get(message.token)
          : undefined;
      if (!session) {
        reply(false, 'This Orion agent session token is missing, invalid, or expired.');
        continue;
      }
      if (message.tool !== 'spawn_subagent') {
        reply(false, `Unknown tool: ${message.tool}`);
        continue;
      }
      const args = message.args && typeof message.args === 'object' ? message.args : {};
      if (
        typeof args.model !== 'string' ||
        !args.model.trim() ||
        typeof args.prompt !== 'string' ||
        !args.prompt.trim()
      ) {
        reply(false, 'spawn_subagent requires string `model` and `prompt` arguments.');
        continue;
      }
      void requestSubagentSpawn(session, args).then((text) => reply(true, text));
    }
  });
  socket.on('error', () => {});
};

let mcpBridgePromise = null;
const ensureMcpBridge = () => {
  if (!mcpBridgePromise) {
    mcpBridgePromise = (async () => {
      const shimPath = path.join(app.getPath('userData'), 'orion-mcp-bridge.cjs');
      let existing = null;
      try {
        existing = await fs.readFile(shimPath, 'utf-8');
      } catch {}
      if (existing !== mcpBridgeShimSource) await fs.writeFile(shimPath, mcpBridgeShimSource);
      const socketPath = mcpBridgeSocketPath();
      if (process.platform !== 'win32') {
        try {
          await fs.unlink(socketPath);
        } catch {}
      }
      const server = net.createServer(handleMcpBridgeConnection);
      await new Promise((resolve, reject) => {
        const onStartupError = (error) => reject(error);
        server.once('error', onStartupError);
        server.listen(socketPath, () => {
          server.off('error', onStartupError);
          server.on('error', (error) => console.error('Orion MCP bridge server error:', error));
          resolve();
        });
      });
      return { shimPath, socketPath };
    })().catch((error) => {
      // Allow a later run to retry a failed setup instead of caching the error.
      mcpBridgePromise = null;
      throw error;
    });
  }
  return mcpBridgePromise;
};

// Registers a run with the bridge and returns everything the provider needs
// to launch the shim. Returns null when the bridge can't start — the run then
// simply proceeds without the spawn_subagent tool.
const isPlainRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const mcpBridgePluginConfig = ({ command, args }) => ({
  mcpServers: {
    orion: {
      command,
      args,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  },
});

const writeMcpBridgePlugin = async ({ token, command, args }) => {
  // Keep the leaf directory stable (`orion`) so Cursor's plugin-qualified
  // server name remains stable, while the token parent isolates every run.
  const tokenRoot = path.join(app.getPath('userData'), 'mcp-runs', token);
  const pluginDir = path.join(tokenRoot, 'orion');
  const cursorManifestDir = path.join(pluginDir, '.cursor-plugin');
  const grokManifestDir = path.join(pluginDir, '.claude-plugin');
  await Promise.all([
    fs.mkdir(cursorManifestDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(grokManifestDir, { recursive: true, mode: 0o700 }),
  ]);
  const manifest = JSON.stringify(
    { name: 'orion', version: '1.0.0', description: 'Orion subagent bridge' },
    null,
    2
  );
  const mcpConfig = JSON.stringify(mcpBridgePluginConfig({ command, args }), null, 2);
  await Promise.all([
    fs.writeFile(path.join(cursorManifestDir, 'plugin.json'), `${manifest}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(grokManifestDir, 'plugin.json'), `${manifest}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(pluginDir, 'mcp.json'), `${mcpConfig}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(pluginDir, '.mcp.json'), `${mcpConfig}\n`, { mode: 0o600 }),
  ]);
  return { pluginDir, tokenRoot };
};

const runPluginSupportPromises = new Map();
const providerSupportsRunPlugin = (providerId) => {
  if (providerId !== 'cursor' && providerId !== 'grok') return Promise.resolve(true);
  if (!runPluginSupportPromises.has(providerId)) {
    const helpCommand = providerId === 'cursor' ? 'cursor-agent --help' : 'grok agent --help';
    runPluginSupportPromises.set(
      providerId,
      runShellCommand(helpCommand, 10000)
        .then(({ stdout, stderr }) => `${stdout}\n${stderr}`.includes('--plugin-dir'))
        .catch(() => false)
    );
  }
  return runPluginSupportPromises.get(providerId);
};

const registerMcpBridgeForRun = async ({
  getSender,
  threadId,
  projectPath,
  providerId,
  accessMode,
}) => {
  try {
    const { shimPath, socketPath } = await ensureMcpBridge();
    const token = crypto.randomUUID();
    // ELECTRON_RUN_AS_NODE turns Orion's own binary into a plain Node runtime;
    // forge.config.js deliberately keeps that fuse enabled for this shim.
    const command = process.execPath;
    const args = [shimPath, '--socket', socketPath, '--token', token];
    const { pluginDir, tokenRoot } = await writeMcpBridgePlugin({ token, command, args });
    mcpBridgeSessions.set(token, {
      getSender,
      threadId,
      projectPath,
      providerId,
      accessMode,
    });
    return {
      token,
      socketPath,
      shimPath,
      command,
      args,
      pluginDir,
      release: () => {
        mcpBridgeSessions.delete(token);
        void fs.rm(tokenRoot, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    console.error('Orion MCP bridge unavailable:', error);
    return null;
  }
};

// The ACP wire shape (session/new + session/load mcpServers) for the bridge.
const orionAcpMcpServers = (orionMcp) =>
  orionMcp
    ? [
        {
          name: 'orion',
          command: orionMcp.command,
          args: orionMcp.args,
          env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
        },
      ]
    : [];

const openCodeMcpConfigContent = (orionMcp, existingContent) => {
  if (!orionMcp) return null;
  let base = {};
  if (typeof existingContent === 'string' && existingContent.trim()) {
    try {
      base = JSON.parse(existingContent);
    } catch (error) {
      console.error('OpenCode inline config is invalid; Orion MCP bridge omitted:', error);
      return null;
    }
    if (!isPlainRecord(base)) {
      console.error('OpenCode inline config must be an object; Orion MCP bridge omitted.');
      return null;
    }
  }
  const existingMcp = base.mcp === undefined ? {} : base.mcp;
  if (!isPlainRecord(existingMcp)) {
    console.error('OpenCode inline `mcp` config must be an object; Orion MCP bridge omitted.');
    return null;
  }
  return JSON.stringify({
    ...base,
    mcp: {
      ...existingMcp,
      orion: {
        type: 'local',
        command: [orionMcp.command, ...orionMcp.args],
        environment: { ELECTRON_RUN_AS_NODE: '1' },
        enabled: true,
      },
    },
  });
};

// Remove only the persistent bridge entries written by the short-lived
// global-config implementation. Current runs use process-only plugins, so
// leaving these behind would load duplicate/stale Orion servers.
const grokMcpBlockStart = '# >>> orion mcp bridge >>>';
const grokMcpBlockEnd = '# <<< orion mcp bridge <<<';
const cleanupLegacyMcpBridgeConfigs = async () => {
  // Per-run plugins are disposable. A crash may leave an old tokenized
  // directory behind, but no active process can legitimately use it after a
  // fresh app launch.
  await fs
    .rm(path.join(app.getPath('userData'), 'mcp-runs'), { recursive: true, force: true })
    .catch(() => {});

  const grokConfigPath = path.join(os.homedir(), '.grok', 'config.toml');
  try {
    const existing = await fs.readFile(grokConfigPath, 'utf-8');
    const startIndex = existing.indexOf(grokMcpBlockStart);
    const endIndex =
      startIndex === -1 ? -1 : existing.indexOf(grokMcpBlockEnd, startIndex);
    if (startIndex !== -1 && endIndex !== -1) {
      const afterIndex = endIndex + grokMcpBlockEnd.length;
      const before = existing.slice(0, startIndex);
      let after = existing.slice(afterIndex);
      if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
      await fs.writeFile(grokConfigPath, `${before}${after}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Could not remove legacy Grok MCP bridge:', error);
  }

  const cursorConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  try {
    const existing = await fs.readFile(cursorConfigPath, 'utf-8');
    const config = JSON.parse(existing);
    const entry = config?.mcpServers?.orion;
    const legacyArgs = Array.isArray(entry?.args) ? entry.args : [];
    const isLegacyEntry =
      typeof entry?.command === 'string' &&
      legacyArgs.some(
        (value) => typeof value === 'string' && path.basename(value) === 'orion-mcp-bridge.cjs'
      ) &&
      entry?.env?.ELECTRON_RUN_AS_NODE === '1';
    if (isLegacyEntry) {
      delete config.mcpServers.orion;
      await fs.writeFile(cursorConfigPath, `${JSON.stringify(config, null, 2)}\n`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Could not remove legacy Cursor MCP bridge:', error);
  }
};

// In-process MCP server offered to every Claude SDK session (not only
// orchestrator ones — @-mentions can request delegation from any thread).
// The tool asks the renderer to spawn a subthread on another model and
// blocks until the subagent's final report arrives.
const createOrionMcpServer = ({ createSdkMcpServer, tool }, session) =>
  createSdkMcpServer({
    name: 'orion',
    version: '1.0.0',
    tools: [
      tool(
        'spawn_subagent',
        'Spawn an Orion subagent on a specific model to perform a task. Blocks until the subagent finishes and returns its final report. Safe to call multiple times in one message — parallel calls run their subagents concurrently. Use for delegating work to specialized models (computer use, exploration, implementation, image/video generation).',
        {
          model: z.string().describe('Target model: model id (e.g. "codex:gpt-5.6-sol"), slug, or label'),
          prompt: z
            .string()
            .describe('Complete, self-contained task for the subagent, including all context it needs and what to report back'),
          title: z.string().optional().describe('Short title for the subthread shown in the sidebar'),
          role: z
            .string()
            .optional()
            .describe('Orchestration role this delegation fulfils: computerUse | exploring | implementation | imageVideoGen'),
        },
        async (args) => {
          const resultText = await requestSubagentSpawn(
            {
              getSender: () => session.sender,
              threadId: session.threadId,
              projectPath: session.projectPath,
              accessMode: session.accessMode,
            },
            args
          );
          return { content: [{ type: 'text', text: resultText }] };
        },
        {
          // Claude Code only runs MCP tool calls from one assistant message
          // concurrently when the tool's annotations declare readOnlyHint
          // (isConcurrencySafe falls back to false otherwise) — without it,
          // parallel spawn_subagent calls serialize behind the first child's
          // entire multi-minute run. The hint is honest enough: the call
          // mutates nothing in the driver's session, and the spawned child
          // inherits the driver's access mode rather than escalating it.
          annotations: { readOnlyHint: true },
        }
      ),
    ],
  });

// Legacy extra-flags string ("--foo bar --baz") -> SDK extraArgs map.
const claudeExtraArgsMap = (extraArgsString) => {
  const tokens = parseExtraArgs(extraArgsString);
  const map = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const eq = key.indexOf('=');
    if (eq !== -1) {
      map[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      map[key] = next;
      i += 1;
    } else {
      map[key] = null;
    }
  }
  return map;
};

const claudeSdkOptionsForInput = (model, input) => {
  const accessMode = input.accessMode || 'full-access';
  const providerOptions =
    input.providerOptions && typeof input.providerOptions === 'object' ? input.providerOptions : {};
  const reasoningEffort = input.claudeReasoningEffort || defaultClaudeReasoningEffort;
  const contextWindow = input.claudeContextWindow || defaultClaudeContextWindow;
  // Browser MCP tools can mutate signed-in external state, so Read only must
  // not expose or pre-approve them even though the filesystem sandbox would
  // otherwise remain intact.
  const chrome = providerOptions.chrome === true && accessMode !== 'read-only';
  const allowedTools =
    accessMode !== 'full-access'
      ? String(providerOptions.allowedTools || '')
          .split(',')
          .map((tool) => tool.trim())
          .filter(
            (tool) =>
              Boolean(tool) &&
              (accessMode !== 'read-only' || !tool.startsWith('mcp__claude-in-chrome'))
          )
      : [];
  // Claude in Chrome tools are MCP tools; headless runs can't show permission
  // prompts, so Workspace write pre-approves the server. Read only disabled it
  // above because browser actions are external mutations.
  if (chrome && accessMode !== 'full-access') allowedTools.push('mcp__claude-in-chrome');
  const extraArgs = claudeExtraArgsMap(providerOptions.extraArgs);
  // Browser control via the Claude Chrome extension. Verified to work in
  // headless --print/stream-json sessions (exposes mcp__claude-in-chrome__*).
  if (chrome) extraArgs.chrome = null; // bare --chrome flag
  return {
    model: claudeModelArgForContextWindow(model.slug, contextWindow),
    effort: claudeEffortForCli(reasoningEffort),
    accessMode,
    ultracode: reasoningEffort === 'ultracode',
    allowedTools,
    extraArgs,
  };
};

// Async iterable the SDK reads user turns from; push() hands the next turn to
// a paused reader, close() ends the stream (and with it the CLI process).
const createClaudeInputQueue = () => {
  const pending = [];
  let wake = null;
  let closed = false;
  return {
    push(message) {
      pending.push(message);
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve();
      }
    },
    close() {
      closed = true;
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve();
      }
    },
    async *stream() {
      while (true) {
        while (pending.length > 0) yield pending.shift();
        if (closed) return;
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
    },
  };
};

const claudeStatsFromResult = (result) => {
  const usage = result?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const inputTokens =
    (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + cachedRead;
  const outputTokens = usage.output_tokens ?? 0;
  if (inputTokens + outputTokens <= 0) return null;
  return {
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    cachedReadTokens: cachedRead,
  };
};

const CLAUDE_SDK_REASONING_EMIT_INTERVAL_MS = 150;

const createClaudeTurnState = (runId, snapshot) => ({
  runId,
  snapshot,
  streamContext: { textSeen: false },
  knownToolActivities: new Map(),
  reasoningText: '',
  reasoningEmitTimer: null,
  lastReasoningEmitAt: 0,
});

const sendClaudeTurnReasoning = (session, turn, status = 'running') => {
  const detail = turn.reasoningText.trim();
  if (!detail) return;
  emitAgentEvent(session.sender, {
    runId: turn.runId,
    threadId: session.threadId,
    type: 'activity',
    activity: { key: `${turn.runId}:reasoning`, type: 'thought', title: 'Reasoning', detail, status },
  });
};

const queueClaudeTurnReasoning = (session, turn) => {
  const elapsed = Date.now() - turn.lastReasoningEmitAt;
  if (elapsed >= CLAUDE_SDK_REASONING_EMIT_INTERVAL_MS) {
    turn.lastReasoningEmitAt = Date.now();
    sendClaudeTurnReasoning(session, turn);
    return;
  }
  if (turn.reasoningEmitTimer) return;
  turn.reasoningEmitTimer = setTimeout(() => {
    turn.reasoningEmitTimer = null;
    turn.lastReasoningEmitAt = Date.now();
    sendClaudeTurnReasoning(session, turn);
  }, CLAUDE_SDK_REASONING_EMIT_INTERVAL_MS - elapsed);
};

const finishClaudeTurnReasoning = (session, turn) => {
  if (turn.reasoningEmitTimer) {
    clearTimeout(turn.reasoningEmitTimer);
    turn.reasoningEmitTimer = null;
  }
  sendClaudeTurnReasoning(session, turn, 'done');
};

// Only model output opens a turn on its own; bookkeeping system messages
// (background_tasks_changed, task_updated, status, ...) between turns don't.
// task_notification specifically must NOT open a turn: the harness sometimes
// delivers the notification without re-invoking the model, and a turn opened
// for it would never receive a `result` — leaving the thread stuck "running"
// forever (and poisoning the FIFO turn queue for every later turn). Pending
// notifications are stashed and flushed into the next turn that opens.
const claudeMessageOpensTurn = (message) =>
  message?.type === 'assistant' || message?.type === 'stream_event';

// Claude Code's visible task list (the TUI's ctrl+t checklist) is driven by
// the TaskCreate/TaskUpdate tools (legacy CLIs: TodoWrite). Track them into a
// session-scoped task map — the CLI's list persists across turns — and emit
// the same 'plan' activity shape grok's ACP plan updates produce, so the
// renderer's existing task-checklist card renders Claude tasks unchanged.
// The raw tool rows are suppressed via session.taskToolUseIds (both the
// tool_use row and its tool_result update) so the plan card is the only
// surface, matching the Claude Code TUI.
const CLAUDE_TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);
const CLAUDE_TASK_STATUSES = new Set(['pending', 'in_progress', 'completed']);

// Returns true when the session's task list changed.
const processClaudeTaskMessage = (session, message) => {
  const content = Array.isArray(message?.message?.content) ? message.message.content : [];
  let changed = false;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;

    if (part.type === 'tool_use' && CLAUDE_TASK_TOOLS.has(part.name)) {
      if (typeof part.id === 'string') session.taskToolUseIds.add(part.id);
      if (part.name === 'TodoWrite') {
        // Legacy full-replacement list: input.todos is the complete new state.
        const todos = Array.isArray(part.input?.todos) ? part.input.todos : [];
        session.tasks = new Map(
          todos.map((todo, index) => [
            `todo:${index}`,
            {
              subject: String(todo?.content ?? ''),
              status: CLAUDE_TASK_STATUSES.has(todo?.status) ? todo.status : 'pending',
            },
          ])
        );
        changed = true;
      } else if (typeof part.id === 'string') {
        // TaskCreate/TaskUpdate apply on their tool_result: the create result
        // carries the harness-assigned task id, and applying on the result
        // also skips calls that errored or were interrupted.
        session.pendingTaskToolUses.set(part.id, { name: part.name, input: part.input ?? {} });
      }
      continue;
    }

    if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
      const pending = session.pendingTaskToolUses.get(part.tool_use_id);
      if (!pending) continue;
      session.pendingTaskToolUses.delete(part.tool_use_id);
      if (part.is_error === true) continue;
      // The CLI/SDK put the structured result on the message envelope.
      const structured = message?.tool_use_result;

      if (pending.name === 'TaskCreate') {
        const subject = String(pending.input.subject ?? pending.input.description ?? '').trim();
        let taskId = structured?.task?.id != null ? String(structured.task.id) : null;
        if (!taskId) {
          const text = typeof part.content === 'string' ? part.content : '';
          taskId = /Task #(\S+?):?\s/.exec(`${text} `)?.[1] ?? crypto.randomUUID();
        }
        session.tasks.set(taskId, { subject: subject || `Task #${taskId}`, status: 'pending' });
        changed = true;
      } else if (pending.name === 'TaskUpdate') {
        const taskId = pending.input.taskId != null ? String(pending.input.taskId) : null;
        if (!taskId) continue;
        const status = String(structured?.statusChange?.to ?? pending.input.status ?? '');
        const task = session.tasks.get(taskId) ?? { subject: `Task #${taskId}`, status: 'pending' };
        if (typeof pending.input.subject === 'string' && pending.input.subject.trim()) {
          task.subject = pending.input.subject.trim();
        }
        if (status === 'deleted' || status === 'cancelled') {
          session.tasks.delete(taskId);
        } else {
          if (CLAUDE_TASK_STATUSES.has(status)) task.status = status;
          session.tasks.set(taskId, task);
        }
        changed = true;
      }
    }
  }
  return changed;
};

// Same activity shape as grok's handlePlanUpdate so the renderer's plan card
// (checklist + "Tasks (n/m)" header) applies unchanged.
const claudeTaskPlanActivity = (session) => {
  const list = [...session.tasks.values()];
  const total = list.length;
  const completed = list.filter((task) => task.status === 'completed').length;
  const active = list.find((task) => task.status === 'in_progress');
  return {
    key: 'plan',
    type: 'plan',
    kind: 'plan',
    title: active
      ? `Tasks (${completed}/${total}) - ${stringifySummary(active.subject, 60)}`
      : `Tasks (${completed}/${total})`,
    status: total > 0 && completed === total ? 'done' : 'running',
    plan: list.map((task) => ({ content: task.subject, status: task.status })),
  };
};

const claudeTaskNotificationActivity = (message) => ({
  key: `task:${message.task_id ?? crypto.randomUUID()}`,
  type: 'tool',
  title: `Background task ${message.status ?? 'update'}`,
  detail: stringifySummary(message.summary ?? message.task_id, 300),
  status: 'done',
});

// Emit any task notifications that arrived while no turn was active into the
// turn that just opened (the model reacts to them in that turn anyway).
const flushPendingClaudeTaskNotifications = (session, turn) => {
  const pending = session.pendingTaskNotifications.splice(0);
  for (const activity of pending) {
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: 'activity',
      activity,
    });
  }
};

// Background tasks the model is genuinely waiting on: subagents and workflows
// (local or remote) settle and re-invoke the model via a task notification.
// local_bash is deliberately excluded — a dev server left running in the
// background never "finishes" and must not pin the thread in a working state.
const claudeAwaitedBackgroundTaskTypes = /agent|workflow/i;

const pendingClaudeBackgroundTasks = (session) =>
  [...session.backgroundTasks.entries()]
    .filter(
      ([taskId, task]) =>
        claudeAwaitedBackgroundTaskTypes.test(task.taskType) &&
        !session.skipTranscriptTaskIds.has(taskId)
    )
    .map(([, task]) => task.description);

// A thread left "working" by a done event that carried pending background
// tasks normally settles when a finished task's notification re-invokes the
// model (that turn's own done event finishes the thread). This timer covers
// the paths that never re-invoke — the task was killed or failed, or its
// notification was suppressed — so the thread can't hang in the working state.
// The delay gives an imminent task_notification time to open its turn first.
const CLAUDE_BACKGROUND_SETTLE_DELAY_MS = 5000;
const updateClaudeBackgroundSettle = (session) => {
  const shouldSettle =
    !session.ended &&
    session.activeTurns.length === 0 &&
    pendingClaudeBackgroundTasks(session).length === 0;
  if (!shouldSettle) {
    if (session.backgroundSettleTimer) {
      clearTimeout(session.backgroundSettleTimer);
      session.backgroundSettleTimer = null;
    }
    return;
  }
  if (session.backgroundSettleTimer) return;
  session.backgroundSettleTimer = setTimeout(() => {
    session.backgroundSettleTimer = null;
    if (session.activeTurns.length > 0) return;
    clearClaudeBackgroundRun(session);
    emitAgentEvent(session.sender, {
      runId: crypto.randomUUID(),
      threadId: session.threadId,
      type: 'background-settled',
    });
  }, CLAUDE_BACKGROUND_SETTLE_DELAY_MS);
};

const finalizeClaudeTurn = async (session, resultMessage) => {
  const turn = session.activeTurns.shift();
  if (!turn) return;
  finishClaudeTurnReasoning(session, turn);
  let changedFiles = [];
  try {
    changedFiles = await summarizeChangedFiles(session.projectPath, turn.snapshot);
    // Refresh the baseline so a later harness-initiated turn attributes the
    // files that background agents change while the thread sits idle.
    session.lastTurnEndSnapshot = await captureGitChangeSnapshot(session.projectPath);
  } catch {}
  const stats = claudeStatsFromResult(resultMessage);
  // Error results (auth failure, max turns, execution error) must not read
  // as a finished run. When subtype is 'success' the error text has already
  // streamed as a chunk via the adapter, so keep the event's message short.
  const resultIsError = resultMessage?.is_error === true;
  let errorText = null;
  if (resultIsError) {
    const details = Array.isArray(resultMessage.errors)
      ? resultMessage.errors.filter(Boolean).join('; ')
      : '';
    errorText =
      details ||
      (resultMessage.subtype && resultMessage.subtype !== 'success'
        ? `Claude ended the turn with an error (${resultMessage.subtype}).`
        : 'Claude reported an error for this turn.');
  }
  // Background subagents/workflows still running when the turn ended: the
  // done event carries them so the renderer keeps the thread in the working
  // state instead of flipping it to Finished between turns. The harness will
  // re-invoke the model (a synthetic turn) when each task settles.
  const pendingBackgroundTasks = resultIsError ? [] : pendingClaudeBackgroundTasks(session);
  if (pendingBackgroundTasks.length > 0) {
    retainClaudeBackgroundRun(session, turn.runId);
  } else {
    clearClaudeBackgroundRun(session);
  }
  emitAgentEvent(session.sender, {
    runId: turn.runId,
    threadId: session.threadId,
    type: resultIsError ? 'error' : 'done',
    exitCode: resultIsError ? 1 : 0,
    changedFiles,
    ...(stats ? { stats } : {}),
    ...(errorText ? { error: errorText } : {}),
    ...(pendingBackgroundTasks.length > 0 ? { pendingBackgroundTasks } : {}),
  });
};

// Lazy per-session tracker for claude-native subagents (the harness's task
// system). Lives on the session, not a turn: a subagent can span turn
// boundaries (backgrounded Agent tool), and the tracker survives with it.
const claudeSessionSubagentTracker = (session) => {
  if (!session.subagentTracker) {
    session.subagentTracker = createSubagentTracker({
      providerId: 'claude',
      threadId: session.threadId,
      getSender: () => session.sender,
      getRunId: () =>
        session.activeTurns[0]?.runId ?? session.backgroundRunId ?? 'claude-session',
    });
  }
  return session.subagentTracker;
};

const handleClaudeSessionMessage = async (session, message) => {
  if (!session.sessionId) {
    const sessionId = extractSessionIdFromJsonEvent('claude', message);
    if (sessionId) {
      session.sessionId = sessionId;
      const runId = session.activeTurns[0]?.runId;
      if (runId) {
        emitAgentEvent(session.sender, {
          runId,
          threadId: session.threadId,
          type: 'session',
          providerId: 'claude',
          sessionId,
        });
      }
    }
  }
  if (message?.type === 'system' && message.subtype === 'init') session.sawInit = true;

  // Track the harness's live background tasks so a turn that ends while
  // subagents are still running doesn't read as Finished. skip_transcript
  // tasks are ambient housekeeping and never hold the thread open.
  if (message?.type === 'system' && message.subtype === 'task_started' && message.skip_transcript) {
    session.skipTranscriptTaskIds.add(message.task_id);
  }
  // A spawned subagent: tail its task output file (the subagent's own
  // session transcript) so the renderer can show it as a live, switchable
  // subagent thread.
  if (
    message?.type === 'system' &&
    message.subtype === 'task_started' &&
    !message.skip_transcript &&
    message.task_id &&
    /agent/i.test(String(message.task_type ?? ''))
  ) {
    const tracker = claudeSessionSubagentTracker(session);
    const taskId = message.task_id;
    const fileRef = { path: typeof message.output_file === 'string' ? message.output_file : null };
    session.subagentFileRefs.set(taskId, fileRef);
    const candidates = session.sessionId
      ? claudeTaskOutputCandidates(session.projectPath, session.sessionId, taskId)
      : [];
    tracker.start(
      {
        id: taskId,
        title: String(message.description ?? 'Subagent'),
        kind: typeof message.subagent_type === 'string' ? message.subagent_type : undefined,
        prompt: typeof message.prompt === 'string' ? message.prompt : undefined,
      },
      {
        resolveFile: async () => {
          if (fileRef.path && existsSync(fileRef.path)) return fileRef.path;
          return candidates.find((candidate) => existsSync(candidate)) ?? null;
        },
        handleLine: handleClaudeSubagentLine,
      }
    );
  }
  // Terminal task updates lack the notification's stats/summary — finish
  // after a grace window unless the richer task_notification lands first.
  if (
    message?.type === 'system' &&
    message.subtype === 'task_updated' &&
    message.task_id &&
    session.subagentTracker?.has(message.task_id)
  ) {
    const status = message.patch?.status;
    if (status === 'failed' || status === 'killed') {
      session.subagentTracker.finish(message.task_id, { status: 'error' });
    } else if (status === 'completed') {
      session.subagentTracker.finishSoon(message.task_id, { status: 'done' });
    }
  }
  if (message?.type === 'system' && message.subtype === 'background_tasks_changed') {
    // REPLACE semantics: the payload is the complete live set after the change.
    session.backgroundTasks = new Map(
      (Array.isArray(message.tasks) ? message.tasks : []).map((task) => [
        task.task_id,
        {
          taskType: String(task.task_type ?? ''),
          description: String(task.description ?? task.task_id ?? ''),
        },
      ])
    );
    // A tracked subagent that left the live set without a terminal signal
    // (its notification was suppressed) still has to settle in the UI.
    if (session.subagentTracker) {
      for (const taskId of session.subagentTracker.ids()) {
        if (!session.backgroundTasks.has(taskId)) {
          session.subagentTracker.finishSoon(taskId, { status: 'done' });
        }
      }
    }
    updateClaudeBackgroundSettle(session);
    return;
  }

  let turn = session.activeTurns[0];

  // A task_notification never opens a turn (the harness may not re-invoke the
  // model for it, and a turn without a coming `result` dangles forever). With
  // no turn active, stash it; it flushes into the next turn that opens.
  if (message?.type === 'system' && message.subtype === 'task_notification') {
    if (message.task_id && session.subagentTracker?.has(message.task_id)) {
      const fileRef = session.subagentFileRefs.get(message.task_id);
      if (fileRef && typeof message.output_file === 'string') fileRef.path = message.output_file;
      session.subagentTracker.finish(message.task_id, {
        status: message.status === 'completed' ? 'done' : 'error',
        stats:
          typeof message.usage?.total_tokens === 'number'
            ? { totalTokens: message.usage.total_tokens }
            : undefined,
        summary: typeof message.summary === 'string' ? message.summary : undefined,
      });
    }
    const activity = claudeTaskNotificationActivity(message);
    if (turn) {
      emitAgentEvent(session.sender, {
        runId: turn.runId,
        threadId: session.threadId,
        type: 'activity',
        activity,
      });
    } else {
      session.pendingTaskNotifications.push(activity);
    }
    return;
  }

  if (!turn && claudeMessageOpensTurn(message)) {
    // The harness re-invoked the model between user turns (a background
    // subagent finished). Open a synthetic turn; the renderer adds a message.
    turn = createClaudeTurnState(crypto.randomUUID(), session.lastTurnEndSnapshot);
    session.activeTurns.push(turn);
    // The CLI owes this harness-initiated turn a result message of its own.
    session.resultsOwed += 1;
    updateClaudeBackgroundSettle(session); // a live turn cancels any pending settle
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: 'started',
      background: true,
      command: 'claude — background work continued',
    });
    flushPendingClaudeTaskNotifications(session, turn);
  }
  if (!turn) return;

  // The SDK yields the same message shapes the CLI's stream-json emits, so
  // the one-shot path's claude adapter functions apply unchanged.
  if (
    message?.type !== 'assistant' &&
    message?.type !== 'user' &&
    message?.type !== 'stream_event' &&
    message?.type !== 'result'
  ) {
    return;
  }

  const reasoningDelta = extractClaudeReasoningFromJsonEvent(message, turn.streamContext);
  if (reasoningDelta) {
    turn.reasoningText = `${turn.reasoningText}${reasoningDelta}`;
    queueClaudeTurnReasoning(session, turn);
  }

  // Task tools drive the live checklist card instead of generic tool rows.
  if (processClaudeTaskMessage(session, message)) {
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: 'activity',
      activity: claudeTaskPlanActivity(session),
    });
  }

  for (const { updateForKey, ...activity } of extractActivitiesFromJsonEvent(message)) {
    // Task tool calls and their results stay hidden — the plan card above is
    // their only surface (mirrors the Claude Code TUI).
    if (
      (activity.key && session.taskToolUseIds.has(activity.key)) ||
      (updateForKey && session.taskToolUseIds.has(updateForKey))
    ) {
      continue;
    }
    if (updateForKey) {
      const known = turn.knownToolActivities.get(updateForKey);
      if (known) {
        emitAgentEvent(session.sender, {
          runId: turn.runId,
          threadId: session.threadId,
          type: 'activity',
          activity: {
            ...known,
            key: updateForKey,
            status: activity.status === 'error' || activity.type === 'error' ? 'error' : 'done',
          },
        });
        continue;
      }
    }
    if (activity.key) {
      const { key, status, ...rest } = activity;
      turn.knownToolActivities.set(key, rest);
    }
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: 'activity',
      activity,
    });
  }

  const text = extractClaudeTextFromJsonEvent(message, turn.streamContext);
  if (text) {
    turn.streamContext.textSeen = true;
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: 'chunk',
      chunk: text,
    });
  }

  if (message?.type === 'result') {
    session.resultsOwed = Math.max(0, session.resultsOwed - 1);
    await finalizeClaudeTurn(session, message);
  }
};

const endClaudeSession = (session, error) => {
  if (session.ended) return;
  session.ended = true;
  clearClaudeBackgroundRun(session);
  session.subagentTracker?.dispose(
    session.disposed ? 'stopped' : error ? 'error' : 'done'
  );
  if (session.backgroundSettleTimer) {
    clearTimeout(session.backgroundSettleTimer);
    session.backgroundSettleTimer = null;
  }
  if (claudeSdkSessions.get(session.threadId) === session) {
    claudeSdkSessions.delete(session.threadId);
  }

  const pendingTurns = session.activeTurns.splice(0);

  // The stored session may be gone (harness cache cleared, expired, or a CLI
  // update): the process dies before its init event. Retry once fresh,
  // re-driving the same runId so the renderer's message keeps streaming.
  if (
    error &&
    !session.disposed &&
    !session.sawInit &&
    session.resumeSessionId &&
    session.firstPrompt &&
    pendingTurns.length > 0
  ) {
    emitAgentEvent(session.sender, {
      runId: pendingTurns[0].runId,
      threadId: session.threadId,
      type: 'chunk',
      chunk: '_Could not resume the previous session; starting a fresh one._\n\n',
    });
    const fresh = createClaudeSdkSession({
      ...session.createParams,
      resumeSessionId: null,
      forkSession: false,
    });
    claudeSdkSessions.set(session.threadId, fresh);
    fresh.activeTurns.push(pendingTurns[0]);
    fresh
      .start()
      .then(() => fresh.pushUserMessage(session.firstPrompt))
      .catch((startError) => {
        fresh.dispose();
        endClaudeSession(fresh, startError);
      });
    return;
  }

  for (const turn of pendingTurns) {
    finishClaudeTurnReasoning(session, turn);
    const stderrTail = session.stderrTail.trim();
    const errorText = session.disposed
      ? null
      : [error?.message ?? 'Claude session ended unexpectedly.', stderrTail]
          .filter(Boolean)
          .join('\n');
    emitAgentEvent(session.sender, {
      runId: turn.runId,
      threadId: session.threadId,
      type: session.disposed ? 'done' : 'error',
      exitCode: session.disposed ? 0 : 1,
      changedFiles: [],
      ...(errorText ? { error: errorText } : {}),
      // Lets the renderer offer the Authenticate button when the failure text
      // reads as a logged-out CLI (e.g. "OAuth session expired").
      ...(session.disposed ? {} : { providerId: 'claude' }),
    });
  }

  // A thread left waiting on background agents (its last done event carried
  // pending tasks, no turn active) must not stay "working" after the session
  // that owned those agents is gone (stop, options change, process death).
  // With pending turns the done/error events above already settle the thread.
  if (pendingTurns.length === 0) {
    emitAgentEvent(session.sender, {
      runId: crypto.randomUUID(),
      threadId: session.threadId,
      type: 'background-settled',
    });
  }
};

const pumpClaudeSession = async (session) => {
  try {
    for await (const message of session.query) {
      if (session.disposed) break;
      await handleClaudeSessionMessage(session, message);
    }
    endClaudeSession(session, null);
  } catch (error) {
    endClaudeSession(session, error);
  }
};

const createClaudeSdkSession = ({
  sender,
  threadId,
  projectPath,
  model,
  input,
  resumeSessionId,
  forkSession,
}) => {
  const sdkOptions = claudeSdkOptionsForInput(model, input);
  const inputQueue = createClaudeInputQueue();
  const abortController = new AbortController();
  const session = {
    threadId,
    projectPath,
    accessMode: sdkOptions.accessMode,
    sender,
    optionsKey: JSON.stringify([projectPath, sdkOptions]),
    createParams: { sender, threadId, projectPath, model, input },
    resumeSessionId: resumeSessionId ?? null,
    sessionId: null,
    sawInit: false,
    firstPrompt: null,
    activeTurns: [],
    // Task notifications that arrived while no turn was active; flushed as
    // activities into the next turn that opens.
    pendingTaskNotifications: [],
    // How many `result` messages the CLI still owes (one per pushed user turn
    // and per harness-initiated synthetic turn). When this hits zero, any
    // turn still queued can never finalize on its own — see
    // interruptClaudeSdkRun, which uses it to recover instead of interrupting.
    resultsOwed: 0,
    backgroundTasks: new Map(), // task_id -> { taskType, description }
    skipTranscriptTaskIds: new Set(),
    // Native subagents (Agent/Task tool): created lazily on first spawn.
    subagentTracker: null,
    subagentFileRefs: new Map(), // task_id -> { path } (output file, once known)
    // Visible task list (TaskCreate/TaskUpdate/TodoWrite) → plan activity.
    tasks: new Map(), // taskId -> { subject, status }
    pendingTaskToolUses: new Map(), // tool_use id -> { name, input }
    taskToolUseIds: new Set(), // suppress these ids from generic tool rows
    backgroundSettleTimer: null,
    backgroundRunId: null,
    lastTurnEndSnapshot: null,
    inputQueue,
    abortController,
    query: null,
    stderrTail: '',
    disposed: false,
    ended: false,
  };

  session.pushUserMessage = (text) => {
    if (session.firstPrompt === null) session.firstPrompt = text;
    session.resultsOwed += 1;
    inputQueue.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    });
  };

  session.start = async () => {
    const [sdk, claudeBinary] = await Promise.all([loadClaudeSdk(), resolveClaudeBinary()]);
    const orionMcpServer = createOrionMcpServer(sdk, session);
    // Headless runs can't show permission prompts, so outside bypass mode the
    // spawn tool must be pre-approved alongside any user-configured allowlist.
    const allowedTools =
      sdkOptions.accessMode === 'full-access'
        ? sdkOptions.allowedTools
        : [...new Set([...sdkOptions.allowedTools, 'mcp__orion__spawn_subagent'])];
    session.query = sdk.query({
      prompt: inputQueue.stream(),
      options: {
        cwd: projectPath,
        model: sdkOptions.model,
        effort: sdkOptions.effort,
        includePartialMessages: true,
        // Match the CLI's behavior: the SDK defaults to a minimal/empty
        // system prompt, which drops Claude Code's narration + progress-update
        // guidance (runs go silent between tool calls without it).
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        // Match the CLI's behavior: without this the SDK loads no user or
        // project settings — no CLAUDE.md, no skills, no MCP servers.
        settingSources: ['user', 'project', 'local'],
        mcpServers: { orion: orionMcpServer },
        ...(sdkOptions.ultracode ? { settings: JSON.stringify({ ultracode: true }) } : {}),
        ...(sdkOptions.accessMode === 'full-access'
          ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
          : { permissionMode: sdkOptions.accessMode === 'read-only' ? 'plan' : 'acceptEdits' }),
        ...(allowedTools.length > 0 ? { allowedTools } : {}),
        ...(Object.keys(sdkOptions.extraArgs).length > 0 ? { extraArgs: sdkOptions.extraArgs } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(forkSession ? { forkSession: true } : {}),
        ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
        abortController,
        stderr: (data) => {
          session.stderrTail = `${session.stderrTail}${data}`.slice(-2000);
        },
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      },
    });
    void pumpClaudeSession(session);
  };

  session.dispose = () => {
    if (session.disposed) return;
    session.disposed = true;
    inputQueue.close();
    try {
      abortController.abort();
    } catch {}
  };

  return session;
};

const runClaudeSdkTurn = async ({ sender, input, model, runId, initialSnapshot }) => {
  const threadId = input.threadId;
  const prompt =
    input.claudeReasoningEffort === 'ultrathink' ? `ultrathink\n\n${input.prompt}` : input.prompt;

  // The window can close and reopen (macOS keeps the app alive) while
  // sessions persist; a session bound to the old, destroyed webContents would
  // silently drop every event. Rebind to the live renderer on each turn.
  for (const persisted of claudeSdkSessions.values()) {
    if (persisted.sender.isDestroyed()) {
      persisted.sender = sender;
      persisted.createParams.sender = sender;
    }
  }

  const sdkOptions = claudeSdkOptionsForInput(model, input);
  const optionsKey = JSON.stringify([input.projectPath, sdkOptions]);
  const existing = claudeSdkSessions.get(threadId);
  let session =
    existing && !existing.ended && !existing.disposed && existing.optionsKey === optionsKey
      ? existing
      : null;
  if (session) {
    session.sender = sender;
    session.createParams.sender = sender;
  }

  if (existing && !session) {
    // Model, effort, access mode, or project changed: replace the harness
    // process, resuming the same conversation. Background agents started by
    // the old process do not survive this.
    existing.dispose();
  }

  if (!session) {
    const resumeSessionId =
      existing?.sessionId ??
      (typeof input.resumeSessionId === 'string' && input.resumeSessionId
        ? input.resumeSessionId
        : null);
    // A branched thread's first turn forks the parent session instead of
    // resuming it in place; replacement sessions resume their own id.
    const forkSession = Boolean(input.forkSession) && Boolean(resumeSessionId) && !existing;
    session = createClaudeSdkSession({
      sender,
      threadId,
      projectPath: input.projectPath,
      model,
      input,
      resumeSessionId,
      forkSession,
    });
    claudeSdkSessions.set(threadId, session);
    try {
      await session.start();
    } catch (error) {
      session.dispose();
      if (claudeSdkSessions.get(threadId) === session) claudeSdkSessions.delete(threadId);
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  // A new foreground instruction supersedes any retained "waiting on
  // background agents" handle. The background work itself remains owned by
  // this persistent session unless the caller explicitly disposes it.
  clearClaudeBackgroundRun(session);
  const snapshot =
    initialSnapshot === undefined
      ? await captureGitChangeSnapshot(input.projectPath)
      : initialSnapshot;
  const turn = createClaudeTurnState(runId, snapshot);
  session.activeTurns.push(turn);
  updateClaudeBackgroundSettle(session); // a live turn cancels any pending settle
  emitAgentEvent(sender, {
    runId,
    threadId,
    type: 'started',
    command: `claude --model ${sdkOptions.model} --effort ${sdkOptions.effort} (persistent session)`,
  });
  if (session.sessionId) {
    emitAgentEvent(sender, {
      runId,
      threadId,
      type: 'session',
      providerId: 'claude',
      sessionId: session.sessionId,
    });
  }
  session.pushUserMessage(prompt);
  // Notifications that landed while the thread sat idle (and never re-invoked
  // the model) surface in this turn — the model reads them here anyway.
  flushPendingClaudeTaskNotifications(session, turn);
  return { ok: true, runId };
};

const interruptClaudeSdkRun = async (runId, { terminateBackground = false } = {}) => {
  for (const session of claudeSdkSessions.values()) {
    if (session.activeTurns.some((turn) => turn.runId === runId)) {
      // The CLI owes no results: nothing is running, so there is nothing to
      // interrupt and the queued turns can never finalize on their own (a
      // legacy dangling turn, e.g. opened by a task_notification that never
      // re-invoked the model). Drain them as done so the thread un-wedges
      // instead of poisoning the FIFO for every later turn.
      if (session.resultsOwed <= 0) {
        while (session.activeTurns.length > 0) {
          await finalizeClaudeTurn(session, null);
        }
        if (terminateBackground) disposeClaudeSdkSession(session.threadId);
        return true;
      }
      if (terminateBackground) {
        // Explicit Stop: the user wants ALL work halted, including background
        // subagents still mutating the working tree. Interrupt is best-effort
        // (flushes an interrupted result into the transcript), then the whole
        // harness process is torn down; the next turn resumes the
        // conversation in a fresh process via the stored session id.
        try {
          await Promise.race([
            session.query?.interrupt?.(),
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ]);
        } catch {}
        disposeClaudeSdkSession(session.threadId);
        return true;
      }
      // Steer: interrupt the turn in place; the session and any background
      // subagents it spawned keep running. Await the CLI's acknowledgement so
      // the steer's follow-up prompt (pushed right after stopTurn resolves)
      // can't race the interrupt and be swallowed with the aborted turn —
      // but cap the wait so a wedged process can never hang the renderer.
      try {
        await Promise.race([
          session.query?.interrupt?.(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {}
      return true;
    }
  }
  const backgroundSession = claudeBackgroundRunSessions.get(runId);
  if (backgroundSession) {
    clearClaudeBackgroundRun(backgroundSession);
    if (terminateBackground) disposeClaudeSdkSession(backgroundSession.threadId);
    // With no foreground turn there is nothing to interrupt. Returning true
    // still acknowledges the retained handle; a steer may now push a fresh
    // instruction, while Stop disposes the session above.
    return true;
  }
  return false;
};

const disposeClaudeSdkSession = (threadId) => {
  const session = claudeSdkSessions.get(threadId);
  if (!session) return false;
  // Remove first so a late pump completion cannot affect a replacement
  // session created for the same thread id.
  claudeSdkSessions.delete(threadId);
  clearClaudeBackgroundRun(session);
  session.dispose();
  return true;
};

const disposeAllClaudeSdkSessions = () => {
  for (const session of claudeSdkSessions.values()) session.dispose();
  claudeSdkSessions.clear();
  claudeBackgroundRunSessions.clear();
};

// grok's stream ends with an explicit {"type":"end","stopReason":...} event,
// but the process (or a background process it spawned that inherited its
// pipes) can outlive it — treat the event itself as the completion signal.
const isTerminalJsonEvent = (providerId, value) =>
  providerId === 'grok' && value?.type === 'end';

const sendsJsonEvents = (providerId) =>
  ['claude', 'codex', 'cursor', 'grok', 'kimi'].includes(providerId);

// Finder-launched apps inherit launchd's minimal PATH, and most CLI
// installers (nvm, bun, grok, ...) export PATH from ~/.zshrc, which only
// interactive shells source. Capture the interactive login shell's PATH once
// at startup so provider detection and agent runs can find the CLIs.
const syncPathFromUserShell = async () => {
  if (process.platform === 'win32') return;
  try {
    const marker = '__ORION_PATH__';
    const { stdout } = await execFileAsync(
      loginShell,
      ['-ilc', `printf "${marker}%s${marker}" "$PATH"`],
      { timeout: 8000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } }
    );
    const match = stdout.match(/__ORION_PATH__([\s\S]*)__ORION_PATH__/);
    const shellPath = match?.[1]?.trim();
    if (!shellPath) return;
    const merged = [
      ...new Set([...shellPath.split(':'), ...String(process.env.PATH || '').split(':')]),
    ]
      .filter(Boolean)
      .join(':');
    process.env.PATH = merged;
  } catch {
    // Keep the inherited PATH; provider checks will report what they can see.
  }
};

const checkCommandAvailable = async (command) => {
  try {
    const { stdout } = await execFileAsync(loginShell, ['-lc', `command -v ${shellQuote(command)}`], {
      timeout: 4000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
};

const runShellCommand = async (command, timeout = 30000) => {
  const { stdout, stderr } = await execFileAsync(loginShell, ['-lc', command], {
    timeout,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stdout: stdout || '', stderr: stderr || '' };
};

const resolveCommandPath = async (command) => {
  try {
    const { stdout } = await runShellCommand(`command -v ${shellQuote(command)}`, 4000);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

const providerUpdaterConfigs = [
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    packageName: '@openai/codex',
    updateCommands: [['update']],
    authCommands: [['login']],
    statusCommand: ['login', 'status'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    packageName: '@anthropic-ai/claude-code',
    updateCommands: [['update']],
    authCommands: [['auth', 'login']],
    statusCommand: ['auth', 'status'],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    updateCommands: [['update']],
    authCommands: [['login']],
    statusCommand: ['status', '--format', 'json'],
  },
  {
    id: 'grok',
    label: 'Grok',
    command: 'grok',
    updateCommands: [['update']],
    checkCommand: ['update', '--check', '--json'],
    authCommands: [['login', '--oauth']],
    statusCommand: ['models'],
  },
  {
    id: 'kimi',
    label: 'Kimi Code',
    command: 'kimi',
    latestVersionUrl: 'https://code.kimi.com/kimi-code/latest',
    updateCommands: [['upgrade']],
    manualInstallCommandPattern: /To update manually, run:\s*([^\r\n]+)/i,
    verifyAfterUpdate: true,
    authCommands: [['login']],
    statusCommand: ['provider', 'list'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    packageName: 'opencode-ai',
    updateCommands: [['update'], ['upgrade']],
    authCommands: [['auth', 'login'], ['login']],
  },
];

const parseVersion = (value) => {
  const match = String(value || '').match(/\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/);
  return match ? match[0] : null;
};

const compareVersionStrings = (left, right) => {
  const leftParts = String(left || '').match(/\d+/g)?.map(Number) ?? [];
  const rightParts = String(right || '').match(/\d+/g)?.map(Number) ?? [];
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
};

const getProcessErrorMessage = (error) => {
  const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
  return output || error?.message || String(error);
};

const readCliVersion = async (command) => {
  try {
    const { stdout, stderr } = await runShellCommand(`${shellQuote(command)} --version`, 8000);
    return parseVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    return parseVersion(getProcessErrorMessage(error));
  }
};

const readNpmLatestVersion = async (packageName) => {
  try {
    const { stdout } = await runShellCommand(`npm view ${shellQuote(packageName)} version`, 20000);
    return parseVersion(stdout);
  } catch {
    return null;
  }
};

const readRemoteLatestVersion = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    return parseVersion(await response.text());
  } catch {
    return null;
  }
};

const parseJsonFromOutput = (output) => {
  const text = String(output || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const jsonLine = text
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith('{'));

  if (!jsonLine) return null;

  try {
    return JSON.parse(jsonLine);
  } catch {
    return null;
  }
};

const getProviderAuthStatus = async (config) => {
  if (!(await resolveCommandPath(config.command))) {
    return {
      authenticated: false,
      status: 'missing',
      label: 'Not installed',
      detail: `${config.command} is not installed.`,
    };
  }

  if (!config.statusCommand) {
    return {
      authenticated: null,
      status: 'unknown',
      label: 'Unknown',
      detail: 'No status command is available.',
    };
  }

  try {
    const command = [config.command, ...config.statusCommand].map(shellQuote).join(' ');
    const { stdout, stderr } = await runShellCommand(command, 15000);
    const output = `${stdout}\n${stderr}`.trim();
    const parsed = parseJsonFromOutput(output);
    const lowerOutput = output.toLowerCase();

    if (config.id === 'codex') {
      const authenticated = /logged in/i.test(output) && !/not logged in/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output,
      };
    }

    if (config.id === 'claude') {
      const authenticated = parsed
        ? parsed.loggedIn === true
        : /logged in|authenticated/i.test(output) && !/not logged/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: parsed?.email || parsed?.authMethod || output,
      };
    }

    if (config.id === 'cursor') {
      const authenticated = parsed
        ? parsed.isAuthenticated === true || parsed.status === 'authenticated'
        : /authenticated|logged in/i.test(output) && !/not authenticated|not logged/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: parsed?.message || parsed?.status || output,
      };
    }

    if (config.id === 'grok') {
      const authenticated =
        /logged in|available models|default model/i.test(output) &&
        !/not logged|unauthenticated|login required|sign in required/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : lowerOutput ? 'unauthenticated' : 'unknown',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output.split(/\r?\n/).find((line) => line.trim()) || output,
      };
    }

    if (config.id === 'kimi') {
      // `kimi provider list` prints the managed provider row (source=oauth)
      // and the default model when the CLI is configured and logged in.
      const authenticated =
        /source=oauth|default model/i.test(output) &&
        !/not logged|login required|unauthenticated|authentication required/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : lowerOutput ? 'unauthenticated' : 'unknown',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output.split(/\r?\n/).find((line) => line.trim()) || output,
      };
    }

    const authenticated =
      /authenticated|logged in|signed in/i.test(output) &&
      !/not authenticated|not logged|signed out/i.test(output);
    return {
      authenticated,
      status: authenticated ? 'authenticated' : 'unknown',
      label: authenticated ? 'Authenticated' : 'Unknown',
      detail: output,
    };
  } catch (error) {
    const message = getProcessErrorMessage(error);
    const unauthenticated = /unauth|not logged|login required|sign in required/i.test(message);
    return {
      authenticated: unauthenticated ? false : null,
      status: unauthenticated ? 'unauthenticated' : 'error',
      label: unauthenticated ? 'Not authenticated' : 'Status unavailable',
      detail: message,
    };
  }
};

const normalizeEnabledProviderIds = (input) => {
  if (!input || !Array.isArray(input.enabledProviderIds)) return null;
  return new Set(input.enabledProviderIds.map(String));
};

const checkProviderUpdate = async (config, enabledProviderIds = null) => {
  const commandPath = await resolveCommandPath(config.command);
  const enabled = !enabledProviderIds || enabledProviderIds.has(config.id);
  const auth = await getProviderAuthStatus(config);
  const base = {
    id: config.id,
    label: config.label,
    command: config.command,
    enabled,
    installed: Boolean(commandPath),
    path: commandPath,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    status: commandPath ? 'unknown' : 'missing',
    auth,
  };

  if (!commandPath) return base;

  const currentVersion = await readCliVersion(config.command);
  const withCurrentVersion = { ...base, currentVersion };

  if (config.checkCommand) {
    try {
      const command = [config.command, ...config.checkCommand].map(shellQuote).join(' ');
      const { stdout, stderr } = await runShellCommand(command, 30000);
      const payload = `${stdout}\n${stderr}`.trim();
      const jsonLine = payload
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('{'));
      const parsed = jsonLine ? JSON.parse(jsonLine) : JSON.parse(payload);
      const latestVersion = parseVersion(parsed.latestVersion);
      const reportedCurrentVersion = parseVersion(parsed.currentVersion) ?? currentVersion;
      const updateAvailable =
        enabled && (parsed.updateAvailable === true ||
        (reportedCurrentVersion && latestVersion
          ? compareVersionStrings(reportedCurrentVersion, latestVersion) < 0
          : false));

      return {
        ...withCurrentVersion,
        currentVersion: reportedCurrentVersion,
        latestVersion,
        updateAvailable,
        status: updateAvailable ? 'available' : 'current',
      };
    } catch (error) {
      return {
        ...withCurrentVersion,
        status: 'error',
        error: getProcessErrorMessage(error),
      };
    }
  }

  if (config.packageName) {
    const latestVersion = await readNpmLatestVersion(config.packageName);
    const updateAvailable =
      enabled && currentVersion && latestVersion
        ? compareVersionStrings(currentVersion, latestVersion) < 0
        : false;

    return {
      ...withCurrentVersion,
      latestVersion,
      updateAvailable,
      status: latestVersion ? (updateAvailable ? 'available' : 'current') : 'unknown',
    };
  }

  if (config.latestVersionUrl) {
    const latestVersion = await readRemoteLatestVersion(config.latestVersionUrl);
    const updateAvailable =
      enabled && currentVersion && latestVersion
        ? compareVersionStrings(currentVersion, latestVersion) < 0
        : false;

    return {
      ...withCurrentVersion,
      latestVersion,
      updateAvailable,
      status: latestVersion ? (updateAvailable ? 'available' : 'current') : 'unknown',
    };
  }

  return withCurrentVersion;
};

const checkProviderUpdates = async (input = {}) => {
  const enabledProviderIds = normalizeEnabledProviderIds(input);
  const providers = await Promise.all(
    providerUpdaterConfigs.map((config) => checkProviderUpdate(config, enabledProviderIds))
  );
  return {
    checkedAt: new Date().toISOString(),
    updatesAvailable: providers.filter((provider) => provider.updateAvailable).length,
    providers,
  };
};

const getProviderStatuses = async () => checkProviderUpdates();

const resolveProviderUpdateCommand = async (config) => {
  for (const args of config.updateCommands) {
    try {
      await runShellCommand([config.command, ...args, '--help'].map(shellQuote).join(' '), 8000);
      return args;
    } catch (error) {
      const output = getProcessErrorMessage(error);
      if (!/unknown command|invalid command|unrecognized subcommand|not found/i.test(output)) {
        return args;
      }
    }
  }

  return config.updateCommands[0] ?? null;
};

const updateProviderTool = async (config, expectedLatestVersion = null) => {
  const commandPath = await resolveCommandPath(config.command);
  if (!commandPath) {
    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: true,
      skipped: true,
      message: `${config.command} is not installed.`,
    };
  }

  const args = await resolveProviderUpdateCommand(config);
  if (!args) {
    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: false,
      error: `No updater command is configured for ${config.command}.`,
    };
  }

  const updateCommand = [config.command, ...args].map(shellQuote).join(' ');

  try {
    const { stdout, stderr } = await runShellCommand(updateCommand, 180000);
    const outputParts = [`${stdout}\n${stderr}`.trim()].filter(Boolean);
    const manualInstallCommand = config.manualInstallCommandPattern
      ? outputParts[0]?.match(config.manualInstallCommandPattern)?.[1]?.trim()
      : null;

    // Some self-updaters only print a source-specific install command when
    // stdin is not a TTY. Run that command explicitly so the background
    // update path performs the install instead of reporting a no-op success.
    if (manualInstallCommand) {
      const manualResult = await runShellCommand(manualInstallCommand, 180000);
      const manualOutput = `${manualResult.stdout}\n${manualResult.stderr}`.trim();
      if (manualOutput) outputParts.push(manualOutput);
    }

    if (config.verifyAfterUpdate && expectedLatestVersion) {
      const installedVersion = await readCliVersion(config.command);
      if (
        !installedVersion ||
        compareVersionStrings(installedVersion, expectedLatestVersion) < 0
      ) {
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: false,
          error: installedVersion
            ? `${config.label} is still on ${installedVersion}; expected ${expectedLatestVersion}.`
            : `Could not verify the installed ${config.label} version after updating.`,
          output: outputParts.join('\n\n'),
        };
      }
    }

    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: true,
      output: outputParts.join('\n\n'),
    };
  } catch (error) {
    if (config.packageName) {
      try {
        const fallbackCommand = `npm install -g ${shellQuote(`${config.packageName}@latest`)}`;
        const { stdout, stderr } = await runShellCommand(fallbackCommand, 180000);
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: true,
          output: `${stdout}\n${stderr}`.trim(),
        };
      } catch (fallbackError) {
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: false,
          error: getProcessErrorMessage(fallbackError),
        };
      }
    }

    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: false,
      error: getProcessErrorMessage(error),
    };
  }
};

const authenticateProviderTool = async (providerId) => {
  const config = providerUpdaterConfigs.find((provider) => provider.id === providerId);
  if (!config) return { ok: false, error: `Unknown provider: ${providerId}` };

  const commandPath = await resolveCommandPath(config.command);
  if (!commandPath) return { ok: false, error: `${config.command} is not installed.` };

  for (const args of config.authCommands ?? []) {
    try {
      const command = [config.command, ...args].map(shellQuote).join(' ');
      const child = spawn(loginShell, ['-lc', command], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: getProcessErrorMessage(error) };
    }
  }

  return { ok: false, error: `No authentication command is configured for ${config.command}.` };
};

const emitAgentEvent = (webContents, event) => {
  if (!webContents.isDestroyed()) {
    webContents.send('agent:turnEvent', event);
  }
};

const getGitStatusKind = (rawStatus) => {
  if (rawStatus === '??') return 'untracked';
  if (rawStatus.includes('U')) return 'conflicted';
  if (rawStatus.includes('D')) return 'deleted';
  if (rawStatus.includes('R')) return 'renamed';
  if (rawStatus.includes('C')) return 'copied';
  if (rawStatus.includes('A')) return 'added';
  if (rawStatus.includes('M')) return 'modified';
  return null;
};

const normalizeGitPath = (value) => value.replace(/^"|"$/g, '').replace(/\\/g, '/');

const getGitRoot = async (dirPath) => {
  const { stdout } = await execFileAsync('git', [
    '-C',
    dirPath,
    'rev-parse',
    '--show-toplevel',
  ]);
  return stdout.trim();
};

const parseGitStatusOutput = (stdout, gitRoot) => {
  const entries = [];

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const rawStatus = line.slice(0, 2);
    const kind = getGitStatusKind(rawStatus);
    if (!kind) continue;

    const rawPath = line.slice(3);
    const relativePath = normalizeGitPath(
      rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath
    );

    entries.push({
      kind,
      relativePath,
      fullPath: path.resolve(gitRoot, relativePath),
    });
  }

  return entries;
};

const readGitStatusEntries = async (gitRoot) => {
  const { stdout } = await execFileAsync('git', [
    '-C',
    gitRoot,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);

  return parseGitStatusOutput(stdout, gitRoot);
};

const getFileSignature = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return `dir:${stat.mtimeMs}`;
    }

    const content = await fs.readFile(filePath);
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    return `file:${stat.size}:${hash}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    return 'unknown';
  }
};

const captureGitChangeSnapshot = async (dirPath) => {
  try {
    const gitRoot = await getGitRoot(dirPath);
    const entries = await readGitStatusEntries(gitRoot);
    const signatures = new Map();

    await Promise.all(
      entries.map(async (entry) => {
        signatures.set(entry.relativePath, await getFileSignature(entry.fullPath));
      })
    );

    return { gitRoot, signatures };
  } catch {
    return null;
  }
};

const hasGitHead = async (gitRoot) => {
  try {
    await execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
};

const getLineCount = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    if (content.length === 0) return 0;
    const lines = content.split(/\r\n|\r|\n/).length;
    return /\r\n$|\r$|\n$/.test(content) ? lines - 1 : lines;
  } catch {
    return 0;
  }
};

const readNumstatMap = async (gitRoot) => {
  const numstat = new Map();

  if (!(await hasGitHead(gitRoot))) {
    return numstat;
  }

  try {
    const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'diff', '--numstat', 'HEAD']);
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
      const rawPath = pathParts.join('\t');
      const relativePath = normalizeGitPath(
        rawPath.includes(' => ') ? rawPath.split(' => ').pop().replace(/[{}]/g, '') : rawPath
      );
      numstat.set(relativePath, {
        additions: Number.parseInt(rawAdditions, 10) || 0,
        deletions: Number.parseInt(rawDeletions, 10) || 0,
      });
    }
  } catch {}

  return numstat;
};

const summarizeChangedFiles = async (dirPath, beforeSnapshot) => {
  try {
    const gitRoot = beforeSnapshot?.gitRoot ?? (await getGitRoot(dirPath));
    const [entries, numstat] = await Promise.all([readGitStatusEntries(gitRoot), readNumstatMap(gitRoot)]);
    const summaries = [];

    for (const entry of entries) {
      const signature = await getFileSignature(entry.fullPath);
      if (beforeSnapshot?.signatures.get(entry.relativePath) === signature) {
        continue;
      }

      let counts = numstat.get(entry.relativePath);
      if (!counts && (entry.kind === 'added' || entry.kind === 'untracked')) {
        counts = {
          additions: await getLineCount(entry.fullPath),
          deletions: 0,
        };
      }

      summaries.push({
        path: entry.relativePath,
        status: entry.kind,
        additions: counts?.additions ?? 0,
        deletions: counts?.deletions ?? 0,
      });
    }

    summaries.sort((a, b) => a.path.localeCompare(b.path));
    return summaries;
  } catch {
    return [];
  }
};

const gitStatusLabels = {
  added: 'A',
  copied: 'C',
  conflicted: '!',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

const gitStatusRank = {
  conflicted: 0,
  deleted: 1,
  modified: 2,
  added: 3,
  renamed: 4,
  copied: 5,
  untracked: 6,
};

const getGitStatusMap = async (dirPath) => {
  try {
    const gitRoot = await getGitRoot(dirPath);
    const entries = await readGitStatusEntries(gitRoot);

    const directStatuses = new Map();
    const aggregateStatuses = new Map();

    for (const entry of entries) {
      const status = {
        kind: entry.kind,
        label: gitStatusLabels[entry.kind],
      };

      directStatuses.set(entry.fullPath, status);

      let ancestor = path.dirname(entry.fullPath);
      while (ancestor.startsWith(gitRoot) && ancestor !== gitRoot) {
        const existing = aggregateStatuses.get(ancestor);
        if (!existing || gitStatusRank[entry.kind] < gitStatusRank[existing.kind]) {
          aggregateStatuses.set(ancestor, status);
        }
        ancestor = path.dirname(ancestor);
      }
    }

    return { directStatuses, aggregateStatuses };
  } catch {
    return { directStatuses: new Map(), aggregateStatuses: new Map() };
  }
};

const commandSucceeds = async (command, args) => {
  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
};

const getCurrentGitBranch = async (gitRoot) => {
  const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'branch', '--show-current']);
  const branch = stdout.trim();
  if (branch) return branch;

  const rev = await execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--short', 'HEAD']);
  return rev.stdout.trim();
};

const readGitBranches = async (gitRoot, currentBranch) => {
  const { stdout } = await execFileAsync('git', [
    '-C',
    gitRoot,
    'for-each-ref',
    '--format=%(refname:short)\t%(upstream:short)',
    'refs/heads',
  ]);

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, upstream] = line.split('\t');
      return {
        name,
        current: name === currentBranch,
        hasUpstream: Boolean(upstream),
      };
    })
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
};

const readGitAheadBehind = async (gitRoot) => {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      gitRoot,
      'rev-list',
      '--left-right',
      '--count',
      '@{u}...HEAD',
    ]);
    const [behind, ahead] = stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
};

const getGitStateForPath = async (projectPath) => {
  const gitRoot = await getGitRoot(projectPath);
  const [currentBranch, entries, aheadBehind] = await Promise.all([
    getCurrentGitBranch(gitRoot),
    readGitStatusEntries(gitRoot),
    readGitAheadBehind(gitRoot),
  ]);
  const branches = await readGitBranches(gitRoot, currentBranch);

  return {
    ok: true,
    root: gitRoot,
    currentBranch,
    branches,
    hasUncommittedChanges: entries.length > 0,
    ...aheadBehind,
  };
};

const validateNewBranchName = async (branchName) => {
  if (!branchName || branchName.startsWith('-')) return false;
  return commandSucceeds('git', ['check-ref-format', '--branch', branchName]);
};

const commitMessageForEntries = (entries) => {
  if (entries.length === 0) return 'Update project';
  if (entries.length === 1) {
    const [entry] = entries;
    const verbs = {
      added: 'Add',
      copied: 'Copy',
      conflicted: 'Resolve',
      deleted: 'Remove',
      modified: 'Update',
      renamed: 'Rename',
      untracked: 'Add',
    };
    return `${verbs[entry.kind] ?? 'Update'} ${entry.relativePath}`;
  }

  const counts = entries.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {});
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'modified';
  const labels = {
    added: 'new files',
    copied: 'copied files',
    conflicted: 'conflict resolutions',
    deleted: 'removed files',
    modified: 'files',
    renamed: 'renamed files',
    untracked: 'new files',
  };
  return `Update ${entries.length} ${labels[dominant] ?? 'files'}`;
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
    const liveStore = path.join(liveUserData, storageFileName);
    const devStore = path.join(devUserData, storageFileName);
    if (!existsSync(devStore) && existsSync(liveStore)) {
      copyFileSync(liveStore, devStore);
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

const getAppIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(app.getAppPath(), 'assets', 'icon.png');
};

const getAppUpdateFeedUrl = () => {
  const baseUrl = process.env.ORION_UPDATE_FEED_URL || 'https://orioncode.xyz/api/update/macos';
  const arch = process.arch === 'x64' ? 'x64' : 'arm64';
  return `${baseUrl.replace(/\/$/, '')}/${arch}/`;
};

const publishAppUpdateState = (patch) => {
  appUpdateState = {
    ...appUpdateState,
    ...patch,
    currentVersion: app.getVersion(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('appUpdate:state', appUpdateState);
  }

  return appUpdateState;
};

const initializeAppUpdater = async () => {
  if (appUpdateInitialized) return;
  appUpdateInitialized = true;

  // electron-forge does not generate the app-update.yml that electron-builder
  // ships in Resources, and electron-updater insists on reading one when
  // downloading (it holds the cache-dir config). Write an equivalent file to
  // user data and point the updater at it.
  try {
    const updateConfigPath = path.join(app.getPath('userData'), 'app-update.yml');
    await fs.writeFile(
      updateConfigPath,
      ['provider: generic', `url: ${getAppUpdateFeedUrl()}`, 'updaterCacheDirName: orion-updater', ''].join('\n')
    );
    autoUpdater.updateConfigPath = updateConfigPath;
  } catch {
    // Checking still works via setFeedURL below; download will surface errors.
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Differential download fetches blockmaps and many byte ranges against the
  // feed's signed URL; any of those requests landing after the signature
  // expires 403s the whole update. One plain GET keeps the window small.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: getAppUpdateFeedUrl(),
  });

  autoUpdater.on('checking-for-update', () => {
    // Background re-checks (the startup timer, the 2h interval) must not hide
    // the update button while a download is in flight or already staged.
    if (appUpdateState.status === 'downloading' || appUpdateState.status === 'downloaded') return;
    publishAppUpdateState({
      status: 'checking',
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    const availableVersion = info?.version ?? null;

    // This fires on every check, including background re-checks that race a
    // just-finished download. If this exact version is already staged, keep
    // the 'downloaded' state so "Restart to update" doesn't revert to
    // "Install update" and prompt a second download of the same bytes.
    if (availableVersion && availableVersion === appUpdateDownloadedVersion) {
      publishAppUpdateState({
        status: 'downloaded',
        availableVersion,
        checkedAt: new Date().toISOString(),
        progress: null,
        error: null,
      });
      return;
    }
    if (appUpdateState.status === 'downloading' && availableVersion === appUpdateState.availableVersion) {
      return;
    }

    publishAppUpdateState({
      status: 'available',
      availableVersion,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });

    // With autoInstallOnAppQuit, a previously downloaded update stays staged
    // and would install on quit even after newer releases ship. Re-download
    // so the staged update is always the latest one.
    if (appUpdateDownloadedVersion && availableVersion && appUpdateDownloadedVersion !== availableVersion) {
      void autoUpdater.downloadUpdate().catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', () => {
    publishAppUpdateState({
      status: 'not-available',
      availableVersion: null,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    publishAppUpdateState({
      status: 'downloading',
      progress: {
        percent: Number.isFinite(progress?.percent) ? progress.percent : 0,
        transferred: progress?.transferred ?? 0,
        total: progress?.total ?? 0,
        bytesPerSecond: progress?.bytesPerSecond ?? 0,
      },
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    appUpdateDownloadedVersion = info?.version ?? appUpdateState.availableVersion;
    publishAppUpdateState({
      status: 'downloaded',
      availableVersion: info?.version ?? appUpdateState.availableVersion,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('error', (error) => {
    publishAppUpdateState({
      status: 'error',
      progress: null,
      error: error?.message ?? 'Update failed',
    });
  });
};

const checkForAppUpdate = async () => {
  if (!app.isPackaged) {
    return publishAppUpdateState({
      status: 'not-available',
      checkedAt: new Date().toISOString(),
      error: null,
    });
  }

  await initializeAppUpdater();
  await autoUpdater.checkForUpdates();
  return appUpdateState;
};

const scheduleAppUpdateChecks = () => {
  if (!app.isPackaged) return;

  setTimeout(() => {
    void checkForAppUpdate().catch((error) => {
      publishAppUpdateState({
        status: 'error',
        checkedAt: new Date().toISOString(),
        error: error?.message ?? 'Could not check for updates',
      });
    });
  }, 10000);

  if (appUpdateCheckTimer) clearInterval(appUpdateCheckTimer);
  appUpdateCheckTimer = setInterval(() => {
    void checkForAppUpdate().catch(() => {});
  }, 2 * 60 * 60 * 1000);
}

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

  await syncPathFromUserShell();
  await cleanupLegacyMcpBridgeConfigs();

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
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // On macOS the main process remains alive after the last window closes.
  // Tear down persistent sessions so their output is not sent to destroyed
  // webContents and background agents cannot keep working invisibly.
  disposeAllClaudeSdkSessions();
  disposeAllTerminalSessions();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Persistent claude sessions outlive individual turns; kill their CLI
// processes (and any background subagents inside them) when Orion exits.
app.on('will-quit', () => {
  disposeAllClaudeSdkSessions();
  disposeAllTerminalSessions();
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
  storageSaveQueue = storageSaveQueue.then(async () => {
    const storagePath = getStorageFilePath();
    const tempPath = `${storagePath}.${process.pid}.tmp`;
    const sanitized = sanitizeStoreValue(value) ?? value;
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(tempPath, sanitized, 'utf-8');
    await fs.rename(tempPath, storagePath);
  });

  try {
    await storageSaveQueue;
    return true;
  } catch (error) {
    console.error('storage:save error', error);
    return false;
  }
});

ipcMain.handle('storage:clear', async () => {
  try {
    await fs.rm(getStorageFilePath(), { force: true });
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
    const items = await Promise.all(
      entries
        .filter((e) => !(e.isDirectory() && hiddenSystemDirectories.has(e.name)))
        .map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let size = 0;
          try {
            if (!entry.isDirectory()) {
              const stat = await fs.stat(fullPath);
              size = stat.size;
            }
          } catch {}
          const directStatus = directStatuses.get(fullPath);
          const aggregateStatus = aggregateStatuses.get(fullPath);
          const status = directStatus ?? aggregateStatus ?? null;

          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size,
            gitStatus: status?.kind ?? null,
            gitStatusLabel: status?.label ?? null,
            hasChildGitStatus: !directStatus && Boolean(aggregateStatus),
          };
        })
    );
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
    return { ok: true, task: result.task };
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

ipcMain.handle('agent:listModels', async () => {
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

  const state = await checkProviderUpdates(input);
  const failed = results.filter((result) => !result.ok);

  return {
    ok: failed.length === 0,
    results,
    state,
    ...(failed.length > 0 ? { error: failed.map((result) => result.error).filter(Boolean).join('\n') } : {}),
  };
});

ipcMain.handle('providers:authenticate', async (_event, providerId) => authenticateProviderTool(providerId));

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

ipcMain.handle('appUpdate:check', async () => checkForAppUpdate());

ipcMain.handle('appUpdate:download', async () => {
  if (!app.isPackaged) return appUpdateState;
  await initializeAppUpdater();
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

ipcMain.handle('agent:runTurn', async (event, input) => {
  try {
    if (!input?.threadId || !input?.projectPath || !input?.prompt || !input?.modelId) {
      return { ok: false, error: 'Missing threadId, projectPath, prompt, or modelId.' };
    }

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
      stdio: [useAcp || useCodexGoal ? 'pipe' : 'ignore', 'pipe', 'pipe'],
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
    // Review runs use an ephemeral throwaway session — reporting its id would
    // overwrite the thread's real resumable codex session.
    let sessionIdReported = Boolean(input.codexReview);
    let finalized = false;
    let exitFallbackTimer = null;
    let terminalEventTimer = null;
    let runStats = null;
    // Set once the stream signals a completed turn — a nonzero exit after
    // that (e.g. from the SIGTERM that reaps a lingering agent process) must
    // not trigger the resume-failed retry.
    let turnCompleted = false;
    activeAgentRuns.set(runId, child);

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

    const finalizeRun = async (exitCode, { wasStopped = false } = {}) => {
      if (finalized) return;
      finalized = true;
      // Stopping a goal run is a successful pause, not a provider failure.
      // The renderer normally untracks explicit stops, but normalizing here
      // keeps any other caller from receiving a false error event.
      const finalExitCode = wasStopped && useCodexGoal ? 0 : exitCode;
      clearFinalizeTimers();
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
          child.kill('SIGTERM');
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
        child.kill('SIGTERM');
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
          child.kill('SIGTERM');
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
      : useCodexGoal
        ? createCodexAppServerDriver({
            child,
            cwd: input.projectPath,
            model,
            input: { ...input, orionMcp },
            goal: input.codexGoal,
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
              onGoalRunEnd: finishDriverRun,
            },
          })
        : null;
    if (useCodexGoal && acpDriver) codexGoalRunDrivers.set(runId, acpDriver);

    emitAgentEvent(event.sender, {
      runId,
      threadId: input.threadId,
      type: 'started',
      // Goal runs and flag-only review runs have no trailing prompt to strip.
      command: `${model.command} ${(
        useCodexGoal || (input.codexReview && !input.codexReview.instructions)
          ? args.slice(1)
          : args.slice(1, -1)
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
  }
});

ipcMain.handle('agent:stopTurn', async (_event, runId, options) => {
  if (await interruptClaudeSdkRun(runId, options)) return true;
  const child = activeAgentRuns.get(runId);
  if (!child) return false;
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
  child.kill('SIGTERM');
  activeAgentRuns.delete(runId);
  return true;
});

// Goal ops on a thread with no live goal run (pause after the run already
// ended, clear, status refresh). Runs a short-lived app-server dialog:
// initialize → thread/resume → goal op → kill.
const runCodexGoalOp = ({ sessionId, cwd, action }) =>
  new Promise((resolve) => {
    const child = spawn(loginShell, ['-lc', 'codex app-server'], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let nextId = 1;
    let buffer = '';
    const pending = new Map();
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill('SIGTERM');
      } catch {}
      resolve(value);
    };
    const timeout = setTimeout(() => settle({ ok: false, error: 'Codex app-server timed out.' }), 20000);
    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {}
    };
    const request = (method, params) =>
      new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        write({ jsonrpc: '2.0', id, method, params });
      });
    child.on('error', (error) => settle({ ok: false, error: error.message }));
    child.on('exit', () => settle({ ok: false, error: 'Codex app-server exited early.' }));
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const message = JSON.parse(trimmed);
          if (message.id !== undefined && !message.method && pending.has(message.id)) {
            const res = pending.get(message.id);
            pending.delete(message.id);
            res(message);
          }
        } catch {}
      }
    });
    (async () => {
      try {
        const init = await request('initialize', {
          clientInfo: { name: 'orion', title: 'Orion', version: app.getVersion?.() ?? '0.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        if (init.error) return settle({ ok: false, error: init.error.message });
        write({ jsonrpc: '2.0', method: 'initialized', params: {} });
        const resumed = await request('thread/resume', { threadId: sessionId, cwd });
        if (resumed.error) return settle({ ok: false, error: resumed.error.message });
        if (action === 'pause') {
          const result = await request('thread/goal/set', { threadId: sessionId, status: 'paused' });
          if (result.error) return settle({ ok: false, error: result.error.message });
          return settle({ ok: true, goal: result.result?.goal ? codexGoalForRenderer(result.result.goal) : null });
        }
        if (action === 'clear') {
          const result = await request('thread/goal/clear', { threadId: sessionId });
          if (result.error) return settle({ ok: false, error: result.error.message });
          return settle({ ok: true, goal: null });
        }
        const result = await request('thread/goal/get', { threadId: sessionId });
        if (result.error) return settle({ ok: false, error: result.error.message });
        return settle({ ok: true, goal: result.result?.goal ? codexGoalForRenderer(result.result.goal) : null });
      } catch (error) {
        settle({ ok: false, error: error?.message ?? String(error) });
      }
    })();
  });

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
  return disposeClaudeSdkSession(threadId) || disposedTerminal;
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

const sendToAllWindows = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
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
  candidate = candidate.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
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
