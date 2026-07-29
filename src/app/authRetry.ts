import type { AuthRetryPayload, LinkedBoardTask, Message, Thread } from '../store';

export type AuthRetryTarget = {
  threadId: string;
  messageId: string;
};

export type PendingAuthRetryAttempt = {
  providerId: string;
  targets: AuthRetryTarget[];
  authenticationCompleted?: boolean;
};

export type AuthRetryResult = {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
};

export type AuthRetryTargetResolution = {
  usableTargets: AuthRetryTarget[];
  undiscoveredTargets: AuthRetryTarget[];
};

const dynamicModelProviderIds = new Set(['cursor', 'kimi']);

/**
 * A branch transition changes checkout identity for every thread that resolves
 * to the same workspace, not only the currently selected thread.
 */
export const authRetryThreadIdsForWorkingDir = <T extends { id: string }>(
  threads: T[],
  workingDir: string,
  resolveWorkingDir: (thread: T) => string | null | undefined
): string[] => {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const expectedWorkingDir = normalize(workingDir);
  return threads
    .filter((thread) => {
      const candidateWorkingDir = resolveWorkingDir(thread);
      return candidateWorkingDir != null && normalize(candidateWorkingDir) === expectedWorkingDir;
    })
    .map((thread) => thread.id);
};

/**
 * Remove every not-yet-dispatched retry for the given threads. This is shared
 * by ordinary user dispatches (which supersede automatic replay) and workspace
 * retirement (where replaying in the thread's next checkout would be unsafe).
 */
export const retireAuthRetryTargets = <T extends { target: AuthRetryTarget }>(
  pendingAttempts: Map<string, PendingAuthRetryAttempt>,
  retryQueues: Map<string, T[]>,
  threadIds: Iterable<string>
): number => {
  const retiredThreadIds = new Set(threadIds);
  let retiredCount = 0;

  for (const pending of pendingAttempts.values()) {
    const remainingTargets = pending.targets.filter((target) => {
      if (!retiredThreadIds.has(target.threadId)) return true;
      retiredCount += 1;
      return false;
    });
    pending.targets = remainingTargets;
  }

  for (const threadId of retiredThreadIds) {
    const queue = retryQueues.get(threadId);
    if (queue) retiredCount += queue.length;
    retryQueues.delete(threadId);
  }

  return retiredCount;
};

/**
 * Authentication completion is attempt-scoped. Consuming the entry on every
 * terminal outcome prevents a later, unrelated login from replaying it.
 */
export const consumeAuthRetryAttempt = (
  pendingAttempts: Map<string, PendingAuthRetryAttempt>,
  attemptId: string,
  providerId: string
): AuthRetryTarget[] | undefined => {
  const pending = pendingAttempts.get(attemptId);
  if (!pending || pending.providerId !== providerId) return undefined;
  pendingAttempts.delete(attemptId);
  return pending.targets;
};

/**
 * Persisted retry payloads must never use the catalog's normal default-model
 * fallback: replaying on another model/provider changes the original request.
 */
export const findExactAuthRetryModel = <T extends { id: string }>(
  models: T[],
  modelId: string
): T | undefined => models.find((model) => model.id === modelId);

/**
 * Resolve the exact failed run the user clicked. Historical failures are
 * intentionally supported; retry selection never falls back to the thread's
 * latest message or to a thread-level "last dispatch" cache.
 */
export const findRetryableAuthMessage = (
  thread: Thread | undefined,
  target: AuthRetryTarget,
  providerId: string
): Message | undefined => {
  if (!thread || thread.id !== target.threadId) return undefined;
  const message = thread.messages.find((candidate) => candidate.id === target.messageId);
  return message?.kind === 'agent-run' &&
    message.status === 'error' &&
    message.authProviderId === providerId &&
    message.authRetryPayload
    ? message
    : undefined;
};

/**
 * Rebuild the attempt-scoped association after a renderer reload. The exact
 * attempt id is persisted on each clicked transcript message, so an unrelated
 * provider login cannot collect historical failures.
 */
export const recoverAuthRetryAttempt = (
  threads: Thread[],
  attemptId: string,
  providerId: string
): PendingAuthRetryAttempt | undefined => {
  const targets: AuthRetryTarget[] = [];
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (message.authRetryAttemptId !== attemptId) continue;
      const target = { threadId: thread.id, messageId: message.id };
      if (findRetryableAuthMessage(thread, target, providerId)) {
        targets.push(target);
      }
    }
  }
  return targets.length > 0 ? { providerId, targets } : undefined;
};

/**
 * A completed authentication attempt can contain historical failures from
 * several threads. Workspace edits during login may delete some of them, and
 * provider discovery may remove an exact model. Those stale entries must not
 * prevent the remaining valid retries from resuming.
 */
export const resolveAuthRetryTargets = <T extends { id: string; available?: boolean }>(
  targets: AuthRetryTarget[],
  threads: Thread[],
  providerId: string,
  models: T[],
  retainUndiscoveredDynamicModels = false
): AuthRetryTargetResolution => {
  const usableTargets: AuthRetryTarget[] = [];
  const undiscoveredTargets: AuthRetryTarget[] = [];

  for (const target of targets) {
    const thread = threads.find((candidate) => candidate.id === target.threadId);
    const message = findRetryableAuthMessage(thread, target, providerId);
    if (!message?.authRetryPayload) continue;
    const model = findExactAuthRetryModel(models, message.authRetryPayload.modelId);
    if (model != null && model.available !== false) {
      usableTargets.push(target);
      continue;
    }
    if (
      model == null &&
      retainUndiscoveredDynamicModels &&
      dynamicModelProviderIds.has(providerId) &&
      message.authRetryPayload.modelId.startsWith(`${providerId}:`)
    ) {
      undiscoveredTargets.push(target);
    }
  }

  return { usableTargets, undiscoveredTargets };
};

export const filterUsableAuthRetryTargets = <T extends { id: string; available?: boolean }>(
  targets: AuthRetryTarget[],
  threads: Thread[],
  providerId: string,
  models: T[]
): AuthRetryTarget[] =>
  resolveAuthRetryTargets(targets, threads, providerId, models).usableTargets;

/**
 * A replay already contains the original one-shot task context. Tasks linked
 * since that dispatch must remain pending for the next user turn.
 */
export const linkedTasksForTurnDispatch = (
  linkedTasks: LinkedBoardTask[] | undefined,
  isRetry: boolean
): LinkedBoardTask[] => (isRetry ? [] : (linkedTasks ?? []).filter((task) => !task.injected));

export const dispatchAuthRetryPayload = (
  payload: AuthRetryPayload,
  dispatchers: {
    turn: (payload: Extract<AuthRetryPayload, { kind: 'turn' }>) => Promise<AuthRetryResult>;
    goal: (payload: Extract<AuthRetryPayload, { kind: 'goal' }>) => AuthRetryResult;
    review: (payload: Extract<AuthRetryPayload, { kind: 'review' }>) => AuthRetryResult;
  }
): Promise<AuthRetryResult> => {
  if (payload.kind === 'turn') return dispatchers.turn(payload);
  return Promise.resolve(payload.kind === 'goal' ? dispatchers.goal(payload) : dispatchers.review(payload));
};
