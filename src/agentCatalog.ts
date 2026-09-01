import {
  ClaudeBrandIcon,
  CodexBrandIcon,
  CursorBrandIcon,
  GrokBrandIcon,
  KimiBrandIcon,
  MuseBrandIcon,
  OpenCodeBrandIcon,
  OrionBrandIcon,
  type ProviderIconComponent,
} from './providerIcons';

export type AgentProviderId =
  | 'orion'
  | 'grok'
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'kimi'
  | 'muse'
  | 'opencode';

export type AgentModel = {
  id: string;
  providerId: AgentProviderId;
  providerLabel: string;
  label: string;
  slug: string;
  shortcut?: string;
  favorite?: boolean;
  reasoningVariants?: string[];
  available?: boolean;
  unavailableReason?: string;
};

export type AgentProvider = {
  id: AgentProviderId;
  label: string;
  icon: ProviderIconComponent;
};

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'ultra';
export type CodexServiceTier = 'default' | 'priority';
export type ClaudeReasoningEffort =
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultracode'
  | 'ultrathink';
export type ClaudeContextWindow = '200k' | '1m';
export type GrokReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type MuseReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'ultra';

export type CodexReasoningOption = {
  value: CodexReasoningEffort;
  label: string;
  default?: boolean;
  description?: string;
};

export const codexReasoningOptions: CodexReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', default: true },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

// The GPT-5.6 family renames the effort tiers (Light instead of Low), defaults
// to High, and adds Ultra. The wire values stay the Codex CLI enum; "ultra" is
// only accepted by 5.6 models. The Codex app offers Ultra on Sol and Terra but
// not Luna, so we mirror that.
const gpt56CodexReasoningOptions: CodexReasoningOption[] = [
  { value: 'low', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', default: true },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'ultra', label: 'Ultra', description: 'Consumes usage limits faster' },
];

const gpt56CodexModelSlugs = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

export const codexReasoningOptionsForModel = (
  model: AgentModel | undefined
): CodexReasoningOption[] => {
  if (!model || !gpt56CodexModelSlugs.has(model.slug)) return codexReasoningOptions;
  if (model.slug === 'gpt-5.6-luna') {
    return gpt56CodexReasoningOptions.filter((option) => option.value !== 'ultra');
  }
  return gpt56CodexReasoningOptions;
};

// Clamp a stored effort to what the model actually offers (e.g. a thread that
// picked Ultra on 5.6 Sol and then switched to 5.5 falls back to that model's
// default).
export const getEffectiveCodexReasoningEffort = (
  model: AgentModel | undefined,
  effort: CodexReasoningEffort | undefined
): CodexReasoningEffort => {
  const options = codexReasoningOptionsForModel(model);
  if (effort && options.some((option) => option.value === effort)) return effort;
  return options.find((option) => option.default)?.value ?? defaultCodexReasoningEffort;
};

export const codexServiceTierOptions: Array<{
  value: CodexServiceTier;
  label: string;
  default?: boolean;
}> = [
  { value: 'default', label: 'Standard', default: true },
  { value: 'priority', label: 'Fast' },
];

export const defaultCodexReasoningEffort: CodexReasoningEffort = 'medium';
export const defaultCodexServiceTier: CodexServiceTier = 'default';
export const defaultClaudeReasoningEffort: ClaudeReasoningEffort = 'high';
export const defaultClaudeContextWindow: ClaudeContextWindow = '200k';

export const claudeReasoningOptions: Array<{
  value: ClaudeReasoningEffort;
  label: string;
}> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
  { value: 'ultracode', label: 'Ultracode' },
  { value: 'ultrathink', label: 'Ultrathink' },
];

export const claudeContextWindowOptions: Array<{
  value: ClaudeContextWindow;
  label: string;
}> = [
  { value: '200k', label: '200k' },
  { value: '1m', label: '1M' },
];

// Grok exposes reasoning effort over ACP; labels/descriptions mirror the
// tiers the agent itself advertises in session/new model metadata. Extra High
// is currently specific to Grok 4.6.
export const defaultGrokReasoningEffort: GrokReasoningEffort = 'high';

export type GrokReasoningOption = {
  value: GrokReasoningEffort;
  label: string;
  default?: boolean;
  description?: string;
};

export const grokReasoningOptions: GrokReasoningOption[] = [
  { value: 'low', label: 'Low', description: 'Quick, fast implementations' },
  { value: 'medium', label: 'Medium', description: 'Balanced effort with standard implementation and testing' },
  { value: 'high', label: 'High', default: true, description: 'Higher implementation quality with extensive reasoning' },
  { value: 'xhigh', label: 'Extra High', description: 'Highest effort and reasoning level' },
];

