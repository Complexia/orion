// Kept free of agentCatalog / store imports so node --experimental-strip-types
// unit tests can load this module without extension resolution for the whole
// catalog tree. Option sets mirror agentCatalog.ts / modelPrefs.ts.

export const remoteThreadRuntime = (modelId: string): 'agent' | 'terminal' =>
  modelId === 'claude:claude-code-cli' ? 'terminal' : 'agent';

export const remoteThreadRunError = (modelId: string) =>
  remoteThreadRuntime(modelId) === 'terminal'
    ? 'Claude Code CLI terminal threads cannot be run through Remote Control because their output is only available in the host terminal.'
    : null;

const GROK_REASONING = new Set(['low', 'medium', 'high']);
const CLAUDE_REASONING = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
  'ultrathink',
]);
const CODEX_REASONING = new Set(['low', 'medium', 'high', 'xhigh', 'ultra']);
const GPT56_CODEX_SLUGS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const CLAUDE_1M_ONLY_SLUGS = new Set(['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5']);

type RemoteAgentSettingsThread = {
  codexReasoningEffort?: string;
  codexServiceTier?: string;
  claudeReasoningEffort?: string;
  claudeContextWindow?: string;
  grokReasoningEffort?: string;
};

type RemoteAgentSettingsModel = {
  providerId?: string;
  slug?: string;
};

/**
 * Map provider-agnostic remote runTurn settings onto the thread fields the
 * local composer would have written. Unknown / wrong-provider values are
 * dropped (same spirit as sanitizeAccessMode) so a controller never poisons
 * the host store with a tier the local picker could not pick.
 */
export const remoteAgentSettingsPatch = (
  thread: RemoteAgentSettingsThread,
  model: RemoteAgentSettingsModel | undefined,
  input: {
    reasoningEffort?: string;
    codexServiceTier?: string;
    claudeContextWindow?: string;
  }
): RemoteAgentSettingsThread => {
  const patch: RemoteAgentSettingsThread = {};
  if (!model?.providerId) return patch;

  if (input.reasoningEffort) {
    if (model.providerId === 'grok') {
      if (GROK_REASONING.has(input.reasoningEffort) && thread.grokReasoningEffort !== input.reasoningEffort) {
        patch.grokReasoningEffort = input.reasoningEffort;
      }
    } else if (model.providerId === 'claude') {
      if (
        CLAUDE_REASONING.has(input.reasoningEffort) &&
        thread.claudeReasoningEffort !== input.reasoningEffort
      ) {
        patch.claudeReasoningEffort = input.reasoningEffort;
      }
    } else if (model.providerId === 'codex') {
      const allowed =
        model.slug && GPT56_CODEX_SLUGS.has(model.slug)
          ? model.slug === 'gpt-5.6-luna'
            ? new Set(['low', 'medium', 'high', 'xhigh'])
            : CODEX_REASONING
          : new Set(['low', 'medium', 'high', 'xhigh']);
      if (allowed.has(input.reasoningEffort) && thread.codexReasoningEffort !== input.reasoningEffort) {
        patch.codexReasoningEffort = input.reasoningEffort;
      }
    }
  }

  if (input.codexServiceTier && model.providerId === 'codex') {
    if (
      (input.codexServiceTier === 'default' || input.codexServiceTier === 'priority') &&
      thread.codexServiceTier !== input.codexServiceTier
    ) {
      patch.codexServiceTier = input.codexServiceTier;
    }
  }

  if (input.claudeContextWindow && model.providerId === 'claude') {
    const requested =
      input.claudeContextWindow === '200k' || input.claudeContextWindow === '1m'
        ? input.claudeContextWindow
        : null;
    if (requested) {
      const effective =
        model.slug && CLAUDE_1M_ONLY_SLUGS.has(model.slug) ? '1m' : requested;
      if (thread.claudeContextWindow !== effective) patch.claudeContextWindow = effective;
    }
  }

  return patch;
};

// A pairing code is usable over ANY live inbound route. In internet mode the
// LAN listener stays up too, so a relay outage must not disable "Generate
// code" while a LAN/VPN pair would still succeed — this mirrors the engine's
// own hostAcceptingConnections() (listening || relay listener).
export const canGenerateRemotePairingCode = ({
  connectionMode,
  hostListening,
  relayOnline,
}: {
  connectionMode: 'direct' | 'relay';
  hostListening: boolean;
  relayOnline: boolean;
}) => hostListening || (connectionMode === 'relay' && relayOnline);

export const remoteControlIsAuthenticated = (
  accountAuthenticated: boolean,
  engineAuthenticated: boolean | undefined
) => accountAuthenticated && engineAuthenticated === true;

export const parseRemotePortDraft = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
};

export const mergeSynchronouslyTrackedRuns = (
  activeRunsByThread: Record<string, string>,
  trackedRuns: Iterable<[string, { threadId: string }]>
) => {
  const merged = new Map<string, string>(Object.entries(activeRunsByThread));
  for (const [runId, tracked] of trackedRuns) {
    // The synchronous registry wins when React's ref still holds the previous
    // render's run id for this thread.
    merged.set(tracked.threadId, runId);
  }
  return merged;
};

export const claimRemoteSideEffect = async (
  canPrepare: () => boolean,
  claim: () => Promise<boolean>
) => canPrepare() && (await claim());

export const claimRemoteThreadStart = async (
  claim: () => Promise<boolean>,
  applyClaimedSettings?: () => void
) => {
  if (!(await claim())) return false;
  applyClaimedSettings?.();
  return true;
};

export type RemoteCommandOutcome = {
  ok: boolean;
  threadId?: string;
  error?: string;
};

export const persistSuccessfulRemoteCommand = async (
  outcome: RemoteCommandOutcome,
  persistThreads: () => Promise<boolean>
): Promise<RemoteCommandOutcome> => {
  if (!outcome.ok) return outcome;
  try {
    if (await persistThreads()) return outcome;
  } catch {}
  return {
    ok: false,
    threadId: outcome.threadId,
    error: 'The remote command changed the host, but its thread state could not be saved.',
  };
};
