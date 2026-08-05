import type { SlashCommandInfo } from '../types';

// The composer's slash-command menu. Claude-backed threads show the real
// command list reported by the CLI (agent:slashCommands / listSlashCommands);
// until one arrives the fallback below seeds the menu. Orion-native commands
// ride the same menu so it is the single discovery surface.

export type SlashCommandCandidate = {
  command: SlashCommandInfo;
  /** orion: handled by Orion itself; claude: expanded CLI-side as prompt text. */
  source: 'orion' | 'claude';
};

type OrionSlashCommand = SlashCommandInfo & {
  /** Which composer contexts list the command. */
  appliesTo: (context: SlashCommandContext) => boolean;
};

export type SlashCommandContext = {
  providerId: string | null;
  /** Thread resolves to a Claude SDK session (claude provider, or Orion orchestrator on a Claude main driver). */
  claudeBacked: boolean;
  /** Embedded Claude Code CLI (PTY) thread — text is delivered verbatim to the TUI. */
  isTerminal: boolean;
};

/**
 * Claude only expands slash commands when the prompt begins with `/`. Keep
 * Orion-owned context without moving it ahead of the command; ordinary
 * prompts retain the established context-first ordering.
 */
export const addPromptContext = (
  prompt: string,
  context: string,
  preserveSlashCommandStart: boolean
): string => {
  if (!context) return prompt;
  if (!prompt) return context;
  if (preserveSlashCommandStart && prompt.trimStart().startsWith('/')) {
    return `${prompt.trimStart()}\n\n${context}`;
  }
  return `${context}\n\n${prompt}`;
};

export const ORION_SLASH_COMMANDS: OrionSlashCommand[] = [
  {
    name: 'goal',
    description: 'Set a persistent goal the agent pursues across turns',
    argumentHint: '<objective> [budget:500k] | pause | resume | clear | status',
    appliesTo: ({ providerId, isTerminal }) => providerId === 'codex' && !isTerminal,
  },
  {
    name: 'review',
    description: 'Review code changes (uncommitted, against a base branch, or a commit)',
    argumentHint: '[uncommitted | base <branch> | commit <sha> | <instructions>]',
    appliesTo: ({ providerId, isTerminal }) => providerId === 'codex' && !isTerminal,
  },
  {
    name: 'btw',
    description: 'Ask a side question without interrupting or polluting the agent',
    argumentHint: '<question>',
    appliesTo: ({ claudeBacked, isTerminal }) => claudeBacked && !isTerminal,
  },
  {
    name: 'clear',
    description: 'Start a fresh session — next message begins with empty context',
    argumentHint: '',
    appliesTo: ({ claudeBacked, isTerminal }) => claudeBacked && !isTerminal,
  },
  {
    name: 'model',
    description: 'Switch the model for this thread',
    argumentHint: '',
    appliesTo: ({ isTerminal }) => !isTerminal,
  },
];

// Seed list shown before any Claude session has reported its real commands.
// Fully replaced (not merged) once live data lands.
export const CLAUDE_BUILTIN_FALLBACK: SlashCommandInfo[] = [
  { name: 'compact', description: 'Compact conversation history, keeping a summary in context', argumentHint: '<optional summary instructions>' },
  { name: 'context', description: 'Show current context usage', argumentHint: '' },
  { name: 'init', description: 'Initialize a CLAUDE.md file with codebase documentation', argumentHint: '' },
  { name: 'pr-comments', description: 'Get comments from a GitHub pull request', argumentHint: '<pr number>' },
  { name: 'review', description: 'Review a GitHub pull request', argumentHint: '<pr number>' },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch', argumentHint: '' },
  { name: 'todos', description: 'List current todo items', argumentHint: '' },
];

// TUI-only commands the embedded terminal handles natively. Never shown for
// SDK threads (whatever supportedCommands() does not return does not exist
// there); the terminal receives composer text verbatim, so all of these work.
export const TERMINAL_EXTRA_COMMANDS: SlashCommandInfo[] = [
  { name: 'clear', description: 'Clear conversation history', argumentHint: '' },
  { name: 'help', description: 'Show help and available commands', argumentHint: '' },
  { name: 'config', description: 'Open the settings panel', argumentHint: '' },
  { name: 'model', description: 'Set the AI model for this session', argumentHint: '' },
  { name: 'permissions', description: 'Manage tool permissions', argumentHint: '' },
  { name: 'status', description: 'Show session status (version, model, account)', argumentHint: '' },
  { name: 'cost', description: 'Show token usage and cost for this session', argumentHint: '' },
  { name: 'usage', description: 'Show plan usage limits', argumentHint: '' },
  { name: 'doctor', description: 'Diagnose the Claude Code installation', argumentHint: '' },
  { name: 'memory', description: 'Edit memory files (CLAUDE.md)', argumentHint: '' },
  { name: 'mcp', description: 'Manage MCP server connections', argumentHint: '' },
  { name: 'agents', description: 'Manage agent configurations', argumentHint: '' },
  { name: 'resume', description: 'Resume a previous conversation', argumentHint: '' },
  { name: 'rewind', description: 'Rewind the conversation and/or code changes', argumentHint: '' },
  { name: 'export', description: 'Export the conversation to a file or clipboard', argumentHint: '' },
  { name: 'add-dir', description: 'Add a working directory to the session', argumentHint: '<path>' },
  { name: 'hooks', description: 'Manage hook configurations', argumentHint: '' },
  { name: 'output-style', description: 'Set the output style for responses', argumentHint: '' },
  { name: 'statusline', description: 'Set up the status line UI', argumentHint: '' },
  { name: 'vim', description: 'Toggle vim editing mode', argumentHint: '' },
  { name: 'terminal-setup', description: 'Install Shift+Enter key binding', argumentHint: '' },
];