export const grokReasoningOptionsForModel = (
  model: AgentModel | undefined
): GrokReasoningOption[] =>
  model?.slug === 'grok-4.6'
    ? grokReasoningOptions
    : grokReasoningOptions.filter((option) => option.value !== 'xhigh');

export const getEffectiveGrokReasoningEffort = (
  model: AgentModel | undefined,
  effort: GrokReasoningEffort | undefined
): GrokReasoningEffort => {
  const options = grokReasoningOptionsForModel(model);
  if (effort && options.some((option) => option.value === effort)) return effort;
  return options.find((option) => option.default)?.value ?? defaultGrokReasoningEffort;
};

// Muse Code's reasoning-effort tiers, the wire values `muse exec
// --reasoning-effort` accepts. The CLI defaults to high.
export const defaultMuseReasoningEffort: MuseReasoningEffort = 'high';

export const museReasoningOptions: Array<{
  value: MuseReasoningEffort;
  label: string;
  default?: boolean;
}> = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', default: true },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'ultra', label: 'Ultra' },
];

export type OpenCodeReasoningOption = {
  value: string;
  label: string;
  default?: boolean;
};

export const openCodeReasoningOptionsForModel = (
  model: AgentModel | undefined
): OpenCodeReasoningOption[] => [
  { value: 'default', label: 'Default', default: true },
  ...(model?.reasoningVariants ?? []).map((variant) => ({ value: variant, label: variant })),
];

export const getEffectiveOpenCodeReasoningEffort = (
  model: AgentModel | undefined,
  effort: string | undefined
): string => {
  const options = openCodeReasoningOptionsForModel(model);
  return effort && options.some((option) => option.value === effort) ? effort : 'default';
};

