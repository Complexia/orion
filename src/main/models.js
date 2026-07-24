import { checkCommandAvailable, execFileAsync, shellPathSyncPromise } from './shell-env.js';

export const defaultCodexReasoningEffort = 'medium';
// The GPT-5.6 family defaults to high effort and is the only one that accepts
// "ultra" as a model_reasoning_effort value.
export const gpt56CodexModelSlugs = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
export const codexReasoningEffortForModel = (model, effort) => {
  const isGpt56 = gpt56CodexModelSlugs.has(model.slug);
  if (!effort) return isGpt56 ? 'high' : defaultCodexReasoningEffort;
  if (effort === 'ultra' && !isGpt56) return 'xhigh';
  return effort;
};
export const defaultCodexServiceTier = 'default';
export const defaultClaudeReasoningEffort = 'high';
export const defaultClaudeContextWindow = '200k';
export const claudeOneMillionContextModels = new Set([
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]);

export const cursorFallbackModels = [
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
export const kimiFallbackModels = [
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

export const agentModels = [
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
export const humanizeModelSlug = (slug) =>
  String(slug)
    .replace(/^[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bAi\b/g, 'AI');

export const cleanCursorModelLabel = (label) =>
  String(label || '')
    .replace(/\s+\((?:current|default|selected)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

export const cursorModelFromCliRow = (slug, label, index = 0) => {
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

export const parseCursorModelObject = (value, index) => {
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

export const parseCursorModelsOutput = (output) => {
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

export const listCursorAgentModels = async () => {
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
export const listKimiModels = async () => {
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
export const spliceProviderModels = (models, providerId, replacements) => {
  if (replacements.length === 0) return models;
  const firstIndex = models.findIndex((model) => model.providerId === providerId);
  if (firstIndex === -1) return [...models, ...replacements];
  return [
    ...models.slice(0, firstIndex).filter((model) => model.providerId !== providerId),
    ...replacements,
    ...models.slice(firstIndex).filter((model) => model.providerId !== providerId),
  ];
};

export const discoverAgentModels = async () => {
  // Finder-launched builds start with launchd's minimal PATH. The renderer can
  // request models as soon as its window loads, so do not let that first
  // request cache fallback catalogs before the interactive-shell PATH arrives.
  await shellPathSyncPromise;
  const [discoveredCursorModels, discoveredKimiModels] = await Promise.all([
    listCursorAgentModels(),
    listKimiModels(),
  ]);
  let models = spliceProviderModels(agentModels, 'cursor', discoveredCursorModels);
  models = spliceProviderModels(models, 'kimi', discoveredKimiModels);
  return models;
};

export const AGENT_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
export let agentModelsDiscoveryPromise = null;
export let cachedAgentModels = null;
export let cachedAgentModelsAt = 0;
export let agentModelsCacheGeneration = 0;
export const invalidateAgentModelsCache = () => {
  agentModelsCacheGeneration += 1;
  agentModelsDiscoveryPromise = null;
  cachedAgentModels = null;
  cachedAgentModelsAt = 0;
};

export const getAgentModels = () => {
  if (
    cachedAgentModels &&
    Date.now() - cachedAgentModelsAt < AGENT_MODELS_CACHE_TTL_MS
  ) {
    return Promise.resolve(cachedAgentModels);
  }
  if (agentModelsDiscoveryPromise) return agentModelsDiscoveryPromise;

  const cacheGeneration = agentModelsCacheGeneration;
  const discovery = discoverAgentModels().then((models) => {
    if (cacheGeneration === agentModelsCacheGeneration) {
      cachedAgentModels = models;
      cachedAgentModelsAt = Date.now();
    }
    return models;
  });
  const sharedDiscovery = discovery.finally(() => {
    if (agentModelsDiscoveryPromise === sharedDiscovery) {
      agentModelsDiscoveryPromise = null;
    }
  });
  agentModelsDiscoveryPromise = sharedDiscovery;
  return agentModelsDiscoveryPromise;
};

export const claudeEffortForCli = (reasoningEffort = defaultClaudeReasoningEffort) => {
  if (reasoningEffort === 'ultracode') return 'xhigh';
  if (reasoningEffort === 'ultrathink') return defaultClaudeReasoningEffort;
  return reasoningEffort;
};

export const claudeModelArgForContextWindow = (modelArg, contextWindow = defaultClaudeContextWindow) => {
  if (contextWindow !== '1m' || !claudeOneMillionContextModels.has(modelArg)) return modelArg;
  return `${modelArg}[1m]`;
};

// Tokenize a user-provided flags string, respecting single/double quotes.
export const parseExtraArgs = (value) => {
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
export const chromeDevtoolsMcpPackage = 'chrome-devtools-mcp@1.6.0';
