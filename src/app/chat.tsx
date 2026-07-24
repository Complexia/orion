import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleCheck, Copy, FileText, Folder, Sparkles, SquareKanban, X, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { type BtwExchange, type ChangedFileSummary, type LinkedBoardTask, type Message, type Thread, useOrionStore } from '../store';
import { agentProviders } from '../agentCatalog';
import { AgentActivityCard, buildAgentRunSegments, FloatingTasksCard, formatRunDuration, formatTokenCount, formatTurnStats, PinnedRunStatus, useRunTicker } from './activity';
import { AttachmentThumb } from './attachments';
import { MarkdownBaseDirContext, MarkdownContent } from './markdown';
import { linkedTaskStatusLabel } from './promptContext';

export const CopyMessageButton: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied; nothing to surface.
    }
  };

  return (
    <button
      type="button"
      className={`message-copy-btn${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

export const changedFileStatusLabels: Record<ChangedFileSummary['status'], string> = {
  added: 'A',
  copied: 'C',
  conflicted: '!',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

// Long change lists collapse to the first few files; a toggle reveals the rest.
export const CHANGED_FILES_COLLAPSED_LIMIT = 10;

export const ChangedFilesCard: React.FC<{ files: ChangedFileSummary[] }> = ({ files }) => {
  const [expanded, setExpanded] = useState(false);
  // Header totals always cover every file, even while the list is collapsed.
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
  const collapsible = files.length > CHANGED_FILES_COLLAPSED_LIMIT;
  const visibleFiles =
    collapsible && !expanded ? files.slice(0, CHANGED_FILES_COLLAPSED_LIMIT) : files;
  const groups = visibleFiles.reduce<Array<{ directory: string; files: ChangedFileSummary[] }>>(
    (result, file) => {
      const lastSlash = file.path.lastIndexOf('/');
      const directory = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '.';
      const existing = result.find((group) => group.directory === directory);
      if (existing) {
        existing.files.push(file);
      } else {
        result.push({ directory, files: [file] });
      }
      return result;
    },
    []
  );

  return (
    <div className="changed-files-card">
      <div className="changed-files-header">
        <span>Changed files ({files.length})</span>
        <span className="changed-files-totals">
          <span className="diff-add">+{totals.additions}</span>
          <span>/</span>
          <span className="diff-delete">-{totals.deletions}</span>
        </span>
      </div>
      {files.length === 0 ? (
        <div className="changed-files-empty">No files changed.</div>
      ) : (
        <div className="changed-files-list">
          {groups.map((group) => (
            <div key={group.directory} className="changed-files-group">
              <div className="changed-files-directory" title={group.directory}>
                <Folder size={15} />
                <span>{group.directory}</span>
              </div>
              {group.files.map((file) => {
                const name = file.path.split('/').pop() ?? file.path;
                return (
                  <div key={file.path} className="changed-file-row" title={file.path}>
                    <span className={`changed-file-status ${file.status}`}>
                      {changedFileStatusLabels[file.status]}
                    </span>
                    <FileText size={14} />
                    <span className="changed-file-name">{name}</span>
                    <span className="changed-file-counts">
                      <span className="diff-add">+{file.additions}</span>
                      <span>/</span>
                      <span className="diff-delete">-{file.deletions}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {collapsible && (
            <button
              className="changed-files-show-more"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? 'Show fewer'
                : `Show all ${files.length} files (${files.length - CHANGED_FILES_COLLAPSED_LIMIT} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const AGENT_SWITCHER_VISIBLE_LIMIT = 5;

// Claude Code-style agents switcher. When the current thread's family (the
// main run plus every subagent it spawned — provider-native or Orion-spawned)
// has members, a strip above the composer lists them with live status, so the
// user can flip between transcripts without losing their place. It renders
// identically on the main thread and on every subagent thread; only the
// highlighted row changes, which is what makes switching back and forth
// seamless.
export const AgentFamilySwitcher: React.FC<{
  currentThread: Thread;
  threads: Thread[];
  onSelect: (threadId: string) => void;
}> = ({ currentThread, threads, onSelect }) => {
  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  // Whole strip open/closed — independent of the "show N more" list truncation.
  const [sectionOpen, setSectionOpen] = useState(true);

  // Walk up to the family root — subagents can themselves spawn subagents.
  const root = useMemo(() => {
    let node = currentThread;
    const seen = new Set<string>([node.id]);
    while (node.parentThreadId) {
      const parent = threads.find((t) => t.id === node.parentThreadId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      node = parent;
    }
    return node;
  }, [currentThread, threads]);

  const subagents = useMemo(() => {
    const childrenByParent = new Map<string, Thread[]>();
    for (const thread of threads) {
      if (!thread.parentThreadId) continue;
      const siblings = childrenByParent.get(thread.parentThreadId);
      if (siblings) siblings.push(thread);
      else childrenByParent.set(thread.parentThreadId, [thread]);
    }
    for (const children of childrenByParent.values()) {
      children.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const seen = new Set<string>([root.id]);
    const collect = (
      parentId: string,
      depth: number,
      out: Array<{ thread: Thread; depth: number }>
    ) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push({ thread: child, depth });
        collect(child.id, depth + 1, out);
      }
    };
    const out: Array<{ thread: Thread; depth: number }> = [];
    collect(root.id, 0, out);
    return out;
  }, [threads, root.id]);

  const isExpanded = expandedRootId === root.id;
  const visibleSubagents = useMemo(() => {
    if (isExpanded || subagents.length <= AGENT_SWITCHER_VISIBLE_LIMIT) return subagents;

    const firstSubagents = subagents.slice(0, AGENT_SWITCHER_VISIBLE_LIMIT);
    const currentSubagent = subagents.find(({ thread }) => thread.id === currentThread.id);
    if (!currentSubagent || firstSubagents.includes(currentSubagent)) return firstSubagents;

    // Keep the selected row visible even when a restored/deep-linked thread
    // starts in the collapsed view.
    return [...firstSubagents.slice(0, AGENT_SWITCHER_VISIBLE_LIMIT - 1), currentSubagent];
  }, [currentThread.id, isExpanded, subagents]);
  const canToggleExpanded = subagents.length > AGENT_SWITCHER_VISIBLE_LIMIT;

  const anyRunning =
    root.status === 'running' || subagents.some(({ thread }) => thread.status === 'running');
  useRunTicker(anyRunning);

  if (subagents.length === 0) return null;

  const renderRow = (thread: Thread, isMain: boolean, depth: number) => {
    const lastRun = [...thread.messages].reverse().find((m) => m.kind === 'agent-run');
    const duration = lastRun
      ? formatRunDuration(lastRun.startedAt, lastRun.completedAt)
      : '';
    const tokens = lastRun?.stats?.totalTokens;
    const active = thread.id === currentThread.id;
    const name = isMain
      ? 'main'
      : thread.subagent?.kind ?? thread.modelId.split(':')[1] ?? 'agent';
    const detail = thread.title;
    return (
      <button
        key={thread.id}
        type="button"
        className={`agent-switcher-row${active ? ' active' : ''}${isMain ? ' main' : ''}`}
        style={depth > 1 ? { paddingLeft: 10 + depth * 14 } : undefined}
        onClick={() => onSelect(thread.id)}
        title={detail}
      >
        <span className={`agent-switcher-dot status-${thread.status}`} aria-hidden="true" />
        <span className="agent-switcher-name">{name}</span>
        {!isMain && <span className="agent-switcher-title">{detail}</span>}
        <span className="agent-switcher-meta">
          {duration}
          {typeof tokens === 'number' && tokens > 0 && (
            <> · ↓ {formatTokenCount(tokens)} tokens</>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="agent-switcher-wrap">
      <button
        type="button"
        className="agent-switcher-label"
        onClick={() => setSectionOpen((open) => !open)}
        aria-expanded={sectionOpen}
        title={sectionOpen ? 'Collapse subagents' : 'Expand subagents'}
      >
        <ChevronDown
          size={12}
          className={sectionOpen ? 'open' : ''}
          aria-hidden="true"
        />
        Subagents
      </button>
      {sectionOpen && (
        <div className={`agent-switcher${isExpanded ? ' expanded' : ''}`}>
          {renderRow(root, true, 0)}
          {visibleSubagents.map(({ thread, depth }) => renderRow(thread, false, depth + 1))}
          {canToggleExpanded && (
            <button
              type="button"
              className="agent-switcher-toggle"
              onClick={() => setExpandedRootId(isExpanded ? null : root.id)}
              aria-expanded={isExpanded}
            >
              <ChevronRight size={12} className={isExpanded ? 'open' : ''} />
              {isExpanded
                ? 'Show less'
                : `Show ${subagents.length - visibleSubagents.length} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Failure text that means the provider CLI is logged out rather than that the
// turn itself went wrong. Matched against the terminal error text (plus the
// tail of the streamed output, where stderr lands) so the transcript can offer
// an Authenticate button instead of a dead-end error. Patterns cover every
// provider's logged-out phrasing: claude ("Invalid API key · Please run
// /login", "OAuth session expired"), codex ("Not logged in. Run codex login",
// 401s), cursor-agent ("Not authenticated"), grok ("login required"), opencode.
export const PROVIDER_AUTH_ERROR_PATTERNS: RegExp[] = [
  /invalid api key/i,
  /run \/login/i,
  /failed to authenticate/i,
  /authentication (failed|error|required)/i,
  /not (logged in|authenticated|signed in)/i,
  /(login|log ?in|sign ?in) (is )?required/i,
  /(oauth|auth(entication)?) (session|token)[^\n]{0,60}(expired|invalid|revoked)/i,
  /token (has )?expired/i,
  /\bunauthenticated\b/i,
  /\b401\b[^\n]{0,40}unauthorized/i,
  /unauthorized[^\n]{0,40}\b401\b/i,
  /run\s+`?(codex|cursor-agent|grok|opencode|claude|kimi)\s+(auth\s+)?login/i,
  /please (log ?in|sign ?in)/i,
];

export const isProviderAuthErrorText = (text: string | null | undefined): boolean =>
  Boolean(text) && PROVIDER_AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text as string));

/** Inline "this CLI is logged out" prompt shown in place of a dead-end turn error. */
export const ProviderAuthPrompt: React.FC<{
  providerId: string;
  onAuthenticate: (providerId: string) => void;
  busy?: boolean;
}> = ({ providerId, onAuthenticate, busy }) => {
  const label =
    agentProviders.find((provider) => provider.id === providerId)?.label ?? providerId;
  return (
    <div className="agent-error agent-auth-error">
      <span>
        {label} is logged out. Authenticate, then send your message again.
      </span>
      <button
        type="button"
        className="provider-auth-button compact"
        onClick={() => onAuthenticate(providerId)}
        disabled={busy}
      >
        {busy ? 'Authenticating…' : 'Authenticate'}
      </button>
    </div>
  );
};

export type ChatMessageProps = {
  message: Message;
  /** The thread's current linked task, for live status on the message's task chip. */
  liveTask?: LinkedBoardTask;
  taskBusy?: boolean;
  onMarkTaskDone?: () => void;
  onUnlinkTask?: () => void;
  btwExchanges?: BtwExchange[];
  renderBtwAside?: (exchange: BtwExchange) => React.ReactNode;
  onAuthenticateProvider?: (providerId: string) => void;
  authenticatingProviderId?: string | null;
};

export const ChatMessage = React.memo(function ChatMessage({
  message,
  liveTask,
  taskBusy,
  onMarkTaskDone,
  onUnlinkTask,
  btwExchanges = [],
  renderBtwAside,
  onAuthenticateProvider,
  authenticatingProviderId,
}: ChatMessageProps) {
  const attachments = message.attachments ?? [];
  const messageTask = message.linkedTask;
  // Live status/actions only while the chip's task is still the thread's
  // linked task; after an unlink or relink it renders as a static snapshot.
  const liveMessageTask = messageTask && liveTask?.id === messageTask.id ? liveTask : undefined;
  const isAgentRun = message.role === 'agent' && message.kind === 'agent-run';
  const isRunning = isAgentRun && message.status === 'running';

  if (isAgentRun) {
    const duration = formatRunDuration(message.startedAt, message.completedAt);
    const hasContent = message.content.trim().length > 0;
    const statsSummary = message.stats ? formatTurnStats(message.stats) : '';

    return (
      <div className={`message agent agent-run ${message.status ?? ''}`}>
        {!isRunning && (
          <div className="agent-response-divider">
            <span>
              Response{duration && ` · worked for ${duration}`}
              {statsSummary && <span className="agent-response-stats"> · {statsSummary}</span>}
            </span>
            {hasContent && <CopyMessageButton text={message.content} className="in-divider" />}
          </div>
        )}
        {message.statusText && !isRunning && (
          <div className="agent-status-line">
            <span>{message.statusText}</span>
          </div>
        )}
        {buildAgentRunSegments(message.content, message.activities ?? [], btwExchanges).map((segment, index) =>
          segment.kind === 'activities' ? (
            <AgentActivityCard
              key={segment.activities[0].id}
              activities={segment.activities}
              runStatus={message.status}
            />
          ) : segment.kind === 'btw' ? (
            <React.Fragment key={`btw-${segment.exchange.id}`}>
              {renderBtwAside?.(segment.exchange)}
            </React.Fragment>
          ) : segment.text.trim() ? (
            <MarkdownContent key={`text-${index}`} content={segment.text} />
          ) : null
        )}
        {!hasContent &&
          isRunning &&
          !message.activities?.length && (
            <div className="agent-empty-output">Waiting for the agent to produce output...</div>
          )}
        {!isRunning && message.changedFiles && <ChangedFilesCard files={message.changedFiles} />}
        {message.error &&
          (message.authProviderId && onAuthenticateProvider ? (
            <ProviderAuthPrompt
              providerId={message.authProviderId}
              onAuthenticate={onAuthenticateProvider}
              busy={authenticatingProviderId === message.authProviderId}
            />
          ) : (
            <div className="agent-error">{message.error}</div>
          ))}
      </div>
    );
  }

  return (
    <div className={`message ${message.role}`}>
      {message.role === 'agent' ? (
        <MarkdownContent content={message.content} />
      ) : (
        <>
          {messageTask && (
            <div
              className={`composer-task-chip message-task-chip status-${liveMessageTask?.lastStatus ?? 'linked'}`}
              title={messageTask.description || messageTask.title}
            >
              <SquareKanban size={13} />
              <span className="composer-task-title">{messageTask.title}</span>
              <span className="composer-task-status">
                {liveMessageTask ? linkedTaskStatusLabel(liveMessageTask.lastStatus) : 'Linked'}
              </span>
              {liveMessageTask && liveMessageTask.lastStatus !== 'done' && !taskBusy && onMarkTaskDone && (
                <button
                  type="button"
                  className="composer-task-action done"
                  onClick={onMarkTaskDone}
                  title="Mark the task as done on the board"
                >
                  <CircleCheck size={13} />
                </button>
              )}
              {liveMessageTask && onUnlinkTask && (
                <button
                  type="button"
                  className="composer-task-action"
                  onClick={onUnlinkTask}
                  title="Unlink task"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {message.content && <div className="whitespace-pre-wrap break-words">{message.content}</div>}
          {attachments.length > 0 && (
            <div className="message-attachments">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="message-attachment" title={attachment.path}>
                  <AttachmentThumb attachment={attachment} />
                  <span>{attachment.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {(message.role === 'user' || message.role === 'agent') && message.content.trim() && (
        <CopyMessageButton text={message.content} />
      )}
    </div>
  );
});

export const AgentsWelcome: React.FC<{
  projectName?: string | null;
}> = ({ projectName }) => (
  <div className="agents-welcome">
    <div className="agents-welcome-icon">
      <Sparkles size={26} />
    </div>
    <h2>
      What should we build in <strong>{projectName ?? 'this project'}</strong>?
    </h2>
  </div>
);

export type ChatTranscriptProps = {
  threadId: string;
  projectName?: string | null;
  mediaBaseDirs: string[];
  isSending: boolean;
  steerSupported: boolean;
  steerReady: boolean;
  authenticatingProviderId: string | null;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  chatPinnedRef: React.MutableRefObject<boolean>;
  chatScrollTopRef: React.MutableRefObject<number>;
  tasksCardPosition: { x: number; y: number } | null;
  tasksCardCollapsed: boolean;
  tasksCardDismissedFor: string | null;
  onMoveTasksCard: (position: { x: number; y: number }) => void;
  onToggleTasksCard: () => void;
  onDismissTasksCard: (messageId: string) => void;
  onMarkTaskDone: (threadId: string) => void;
  onUnlinkTask: (threadId: string) => void;
  onDismissBtwExchange: (threadId: string, exchangeId: string) => void;
  onAuthenticateProvider: (providerId: string) => void;
  onSteerQueuedMessage: (queuedId: string) => void;
};

/**
 * Owns the high-frequency selected-thread subscription. Streaming chunks now
 * re-render this boundary only; memoized historical messages retain their
 * object identity and are skipped by React.
 */
export const ChatTranscript = React.memo(function ChatTranscript({
  threadId,
  projectName,
  mediaBaseDirs,
  isSending,
  steerSupported,
  steerReady,
  authenticatingProviderId,
  chatScrollRef,
  chatEndRef,
  chatPinnedRef,
  chatScrollTopRef,
  tasksCardPosition,
  tasksCardCollapsed,
  tasksCardDismissedFor,
  onMoveTasksCard,
  onToggleTasksCard,
  onDismissTasksCard,
  onMarkTaskDone,
  onUnlinkTask,
  onDismissBtwExchange,
  onAuthenticateProvider,
  onSteerQueuedMessage,
}: ChatTranscriptProps) {
  const { thread, removeQueuedThreadMessage } = useOrionStore(
    useShallow((state) => ({
      thread: state.threads.find((candidate) => candidate.id === threadId),
      removeQueuedThreadMessage: state.removeQueuedThreadMessage,
    }))
  );
  const floatingPlan = useMemo(() => {
    const messages = thread?.messages;
    if (!messages) return null;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'agent' || message.kind !== 'agent-run') continue;
      const activity = message.activities?.find((entry) => entry.type === 'plan');
      if (!activity || (activity.plan?.length ?? 0) === 0) return null;
      return { messageId: message.id, activity, running: message.status === 'running' };
    }
    return null;
  }, [thread?.messages]);

  const runningAgentMessage = useMemo(() => {
    const messages = thread?.messages;
    if (!messages) return null;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role === 'agent' && message.kind === 'agent-run' && message.status === 'running') {
        return message;
      }
    }
    return null;
  }, [thread?.messages]);

  const { btwAsidesByAnchor, leadingBtwAsides, trailingBtwAsides } = useMemo(() => {
    const byAnchor = new Map<string, BtwExchange[]>();
    const leading: BtwExchange[] = [];
    const trailing: BtwExchange[] = [];
    if (!thread) {
      return {
        btwAsidesByAnchor: byAnchor,
        leadingBtwAsides: leading,
        trailingBtwAsides: trailing,
      };
    }

    const messageIds = new Set(thread.messages.map((message) => message.id));
    for (const exchange of thread.btwExchanges ?? []) {
      let anchorId =
        exchange.afterMessageId && messageIds.has(exchange.afterMessageId)
          ? exchange.afterMessageId
          : undefined;
      const exchangeTime = new Date(exchange.createdAt).getTime();
      if (!anchorId && Number.isFinite(exchangeTime)) {
        anchorId = [...thread.messages]
          .reverse()
          .find((message) => {
            const messageTime = new Date(message.ts).getTime();
            return Number.isFinite(messageTime) && messageTime <= exchangeTime;
          })?.id;
      }
      if (anchorId) {
        const anchored = byAnchor.get(anchorId);
        if (anchored) anchored.push(exchange);
        else byAnchor.set(anchorId, [exchange]);
      } else if (Number.isFinite(exchangeTime) && thread.messages.length > 0) {
        leading.push(exchange);
      } else {
        trailing.push(exchange);
      }
    }

    return {
      btwAsidesByAnchor: byAnchor,
      leadingBtwAsides: leading,
      trailingBtwAsides: trailing,
    };
  }, [thread]);

  const handleChatScroll = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    chatPinnedRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    chatScrollTopRef.current = element.scrollTop;
  }, [chatPinnedRef, chatScrollRef, chatScrollTopRef]);

  useLayoutEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: chatPinnedRef.current ? element.scrollHeight : chatScrollTopRef.current,
      behavior: 'instant',
    });
  }, [chatPinnedRef, chatScrollRef, chatScrollTopRef]);

  useEffect(() => {
    if (!chatPinnedRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [
    chatEndRef,
    chatPinnedRef,
    isSending,
    thread?.messages,
    thread?.queuedMessages,
    thread?.btwExchanges,
  ]);

  const handleMarkTaskDone = useCallback(
    () => onMarkTaskDone(threadId),
    [onMarkTaskDone, threadId]
  );
  const handleUnlinkTask = useCallback(
    () => onUnlinkTask(threadId),
    [onUnlinkTask, threadId]
  );
  const handleDismissTasksCard = useCallback(() => {
    if (floatingPlan) onDismissTasksCard(floatingPlan.messageId);
  }, [floatingPlan, onDismissTasksCard]);
  const renderBtwAside = useCallback(
    (exchange: BtwExchange) => (
      <div key={exchange.id} className={`btw-aside ${exchange.status}`}>
        <div className="btw-aside-bar">
          <span className="btw-aside-badge">
            <Sparkles size={11} />
            BTW
          </span>
          <span className="btw-aside-note">
            aside · answered from a fork · not part of the thread
          </span>
          <button
            type="button"
            className="btw-aside-dismiss"
            onClick={() => onDismissBtwExchange(threadId, exchange.id)}
            title={
              exchange.status === 'running'
                ? 'Cancel and dismiss this aside'
                : 'Dismiss this aside'
            }
          >
            <X size={12} />
          </button>
        </div>
        <div className="btw-aside-question">{exchange.question}</div>
        {exchange.status === 'running' && !exchange.answer && (
          <div className="agent-status-line running">
            <span className="working-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Answering on the side…</span>
          </div>
        )}
        {exchange.answer && (
          <div className="btw-aside-answer">
            <MarkdownContent content={exchange.answer} />
          </div>
        )}
        {exchange.status === 'error' &&
          (exchange.authProviderId ? (
            <ProviderAuthPrompt
              providerId={exchange.authProviderId}
              onAuthenticate={onAuthenticateProvider}
              busy={authenticatingProviderId === exchange.authProviderId}
            />
          ) : (
            <div className="agent-error">{exchange.error ?? 'The aside failed.'}</div>
          ))}
      </div>
    ),
    [
      authenticatingProviderId,
      onAuthenticateProvider,
      onDismissBtwExchange,
      threadId,
    ]
  );

  if (!thread) return null;

  return (
    <div className="chat-scroll-wrap">
      <div className="chat-scroll" ref={chatScrollRef} onScroll={handleChatScroll}>
        <MarkdownBaseDirContext.Provider value={mediaBaseDirs}>
          <div className="chat-container">
            {thread.messages.length === 0 && <AgentsWelcome projectName={projectName} />}

            {leadingBtwAsides.map(renderBtwAside)}

            {thread.messages.map((message) => (
              <React.Fragment key={message.id}>
                <ChatMessage
                  message={message}
                  liveTask={thread.linkedTask}
                  taskBusy={isSending}
                  onMarkTaskDone={handleMarkTaskDone}
                  onUnlinkTask={handleUnlinkTask}
                  btwExchanges={
                    message.kind === 'agent-run'
                      ? btwAsidesByAnchor.get(message.id)
                      : undefined
                  }
                  renderBtwAside={renderBtwAside}
                  onAuthenticateProvider={onAuthenticateProvider}
                  authenticatingProviderId={authenticatingProviderId}
                />
                {message.kind !== 'agent-run' &&
                  btwAsidesByAnchor.get(message.id)?.map(renderBtwAside)}
              </React.Fragment>
            ))}

            {isSending && thread.messages.at(-1)?.role !== 'agent' && (
              <div className="message agent opacity-70">Starting agent...</div>
            )}

            {(thread.queuedMessages ?? []).map((queued) => (
              <div key={queued.id} className="message user queued">
                {queued.text && (
                  <div className="whitespace-pre-wrap break-words">{queued.text}</div>
                )}
                {(queued.attachments?.length ?? 0) > 0 && (
                  <div className="message-attachments">
                    {queued.attachments!.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="message-attachment"
                        title={attachment.path}
                      >
                        <AttachmentThumb attachment={attachment} />
                        <span>{attachment.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="queued-message-bar">
                  <span className="queued-message-badge">Queued</span>
                  {steerSupported && (
                    <button
                      type="button"
                      className="queued-message-action steer"
                      onClick={() => onSteerQueuedMessage(queued.id)}
                      disabled={!steerReady}
                      title={
                        steerReady
                          ? 'Interrupt the agent and send this now'
                          : 'Steer becomes available once the agent reports its session'
                      }
                    >
                      <Zap size={12} />
                      Steer now
                    </button>
                  )}
                  <button
                    type="button"
                    className="queued-message-action remove"
                    onClick={() => removeQueuedThreadMessage(threadId, queued.id)}
                    title="Remove queued message"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}

            {trailingBtwAsides.map(renderBtwAside)}
            <div ref={chatEndRef} />
          </div>
        </MarkdownBaseDirContext.Provider>
      </div>

      {floatingPlan && tasksCardDismissedFor !== floatingPlan.messageId && (
        <FloatingTasksCard
          activity={floatingPlan.activity}
          running={floatingPlan.running}
          position={tasksCardPosition}
          onMove={onMoveTasksCard}
          collapsed={tasksCardCollapsed}
          onToggleCollapsed={onToggleTasksCard}
          onDismiss={handleDismissTasksCard}
        />
      )}

      {runningAgentMessage && <PinnedRunStatus message={runningAgentMessage} />}
    </div>
  );
});
