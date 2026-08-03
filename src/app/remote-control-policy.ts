export const remoteThreadRuntime = (modelId: string): 'agent' | 'terminal' =>
  modelId === 'claude:claude-code-cli' ? 'terminal' : 'agent';

export const remoteThreadRunError = (modelId: string) =>
  remoteThreadRuntime(modelId) === 'terminal'
    ? 'Claude Code CLI terminal threads cannot be run through Remote Control because their output is only available in the host terminal.'
    : null;

export const canGenerateRemotePairingCode = ({
  connectionMode,
  hostListening,
  relayOnline,
}: {
  connectionMode: 'direct' | 'relay';
  hostListening: boolean;
  relayOnline: boolean;
}) => (connectionMode === 'relay' ? relayOnline : hostListening);

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
