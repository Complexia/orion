import { app, BrowserWindow, ipcMain, dialog, nativeImage, protocol, safeStorage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import started from 'electron-squirrel-startup';
import { autoUpdater } from 'electron-updater';

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

const defaultCodexReasoningEffort = 'medium';
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
  {
    id: 'grok:grok-build',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Grok Build',
    slug: 'grok-build',
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
const imagePreviewExtensions = new Set(Object.values(imageExtensionsByMimeType));

const imageMimeTypeByExtension = Object.fromEntries(
  Object.entries(imageExtensionsByMimeType).map(([mimeType, ext]) => [ext, mimeType])
);

const getMimeTypeForImagePath = (filePath) =>
  imageMimeTypeByExtension[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

const extensionFromImageInput = (name, mimeType) => {
  const fromMime = imageExtensionsByMimeType[String(mimeType || '').toLowerCase()];
  if (fromMime) return fromMime;

  const ext = path.extname(String(name || '')).toLowerCase();
  if (/^\.(apng|avif|gif|jpe?g|png|svg|webp)$/.test(ext)) return ext;
  return '.png';
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
  const rawUrl = process.env.ORION_WEB_URL || 'https://orioncode.xyz';
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

const encryptAccountToken = (token) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed secure storage is not available.');
  }
  return {
    encrypted: true,
    value: safeStorage.encryptString(token).toString('base64'),
  };
};

const decryptAccountToken = (storedToken) => {
  if (!storedToken || typeof storedToken !== 'object') return null;
  if (storedToken.encrypted) {
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

  // Never persist account tokens without OS-backed encryption.
  if (!safeStorage.isEncryptionAvailable()) {
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

const getAgentModels = async () => {
  const discoveredCursorModels = await listCursorAgentModels();
  const cursorModels = discoveredCursorModels.length > 0 ? discoveredCursorModels : cursorFallbackModels;
  const firstCursorIndex = agentModels.findIndex((model) => model.providerId === 'cursor');

  if (firstCursorIndex === -1) return [...agentModels, ...cursorModels];

  return [
    ...agentModels.slice(0, firstCursorIndex).filter((model) => model.providerId !== 'cursor'),
    ...cursorModels,
    ...agentModels.slice(firstCursorIndex).filter((model) => model.providerId !== 'cursor'),
  ];
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

const commandForModel = (model, input) => {
  const prompt =
    model.providerId === 'claude' && input.claudeReasoningEffort === 'ultrathink'
      ? `ultrathink\n\n${input.prompt}`
      : input.prompt;
  const cwd = input.projectPath;
  const modelArg = model.slug;
  const accessMode = input.accessMode || 'workspace-write';

  if (model.providerId === 'codex') {
    const reasoningEffort = input.codexReasoningEffort || defaultCodexReasoningEffort;
    const serviceTier = input.codexServiceTier || defaultCodexServiceTier;
    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', accessMode === 'read-only' ? 'read-only' : 'workspace-write'];
    return [
      'codex',
      'exec',
      '--cd',
      cwd,
      '--skip-git-repo-check',
      '--color',
      'never',
      '--model',
      modelArg,
      '--config',
      `model_reasoning_effort="${reasoningEffort}"`,
      '--config',
      `service_tier="${serviceTier}"`,
      ...accessArgs,
      prompt,
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
      prompt,
    ];
  }

  if (model.providerId === 'cursor') {
    const accessArgs = accessMode === 'read-only' ? ['--mode', 'plan'] : ['--force'];
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
      ...accessArgs,
      prompt,
    ];
  }

  if (model.providerId === 'grok') {
    const accessArgs =
      accessMode === 'full-access'
        ? ['--permission-mode', 'bypassPermissions', '--always-approve']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    return [
      'grok',
      '--cwd',
      cwd,
      '--model',
      modelArg,
      '--output-format',
      'streaming-json',
      ...accessArgs,
      '--single',
      prompt,
    ];
  }

  return ['opencode', 'run', '--model', modelArg, prompt];
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
const extractClaudeTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'stream_event') {
    if (value.parent_tool_use_id) return '';
    const delta = value.event?.delta;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
    return '';
  }
  if (value.type === 'result' && value.is_error && typeof value.result === 'string') {
    return value.result;
  }
  return '';
};

const textExtractorForProvider = (providerId) =>
  providerId === 'claude' ? extractClaudeTextFromJsonEvent : extractTextFromJsonEvent;

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

  return {
    type: candidate.is_error === true ? 'error' : isResult ? 'result' : isCommand ? 'command' : 'tool',
    title,
    detail,
    status: candidate.is_error === true ? 'error' : isResult ? 'done' : 'running',
  };
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

const sendsJsonEvents = (providerId) => ['claude', 'cursor', 'grok'].includes(providerId);

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
    requiresUpdateAgentIdentity: true,
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
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
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
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

const readCodexDoctorAuthDetails = async () => {
  try {
    const { stdout, stderr } = await runShellCommand('codex doctor --json', 12000);
    const report = parseJsonFromOutput(`${stdout}\n${stderr}`);
    const details = report?.checks?.['auth.credentials']?.details;
    if (!details || typeof details !== 'object') return null;

    return {
      agentIdentity: String(details['stored agent identity'] || '').toLowerCase() === 'true',
      authMode: details['stored auth mode'] ? String(details['stored auth mode']) : undefined,
    };
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
      updateAuthenticated: false,
    };
  }

  if (!config.statusCommand) {
    return {
      authenticated: null,
      status: 'unknown',
      label: 'Unknown',
      detail: 'No status command is available.',
      updateAuthenticated: true,
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
      const doctorAuth = await readCodexDoctorAuthDetails();
      const updateAuthenticated =
        authenticated && (!config.requiresUpdateAgentIdentity || doctorAuth?.agentIdentity === true);

      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: doctorAuth?.authMode ? `Logged in using ${doctorAuth.authMode}` : output,
        updateAuthenticated,
        updateBlockedReason:
          authenticated && !updateAuthenticated
            ? 'Updater requires Codex agent identity authentication.'
            : undefined,
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
        updateAuthenticated: authenticated,
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
        updateAuthenticated: authenticated,
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
        updateAuthenticated: authenticated,
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
      updateAuthenticated: authenticated,
    };
  } catch (error) {
    const message = getProcessErrorMessage(error);
    const unauthenticated = /unauth|not logged|login required|sign in required/i.test(message);
    return {
      authenticated: unauthenticated ? false : null,
      status: unauthenticated ? 'unauthenticated' : 'error',
      label: unauthenticated ? 'Not authenticated' : 'Status unavailable',
      detail: message,
      updateAuthenticated: false,
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
        enabled && auth.updateAuthenticated === true && (parsed.updateAvailable === true ||
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
      enabled && auth.updateAuthenticated === true && currentVersion && latestVersion
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

const updateProviderTool = async (config) => {
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
    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: true,
      output: `${stdout}\n${stderr}`.trim(),
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

const initializeAppUpdater = () => {
  if (appUpdateInitialized) return;
  appUpdateInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: getAppUpdateFeedUrl(),
  });

  autoUpdater.on('checking-for-update', () => {
    publishAppUpdateState({
      status: 'checking',
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    publishAppUpdateState({
      status: 'available',
      availableVersion: info?.version ?? null,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
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

  initializeAppUpdater();
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
  }, 6 * 60 * 60 * 1000);
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
      const requestedPath = url.searchParams.get('path');
      const attachmentDir = path.resolve(getAttachmentDirectoryPath());
      const filePath = requestedPath
        ? path.resolve(requestedPath)
        : path.resolve(
            getAttachmentDirectoryPath(),
            path.basename(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
          );
      const isSavedAttachment = filePath.startsWith(`${attachmentDir}${path.sep}`);
      const isImagePreview = imagePreviewExtensions.has(path.extname(filePath).toLowerCase());

      if (!isSavedAttachment && !isImagePreview) {
        return new Response('Not found', { status: 404 });
      }

      const data = await fs.readFile(filePath);
      return new Response(data, {
        headers: {
          'content-type': getMimeTypeForImagePath(filePath),
          'cache-control': 'no-store',
        },
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
  if (process.platform !== 'darwin') {
    app.quit();
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

ipcMain.handle('attachment:saveImage', async (_event, input) => {
  try {
    const mimeType = String(input?.mimeType || '').toLowerCase();
    const originalName = sanitizeAttachmentName(input?.name);
    const data = input?.data;

    if (!data || (!mimeType.startsWith('image/') && !/\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(originalName))) {
      return { ok: false, error: 'Only image attachments are supported.' };
    }

    const id = crypto.randomUUID();
    const ext = extensionFromImageInput(originalName, mimeType);
    const nameWithoutExtension = originalName.replace(/\.[^.]+$/, '') || 'image';
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
        mimeType: mimeType || 'image/*',
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
  const uniqueCommands = [...new Set(models.map((model) => model.command))];
  const availability = new Map(
    await Promise.all(
      uniqueCommands.map(async (command) => [command, await checkCommandAvailable(command)])
    )
  );

  return models.map(({ command, ...model }) => {
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
        message: state.auth?.updateBlockedReason ?? `${config.label} has no available update.`,
      });
      continue;
    }

    results.push(await updateProviderTool(config));
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
  initializeAppUpdater();
  publishAppUpdateState({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, error: null });
  await autoUpdater.downloadUpdate();
  return appUpdateState;
});

ipcMain.handle('appUpdate:restart', async () => {
  if (appUpdateState.status !== 'downloaded') return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
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

    const available = await checkCommandAvailable(model.command);
    if (!available) {
      return { ok: false, error: `${model.command} is not installed or not on PATH.` };
    }

    const runId = input.runId || crypto.randomUUID();
    const args = commandForModel(model, input);
    const commandString = args.map(shellQuote).join(' ');
    const beforeSnapshot = await captureGitChangeSnapshot(input.projectPath);
    const child = spawn(loginShell, ['-lc', commandString], {
      cwd: input.projectPath,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutSeen = false;
    let jsonBuffer = '';
    const jsonMode = sendsJsonEvents(model.providerId);
    let reasoningText = '';
    const reasoningActivityKey = `${runId}:reasoning`;
    activeAgentRuns.set(runId, child);

    const emitReasoningActivity = (text) => {
      const detail = stringifySummary(text, 600);
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
          status: 'running',
        },
      });
    };

    const emitParsedJsonEvent = (parsed) => {
      const reasoningDelta = extractReasoningFromJsonEvent(parsed);
      if (reasoningDelta) {
        reasoningText = `${reasoningText}${reasoningDelta}`;
        emitReasoningActivity(reasoningText);
      }

      const activities = extractActivitiesFromJsonEvent(parsed);
      for (const activity of activities) {
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'activity',
          activity,
        });
      }

      const text = textExtractorForProvider(model.providerId)(parsed);
      if (text) {
        stdoutSeen = true;
        emitAgentEvent(event.sender, {
          runId,
          threadId: input.threadId,
          type: 'chunk',
          chunk: text,
        });
      }
    };

    emitAgentEvent(event.sender, {
      runId,
      threadId: input.threadId,
      type: 'started',
      command: `${model.command} ${args.slice(1, -1).join(' ')}`,
    });

    child.stdout.on('data', (data) => {
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
          emitParsedJsonEvent(parsed);
        } catch {
          stdoutSeen = true;
          // Never leak raw agent protocol JSON (e.g. {"type":"thought",...}) into the chat transcript
          const looksLikeProtocol =
            /^\s*[\{\[]/.test(trimmed) &&
            (/"type"\s*:/i.test(trimmed) || /"data"\s*:/i.test(trimmed) || /"thought"/i.test(trimmed));
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

    child.on('close', async (exitCode) => {
      activeAgentRuns.delete(runId);
      if (jsonMode && jsonBuffer.trim()) {
        try {
          const parsed = JSON.parse(jsonBuffer.trim());
          emitParsedJsonEvent(parsed);
        } catch {}
      }

      if (exitCode !== 0 && stderr.trim()) {
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
        type: exitCode === 0 ? 'done' : 'error',
        exitCode,
        changedFiles: await summarizeChangedFiles(input.projectPath, beforeSnapshot),
        ...(exitCode === 0 ? {} : { error: `${model.label} exited with code ${exitCode}.` }),
      });
    });

    return { ok: true, runId };
  } catch (error) {
    console.error('agent:runTurn error', error);
    return { ok: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle('agent:stopTurn', async (_event, runId) => {
  const child = activeAgentRuns.get(runId);
  if (!child) return false;
  child.kill('SIGTERM');
  activeAgentRuns.delete(runId);
  return true;
});

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
              const t = textExtractorForProvider(model.providerId)(parsed);
              if (t) {
                responseText += t;
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
              const t = textExtractorForProvider(model.providerId)(p);
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

        let candidate = (responseText || '').split(/[\r\n]+/)[0] || '';
        candidate = candidate.trim();
        if (!candidate) {
          resolve('');
          return;
        }

        // Clean model output
        candidate = candidate.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
        candidate = candidate.replace(/^(title\s*[:：]\s*|here\s*(is|is a)\s*(a\s+)?(concise\s+)?title\s*[:：]?\s*|the title (is|should be)\s*[:：]?\s*)/i, '');
        candidate = candidate.replace(/\s+/g, ' ').trim();
        candidate = candidate.split(/[\.!?]\s/)[0].trim();
        if (candidate.length > 70) candidate = candidate.slice(0, 67).trim() + '…';

        // Hard guard: never accept raw protocol / JSON / thought lines as a title
        if (!candidate || /^[\{\[]/.test(candidate) || /"type"\s*:/i.test(candidate) || /"data"\s*:/i.test(candidate) || /\btype["\s]*:["\s]*thought\b/i.test(candidate)) {
          resolve('');
          return;
        }

        resolve(candidate);
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

ipcMain.handle('path:basename', (_e, p) => path.basename(p));
ipcMain.handle('path:dirname', (_e, p) => path.dirname(p));
ipcMain.handle('path:join', (_e, ...parts) => path.join(...parts));