// Claude commands hidden on SDK threads because Orion overrides them with its
// own handler (/clear, /model) or has no equivalent surface yet (/resume,
// /rewind — session picking is Orion's thread list).
export const OVERRIDDEN_CLAUDE_COMMANDS = new Set(['clear', 'model', 'resume', 'rewind']);

/**
 * The slash menu is active only while the whole draft is a single
 * `/`-prefixed token — matching Claude Code, where a command must start the
 * prompt. Whitespace anywhere (including a trailing space after the completed
 * name) ends the token, so pasted prose and argument editing never reopen it.
 */
export const getSlashToken = (value: string): { query: string } | null => {
  const match = value.match(/^\/(\S*)$/);
  return match ? { query: match[1] } : null;
};

const commandNames = (command: SlashCommandInfo) => [command.name, ...(command.aliases ?? [])];

/**
 * Rank: name prefix > alias prefix > name substring > description substring.
 * Stable within a rank, so the builder's ordering (Orion first, then Claude
 * alphabetical) shows through for short queries.
 */
export const filterSlashCommands = (
  candidates: SlashCommandCandidate[],
  query: string
): SlashCommandCandidate[] => {
  const needle = query.toLowerCase();
  if (!needle) return candidates;
  const ranked: Array<{ candidate: SlashCommandCandidate; rank: number }> = [];
  for (const candidate of candidates) {
    const { command } = candidate;
    const name = command.name.toLowerCase();
    let rank: number | null = null;
    if (name.startsWith(needle)) rank = 0;
    else if ((command.aliases ?? []).some((alias) => alias.toLowerCase().startsWith(needle))) rank = 1;
    else if (name.includes(needle)) rank = 2;
    else if (command.description.toLowerCase().includes(needle)) rank = 3;
    if (rank !== null) ranked.push({ candidate, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.candidate);
};

const byName = (a: SlashCommandInfo, b: SlashCommandInfo) => a.name.localeCompare(b.name);

/** Merge lists by name; earlier lists win. */
const mergeCommandLists = (...lists: SlashCommandInfo[][]): SlashCommandInfo[] => {
  const seen = new Map<string, SlashCommandInfo>();
  for (const list of lists) {
    for (const command of list) {
      if (!seen.has(command.name)) seen.set(command.name, command);
    }
  }
  return [...seen.values()];
};

export const buildSlashCommandCandidates = (
  context: SlashCommandContext,
  liveCommands: SlashCommandInfo[] | null
): SlashCommandCandidate[] => {
  if (context.isTerminal) {
    // The TUI handles everything natively, including TUI-only commands. Live
    // data (from a sibling SDK session in the same project) contributes custom
    // commands and richer descriptions where names overlap.
    const merged = mergeCommandLists(
      liveCommands ?? [],
      TERMINAL_EXTRA_COMMANDS,
      CLAUDE_BUILTIN_FALLBACK
    ).sort(byName);
    return merged.map((command) => ({ command, source: 'claude' as const }));
  }
  const orion: SlashCommandCandidate[] = ORION_SLASH_COMMANDS.filter((command) =>
    command.appliesTo(context)
  ).map(({ appliesTo: _appliesTo, ...command }) => ({ command, source: 'orion' as const }));
  if (!context.claudeBacked) return orion;
  const orionNames = new Set(orion.map((candidate) => candidate.command.name));
  // mergeCommandLists dedupes by name — lists from older caches may predate
  // main-side normalization.
  const claude = mergeCommandLists(liveCommands ?? CLAUDE_BUILTIN_FALLBACK)
    .filter(
      (command) => !OVERRIDDEN_CLAUDE_COMMANDS.has(command.name) && !orionNames.has(command.name)
    )
    .sort(byName)
    .map((command) => ({ command, source: 'claude' as const }));
  return [...orion, ...claude];
};

/**
 * The command a completed draft refers to (`/name` followed by whitespace or
 * arguments, or an exact name when the menu is dismissed) — drives the
 * argument-hint strip under the composer.
 */
export const completedSlashCommand = (
  value: string,
  candidates: SlashCommandCandidate[]
): SlashCommandCandidate | null => {
  const match = value.match(/^\/(\S+)(?:\s|$)/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return (
    candidates.find((candidate) =>
      commandNames(candidate.command).some((candidateName) => candidateName.toLowerCase() === name)
    ) ?? null
  );
};
