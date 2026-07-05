import {
  ClaudeBrandIcon,
  CodexBrandIcon,
  CursorBrandIcon,
  GrokBrandIcon,
  OpenCodeBrandIcon,
  type ProviderIconComponent,
} from './providerIcons';

export type AgentProviderId = 'grok' | 'codex' | 'claude' | 'cursor' | 'opencode';

export type AgentModel = {
  id: string;
  providerId: AgentProviderId;
  providerLabel: string;
  label: string;
  slug: string;
  shortcut?: string;
  favorite?: boolean;
  available?: boolean;
  unavailableReason?: string;
};

export type AgentProvider = {
  id: AgentProviderId;
  label: string;
  icon: ProviderIconComponent;
};

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
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

export const codexReasoningOptions: Array<{
  value: CodexReasoningEffort;
  label: string;
  default?: boolean;
}> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', default: true },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

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

export type ProviderOptionDef = {
  key: 'allowedTools' | 'networkAccess' | 'webSearch' | 'experimentalMemory' | 'extraArgs';
  label: string;
  description: string;
  type: 'boolean' | 'string';
  placeholder?: string;
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
  claude: [
    {
      key: 'allowedTools',
      label: 'Auto-allowed tools',
      description:
        'Tools approved without prompting in Read only / Workspace write modes (headless runs cannot ask). E.g. Bash, WebFetch, WebSearch, mcp__claude-in-chrome. Full Access already allows everything.',
      type: 'string',
      placeholder: 'Bash, WebFetch, WebSearch',
    },
    extraArgsOption('claude'),
  ],
  codex: [
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
  grok: [
    {
      key: 'experimentalMemory',
      label: 'Cross-session memory',
      description: 'Enable Grok experimental memory across sessions (--experimental-memory).',
      type: 'boolean',
    },
    extraArgsOption('grok'),
  ],
  cursor: [extraArgsOption('cursor-agent')],
  opencode: [extraArgsOption('opencode')],
};

// What each harness supports for messages sent while a run is in flight.
// queue: hold the message and send it as the next turn (session resume).
// steer: interrupt the running process and immediately resume the same
// harness session with the new instruction. The non-interactive CLI modes
// Orion uses accept no stdin mid-run, so interrupt+resume is the steer path;
// opencode has no session resume wired, so it is queue-only.
export const providerFollowUpSupport: Record<AgentProviderId, { queue: boolean; steer: boolean }> = {
  grok: { queue: true, steer: true },
  codex: { queue: true, steer: true },
  claude: { queue: true, steer: true },
  cursor: { queue: true, steer: true },
  opencode: { queue: true, steer: false },
};

export const agentProviders: AgentProvider[] = [
  { id: 'grok', label: 'Grok', icon: GrokBrandIcon },
  { id: 'codex', label: 'Codex', icon: CodexBrandIcon },
  { id: 'claude', label: 'Claude', icon: ClaudeBrandIcon },
  { id: 'cursor', label: 'Cursor', icon: CursorBrandIcon },
  { id: 'opencode', label: 'OpenCode', icon: OpenCodeBrandIcon },
];

export const fallbackAgentModels: AgentModel[] = [
  {
    id: 'grok:grok-build',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Grok Build',
    slug: 'grok-build',
    shortcut: '⌘1',
    favorite: true,
  },
  {
    id: 'grok:grok-composer-2.5-fast',
    providerId: 'grok',
    providerLabel: 'Grok',
    label: 'Composer 2.5 Fast',
    slug: 'grok-composer-2.5-fast',
    shortcut: '⌘2',
    favorite: true,
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
    id: 'claude:claude-fable-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Fable 5',
    slug: 'claude-fable-5',
    shortcut: '⌘1',
  },
  {
    id: 'claude:claude-opus-4-8',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.8',
    slug: 'claude-opus-4-8',
    shortcut: '⌘2',
  },
  {
    id: 'claude:claude-sonnet-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 5',
    slug: 'claude-sonnet-5',
    shortcut: '⌘3',
  },
  {
    id: 'claude:claude-opus-4-7',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.7',
    slug: 'claude-opus-4-7',
    shortcut: '⌘4',
  },
  {
    id: 'claude:claude-opus-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.6',
    slug: 'claude-opus-4-6',
    shortcut: '⌘5',
  },
  {
    id: 'claude:claude-opus-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Opus 4.5',
    slug: 'claude-opus-4-5',
    shortcut: '⌘6',
  },
  {
    id: 'claude:claude-sonnet-4-6',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Sonnet 4.6',
    slug: 'claude-sonnet-4-6',
    shortcut: '⌘7',
  },
  {
    id: 'claude:claude-haiku-4-5',
    providerId: 'claude',
    providerLabel: 'Claude',
    label: 'Claude Haiku 4.5',
    slug: 'claude-haiku-4-5',
    shortcut: '⌘8',
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
    id: 'cursor:composer-2.5-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Composer 2.5 Fast',
    slug: 'composer-2.5-fast',
  },
  {
    id: 'cursor:gpt-5.5-high-fast',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5.5 High Fast',
    slug: 'gpt-5.5-high-fast',
  },
  {
    id: 'cursor:gpt-5',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'GPT-5',
    slug: 'gpt-5',
  },
  {
    id: 'cursor:sonnet-4-thinking',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Sonnet 4 Thinking',
    slug: 'sonnet-4-thinking',
  },
  {
    id: 'cursor:sonnet-4',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Sonnet 4',
    slug: 'sonnet-4',
  },
  {
    id: 'cursor:claude-opus-4-8',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Opus 4.8',
    slug: 'claude-opus-4-8',
  },
  {
    id: 'cursor:gemini-3.1-pro',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Gemini 3.1 Pro',
    slug: 'gemini-3.1-pro',
  },
  {
    id: 'cursor:grok-4.3',
    providerId: 'cursor',
    providerLabel: 'Cursor',
    label: 'Grok 4.3',
    slug: 'grok-4.3',
  },
  {
    id: 'opencode:anthropic/claude-sonnet-4-6',
    providerId: 'opencode',
    providerLabel: 'OpenCode',
    label: 'Claude Sonnet 4.6',
    slug: 'anthropic/claude-sonnet-4-6',
  },
];

export const defaultAgentModelId = 'grok:grok-build';

export const findAgentModel = (models: AgentModel[], id: string | null | undefined) =>
  models.find((model) => model.id === id) ?? models.find((model) => model.id === defaultAgentModelId) ?? models[0];