export type ProviderOptionDef = {
  key:
    | 'allowedTools'
    | 'networkAccess'
    | 'webSearch'
    | 'codexMemoryMode'
    | 'codexChronicleMode'
    | 'codexMemoryExternalContextMode'
    | 'codexPersonality'
    | 'codexDeveloperInstructions'
    | 'experimentalMemory'
    | 'chrome'
    | 'browserControl'
    | 'extraArgs';
  label: string;
  description: string;
  type: 'boolean' | 'string' | 'select' | 'textarea';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

const extraArgsOption = (command: string): ProviderOptionDef => ({
  key: 'extraArgs',
  label: 'Extra CLI flags',
  description: `Appended to every ${command} invocation. Quotes are respected.`,
  type: 'string',
  placeholder: '--flag value',
});

// Harness capabilities surfaced per provider. Everything here maps directly
// onto a CLI flag or config override in main.js's commandForModel.
export const providerOptionDefs: Record<AgentProviderId, ProviderOptionDef[]> = {
  // The Orion orchestrator is a pseudo-model, not a CLI harness — no options.
  orion: [],
  claude: [
    {
      key: 'allowedTools',
      label: 'Auto-allowed tools',
      description:
        'Tools approved without prompting in Read only / Workspace write modes (headless runs cannot ask). E.g. Bash, WebFetch, WebSearch. Browser tools remain disabled in Read only. Full Access already allows everything.',
      type: 'string',
      placeholder: 'Bash, WebFetch, WebSearch',
    },
    extraArgsOption('claude'),
  ],
  codex: [
    {
      key: 'codexDeveloperInstructions',
      label: 'Custom instructions',
      description:
        'Additional instructions and context for Codex chats launched from Orion. Leave blank to use only your normal Codex configuration and AGENTS.md guidance.',
      type: 'textarea',
      placeholder: 'Add your custom instructions…',
    },
    {
      key: 'codexMemoryMode',
      label: 'Local memories',
      description:
        'Use locally stored Codex context across Orion chats and allow eligible Orion chats to contribute to future memories. Inherit follows $CODEX_HOME/config.toml.',
      type: 'select',
      options: [
        { value: 'inherit', label: 'Inherit Codex setting' },
        { value: 'enabled', label: 'Enabled in Orion' },
        { value: 'disabled', label: 'Disabled in Orion' },
      ],
    },
    {
      key: 'codexChronicleMode',
      label: 'Chronicle memories',
      description:
        'Let Codex use Chronicle screen-context memories in Orion when the ChatGPT desktop recorder is running. Chronicle is a macOS ChatGPT Pro research preview; Orion does not start or capture the recorder itself.',
      type: 'select',
      options: [
        { value: 'inherit', label: 'Inherit Codex setting' },
        { value: 'enabled', label: 'Enabled in Orion' },
        { value: 'disabled', label: 'Disabled in Orion' },
      ],
    },
    {
      key: 'codexMemoryExternalContextMode',
      label: 'Tool-assisted chat memories',
      description:
        'Choose whether chats that used MCP tools, web search, or tool search may generate local memories. Inherit keeps the host Codex privacy setting.',
      type: 'select',
      options: [
        { value: 'inherit', label: 'Inherit Codex setting' },
        { value: 'enabled', label: 'Allow generation' },
        { value: 'disabled', label: 'Exclude these chats' },
      ],
    },
    {
      key: 'codexPersonality',
      label: 'Personality',
      description:
        'Default communication style for Codex models that support personality. Inherit uses your normal Codex setting.',
      type: 'select',
      options: [
        { value: 'inherit', label: 'Inherit Codex setting' },
        { value: 'none', label: 'None' },
        { value: 'friendly', label: 'Friendly' },
        { value: 'pragmatic', label: 'Pragmatic' },
      ],
    },
    {
      key: 'networkAccess',
      label: 'Network access in sandbox',
      description:
        'Allow network inside the workspace-write sandbox (web fetches, npm install). Full Access is never sandboxed.',
      type: 'boolean',
    },
    {
      key: 'webSearch',
      label: 'Web search',
      description: 'Enable the Codex web search tool for all runs.',
      type: 'boolean',
    },
    extraArgsOption('codex'),
  ],
  // Grok turns run over `grok agent stdio` (ACP), which accepts far fewer
  // flags than the TUI — e.g. --experimental-memory is rejected there, so the
  // old cross-session memory toggle is gone.
  grok: [
    {
      key: 'extraArgs',
      label: 'Extra CLI flags',
      description:
        'Appended to every `grok agent` invocation. Flags must be valid for `grok agent` (not the interactive TUI). Quotes are respected.',
      type: 'string',
      placeholder: '--reasoning-effort high',
    },
  ],
  cursor: [extraArgsOption('cursor-agent')],
  // Kimi turns run over `kimi acp` (ACP over stdio), which takes no
  // model/permission flags — those travel in the JSON-RPC dialog. Extra flags
  // are inserted before the `acp` subcommand (e.g. --skills-dir, --add-dir).
  kimi: [
    {
      key: 'extraArgs',
      label: 'Extra CLI flags',
      description:
        'Inserted before the `acp` subcommand on every kimi invocation (e.g. --skills-dir, --add-dir). Quotes are respected.',
      type: 'string',
      placeholder: '--add-dir /path',
    },
  ],
  // Muse turns run over `muse exec` (headless JSONL); flags land between
  // `exec` and the prompt argument.
  muse: [
    {
      key: 'extraArgs',
      label: 'Extra CLI flags',
      description:
        'Appended to every `muse exec` invocation, before the prompt. Quotes are respected.',
      type: 'string',
      placeholder: '--sandbox-network enabled',
    },
  ],
  opencode: [extraArgsOption('opencode')],
};

// What each harness supports for messages sent while a run is in flight.
// queue: hold the message and send it as the next turn (session resume);
// dispatches automatically the moment the current turn ends.
// steer: deliver the message INTO the running turn without interrupting it —
// the same behavior as typing while Claude Code works. This needs a live
// mid-turn input channel: Claude folds the message into its persistent SDK
// session, while Codex uses app-server's native turn/steer. The other
// harnesses run one-shot per turn or hold a single-prompt ACP dialog, so a
// follow-up cannot reach the running turn — it queues and sends when that
// turn finishes. Steer must never kill the running process; that is Stop's job.
export const providerFollowUpSupport: Record<AgentProviderId, { queue: boolean; steer: boolean }> = {
  // Steering an orchestrated thread would bypass the driver resolution.
  orion: { queue: true, steer: false },
  grok: { queue: true, steer: false },
  codex: { queue: true, steer: true },
  claude: { queue: true, steer: true },
  cursor: { queue: true, steer: false },
  kimi: { queue: true, steer: false },
  muse: { queue: true, steer: false },
  opencode: { queue: true, steer: false },
};

export const agentProviders: AgentProvider[] = [
  { id: 'orion', label: 'Orion', icon: OrionBrandIcon },
  { id: 'grok', label: 'Grok', icon: GrokBrandIcon },
  { id: 'codex', label: 'Codex', icon: CodexBrandIcon },
  { id: 'claude', label: 'Claude', icon: ClaudeBrandIcon },
  { id: 'kimi', label: 'Kimi', icon: KimiBrandIcon },
  { id: 'muse', label: 'Muse', icon: MuseBrandIcon },
  { id: 'cursor', label: 'Cursor', icon: CursorBrandIcon },
  { id: 'opencode', label: 'OpenCode', icon: OpenCodeBrandIcon },
];

export const fallbackAgentModels: AgentModel[] = [
  {
    id: 'orion:orchestrator',
    providerId: 'orion',
    providerLabel: 'Orion',
    label: 'Orion',
    slug: 'orion',
    favorite: true,
  },
  {
    id: 'grok:grok-4.6',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Grok 4.6',
    slug: 'grok-4.6',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'grok:grok-4.5',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Grok 4.5',
    slug: 'grok-4.5',
    shortcut: '⌘2',
  },
  {
    id: 'grok:grok-composer-2.5-fast',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Composer 2.5 Fast',
    slug: 'grok-composer-2.5-fast',
    shortcut: '⌘3',
    favorite: true,
  },
  {
    id: 'codex:gpt-5.6-sol',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Sol',
    slug: 'gpt-5.6-sol',
  },
  {
    id: 'codex:gpt-5.6-terra',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Terra',
    slug: 'gpt-5.6-terra',
  },
  {
    id: 'codex:gpt-5.6-luna',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.6 Luna',
    slug: 'gpt-5.6-luna',
  },
  {
    id: 'codex:gpt-5.5',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.5',
    slug: 'gpt-5.5',
  },
  {
    id: 'codex:gpt-5.4',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.4',
    slug: 'gpt-5.4',
  },
  {
    id: 'codex:gpt-5.4-mini',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.4 Mini',
    slug: 'gpt-5.4-mini',
  },
  {
    id: 'codex:gpt-5.3-codex-spark',
    providerId: 'codex',
    providerLabel: 'Codex',
    label: 'GPT-5.3 Codex Spark',
    slug: 'gpt-5.3-codex-spark',
  },
  {
    id: 'claude:claude-fable-5-1',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Fable 5.1',
    slug: 'claude-fable-5-1',
    shortcut: '⌘1',
  },
  {
    id: 'claude:claude-fable-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Fable 5',
    slug: 'claude-fable-5',
    shortcut: '⌘2',
  },
  {
    id: 'claude:claude-opus-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 5',
    slug: 'claude-opus-5',
    shortcut: '⌘3',
  },
  {
    id: 'claude:claude-opus-4-8',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.8',
    slug: 'claude-opus-4-8',
    shortcut: '⌘4',
  },
  {
    id: 'claude:claude-sonnet-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 5',
    slug: 'claude-sonnet-5',
    shortcut: '⌘5',
  },
  {
    id: 'claude:claude-opus-4-7',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.7',
    slug: 'claude-opus-4-7',
    shortcut: '⌘6',
  },
  {
    id: 'claude:claude-opus-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.6',
    slug: 'claude-opus-4-6',
    shortcut: '⌘7',
  },
  {
    id: 'claude:claude-opus-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.5',
    slug: 'claude-opus-4-5',
    shortcut: '⌘8',
  },
  {
    id: 'claude:claude-sonnet-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 4.6',
    slug: 'claude-sonnet-4-6',
    shortcut: '⌘9',
  },
  {
    id: 'claude:claude-haiku-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Haiku 4.5',
    slug: 'claude-haiku-4-5',
  },
  {
    id: 'claude:claude-code-cli',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Code CLI',
    slug: 'claude-code-cli',
  },
  {
    id: 'kimi:kimi-code/k3',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K3',
    slug: 'kimi-code/k3',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'kimi:kimi-code/kimi-for-coding',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K2.7 Coding',
    slug: 'kimi-code/kimi-for-coding',
    shortcut: '⌘2',
  },
  {
    id: 'kimi:kimi-code/kimi-for-coding-highspeed',
    providerId: 'kimi',
    providerLabel: 'Kimi',
    label: 'K2.7 Coding Highspeed',
    slug: 'kimi-code/kimi-for-coding-highspeed',
    shortcut: '⌘3',
  },
  {
    id: 'muse:muse-spark-1.2',
    providerId: 'muse',
    providerLabel: 'Muse',
    label: 'Muse Spark 1.2',
    slug: 'muse-spark-1.2',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'cursor:auto',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Auto',
    slug: 'auto',
    favorite: true,
  },
  {
    id: 'cursor:cursor-grok-4.6-high-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Cursor Grok 4.6 Fast',
    slug: 'cursor-grok-4.6-high-fast',
    favorite: true,
  },
  {
    id: 'cursor:claude-opus-5-thinking-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Opus 5 1M Thinking',
    slug: 'claude-opus-5-thinking-high',
  },
  {
    id: 'cursor:claude-fable-5-thinking-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Fable 5 1M Thinking (NO ZDR)',
    slug: 'claude-fable-5-thinking-high',
  },
  {
    id: 'cursor:claude-sonnet-5-thinking-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Sonnet 5 1M Thinking',
    slug: 'claude-sonnet-5-thinking-high',
  },
  {
    id: 'cursor:gpt-5.6-sol-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.6 Sol 1M High',
    slug: 'gpt-5.6-sol-high',
  },
  {
    id: 'cursor:gpt-5.6-terra-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.6 Terra 1M High',
    slug: 'gpt-5.6-terra-high',
  },
  {
    id: 'cursor:gpt-5.6-luna-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.6 Luna 1M High',
    slug: 'gpt-5.6-luna-high',
  },
  {
    id: 'cursor:kimi-k3-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Kimi K3 High',
    slug: 'kimi-k3-high',
  },
  {
    id: 'cursor:gemini-3.6-flash-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Gemini 3.6 Flash',
    slug: 'gemini-3.6-flash-high',
  },
  {
    id: 'cursor:composer-2.5',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Composer 2.5',
    slug: 'composer-2.5',
    favorite: true,
  },
  {
    id: 'cursor:cursor-grok-4.5-high-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Cursor Grok 4.5 Fast',
    slug: 'cursor-grok-4.5-high-fast',
  },
  {
    id: 'cursor:claude-opus-4-8-thinking-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Opus 4.8 1M Thinking',
    slug: 'claude-opus-4-8-thinking-high',
  },
  {
    id: 'cursor:gpt-5.5-high',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.5 1M High',
    slug: 'gpt-5.5-high',
  },
  ...([
    ['opencode/x-preview-f-free', '0x Alpha Free (Unlimited)', ['low', 'high', 'max']],
    ['opencode/nemotron-3.5-lightning-free', 'Nemotron 3.5 Lightning Free', []],
    ['opencode/muse-spark-1.2-contributor-free', 'Muse Spark 1.2 Free', ['minimal', 'low', 'medium', 'high', 'xhigh']],
    ['opencode/hy3-free', 'Hy3 Free', ['low', 'medium', 'high']],
    ['opencode/nemotron-3-ultra-free', 'Nemotron 3 Ultra Free', []],
    ['opencode/mimo-v2.5-free', 'MiMo V2.5 Free', []],
    ['opencode/big-pickle', 'Big Pickle', []],
  ] as Array<[string, string, string[]]>).map(([slug, label, reasoningVariants], index) => ({
    id: `opencode:${slug}`,
    providerId: 'opencode' as const,
    providerLabel: 'OpenCode',
    label,
    slug,
    ...(reasoningVariants.length > 0 ? { reasoningVariants } : {}),
    ...(index < 9 ? { shortcut: `⌘${index + 1}` } : {}),
    favorite: slug === 'opencode/big-pickle',
  })),
];

export const defaultAgentModelId = 'grok:grok-4.6';

// The Orion pseudo-model: not a CLI harness, resolved by the renderer into
// the per-role models configured in Settings → Orchestration.
export const orionOrchestratorModelId = 'orion:orchestrator';

// Claude Code CLI pseudo-model: the thread hosts the interactive `claude` TUI
// in an embedded terminal instead of the chat transcript. Turns never go
// through agent:runTurn — the composer feeds straight into the PTY.
export const claudeCodeCliModelId = 'claude:claude-code-cli';

export const isClaudeCodeCliModelId = (modelId: string | undefined | null): boolean =>
  modelId === claudeCodeCliModelId;

export const isOrionModelId = (modelId: string | undefined | null): boolean =>
  modelId === orionOrchestratorModelId || (modelId ?? '').startsWith('orion:');

export const findAgentModel = (models: AgentModel[], id: string | null | undefined) =>
  models.find((model) => model.id === id) ??
  (id?.startsWith('opencode:')
    ? models.find((model) => model.providerId === 'opencode')
    : undefined) ??
  models.find((model) => model.id === defaultAgentModelId) ??
  models[0];
