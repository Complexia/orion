import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Trash2,
  MessageSquare,
  Code2,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  ChevronDown,
  Columns3,
  Ellipsis,
  SquarePen,
  Check,
  X,
  Play,
  Pause,
  Target,
  Shield,
  Square,
  Terminal,
  Bot,
  Sparkles,
  ArrowUp,
  Image as ImageIcon,
  RefreshCw,
  Archive,
  Cloud,
  CloudUpload,
  CloudDownload,
  Globe,
  AppWindow,
  SquareArrowOutUpRight,
  ListPlus,
  Zap,
  SquareKanban,
  CircleCheck,
  FlaskConical,
  Menu,
  SlidersHorizontal,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  useOrionStore,
  flushOrionStoreSave,
  flushOrionThreadsSave,
  defaultProviderSettings,
  defaultOrchestrationSettings,
  defaultNotificationSettings,
  defaultEpicsSettings,
  defaultRiftsSettings,
  isAgentsPanelVisible,
  MAX_THREAD_PANES,
  type AgentActivity,
  type BtwExchange,
  type ChangedFileSummary,
  type ImageAttachment,
  type LinkedBoardTask,
  type Message,
  type OrchestrationRoleId,
  type Project,
  type ProviderId,
  type Thread,
  type ThreadGoal,
  type TurnTokenStats,
  type Epic,
} from './store';
import type { RiftStorageEntry, RiftStorageState } from './types';
import { Toaster, toast } from 'sonner';
import {
  agentProviders,
  claudeCodeCliModelId,
  claudeContextWindowOptions,
  claudeReasoningOptions,
  codexReasoningOptionsForModel,
  codexServiceTierOptions,
  defaultAgentModelId,
  defaultClaudeContextWindow,
  defaultCodexServiceTier,
  defaultGrokReasoningEffort,
  getEffectiveCodexReasoningEffort,
  grokReasoningOptions,
  fallbackAgentModels,
  findAgentModel,
  isClaudeCodeCliModelId,
  isOrionModelId,
  providerFollowUpSupport,
  type AgentModel,
  type AgentProviderId,
  type ClaudeContextWindow,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type CodexServiceTier,
  type GrokReasoningEffort,
} from './agentCatalog';
import orionIconUrl from '../assets/icon.png';
import { CodeWorkspace } from './app/CodeWorkspace';
import { AgentsSidebar, type AgentsSidebarModel, THREAD_DRAG_MIME } from './app/AgentsSidebar';
import { ThreadPane } from './app/ThreadPane';
import type { AppDialogsModel } from './app/AppDialogs';
import { ProjectIcon } from './app/ProjectIcon';
import { TaskPickerPopover } from './app/TaskPickerPopover';
import { ComposerPopover } from './app/ComposerPopover';
import { ModelPickerPopover } from './app/ModelPickerPopover';
import { goalStatusLabels, goalSummaryLine, goalUsageSummary } from './app/activity';
import {
  AttachmentThumb,
  buildPromptWithAttachments,
  formatAttachmentSize,
  getDroppedFilePath,
  isMediaFile,
  isVideoAttachment,
  isVideoFile,
} from './app/attachments';
import {
  AgentFamilySwitcher,
  type ChatScrollPosition,
  ChatTranscript,
  isProviderAuthErrorText,
  type PaneChatRefs,
} from './app/chat';
import { InlineRenameInput } from './app/fileTree';
import {
  claudeOneMillionOnlyModelSlugs,
  getDefaultClaudeReasoningEffort,
  getEffectiveClaudeContextWindow,
} from './app/modelPrefs';
import {
  accessModeOptions,
  buildLinkedTaskContext,
  buildModelMentionsContext,
  buildOrchestrationContext,
  buildReviewThreadContext,
  linkedTaskFromBoardTask,
  linkedTaskMediaAttachments,
  linkedTaskStatusLabel,
  modelMentionToken,
  orchestrationRoleMeta,
  parseModelMentions,
} from './app/promptContext';
import { formatShortTime, getThreadActivityTime } from './app/time';
import { deriveTitle, isDefaultTitle, isPlausibleTitle, tryGenerateBetterTitle } from './app/titles';
import type { SidebarFooterProps } from './app/SidebarFooter';
import type { SettingsPageProps } from './app/SettingsPage';
import type {
  AppUpdateState,
  EpicCommitDialogState,
  EpicPrBaseDialogState,
  EpicPrStatus,
  EpicSettleDialogState,
  GitRepoState,
  NewEpicRiftBranches,
  OrionAccountState,
  ProviderUpdateState,
  RiftSweepDialogState,
  SettingsTab,
} from './app/appTypes';

// Lazy-loaded so xterm (and the TerminalView code) is split into its own
// chunk and only fetched/parsed when a Claude Code CLI thread is actually
// opened — the pseudo-model costs nothing at startup. (Its main-process
// counterpart, node-pty, is likewise only import()ed on first terminal:ensure.)
const TerminalView = React.lazy(() => import('./TerminalView'));
const SettingsPage = React.lazy(() => import('./app/SettingsPage'));
const AppDialogs = React.lazy(() => import('./app/AppDialogs'));

const normalizeRepositoryPath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * Sizes come from block accounting, which counts a copy-on-write clone's
 * shared blocks in full — so these read as an upper bound on what freeing a
 * rift reclaims, not a promise. The real figure is measured from free space
 * after a sweep.
 */
const formatBytes = (bytes: number | null | undefined) => {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
};

const RIFT_RELEASE_REASON_LABELS: Record<string, string> = {
  'unsafe-path': 'not a recognizable rift directory',
  'missing-marker': 'missing its rift marker',
  'epic-active': 'its epic is still active',
  'epic-busy': 'its epic is busy',
  'unpushed-work': 'has uncommitted or unpushed work',
  'restore-ref-failed': 'its restorable branch state could not be preserved',
  'runtime-dispose-failed': 'its agent runtimes could not be stopped safely',
  'journal-failed': 'its release could not be recorded safely',
  'ownership-changed': 'its epic ownership changed while cleanup was running',
  'remove-failed': 'could not be removed',
};

const THREADS_VISIBLE_LIMIT = 5;

// How often the sidebar refreshes non-merged PRs. One `gh api graphql` call
// covers every epic at once (rate-limit cost 1 of 5000/hour), so this is a
// fixed cost per tick rather than per PR, and stays well under the 5s local-git
// poll behind the selected epic's buttons. A merge can land any time — minutes
// or a day after the PR opens, and possibly by someone else — so this periodic
// refresh, not any user-driven event, is what has to catch it.
const EPIC_PR_STATE_REFRESH_MS = 60_000;

// Returning to Orion right after merging in the browser is the moment the icon
// is most likely stale, so focus gets its own much shorter throttle.
const EPIC_PR_STATE_FOCUS_REFRESH_MS = 15_000;

type EpicPrLookupRequest = {
  expectedPrUrl: string;
  order: number;
  startedAt: string;
};

// What prompted a batch PR-state refresh, which decides how long it must wait
// since the last one: the background interval or a window focus.
type EpicPrRefreshReason = 'tick' | 'focus';

// The git action an epic currently has in flight, with the checkout it acts
// on. Tracked per epic so one epic's commit or PR never blocks another epic's.
type EpicGitBusyKind = 'commit' | 'pr' | 'pr-branches' | 'settle';

type EpicGitBusyEntry = {
  kind: EpicGitBusyKind;
  workspaceKey?: string;
};

// Which group of the composer's overflow menu is expanded, when the controls
// row is too narrow to show them as separate chips. One at a time.
type ComposerMenuSection = 'agent' | 'access' | 'tasks' | null;

// Width the composer controls need before they start colliding, estimated from
// the labels they will render rather than measured: the collapsed row can't
// measure the expanded one, and re-measuring after each switch would oscillate.
// Deliberately generous — a chip that just fits looks cramped anyway.
const estimateChipWidth = (label: string, perChar: number, fixed: number) =>
  Math.ceil(label.length * perChar) + fixed;

const UNCLAIMED_EPIC_GIT_WORKSPACE_KEY = 'git:unclaimed';

const epicGitWorkspacesOverlap = (left: string, right: string) =>
  left === right ||
  ((left === UNCLAIMED_EPIC_GIT_WORKSPACE_KEY || right === UNCLAIMED_EPIC_GIT_WORKSPACE_KEY) &&
    !left.startsWith('rift:') &&
    !right.startsWith('rift:'));

// Whether an epic has to wait before starting a git action: either it already
// has one in flight, or another epic is working in the same canonical checkout.
const epicGitWorkspaceBusy = (
  epicId: string,
  workspaceKey: string | undefined,
  entries: Record<string, EpicGitBusyEntry>
) =>
  Object.entries(entries).some(([busyEpicId, entry]) => {
    if (busyEpicId === epicId) return true;
    if (!workspaceKey || !entry.workspaceKey) return false;
    return epicGitWorkspacesOverlap(workspaceKey, entry.workspaceKey);
  });

// Single source of truth for "what state is this epic's PR in", shared by the
// sidebar icon colour and the epic view's badge. Successful selected-workspace
// reads and URL-only batch reads both update the persisted epic, so rendering
// from that value prevents an older local status cache masking a newer batch
// result when the selected workspace later becomes unavailable.
const epicPrStatus = (epic: Pick<Epic, 'prUrl' | 'prState'> | undefined | null): EpicPrStatus | null => {
  if (!epic?.prUrl) return null;
  switch (epic.prState) {
    case 'OPEN':
      return 'open';
    case 'MERGED':
      return 'merged';
    case 'CLOSED':
      return 'closed';
    default:
      return null;
  }
};

// Default order for Orion's hidden text-generation turns (thread titles, epic
// commit messages, PR descriptions) when the user hasn't picked a model in
// Settings. One entry per provider — the fastest model that provider offers —
// so a user with a single harness gets that harness's quick model, and a user
// with several gets them in this order. Falls through to any usable model.
const UTILITY_MODEL_PREFERENCE = [
  'codex:gpt-5.6-luna',
  'grok:grok-composer-2.5-fast',
  'cursor:composer-2.5',
  'claude:claude-haiku-4-5',
  'kimi:kimi-code/kimi-for-coding',
];

// Threads grouped under an epic that has a rift workspace (experimental Rifts
// feature) run their agent processes inside the rift instead of the project
// directory.
const threadWorkingDir = (epics: Epic[], thread: { epicId?: string } | undefined, project: Project) => {
  const epic = thread?.epicId ? epics.find((candidate) => candidate.id === thread.epicId) : undefined;
  // A thread that belongs to a Rift epic must never silently fall back to the
  // source checkout while that workspace is absent. Callers treat null as a
  // hard launch guard.
  if (epic?.riftReleased || epic?.riftRequest || epic?.riftCleanupPending) return null;
  return epic?.riftPath ? (epic.riftWorkingDir ?? epic.riftPath) : project.path;
};

// Provider-native ids are not necessarily globally unique (Kimi uses values
// such as agent-0 per session). Reload recovery may search nested descendants,
// but it must never escape the Orion thread whose run emitted the event.
const descendantThreadIds = (threads: Thread[], rootThreadId: string): Set<string> => {
  const ids = new Set<string>([rootThreadId]);
  let foundChild = true;
  while (foundChild) {
    foundChild = false;
    for (const thread of threads) {
      if (thread.parentThreadId && ids.has(thread.parentThreadId) && !ids.has(thread.id)) {
        ids.add(thread.id);
        foundChild = true;
      }
    }
  }
  return ids;
};

// Keep the shell/sidebar subscription independent from transcript payloads.
// A token chunk replaces a Thread object, but none of these metadata fields,
// so useShallow keeps App asleep while ChatTranscript handles the update.
const threadShellSignatureCache = new WeakMap<Thread, string>();
const threadShellSignature = (thread: Thread): string => {
  const cached = threadShellSignatureCache.get(thread);
  if (cached !== undefined) return cached;

  const lastMessage = thread.messages.at(-1);
  const queuedIds = thread.queuedMessages?.map((message) => message.id).join(',') ?? '';
  const signature = [
    thread.id,
    thread.projectId,
    thread.title,
    thread.status,
    thread.modelId,
    thread.accessMode,
    thread.codexReasoningEffort,
    thread.codexServiceTier,
    thread.claudeReasoningEffort,
    thread.claudeContextWindow,
    thread.grokReasoningEffort,
    thread.createdAt,
    thread.hiddenFromRecent ? '1' : '0',
    thread.pinnedAt,
    thread.unpinnedAt,
    // Drives the sidebar's finished-but-unopened dot, and clearing it on open
    // changes nothing else — so the shell has to wake for it.
    thread.finishedUnseenAt,
    thread.parentThreadId,
    thread.branchedFromThreadId,
    thread.epicId,
    thread.spawnId,
    thread.terminalActivityAt,
    thread.messages.length,
    lastMessage?.id,
    lastMessage?.ts,
    lastMessage?.status,
    lastMessage?.completedAt,
    queuedIds,
    JSON.stringify(thread.agentSessionIds ?? null),
    JSON.stringify(thread.pendingForkProviders ?? null),
    JSON.stringify(thread.subagent ?? null),
    JSON.stringify(thread.goal ?? null),
    JSON.stringify(thread.linkedTasks ?? null),
  ].join('\u0000');
  threadShellSignatureCache.set(thread, signature);
  return signature;
};

// The epic-view description draft stays local while typing: every store write
// rebuilds `epics`, re-renders the whole shell, and re-serializes the persisted
// state, so committing per keystroke would tax typing latency for no benefit.
// Commits happen on blur, on a short idle debounce, and on unmount (which
// covers switching epics — the caller keys this component by epic id).
const EpicDescriptionEditor: React.FC<{
  epicId: string;
  initialValue: string;
  onCommit: (epicId: string, description: string) => void;
}> = ({ epicId, initialValue, onCommit }) => {
  const [draft, setDraft] = useState(initialValue);
  const latestRef = useRef({ epicId, draft, initialValue, onCommit });
  const commitTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const latest = latestRef.current;
    if (latest.draft !== latest.initialValue) latest.onCommit(latest.epicId, latest.draft);
  }, []);

  // Sync on every commit rather than during render: a discarded concurrent
  // render must not leave its draft behind for the flush to write.
  useEffect(() => {
    latestRef.current = { epicId, draft, initialValue, onCommit };
  });

  useEffect(() => flush, [flush]);

  return (
    <textarea
      id="epic-description"
      className="epic-view-description"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(flush, 400);
      }}
      onBlur={flush}
      placeholder="Add notes for this epic…"
      rows={4}
    />
  );
};

const runtimeThreadsForEpic = (threads: Thread[], epicId: string) => {
  const threadIds = new Set(threads.filter((thread) => thread.epicId === epicId).map((thread) => thread.id));
  let foundChild = true;
  while (foundChild) {
    foundChild = false;
    for (const thread of threads) {
      if (thread.parentThreadId && threadIds.has(thread.parentThreadId) && !threadIds.has(thread.id)) {
        threadIds.add(thread.id);
        foundChild = true;
      }
    }
  }
  return threads.filter((thread) => threadIds.has(thread.id));
};

const formatCheckedTime = (iso: string): string => {
  try {
    const then = new Date(iso).getTime();
    const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
    if (mins < 1) return 'just now';
    if (mins === 1) return '1m ago';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return 'recently';
  }
};

const renderThreadCliBadge = (thread: Thread) =>
  isClaudeCodeCliModelId(thread.modelId) ? (
    <span className="thread-cli-badge" title="Claude Code CLI" aria-label="Claude Code CLI">
      <Terminal size={10} strokeWidth={2.4} aria-hidden />
    </span>
  ) : null;

const renderThreadStatusDot = (thread: Thread) => {
  if (thread.status === 'running') {
    return <span className="thread-working-dot" title="Working" />;
  }
  if (!thread.finishedUnseenAt) return null;
  const failed = thread.status === 'error';
  return (
    <span
      className={`thread-finished-dot ${failed ? 'error' : ''}`}
      title={failed ? 'Failed — not opened yet' : 'Finished — not opened yet'}
    />
  );
};

const App: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    settingsOpen,
    setSettingsOpen,
    projects,
    selectedProjectId,
    selectedThreadId,
    paneThreadIds,
    openThreadInSplit,
    closeThreadPane,
    savedViews,
    activeSavedViewId,
    openSavedView,
    deleteSavedView,
    splitViewSettings,
    setSplitViewSettings,
    epics,
    selectedEpicId,
    epicsSettings,
    riftsSettings,
    setRiftsSettings,
    addProject,
    removeProject,
    renameProject,
    addEpic,
    renameEpic,
    updateEpic,
    deleteEpic,
    settleEpic,
    unsettleEpic,
    releaseEpicRift,
    selectEpic,
    setEpicsSettings,
    createThread,
    branchThread,
    selectProject,
    selectThread,
    updateThread,
    deleteThread,
    addMessageToThread,
    appendToThreadMessage,
    updateThreadMessage,
    addActivityToThreadMessage,
    workspacePath,
    setWorkspacePath,
    activeFilePath,
    closeAllFiles,
    providerSettings,
    setProviderEnabled,
    setProviderOptions,
    orchestrationSettings,
    setOrchestrationRoleModel,
    setOrchestrationGeneralInstructions,
    notificationSettings,
    setNotificationSettings,
    textGenerationSettings,
    setTextGenerationSettings,
    setThreadAgentSession,
    queueMessageToThread,
    removeQueuedThreadMessage,
    addBtwExchange,
    appendToBtwExchange,
    updateBtwExchange,
    removeBtwExchange,
  } = useOrionStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      settingsOpen: state.settingsOpen,
      setSettingsOpen: state.setSettingsOpen,
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      selectedThreadId: state.selectedThreadId,
      paneThreadIds: state.paneThreadIds,
      openThreadInSplit: state.openThreadInSplit,
      closeThreadPane: state.closeThreadPane,
      savedViews: state.savedViews,
      activeSavedViewId: state.activeSavedViewId,
      openSavedView: state.openSavedView,
      deleteSavedView: state.deleteSavedView,
      splitViewSettings: state.splitViewSettings,
      setSplitViewSettings: state.setSplitViewSettings,
      epics: state.epics,
      selectedEpicId: state.selectedEpicId,
      epicsSettings: state.epicsSettings,
      riftsSettings: state.riftsSettings,
      setRiftsSettings: state.setRiftsSettings,
      addProject: state.addProject,
      removeProject: state.removeProject,
      renameProject: state.renameProject,
      addEpic: state.addEpic,
      renameEpic: state.renameEpic,
      updateEpic: state.updateEpic,
      deleteEpic: state.deleteEpic,
      settleEpic: state.settleEpic,
      unsettleEpic: state.unsettleEpic,
      releaseEpicRift: state.releaseEpicRift,
      selectEpic: state.selectEpic,
      setEpicsSettings: state.setEpicsSettings,
      createThread: state.createThread,
      branchThread: state.branchThread,
      selectProject: state.selectProject,
      selectThread: state.selectThread,
      updateThread: state.updateThread,
      deleteThread: state.deleteThread,
      addMessageToThread: state.addMessageToThread,
      appendToThreadMessage: state.appendToThreadMessage,
      updateThreadMessage: state.updateThreadMessage,
      addActivityToThreadMessage: state.addActivityToThreadMessage,
      workspacePath: state.workspacePath,
      setWorkspacePath: state.setWorkspacePath,
      activeFilePath: state.activeFilePath,
      closeAllFiles: state.closeAllFiles,
      providerSettings: state.providerSettings,
      setProviderEnabled: state.setProviderEnabled,
      setProviderOptions: state.setProviderOptions,
      orchestrationSettings: state.orchestrationSettings,
      setOrchestrationRoleModel: state.setOrchestrationRoleModel,
      setOrchestrationGeneralInstructions: state.setOrchestrationGeneralInstructions,
      notificationSettings: state.notificationSettings,
      setNotificationSettings: state.setNotificationSettings,
      textGenerationSettings: state.textGenerationSettings,
      setTextGenerationSettings: state.setTextGenerationSettings,
      setThreadAgentSession: state.setThreadAgentSession,
      queueMessageToThread: state.queueMessageToThread,
      removeQueuedThreadMessage: state.removeQueuedThreadMessage,
      addBtwExchange: state.addBtwExchange,
      appendToBtwExchange: state.appendToBtwExchange,
      updateBtwExchange: state.updateBtwExchange,
      removeBtwExchange: state.removeBtwExchange,
    }))
  );
  const threadShellSignatures = useOrionStore(useShallow((state) => state.threads.map(threadShellSignature)));
  const threads = useMemo(() => useOrionStore.getState().threads, [threadShellSignatures]);
  // Bumped when a turn completes without the thread leaving 'running' (a
  // Claude turn still waiting on background agents) — invisible to the
  // runningAgentCount-based refresh below, but its files are on disk.
  const [treeTurnRefreshTick, setTreeTurnRefreshTick] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatAttachments, setChatAttachments] = useState<ImageAttachment[]>([]);
  const [draggingImages, setDraggingImages] = useState(false);
  // One agent run may be active per thread; runs in other threads are
  // independent, so starting/stopping one never blocks the rest.
  const [activeRunsByThread, setActiveRunsByThread] = useState<Record<string, string>>({});
  const activeRunsByThreadRef = useRef(activeRunsByThread);
  useEffect(() => {
    activeRunsByThreadRef.current = activeRunsByThread;
  }, [activeRunsByThread]);
  const activeRunId = selectedThreadId ? (activeRunsByThread[selectedThreadId] ?? null) : null;
  const isSending = Boolean(activeRunId);
  const clearActiveRun = useCallback((runId: string) => {
    setActiveRunsByThread((current) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [threadId, id] of Object.entries(current)) {
        if (id === runId) changed = true;
        else next[threadId] = id;
      }
      return changed ? next : current;
    });
  }, []);
  const [agentModels, setAgentModels] = useState<AgentModel[]>(fallbackAgentModels);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  // Settings → General → Text generation drives its own copy of the picker
  // state so opening it never disturbs the composer's picker.
  const [utilityModelPickerOpen, setUtilityModelPickerOpen] = useState(false);
  const [utilityModelSearch, setUtilityModelSearch] = useState('');
  const [utilityModelTab, setUtilityModelTab] = useState<AgentProviderId>('codex');
  // Active @-mention token in the composer: index of the '@' and the query
  // typed after it (null when the caret isn't inside a mention token).
  const [chatMention, setChatMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [chatMentionIndex, setChatMentionIndex] = useState(0);
  // Start offset of a token dismissed with Escape, so it stays closed until
  // the user begins a new mention.
  const chatMentionDismissRef = useRef<number | null>(null);
  const [activeProviderTab, setActiveProviderTab] = useState<AgentProviderId>('grok');
  const [codexSettingsOpen, setCodexSettingsOpen] = useState(false);
  const [accessModeOpen, setAccessModeOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);

  useEffect(() => {
    if (isSending) setAccessModeOpen(false);
  }, [isSending]);

  useEffect(() => {
    if (!branchPickerOpen) setCreatingBranch(false);
  }, [branchPickerOpen]);
  const [openWithApps, setOpenWithApps] = useState<Array<{ id: string; name: string; icon: string | null }>>([]);
  const [openWithOpen, setOpenWithOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [gitState, setGitState] = useState<GitRepoState | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [cloudState, setCloudState] = useState<OrionCloudState | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);
  // Keys are namespaced ("shell:<id>", "recent:<id>", "project:<id>") because the
  // same thread can appear in both the Recent agents list and its project list.
  const [threadItemMenuKey, setThreadItemMenuKey] = useState<string | null>(null);
  const [threadRenameKey, setThreadRenameKey] = useState<string | null>(null);
  const [projectRenameId, setProjectRenameId] = useState<string | null>(null);
  const [threadListLimits, setThreadListLimits] = useState<Record<string, number>>({});
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  // Nested subthread lists (keyed by parent thread id), shared between the
  // Recent agents list and the project lists.
  const [recentAgentsOpen, setRecentAgentsOpen] = useState(true);
  const [recentAgentsShowAll, setRecentAgentsShowAll] = useState(false);
  const [pinnedAgentsOpen, setPinnedAgentsOpen] = useState(true);
  const [pinnedAgentsShowAll, setPinnedAgentsShowAll] = useState(false);
  const [epicsSectionOpen, setEpicsSectionOpen] = useState(true);
  const [savedViewsSectionOpen, setSavedViewsSectionOpen] = useState(true);
  const [collapsedEpics, setCollapsedEpics] = useState<Record<string, boolean>>({});
  // Create-item modal (title + optional description).
  const [createEpicOpen, setCreateEpicOpen] = useState(false);
  const [newEpicName, setNewEpicName] = useState('');
  const [newEpicDescription, setNewEpicDescription] = useState('');
  // Project the new epic binds to; preset on open to the project the user
  // last sent a message in.
  const [newEpicProjectId, setNewEpicProjectId] = useState<string | null>(null);
  // Tailwind dropdown open state for the create-epic project / base-branch pickers.
  const [createEpicProjectPickerOpen, setCreateEpicProjectPickerOpen] = useState(false);
  const [createEpicRiftBranchPickerOpen, setCreateEpicRiftBranchPickerOpen] = useState(false);
  // Per-epic opt-out for the modal's "Create a rift" checkbox; the default
  // comes from the experimental Rifts settings when the modal opens.
  const [newEpicCreateRift, setNewEpicCreateRift] = useState(false);
  // Local branch the rift's feature branch starts from; null = the source
  // checkout's current branch (which needs no checkout anywhere).
  const [newEpicRiftBaseBranch, setNewEpicRiftBaseBranch] = useState<string | null>(null);
  // Local branches of the modal's selected project, for the base picker.
  // Tagged with the project id so a stale list can't feed another project.
  const [newEpicRiftBranches, setNewEpicRiftBranches] = useState<NewEpicRiftBranches | null>(null);
  // Rift binary availability, fetched once (null while unknown).
  const [riftStatus, setRiftStatus] = useState<{
    available: boolean;
    version?: string | null;
    pendingEpicIds?: string[];
    pendingRemovalEpicIds?: string[];
    readyRifts?: Array<{
      epicId: string;
      projectId?: string;
      projectPath: string;
      riftPath: string;
      riftWorkingDir: string;
      gitRoot?: string;
      branch?: string;
    }>;
  } | null>(null);
  // Epics whose rift workspace is still being created (branch naming runs a
  // hidden model turn, so this can take a few seconds). Mirrored in a ref so
  // the turn dispatcher — which reads state at call time — can refuse to start
  // an epic's threads in the source repository before its rift exists.
  const [riftSetupEpicIds, setRiftSetupEpicIds] = useState<Record<string, boolean>>({});
  const riftSetupEpicIdsRef = useRef<Record<string, boolean>>({});
  const locallyStartedRiftEpicIdsRef = useRef<Set<string>>(new Set());
  const [riftRecoveryRefreshNonce, setRiftRecoveryRefreshNonce] = useState(0);
  // Prevent repeated delete clicks from racing two runtime teardown / rift
  // removal sequences for the same epic. The state mirror also unmounts any
  // selected Claude terminal while teardown is in flight.
  const [riftRemovalEpicIds, setRiftRemovalEpicIds] = useState<Record<string, boolean>>({});
  const riftRemovalEpicIdsRef = useRef<Set<string>>(new Set());
  const [riftRemovalThreadIds, setRiftRemovalThreadIds] = useState<Record<string, boolean>>({});
  const riftRemovalThreadIdsRef = useRef<Set<string>>(new Set());
  const markRiftRemoval = useCallback((epicId: string, pending: boolean) => {
    if (pending) riftRemovalEpicIdsRef.current.add(epicId);
    else riftRemovalEpicIdsRef.current.delete(epicId);
    setRiftRemovalEpicIds((current) => {
      const next = { ...current };
      if (pending) next[epicId] = true;
      else delete next[epicId];
      return next;
    });
  }, []);
  const markRiftRemovalThreads = useCallback((threadIds: Iterable<string>, pending: boolean) => {
    const ids = [...threadIds];
    for (const threadId of ids) {
      if (pending) riftRemovalThreadIdsRef.current.add(threadId);
      else riftRemovalThreadIdsRef.current.delete(threadId);
    }
    setRiftRemovalThreadIds((current) => {
      const next = { ...current };
      for (const threadId of ids) {
        if (pending) next[threadId] = true;
        else delete next[threadId];
      }
      return next;
    });
  }, []);
  const markRiftSetup = useCallback((epicId: string, pending: boolean) => {
    if (pending) locallyStartedRiftEpicIdsRef.current.add(epicId);
    else locallyStartedRiftEpicIdsRef.current.delete(epicId);
    const next = { ...riftSetupEpicIdsRef.current };
    if (pending) next[epicId] = true;
    else delete next[epicId];
    riftSetupEpicIdsRef.current = next;
    setRiftSetupEpicIds(next);
  }, []);
  const createEpicTitleRef = useRef<HTMLInputElement>(null);
  const createEpicProjectPickerRef = useRef<HTMLDivElement>(null);
  const createEpicRiftBranchPickerRef = useRef<HTMLDivElement>(null);
  const [epicMenuOpenId, setEpicMenuOpenId] = useState<string | null>(null);
  const [epicRenameId, setEpicRenameId] = useState<string | null>(null);
  const [epicRepoPickerOpen, setEpicRepoPickerOpen] = useState(false);
  // One epic git action (commit/PR/status) at a time *per epic*, keyed by epic
  // id: the epic view's buttons disable while that epic's action runs, and
  // every other epic stays free to start its own. The ref mirrors the state so
  // a click-time guard sees a just-started action before React re-renders.
  const [epicGitBusy, setEpicGitBusy] = useState<Record<string, EpicGitBusyEntry>>({});
  const epicGitBusyRef = useRef<Record<string, EpicGitBusyEntry>>({});
  const markEpicGitBusy = useCallback((epicId: string, kind: EpicGitBusyKind | null, workspaceKey?: string) => {
    const next = { ...epicGitBusyRef.current };
    if (kind) next[epicId] = { kind, workspaceKey };
    else delete next[epicId];
    epicGitBusyRef.current = next;
    setEpicGitBusy(next);
  }, []);
  const anyEpicGitBusy = Object.keys(epicGitBusy).length > 0;
  // Message dialog shown before an epic's commit & push. An empty message
  // hands the write back to the epic message model.
  const [epicCommitDialog, setEpicCommitDialog] = useState<EpicCommitDialogState | null>(null);
  // Base-branch and message picker shown before opening an epic's pull
  // request. Holds the origin branches fetched for the picker, the user's
  // current selection, and their optional hand-written title/description.
  // The dialog opens before origin has answered, so the branch list starts
  // empty and loading while the base branch comes from local git.
  const [epicPrBaseDialog, setEpicPrBaseDialog] = useState<EpicPrBaseDialogState | null>(null);
  const epicPrBaseDialogInstanceRef = useRef(0);
  const [epicSettleDialog, setEpicSettleDialog] = useState<EpicSettleDialogState | null>(null);
  const [riftStorageState, setRiftStorageState] = useState<RiftStorageState | null>(null);
  const [riftStorageBusy, setRiftStorageBusy] = useState(false);
  const riftStorageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const riftStorageQueueDepthRef = useRef(0);
  // Rifts the user chose to free despite uncommitted or unpushed work.
  const [riftStorageForced, setRiftStorageForced] = useState<Record<string, boolean>>({});
  const [riftSweepDialog, setRiftSweepDialog] = useState<RiftSweepDialogState | null>(null);
  const dismissRiftSweepDialog = useCallback(() => {
    setRiftSweepDialog(null);
    // "Free anyway" is approval for one confirmation flow, not a durable
    // property of the path. Dismissing that flow revokes it.
    setRiftStorageForced({});
  }, []);

  const riftStorageEntries = riftStorageState?.entries ?? [];
  const riftStorageSummary = useMemo(() => {
    const entries = riftStorageState?.entries ?? [];
    const sumBytes = (matches: (entry: RiftStorageEntry) => boolean) =>
      entries.reduce((total, entry) => (matches(entry) ? total + (entry.bytes ?? 0) : total), 0);
    return {
      total: sumBytes(() => true) + (riftStorageState?.trashBytes ?? 0),
      active: sumBytes((entry) => entry.status === 'active'),
      settled: sumBytes((entry) => entry.status === 'settled'),
      orphan: sumBytes((entry) => entry.status === 'orphan' || entry.status === 'cleanupPending'),
      trash: riftStorageState?.trashBytes ?? 0,
    };
  }, [riftStorageState]);

  // Anything not backing a live epic. Rifts holding uncommitted or unpushed
  // work stay in the list but are excluded until the user forces them, since
  // settling only warns about that work and never publishes it.
  const riftSweepCandidates = useMemo(() => {
    const entries = riftStorageState?.entries ?? [];
    return entries.filter((entry) => entry.status !== 'active' && entry.hasMarker);
  }, [riftStorageState]);

  const riftSweepSelection = useMemo(
    () =>
      riftSweepCandidates.filter(
        (entry) => riftStorageForced[entry.riftPath] || (!entry.hasUncommittedChanges && !entry.hasUnpushedCommits)
      ),
    [riftSweepCandidates, riftStorageForced]
  );
  const [epicPrBaseBranchPickerOpen, setEpicPrBaseBranchPickerOpen] = useState(false);
  const epicPrBaseBranchPickerRef = useRef<HTMLDivElement>(null);
  // Escape dismisses any epic-action dialog, matching the create-epic modal.
  // An open base-branch dropdown closes first before the dialog itself.
  useEffect(() => {
    if (!epicCommitDialog && !epicPrBaseDialog && !epicSettleDialog && !riftSweepDialog) {
      return undefined;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (epicPrBaseBranchPickerOpen) {
        setEpicPrBaseBranchPickerOpen(false);
        return;
      }
      setEpicCommitDialog(null);
      setEpicPrBaseDialog(null);
      setEpicSettleDialog(null);
      dismissRiftSweepDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    epicCommitDialog,
    epicPrBaseDialog,
    epicPrBaseBranchPickerOpen,
    epicSettleDialog,
    dismissRiftSweepDialog,
    riftSweepDialog,
  ]);

  // Click-outside for the Create PR base-branch Tailwind dropdown.
  useEffect(() => {
    if (!epicPrBaseBranchPickerOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!epicPrBaseBranchPickerRef.current?.contains(target)) {
        setEpicPrBaseBranchPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [epicPrBaseBranchPickerOpen]);

  // Reset the branch picker whenever the Create PR dialog is dismissed.
  useEffect(() => {
    if (!epicPrBaseDialog) setEpicPrBaseBranchPickerOpen(false);
  }, [epicPrBaseDialog]);
  // Live workspace status behind the epic git buttons: "Commit & push" greys
  // out when the workspace is clean and fully pushed. PR lifecycle is kept in
  // the persisted epic instead so URL-only refreshes and workspace reads do
  // not create competing caches.
  const [epicGitStatuses, setEpicGitStatuses] = useState<
    Record<
      string,
      {
        hasChangesToCommit: boolean;
        hasUnpushedCommits: boolean;
      }
    >
  >({});
  // Shell-wide guard: the workspace project/branch pickers and cloud actions
  // stand down while any repository work is in flight, epic git included.
  const repositoryOperationBusy = gitBusy || cloudBusy || anyEpicGitBusy;
  useEffect(() => {
    if (!repositoryOperationBusy) return;
    setProjectPickerOpen(false);
    setBranchPickerOpen(false);
    setEpicRepoPickerOpen(false);
  }, [repositoryOperationBusy]);
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState | null>(null);
  const [providerUpdatesRunning, setProviderUpdatesRunning] = useState(false);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [authenticatingProviderId, setAuthenticatingProviderId] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<OrionAccountState>({
    authenticated: false,
    user: null,
    expiresAt: null,
  });
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountBusy, setAccountBusy] = useState(false);
  const [computerUsePerms, setComputerUsePerms] = useState<OrionComputerUsePermissions | null>(null);
  const [computerUseBusyKind, setComputerUseBusyKind] = useState<OrionComputerUsePermissionKind | null>(null);
  const [revealedProviderEmails, setRevealedProviderEmails] = useState<Record<string, boolean>>({});
  const [revealedAccountIdentity, setRevealedAccountIdentity] = useState<string | null>(null);
  const [expandedProviderOptions, setExpandedProviderOptions] = useState<Record<string, boolean>>({});
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const openWithRef = useRef<HTMLDivElement>(null);
  const threadSearchRef = useRef<HTMLDivElement>(null);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  const goalMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const threadItemMenuRef = useRef<HTMLDivElement>(null);
  const epicMenuRef = useRef<HTMLDivElement>(null);
  const epicRepoPickerRef = useRef<HTMLDivElement>(null);
  const runOutputMessages = useRef(new Map<string, { threadId: string; messageId: string }>());
  // Startup IPC resolves long before a normal turn ends. Retain its result for
  // a short grace window so a steer whose stop lands just after startup failed
  // can distinguish that failure from a run that completed naturally.
  const runStartupResults = useRef(new Map<string, Promise<{ ok: boolean; runId?: string; error?: string }>>());
  const trackRunStartup = useCallback(
    (runId: string, startup: Promise<{ ok: boolean; runId?: string; error?: string }>) => {
      runStartupResults.current.set(runId, startup);
      const forgetLater = () => {
        window.setTimeout(() => {
          if (runStartupResults.current.get(runId) === startup) {
            runStartupResults.current.delete(runId);
          }
        }, 10_000);
      };
      void startup.then(forgetLater, forgetLater);
      return startup;
    },
    []
  );
  // `/btw` side-question runs, routed to a thread's btwExchanges instead of
  // its transcript. Kept separate from runOutputMessages so aside runs never
  // touch thread status, queued-message dispatch, or the active-run map.
  const btwRuns = useRef(new Map<string, { threadId: string; exchangeId: string }>());
  // Provider-native subagents streamed by main (subagent/subagent-chunk/
  // subagent-activity events): `${parentThreadId}:${providerId}:${subagentId}`
  // → the child thread + agent-run message their transcript streams into.
  const nativeSubagentTargets = useRef(new Map<string, { threadId: string; messageId: string }>());
  const agentModelsRef = useRef<AgentModel[]>(fallbackAgentModels);
  const startTurnForThreadRef = useRef<
    | ((
        threadId: string,
        promptText: string,
        attachments: ImageAttachment[]
      ) => Promise<{ ok: boolean; error?: string }>)
    | null
  >(null);
  // In-flight snapshot refreshes, keyed by `${threadId} ${taskId}`.
  const linkedTaskRefreshesRef = useRef(new Map<string, Promise<void>>());
  // Shared unlink requests prevent the picker and composer chip from issuing
  // competing mutations for the same thread/task pair.
  const linkedTaskUnlinksRef = useRef(new Map<string, Promise<boolean>>());
  const pendingTurnStartsRef = useRef(new Set<string>());
  const recoveredInterruptedRuns = useRef(false);
  const dragDepth = useRef(0);
  // Each pane scrolls its own transcript, so the DOM refs and the pinned/offset
  // bookkeeping are per thread rather than per shell. Entries are plain objects
  // created on demand — no hooks — so a pane opening mid-render is fine.
  const paneChatRefsRef = useRef(new Map<string, PaneChatRefs>());
  const paneChatRefs = useCallback((threadId: string): PaneChatRefs => {
    const existing = paneChatRefsRef.current.get(threadId);
    if (existing) return existing;
    const created: PaneChatRefs = {
      chatScrollRef: { current: null },
      chatEndRef: { current: null },
      chatPinnedRef: { current: true },
      chatScrollTopRef: { current: 0 },
    };
    paneChatRefsRef.current.set(threadId, created);
    return created;
  }, []);
  // Sending or receiving in a thread sticks its transcript to the bottom. Any
  // pane showing that thread follows along, not just the focused one.
  const pinThreadToBottom = useCallback(
    (threadId: string) => {
      paneChatRefs(threadId).chatPinnedRef.current = true;
    },
    [paneChatRefs]
  );
  // Per-thread transcript positions, owned here so they survive ChatTranscript
  // unmounting (Code tab) and are shared by every thread the switcher can reach.
  const chatScrollPositionsRef = useRef(new Map<string, ChatScrollPosition>());
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const utilityModelPickerRef = useRef<HTMLDivElement>(null);
  const taskPickerRef = useRef<HTMLDivElement>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const codexSettingsRef = useRef<HTMLDivElement>(null);
  const accessModeRef = useRef<HTMLDivElement>(null);
  // Composer controls collapse into one overflow menu when the row runs out of
  // room (narrow split panes); see composerControlsCompact below.
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const composerMenuPopoverRef = useRef<HTMLDivElement>(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerMenuSection, setComposerMenuSection] = useState<ComposerMenuSection>(null);
  const [composerControlsWidth, setComposerControlsWidth] = useState<number | null>(null);
  const composerControlsObserverRef = useRef<ResizeObserver | null>(null);
  // A callback ref, not useEffect: the composer unmounts and remounts as panes
  // take focus, and the row has to be re-measured each time.
  const composerControlsRef = useCallback((node: HTMLDivElement | null) => {
    composerControlsObserverRef.current?.disconnect();
    composerControlsObserverRef.current = null;
    if (!node) {
      // Unmeasured means "assume there is room", so the full-width composer
      // never flashes the compact menu on mount.
      setComposerControlsWidth(null);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (typeof width === 'number') setComposerControlsWidth(width);
    });
    observer.observe(node);
    composerControlsObserverRef.current = observer;
  }, []);

  useEffect(() => () => composerControlsObserverRef.current?.disconnect(), []);

  // Autosize the composer to its content. The height lives as an inline style
  // on the textarea, so it is lost with the DOM node on every unmount.
  const resizeChatInput = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // The composer unmounts whenever the shell swaps views — Settings, the Code
  // tab — and remounts with a fresh node that has no height style, collapsing a
  // long draft back to one line. Measuring from the ref callback re-applies the
  // height during the same commit that mounts the node, so the draft keeps the
  // size its text earns no matter what caused the remount.
  const setChatInputRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      chatInputRef.current = el;
      resizeChatInput(el);
    },
    [resizeChatInput]
  );

  useLayoutEffect(() => {
    resizeChatInput(chatInputRef.current);
  }, [chatInput, resizeChatInput]);

  // Selecting a thread no longer forces the transcript to the bottom — the
  // transcript restores that thread's own position (bottom for never-visited
  // ones). Positions for threads that are gone are dropped so the map tracks
  // the live thread set.
  useEffect(() => {
    const positions = chatScrollPositionsRef.current;
    const paneRefs = paneChatRefsRef.current;
    if (positions.size === 0 && paneRefs.size === 0) return;
    const liveIds = new Set(threads.map((thread) => thread.id));
    for (const threadId of positions.keys()) {
      if (!liveIds.has(threadId)) positions.delete(threadId);
    }
    for (const threadId of paneRefs.keys()) {
      if (!liveIds.has(threadId)) paneRefs.delete(threadId);
    }
  }, [threads]);

  // Everything the main view needs to render one thread. The split view shows
  // up to MAX_THREAD_PANES threads at once, so this has to resolve per thread
  // rather than only for the focused one.
  const threadViewContext = useCallback(
    (thread: Thread | undefined) => {
      const project = thread ? (projects.find((p) => p.id === thread.projectId) ?? null) : null;
      const epic = thread?.epicId ? epics.find((candidate) => candidate.id === thread.epicId) : undefined;
      const riftPending = Boolean(thread?.epicId && riftSetupEpicIds[thread.epicId]);
      const riftRemoving = Boolean(
        thread && (riftRemovalThreadIds[thread.id] || (thread.epicId && riftRemovalEpicIds[thread.epicId]))
      );
      const riftUnavailable =
        riftPending ||
        riftRemoving ||
        Boolean(epic?.riftRequest) ||
        Boolean(epic?.riftCleanupPending) ||
        // Released epic threads remain grouped in Recent agents, but their
        // isolated workspace no longer exists. Never fall through to the source
        // project while the epic is waiting for its Rift to be recreated.
        Boolean(epic?.riftReleased) ||
        Boolean(epic && !epic.riftPath && riftsSettings.enabled && riftStatus === null);
      // Threads grouped under an epic with a rift work inside that rift workspace.
      const projectPath = riftUnavailable
        ? undefined
        : epic?.riftPath
          ? (epic.riftWorkingDir ?? epic.riftPath)
          : project?.path;
      // Candidate dirs for resolving relative media paths in agent markdown: the
      // thread's project dir, plus the grok CLI's per-session dir — Grok Imagine
      // saves generated images there (~/.grok/sessions/<encoded-cwd>/<session-id>/
      // images/N.jpg) and references them relative to it, not to the project.
      const grokSessionId = thread?.agentSessionIds?.grok;
      const mediaBaseDirs = projectPath
        ? grokSessionId
          ? [projectPath, `~/.grok/sessions/${encodeURIComponent(projectPath)}/${grokSessionId}`]
          : [projectPath]
        : [];
      return { project, epic, riftPending, riftRemoving, riftUnavailable, projectPath, mediaBaseDirs };
    },
    [epics, projects, riftRemovalEpicIds, riftRemovalThreadIds, riftSetupEpicIds, riftStatus, riftsSettings.enabled]
  );

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const selectedThreadContext = threadViewContext(selectedThread);
  const selectedThreadProject = selectedThreadContext.project;
  const selectedThreadEpic = selectedThreadContext.epic;
  const selectedThreadRiftPending = selectedThreadContext.riftPending;
  const selectedThreadRiftRemoving = selectedThreadContext.riftRemoving;
  const selectedThreadRiftUnavailable = selectedThreadContext.riftUnavailable;
  const selectedThreadProjectPath = selectedThreadContext.projectPath;
  // threadViewContext returns a fresh array per call; every pane re-derives one
  // on each render, which would defeat ChatTranscript's memo. Hand back the
  // previous array whenever the dirs are unchanged so identity tracks content.
  const mediaBaseDirsCacheRef = useRef(new Map<string, string[]>());
  const stableMediaBaseDirs = useCallback((threadId: string, dirs: string[]) => {
    const cached = mediaBaseDirsCacheRef.current.get(threadId);
    if (cached && cached.length === dirs.length && cached.every((dir, index) => dir === dirs[index])) {
      return cached;
    }
    mediaBaseDirsCacheRef.current.set(threadId, dirs);
    return dirs;
  }, []);
  // Card placement survives switching to Code and back, but each simultaneously
  // mounted transcript owns an independent position, collapse state, and
  // dismissed plan id.
  type TasksCardState = {
    position: { x: number; y: number } | null;
    collapsed: boolean;
    dismissedFor: string | null;
  };
  const [tasksCardStates, setTasksCardStates] = useState<Record<string, TasksCardState>>({});
  const updateTasksCardState = useCallback(
    (threadId: string, update: (current: TasksCardState) => TasksCardState) => {
      setTasksCardStates((states) => {
        const current = states[threadId] ?? {
          position: null,
          collapsed: false,
          dismissedFor: null,
        };
        return { ...states, [threadId]: update(current) };
      });
    },
    []
  );
  const moveTasksCard = useCallback(
    (threadId: string, position: { x: number; y: number }) => {
      updateTasksCardState(threadId, (current) => ({ ...current, position }));
    },
    [updateTasksCardState]
  );
  const toggleTasksCard = useCallback(
    (threadId: string) => {
      updateTasksCardState(threadId, (current) => ({ ...current, collapsed: !current.collapsed }));
    },
    [updateTasksCardState]
  );
  const dismissTasksCard = useCallback(
    (threadId: string, messageId: string) => {
      updateTasksCardState(threadId, (current) => ({ ...current, dismissedFor: messageId }));
    },
    [updateTasksCardState]
  );
  useEffect(() => {
    const liveThreadIds = new Set(threads.map((thread) => thread.id));
    setTasksCardStates((states) => {
      const staleThreadIds = Object.keys(states).filter((threadId) => !liveThreadIds.has(threadId));
      if (staleThreadIds.length === 0) return states;
      const next = { ...states };
      for (const threadId of staleThreadIds) delete next[threadId];
      return next;
    });
  }, [threads]);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? selectedThreadProject ?? null;
  const latestThreadProjectId = useMemo(() => {
    let latestProjectId: string | null = null;
    let latestCreatedAt = -Infinity;
    for (const thread of threads) {
      const createdAt = new Date(thread.createdAt).getTime();
      if (createdAt > latestCreatedAt) {
        latestCreatedAt = createdAt;
        latestProjectId = thread.projectId;
      }
    }
    return latestProjectId;
  }, [threads]);
  // The project the user last sent a message in (a thread's last user message
  // is its latest, so only that one is checked per thread). Presets the
  // create-epic modal's project picker.
  const lastMessagedProjectId = useMemo(() => {
    let latestProjectId: string | null = null;
    let latestTs = -Infinity;
    for (const thread of threads) {
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        if (thread.messages[i].role !== 'user') continue;
        const ts = new Date(thread.messages[i].ts).getTime();
        if (ts > latestTs) {
          latestTs = ts;
          latestProjectId = thread.projectId;
        }
        break;
      }
    }
    return latestProjectId;
  }, [threads]);
  const defaultNewThreadProject =
    selectedProject ?? projects.find((project) => project.id === latestThreadProjectId) ?? projects[0] ?? null;
  // Unsent composer drafts are kept per thread so switching threads swaps the
  // draft instead of carrying it along, and a fresh thread starts with an
  // empty composer.
  const composerDraftKey = selectedThreadId ?? null;
  const composerDraftsRef = useRef(new Map<string, { text: string; attachments: ImageAttachment[] }>());
  const composerDraftKeyRef = useRef<string | null>(composerDraftKey);

  useEffect(() => {
    // Skip the render where the key just changed: chatInput still holds the
    // previous project's draft until the swap effect below runs.
    if (!composerDraftKey || composerDraftKeyRef.current !== composerDraftKey) return;
    composerDraftsRef.current.set(composerDraftKey, {
      text: chatInput,
      attachments: chatAttachments,
    });
  }, [chatInput, chatAttachments, composerDraftKey]);

  useEffect(() => {
    const prevKey = composerDraftKeyRef.current;
    if (prevKey === composerDraftKey) return;
    composerDraftKeyRef.current = composerDraftKey;
    const draft = composerDraftKey ? composerDraftsRef.current.get(composerDraftKey) : undefined;
    setChatInput(draft?.text ?? '');
    setChatAttachments(draft?.attachments ?? []);
    // The restored draft has no caret yet, so no mention token can be active.
    setChatMention(null);
    chatMentionDismissRef.current = null;
  }, [composerDraftKey]);

  // The spawn-request listener mounts once; it reads the live model catalog
  // through this ref instead of a stale closure.
  useEffect(() => {
    agentModelsRef.current = agentModels;
  }, [agentModels]);

  const canChangeSelectedThreadProject =
    !!selectedThread &&
    !selectedThreadEpic?.riftPath &&
    !selectedThreadEpic?.riftRequest &&
    !selectedThreadRiftPending &&
    selectedThread.messages.length === 0 &&
    selectedThread.status === 'idle' &&
    !isSending;

  const shellTitle =
    activeTab === 'agents'
      ? (selectedThread?.title ?? 'New thread')
      : activeFilePath
        ? (activeFilePath.split(/[\\/]/).pop() ?? 'Code')
        : 'Code';
  const shellSubtitle =
    activeTab === 'agents'
      ? undefined
      : workspacePath
        ? (workspacePath.split(/[\\/]/).pop() ?? workspacePath)
        : undefined;
  const selectedAgentModel = findAgentModel(agentModels, selectedThread?.modelId ?? defaultAgentModelId);
  // Claude Code CLI threads host the interactive `claude` TUI in an embedded
  // terminal; the composer feeds the PTY instead of dispatching agent turns.
  const isTerminalThread = selectedAgentModel?.id === claudeCodeCliModelId;
  // Provider-native subagent transcripts are read-only mirrors of a CLI's
  // internal agent — there is no session of their own to talk to. Steering
  // happens from the parent thread.
  const isNativeSubagentThread = Boolean(selectedThread?.subagent);
  const selectedCodexReasoningOptions = codexReasoningOptionsForModel(selectedAgentModel);
  const selectedCodexReasoning = getEffectiveCodexReasoningEffort(
    selectedAgentModel,
    selectedThread?.codexReasoningEffort
  );
  const selectedCodexServiceTier = selectedThread?.codexServiceTier ?? defaultCodexServiceTier;
  const selectedCodexReasoningLabel =
    selectedCodexReasoningOptions.find((option) => option.value === selectedCodexReasoning)?.label ?? 'Medium';
  const selectedCodexServiceTierLabel =
    codexServiceTierOptions.find((option) => option.value === selectedCodexServiceTier)?.label ?? 'Standard';
  const selectedClaudeDefaultReasoning = getDefaultClaudeReasoningEffort(selectedAgentModel);
  const selectedClaudeReasoning = selectedThread?.claudeReasoningEffort ?? selectedClaudeDefaultReasoning;
  const selectedClaudeContextWindow = selectedThread?.claudeContextWindow ?? defaultClaudeContextWindow;
  const effectiveClaudeContextWindow = getEffectiveClaudeContextWindow(selectedAgentModel, selectedClaudeContextWindow);
  const selectedClaudeReasoningLabel =
    claudeReasoningOptions.find((option) => option.value === selectedClaudeReasoning)?.label ?? 'High';
  const selectedClaudeContextWindowLabel =
    claudeContextWindowOptions.find((option) => option.value === effectiveClaudeContextWindow)?.label ?? '200k';
  const selectedGrokReasoning = selectedThread?.grokReasoningEffort ?? defaultGrokReasoningEffort;
  const selectedGrokReasoningLabel =
    grokReasoningOptions.find((option) => option.value === selectedGrokReasoning)?.label ?? 'High';
  const selectedAccessMode = selectedThread?.accessMode ?? 'full-access';
  const selectedAccessModeLabel =
    accessModeOptions.find((option) => option.value === selectedAccessMode)?.label ?? 'Full access';
  const shouldShowAgentSettings =
    !isTerminalThread &&
    (selectedAgentModel?.providerId === 'codex' ||
      selectedAgentModel?.providerId === 'claude' ||
      selectedAgentModel?.providerId === 'grok');
  const normalizedProviderSettings = useMemo(
    () => ({
      ...defaultProviderSettings,
      ...providerSettings,
    }),
    [providerSettings]
  );
  // Persisted stores from before orchestration shipped may lack the field, so
  // merge over the defaults before reading any role model.
  const normalizedOrchestrationSettings = useMemo(
    () => ({
      ...defaultOrchestrationSettings,
      ...orchestrationSettings,
      models: {
        ...defaultOrchestrationSettings.models,
        ...orchestrationSettings?.models,
      },
    }),
    [orchestrationSettings]
  );
  const enabledProviderIds = useMemo(
    () =>
      agentProviders
        .map((provider) => provider.id)
        // 'orion' has no providerSettings entry (it's a pseudo-provider, not a
        // CLI); it is always enabled.
        .filter((id) => id === 'orion' || normalizedProviderSettings[id as ProviderId]?.enabled !== false),
    [normalizedProviderSettings]
  );
  const enabledProviderIdSet = useMemo(() => new Set(enabledProviderIds), [enabledProviderIds]);
  const visibleAgentModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return agentModels.filter((model) => {
      // Claude Code CLI lives as a dedicated overlay button on the Claude tab,
      // not as a row in the model list.
      if (model.id === claudeCodeCliModelId) return false;
      const providerMatches = model.providerId === activeProviderTab;
      const providerEnabled = enabledProviderIdSet.has(model.providerId);
      const queryMatches =
        !query ||
        model.label.toLowerCase().includes(query) ||
        model.providerLabel.toLowerCase().includes(query) ||
        model.slug.toLowerCase().includes(query);
      return providerEnabled && providerMatches && queryMatches;
    });
  }, [activeProviderTab, agentModels, enabledProviderIdSet, modelSearch]);
  const claudeCodeCliModel = useMemo(
    () => agentModels.find((model) => model.id === claudeCodeCliModelId),
    [agentModels]
  );
  // Composer @-mention candidates: models on enabled providers, 'orion'
  // excluded (work can't be delegated to the orchestrator itself). An empty
  // query shows the favorites (or everything), capped at 8 rows.
  const chatMentionCandidates = useMemo(() => {
    if (!chatMention) return [];
    const base = agentModels.filter(
      (model) =>
        model.providerId !== 'orion' &&
        // The Claude Code CLI pseudo-model is an interactive terminal, not a
        // delegable harness.
        model.id !== claudeCodeCliModelId &&
        enabledProviderIdSet.has(model.providerId)
    );
    const query = chatMention.query.toLowerCase();
    if (!query) {
      const favorites = base.filter((model) => model.favorite);
      return (favorites.length > 0 ? favorites : base).slice(0, 8);
    }
    return base
      .filter(
        (model) =>
          model.id.toLowerCase().includes(query) ||
          model.label.toLowerCase().includes(query) ||
          model.slug.toLowerCase().includes(query) ||
          model.providerLabel.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [agentModels, chatMention, enabledProviderIdSet]);
  const chatMentionOpen = Boolean(chatMention) && chatMentionCandidates.length > 0;
  // Reset the highlight to the top whenever the candidate list changes.
  const chatMentionListKey = chatMentionCandidates.map((model) => model.id).join('|');
  useEffect(() => {
    setChatMentionIndex(0);
  }, [chatMentionListKey]);
  // The dropdown's height is clamped to the space around the composer, so
  // keyboard navigation has to keep the highlighted row scrolled into view.
  const chatMentionSelectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    chatMentionSelectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chatMentionIndex, chatMentionListKey]);
  // Role-model options for Settings → Orchestration: every real model grouped
  // by provider. The Orion pseudo-model can't delegate to itself.
  const orchestrationModelGroups = useMemo(
    () =>
      agentProviders
        .filter((provider) => provider.id !== 'orion')
        .map((provider) => ({
          provider,
          models: agentModels.filter((model) => model.providerId === provider.id && model.id !== claudeCodeCliModelId),
        }))
        .filter((group) => group.models.length > 0),
    [agentModels]
  );
  const availableProviderUpdates = useMemo(
    () => providerUpdateState?.providers.filter((provider) => provider.updateAvailable) ?? [],
    [providerUpdateState]
  );
  const providerUpdateSummary =
    availableProviderUpdates.length === 1
      ? `${availableProviderUpdates[0].label} update available`
      : `${availableProviderUpdates.length} CLI updates available`;
  const providerUpdateTooltip = useMemo(
    () =>
      availableProviderUpdates
        .map((provider) => {
          const versionLabel =
            provider.currentVersion && provider.latestVersion
              ? `${provider.currentVersion} -> ${provider.latestVersion}`
              : 'update available';
          return `${provider.label}: ${versionLabel}`;
        })
        .join('\n'),
    [availableProviderUpdates]
  );
  const providerStatusById = useMemo(
    () => new Map((providerUpdateState?.providers ?? []).map((provider) => [provider.id, provider])),
    [providerUpdateState]
  );
  const appUpdateVisible =
    !!appUpdateState &&
    ['available', 'downloading', 'downloaded', 'restarting', 'error'].includes(appUpdateState.status);
  const appUpdatePercent = Math.max(0, Math.min(100, Math.round(appUpdateState?.progress?.percent ?? 0)));
  const appUpdateLabel =
    appUpdateState?.status === 'restarting'
      ? 'Restarting…'
      : appUpdateState?.status === 'downloaded'
        ? 'Restart to update'
        : appUpdateState?.status === 'downloading'
          ? `Downloading ${appUpdatePercent}%`
          : appUpdateState?.status === 'error'
            ? 'Update failed'
            : appUpdateState?.availableVersion
              ? `Update ${appUpdateState.availableVersion}`
              : 'Update available';
  const appUpdateTitle =
    appUpdateState?.status === 'error'
      ? (appUpdateState.error ?? 'Update failed')
      : appUpdateState?.status === 'restarting'
        ? 'Finishing the update, then reopening Orion'
        : appUpdateState?.availableVersion
          ? `Orion ${appUpdateState.availableVersion} is available`
          : appUpdateLabel;
  const accountName = accountState.user?.name || (accountState.authenticated ? 'Orion account' : 'Not signed in');
  const accountEmail = accountState.user?.email ?? null;
  const accountIdentity = accountState.user ? `${accountState.user.id}\n${accountEmail ?? ''}` : null;
  const accountEmailRevealed = accountIdentity !== null && revealedAccountIdentity === accountIdentity;
  const accountInitials = (accountState.user?.name || accountState.user?.email || 'O')
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  // Order projects by their most recently active thread (same activity signal
  // as the Recent agents list) so current work stays at the top. Projects with
  // no threads sort last, keeping their insertion order. Merely selecting a
  // project does not reorder the sidebar.
  const sortedProjects = useMemo(() => {
    const lastActivityByProject = new Map<string, number>();
    for (const thread of threads) {
      const ts = getThreadActivityTime(thread).getTime();
      const prev = lastActivityByProject.get(thread.projectId) ?? -Infinity;
      if (ts > prev) lastActivityByProject.set(thread.projectId, ts);
    }
    return [...projects].sort(
      (a, b) => (lastActivityByProject.get(b.id) ?? -Infinity) - (lastActivityByProject.get(a.id) ?? -Infinity)
    );
  }, [projects, threads]);

  // The Recent agents section spans every project, so its "new thread" button
  // has no project of its own: it targets the project the last thread ran in.
  // sortedProjects is already ordered by most recent thread activity, so that
  // is simply the topmost project in the sidebar.
  const recentAgentsTargetProject = sortedProjects[0] ?? null;

  // Subagent threads live in the in-thread subagents bar, not the sidebar.
  // A thread counts as a child only while its parent still exists — orphans
  // render as top-level.
  const childThreadIds = useMemo(() => {
    const threadIds = new Set(threads.map((t) => t.id));
    const ids = new Set<string>();
    for (const thread of threads) {
      if (thread.parentThreadId && threadIds.has(thread.parentThreadId)) ids.add(thread.id);
    }
    return ids;
  }, [threads]);

  const pinnedThreads = useMemo(
    () =>
      threads
        .filter((t) => t.pinnedAt && !childThreadIds.has(t.id))
        .sort((a, b) => new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime()),
    [childThreadIds, threads]
  );

  const recentThreads = useMemo(
    () =>
      threads
        // Children never appear top-level; they nest under their parent's row.
        // Pinned threads live in the Pinned section instead.
        .filter((t) => !t.hiddenFromRecent && !t.pinnedAt && !childThreadIds.has(t.id))
        .sort((a, b) => {
          // Running agents are active "now", so they always rank above
          // finished ones. Among running agents, keep start order so the list
          // doesn't reshuffle as they stream; finished agents sort by their
          // last activity (i.e. when they finished) — or by when they were
          // unpinned, so a just-unpinned thread surfaces at the top instead
          // of sinking back to its old chronological spot.
          const aRunning = a.status === 'running';
          const bRunning = b.status === 'running';
          if (aRunning !== bRunning) return aRunning ? -1 : 1;
          if (aRunning) {
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          }
          const recentRank = (t: Thread) =>
            Math.max(
              getThreadActivityTime(t).getTime(),
              t.unpinnedAt ? new Date(t.unpinnedAt).getTime() : Number.NEGATIVE_INFINITY
            );
          return recentRank(b) - recentRank(a);
        }),
    [childThreadIds, threads]
  );

  const pinThread = useCallback(
    (threadId: string) => updateThread(threadId, { pinnedAt: new Date().toISOString() }),
    [updateThread]
  );
  // Unpinning surfaces the thread at the top of Recent agents (see the
  // recentThreads sort) so an accidental unpin of an old thread is easy to
  // recover instead of sinking back to its chronological spot.
  const unpinThread = useCallback(
    (threadId: string) =>
      updateThread(threadId, {
        pinnedAt: undefined,
        unpinnedAt: new Date().toISOString(),
        hiddenFromRecent: false,
      }),
    [updateThread]
  );

  const runningAgentCount = useMemo(() => threads.filter((t) => t.status === 'running').length, [threads]);

  const projectThreadsByProject = useMemo(() => {
    const grouped = new Map<string, Thread[]>();
    for (const thread of threads) {
      // Top-level rows only; children render nested under their parent.
      if (childThreadIds.has(thread.id)) continue;
      const projectThreads = grouped.get(thread.projectId);
      if (projectThreads) projectThreads.push(thread);
      else grouped.set(thread.projectId, [thread]);
    }
    for (const projectThreads of grouped.values()) {
      projectThreads.sort((a, b) => getThreadActivityTime(b).getTime() - getThreadActivityTime(a).getTime());
    }
    return grouped;
  }, [childThreadIds, threads]);

  const epicsEnabled = epicsSettings?.enabled ?? defaultEpicsSettings.enabled;
  const epicPromptGitMessages = epicsSettings?.promptGitMessages ?? defaultEpicsSettings.promptGitMessages;

  const activeEpics = useMemo(() => epics.filter((epic) => !epic.settledAt), [epics]);

  const archivedEpics = useMemo(
    () =>
      epics
        .filter((epic) => epic.settledAt)
        .sort((a, b) => new Date(b.settledAt ?? 0).getTime() - new Date(a.settledAt ?? 0).getTime()),
    [epics]
  );

  const threadsByEpic = useMemo(() => {
    const grouped = new Map<string, Thread[]>();
    // No Epics UI renders while the feature is off, so skip the grouping work.
    if (!epicsEnabled) return grouped;
    for (const thread of threads) {
      // Top-level rows only; children render nested under their parent.
      if (!thread.epicId || childThreadIds.has(thread.id)) continue;
      const epicThreads = grouped.get(thread.epicId);
      if (epicThreads) epicThreads.push(thread);
      else grouped.set(thread.epicId, [thread]);
    }
    for (const epicThreads of grouped.values()) {
      epicThreads.sort((a, b) => getThreadActivityTime(b).getTime() - getThreadActivityTime(a).getTime());
    }
    return grouped;
  }, [childThreadIds, epicsEnabled, threads]);

  // Epics that still have a live agent: any thread grouped under the epic —
  // including hidden subagent children — that is running or has a tracked run.
  // Children spawned before epic inheritance carry no epicId, so resolve
  // through the parent chain. Drives disabling commit/PR/settle for the epic.
  const runningAgentEpicIds = useMemo(() => {
    const running = new Set<string>();
    if (!epicsEnabled) return running;
    const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
    const epicIdForThread = (thread: Thread): string | undefined => {
      const seen = new Set<string>();
      let current: Thread | undefined = thread;
      while (current && !seen.has(current.id)) {
        if (current.epicId) return current.epicId;
        seen.add(current.id);
        current = current.parentThreadId ? threadsById.get(current.parentThreadId) : undefined;
      }
      return undefined;
    };
    for (const thread of threads) {
      if (thread.status !== 'running' && !activeRunsByThread[thread.id]) continue;
      const epicId = epicIdForThread(thread);
      if (epicId) running.add(epicId);
    }
    return running;
  }, [activeRunsByThread, epicsEnabled, threads]);

  const projectForGitRoot = useCallback(
    (gitRoot: string | undefined, preferredProjectId?: string) => {
      if (!gitRoot) return null;
      const normalizedRoot = normalizeRepositoryPath(gitRoot);
      const belongsToRoot = (project: Project) => {
        const normalizedProjectPath = normalizeRepositoryPath(project.path);
        return normalizedProjectPath === normalizedRoot || normalizedProjectPath.startsWith(`${normalizedRoot}/`);
      };
      const preferredProject = preferredProjectId
        ? projects.find((project) => project.id === preferredProjectId)
        : null;
      if (preferredProject && belongsToRoot(preferredProject)) return preferredProject;
      return projects.find(belongsToRoot) ?? null;
    },
    [projects]
  );

  // A claimed epic must stay bound to its claimed repository, so the claimed
  // gitRoot outranks the picked repository everywhere (see
  // projectForEpicRepository in the store and the epic git handlers). If that
  // repository was removed from Orion, return null instead of silently
  // redirecting new work into another project.
  const projectForEpic = useCallback(
    (epic: Epic) => {
      if (epic.gitRoot) {
        return projectForGitRoot(epic.gitRoot, epic.repositoryProjectId);
      }

      const selectedRepository = epic.repositoryProjectId
        ? projects.find((project) => project.id === epic.repositoryProjectId)
        : null;
      if (selectedRepository) return selectedRepository;

      const lastThread = threadsByEpic.get(epic.id)?.[0];
      const lastProject = lastThread ? projects.find((p) => p.id === lastThread.projectId) : undefined;
      return lastProject ?? defaultNewThreadProject ?? projects[0] ?? null;
    },
    [defaultNewThreadProject, projectForGitRoot, projects, threadsByEpic]
  );

  const selectedEpic = epicsEnabled ? (epics.find((epic) => epic.id === selectedEpicId) ?? null) : null;

  // The store retargets selectedProjectId to an epic's repository. Do not
  // apply the generic new-thread fallback while an epic is selected: an
  // unbound epic must leave repository controls hidden instead of exposing a
  // stale project. Gate on the resolved epic, not the persisted id, so a
  // leftover id cannot hide the controls once Epics is turned off.
  const activeThreadProject = selectedThreadProject ?? (selectedEpic ? selectedProject : defaultNewThreadProject);

  // The directory the repository controls act on. A thread grouped under an
  // epic with a rift has its agents working inside that rift, so the git
  // state, branch actions, commit/push, cloud sync, Code tab and Open With
  // have to follow it there — reading or committing the source repository
  // instead would show and act on a tree nobody is editing.
  const activeRift = selectedThread ? selectedThreadEpic : selectedEpic;
  const activeRiftPath =
    activeRift?.riftPath && !activeRift.riftCleanupPending ? (activeRift.riftWorkingDir ?? activeRift.riftPath) : null;
  const activeRiftUnavailable = Boolean(
    selectedThreadRiftUnavailable ||
    (activeRift &&
      (riftSetupEpicIds[activeRift.id] ||
        riftRemovalEpicIds[activeRift.id] ||
        activeRift.riftRequest ||
        activeRift.riftCleanupPending ||
        activeRift.riftReleased ||
        (!activeRift.riftPath && riftsSettings.enabled && riftStatus === null)))
  );
  const activeWorkingDir = activeRiftUnavailable ? null : (activeRiftPath ?? activeThreadProject?.path ?? null);
  const previousActiveWorkingDirRef = useRef(activeWorkingDir);
  useLayoutEffect(() => {
    const workingDirChanged = previousActiveWorkingDirRef.current !== activeWorkingDir;
    previousActiveWorkingDirRef.current = activeWorkingDir;
    // Keep the editor mounted only while it still belongs to the active
    // thread/epic. Leaving Code preserves any open-file state; reopening it
    // goes through handleSetActiveTab, which switches the workspace root.
    if (activeTab === 'code' && (activeRiftUnavailable || workingDirChanged)) {
      setActiveTab('agents');
    }
  }, [activeRiftUnavailable, activeWorkingDir, activeTab, setActiveTab]);

  const selectedEpicThreads = selectedEpic ? (threadsByEpic.get(selectedEpic.id) ?? []) : [];
  const selectedEpicHasRunningAgents = selectedEpic ? runningAgentEpicIds.has(selectedEpic.id) : false;
  const selectedEpicRepositoryProject = selectedEpic?.repositoryProjectId
    ? (projects.find((project) => project.id === selectedEpic.repositoryProjectId) ?? null)
    : null;
  const selectedEpicClaimedProject = selectedEpic
    ? projectForGitRoot(selectedEpic.gitRoot, selectedEpic.repositoryProjectId)
    : null;
  const selectedEpicGitStatus = selectedEpic ? epicGitStatuses[selectedEpic.id] : undefined;
  // Fail open: until the first status arrives, the commit button stays enabled.
  const selectedEpicHasWorkToPush =
    !selectedEpicGitStatus || selectedEpicGitStatus.hasChangesToCommit || selectedEpicGitStatus.hasUnpushedCommits;
  const selectedEpicPrStatus = epicPrStatus(selectedEpic);
  const selectedEpicPrBadge = !selectedEpicPrStatus
    ? null
    : {
        modifier: selectedEpicPrStatus,
        label:
          selectedEpicPrStatus === 'merged'
            ? 'PR merged'
            : selectedEpicPrStatus === 'closed'
              ? 'PR closed'
              : // Distinguish a confirmed-open PR from one we've only just
                // created and not yet read back.
                selectedEpic?.prState
                ? 'PR open'
                : 'PR created',
      };

  // Models eligible for the hidden text-generation turns. Orion can't delegate
  // to itself, the Claude Code CLI pseudo-model is an interactive terminal, and
  // OpenCode's non-interactive command has no mode Orion can pin to read-only —
  // hidden turns there fail closed in main, so it is never offered.
  const utilityCandidateModels = useMemo(
    () =>
      agentModels.filter(
        (model) => !isOrionModelId(model.id) && model.id !== claudeCodeCliModelId && model.providerId !== 'opencode'
      ),
    [agentModels]
  );
  const utilityProviders = useMemo(
    () =>
      agentProviders.filter(
        (provider) =>
          provider.id !== 'orion' &&
          enabledProviderIdSet.has(provider.id) &&
          utilityCandidateModels.some((model) => model.providerId === provider.id)
      ),
    [enabledProviderIdSet, utilityCandidateModels]
  );
  // The model behind thread titles and epic commit/PR messages: the Settings
  // pick when it's installed and its provider is enabled, else the fastest
  // model on the first available provider in UTILITY_MODEL_PREFERENCE.
  const resolvedUtilityModelId = useMemo(() => {
    const isUsable = (id: string | null | undefined): id is string => {
      if (!id) return false;
      const model = utilityCandidateModels.find((candidate) => candidate.id === id);
      return !!model && model.available !== false && enabledProviderIdSet.has(model.providerId);
    };
    const preferred = textGenerationSettings?.modelId ?? null;
    if (isUsable(preferred)) return preferred;
    for (const id of UTILITY_MODEL_PREFERENCE) {
      if (isUsable(id)) return id;
    }
    return (
      utilityCandidateModels.find((model) => model.available !== false && enabledProviderIdSet.has(model.providerId))
        ?.id ?? null
    );
  }, [enabledProviderIdSet, textGenerationSettings?.modelId, utilityCandidateModels]);
  const resolvedUtilityModel = useMemo(
    () => utilityCandidateModels.find((model) => model.id === resolvedUtilityModelId) ?? null,
    [resolvedUtilityModelId, utilityCandidateModels]
  );
  const utilityModelProviderId = resolvedUtilityModel?.providerId ?? null;
  // Reasoning tiers the picked model actually accepts, cheapest first. Cursor
  // and Kimi take none, so they get no picker at all.
  const utilityReasoningOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const toOptions = (options: Array<{ value: string; label: string }>) =>
      options.map(({ value, label }) => ({ value, label }));
    if (!resolvedUtilityModel) return [];
    if (resolvedUtilityModel.providerId === 'codex')
      return toOptions(codexReasoningOptionsForModel(resolvedUtilityModel));
    if (resolvedUtilityModel.providerId === 'claude') return toOptions(claudeReasoningOptions);
    if (resolvedUtilityModel.providerId === 'grok') return toOptions(grokReasoningOptions);
    return [];
  }, [resolvedUtilityModel]);
  // A hidden turn writes a title or a commit message, so an unset effort — and
  // one the current model doesn't offer, e.g. Claude's Ultrathink after a
  // switch to Codex — falls back to the cheapest tier rather than a provider
  // default that would spend real reasoning on one sentence.
  const resolvedUtilityReasoningEffort = useMemo(() => {
    if (utilityReasoningOptions.length === 0) return null;
    const stored = textGenerationSettings?.reasoningEffort ?? null;
    if (stored && utilityReasoningOptions.some((option) => option.value === stored)) return stored;
    return utilityReasoningOptions[0].value;
  }, [textGenerationSettings?.reasoningEffort, utilityReasoningOptions]);
  // Callers reach for these at the moment they fire a turn, so reading through
  // a ref keeps them off the resolvers' identity and out of re-render churn.
  const utilityTurnRef = useRef({
    modelId: resolvedUtilityModelId,
    reasoningEffort: resolvedUtilityReasoningEffort,
  });
  utilityTurnRef.current = {
    modelId: resolvedUtilityModelId,
    reasoningEffort: resolvedUtilityReasoningEffort,
  };
  /** `{ modelId, reasoningEffort }` for a hidden text-generation turn. */
  const resolveUtilityTurn = useCallback(() => utilityTurnRef.current, []);

  const disposeThreadRuntime = useCallback(async (threadId: string) => {
    try {
      await window.orion?.disposeAgentThread?.(threadId);
    } catch (error) {
      console.error('Could not dispose agent thread runtime', error);
    }
  }, []);

  const deleteThreadWithRuntime = useCallback(
    async (threadId: string) => {
      const state = useOrionStore.getState();
      const threadIds = new Set([threadId]);
      // A spawned child has an independent runtime. Deleting its parent must
      // therefore walk the whole subtree instead of merely orphaning work
      // that can continue changing the workspace in the background.
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const thread of state.threads) {
          if (thread.parentThreadId && threadIds.has(thread.parentThreadId) && !threadIds.has(thread.id)) {
            threadIds.add(thread.id);
            foundChild = true;
          }
        }
      }

      const removedThreads = state.threads.filter((thread) => threadIds.has(thread.id));
      const runIds: string[] = [];
      const spawnIds: string[] = [];
      for (const thread of removedThreads) {
        const runId = activeRunsByThread[thread.id];
        if (runId) {
          runIds.push(runId);
          runOutputMessages.current.delete(runId);
          clearActiveRun(runId);
        }
        if (thread.spawnId) spawnIds.push(thread.spawnId);
      }

      await Promise.all(runIds.map((runId) => window.orion?.stopAgentTurn?.(runId, { terminateBackground: true })));
      await Promise.all(removedThreads.map((thread) => disposeThreadRuntime(thread.id)));
      for (const spawnId of spawnIds) {
        void window.orion?.reportSubagentResult?.({
          spawnId,
          ok: false,
          result: 'Subagent thread was deleted by the user.',
        });
      }
      // Delete children first so no orphan can briefly surface as a top-level
      // thread while the persisted store updates.
      for (const thread of removedThreads.reverse()) deleteThread(thread.id);
    },
    [activeRunsByThread, clearActiveRun, deleteThread, disposeThreadRuntime]
  );

  const removeProjectWithRuntimes = useCallback(
    async (projectId: string) => {
      const projectThreads = useOrionStore.getState().threads.filter((thread) => thread.projectId === projectId);
      const runIds = projectThreads
        .map((thread) => activeRunsByThread[thread.id])
        .filter((runId): runId is string => Boolean(runId));
      for (const runId of runIds) {
        runOutputMessages.current.delete(runId);
        clearActiveRun(runId);
      }
      await Promise.all(runIds.map((runId) => window.orion?.stopAgentTurn?.(runId, { terminateBackground: true })));
      await Promise.all(projectThreads.map((thread) => disposeThreadRuntime(thread.id)));
      for (const thread of projectThreads) {
        if (!thread.spawnId) continue;
        void window.orion?.reportSubagentResult?.({
          spawnId: thread.spawnId,
          ok: false,
          result: 'Subagent project was removed by the user.',
        });
      }
      removeProject(projectId);
    },
    [activeRunsByThread, clearActiveRun, disposeThreadRuntime, removeProject]
  );

  const refreshAgentModels = useCallback(async (force = false) => {
    if (!window.orion?.listAgentModels) return;
    try {
      const models = await window.orion.listAgentModels({ force });
      if (models.length > 0) {
        setAgentModels(models);
      }
    } catch {
      // The fallback catalog remains usable when the bridge is unavailable.
    }
  }, []);

  const refreshProviderUpdates = useCallback(async () => {
    if (!window.orion?.checkProviderUpdates) return;
    try {
      setProviderUpdateState(await window.orion.checkProviderUpdates({ enabledProviderIds }));
    } catch {
      setProviderUpdateState(null);
    }
  }, [enabledProviderIds]);

  useEffect(() => {
    void refreshAgentModels();
    void refreshProviderUpdates();
  }, [refreshAgentModels, refreshProviderUpdates]);

  useEffect(() => {
    if (!window.orion?.onProviderAuthenticated) return undefined;
    return window.orion.onProviderAuthenticated(() => {
      void refreshAgentModels(true);
      void refreshProviderUpdates();
    });
  }, [refreshAgentModels, refreshProviderUpdates]);

  // Claude Code CLI terminal threads: main discovers the live CLI session id
  // from claude's on-disk session store (the interactive TUI ignores
  // --session-id) and pushes it here. Stored on the thread so later spawns
  // can --resume it after an app restart. Registered app-wide (not in
  // TerminalView) so ids aren't missed while the terminal view is unmounted.
  useEffect(() => {
    if (!window.orion?.onTerminalSession) return undefined;
    return window.orion.onTerminalSession((event) => {
      setThreadAgentSession(event.threadId, 'claude', event.sessionId);
    });
  }, [setThreadAgentSession]);

  useEffect(() => {
    let mounted = true;

    void window.orion?.getAppUpdateState?.().then((state) => {
      if (mounted) setAppUpdateState(state);
    });

    const unsubscribe = window.orion?.onAppUpdateState?.((state) => {
      setAppUpdateState(state);
      setAppUpdateBusy(false);
    });

    void window.orion?.checkForAppUpdate?.().catch(() => {
      // The main process publishes the visible error state.
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const finalizeReleasedRifts = useCallback(
    async (
      released: Array<{ riftPath: string; epicId: string }>,
      { disposeRuntimes = true }: { disposeRuntimes?: boolean } = {}
    ) => {
      if (released.length === 0) return true;
      const state = useOrionStore.getState();
      const epicMatchesRelease = (epic: Epic, { epicId, riftPath }: { epicId: string; riftPath: string }) =>
        epic.id === epicId && (epic.riftPath === riftPath || (!epic.riftPath && epic.riftReleased === true));
      // Startup state and the live release event can deliver the same journal
      // result more than once. A restored epic may already own a replacement
      // Rift by then, so stale payloads must not touch its new runtimes/state.
      // An unbound riftReleased epic is a partial-persistence retry: its store
      // save landed, but its stale thread sessions may still need saving.
      const matchingReleases = released.filter((release) =>
        state.epics.some((epic) => epicMatchesRelease(epic, release))
      );
      const runtimeThreadsByEpic = new Map(
        matchingReleases.map(({ epicId }) => [epicId, runtimeThreadsForEpic(state.threads, epicId)])
      );
      const runtimeThreads = [
        ...new Map([...runtimeThreadsByEpic.values()].flat().map((thread) => [thread.id, thread])).values(),
      ];

      let runtimesDisposed = true;
      if (disposeRuntimes && window.orion?.disposeAgentThread) {
        try {
          await Promise.all(runtimeThreads.map((thread) => window.orion!.disposeAgentThread(thread.id)));
        } catch (error) {
          runtimesDisposed = false;
          console.error('Could not dispose every runtime for released Rifts', error);
        }
      }

      // These resumable ids were created with the removed workspace as cwd.
      // Clear them even when disposal failed so no later turn tries to resume
      // into that path; the durable release journal remains for another reap.
      const latestState = useOrionStore.getState();
      const releasesToFinalize = matchingReleases.filter((release) =>
        latestState.epics.some((epic) => epicMatchesRelease(epic, release))
      );
      const threadsToFinalize = [
        ...new Map(
          releasesToFinalize
            .flatMap(({ epicId }) => runtimeThreadsByEpic.get(epicId) ?? [])
            .map((thread) => [thread.id, thread])
        ).values(),
      ];
      for (const thread of threadsToFinalize) {
        updateThread(thread.id, {
          agentSessionIds: undefined,
          pendingForkProviders: undefined,
          ...(thread.status === 'running' ? { status: 'idle' as const } : {}),
          ...((thread.queuedMessages?.length ?? 0) > 0 ? { queuedMessages: [] } : {}),
        });
      }
      for (const { epicId, riftPath } of releasesToFinalize) {
        releaseEpicRift(epicId, riftPath);
      }

      const [storeSaved, threadsSaved] =
        releasesToFinalize.length > 0
          ? await Promise.all([flushOrionStoreSave(), flushOrionThreadsSave()])
          : [true, true];
      if (!runtimesDisposed || !storeSaved || !threadsSaved) return false;
      const acknowledgement = await window.orion?.acknowledgeRiftStorageReleases?.({
        riftPaths: released.map((entry) => entry.riftPath),
      });
      return acknowledgement?.ok === true;
    },
    [releaseEpicRift, updateThread]
  );

  // Rift storage. Main owns the scan; the renderer only mirrors its state and
  // asks for a rescan when the Storage tab is opened.
  //
  // The startup retention sweep runs before this window exists, so its result
  // cannot arrive as a push — main parks it and this mount drains it. The live
  // subscription only covers a sweep that happens while a window is already up.
  useEffect(() => {
    let mounted = true;

    const applyReleases = async (
      released: Array<{ riftPath: string; epicId: string }>,
      retentionDays: number | null
    ) => {
      if (released.length === 0) return;
      // The startup journal can be ready before Zustand's async storage has
      // hydrated. Releasing against the initial empty store would persist that
      // snapshot over the real epics before hydration gets a chance to merge.
      if (!useOrionStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          let finished = false;
          let unsubscribe = () => {};
          const finish = () => {
            if (finished) return;
            finished = true;
            unsubscribe();
            resolve();
          };
          unsubscribe = useOrionStore.persist.onFinishHydration(finish);
          // Close the check/subscription race if hydration completed between
          // the first hasHydrated() call and listener registration.
          if (useOrionStore.persist.hasHydrated()) finish();
        });
      }
      if (!mounted) return;
      if (await finalizeReleasedRifts(released)) {
        toast.info(
          `Freed ${released.length} rift${released.length === 1 ? '' : 's'}` +
            (retentionDays ? ` settled over ${retentionDays} days ago` : '')
        );
      } else {
        toast.error('Rifts were freed, but Orion could not durably finish their cleanup');
      }
    };

    void window.orion?.getRiftStorageState?.().then(async (state) => {
      if (!mounted) return;
      setRiftStorageState(state);
      if (!state.pendingReleases?.length) return;
      await applyReleases(state.pendingReleases, state.pendingReleasesRetentionDays ?? null);
    });

    const unsubscribeState = window.orion?.onRiftStorageState?.((state) => {
      setRiftStorageState(state);
    });
    const unsubscribeReleased = window.orion?.onRiftStorageReleased?.(
      ({ released, retentionDays }) => void applyReleases(released, retentionDays)
    );

    return () => {
      mounted = false;
      unsubscribeState?.();
      unsubscribeReleased?.();
    };
  }, [finalizeReleasedRifts]);

  // Sizing walks multi-gigabyte trees, so it only runs when the tab is opened,
  // reusing cached sizes unless the user asks for a fresh measurement.
  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'storage') return;
    let cancelled = false;
    void flushOrionStoreSave().then((saved) => {
      if (cancelled || !saved) return;
      void window.orion?.scanRiftStorage?.({ remeasure: false });
    });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    let mounted = true;

    void window.orion
      ?.getAccountSession?.()
      .then((state) => {
        if (mounted) setAccountState(state);
      })
      .catch(() => {
        if (mounted) {
          setAccountState({
            authenticated: false,
            user: null,
            expiresAt: null,
          });
        }
      })
      .finally(() => {
        if (mounted) setAccountLoading(false);
      });

    const unsubscribe = window.orion?.onAccountChanged?.((state) => {
      setAccountState(state);
      setAccountLoading(false);
      setAccountBusy(false);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!modelPickerOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) {
        setModelPickerOpen(false);
        setModelSearch('');
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelPickerOpen(false);
        setModelSearch('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!utilityModelPickerOpen) return undefined;

    const close = () => {
      setUtilityModelPickerOpen(false);
      setUtilityModelSearch('');
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!utilityModelPickerRef.current?.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [utilityModelPickerOpen]);

  useEffect(() => {
    if (!taskPickerOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!taskPickerRef.current?.contains(event.target as Node)) {
        setTaskPickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTaskPickerOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [taskPickerOpen]);

  useEffect(() => {
    if (!codexSettingsOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!codexSettingsRef.current?.contains(event.target as Node)) {
        setCodexSettingsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCodexSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [codexSettingsOpen]);

  useEffect(() => {
    if (!accessModeOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!accessModeRef.current?.contains(event.target as Node)) {
        setAccessModeOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccessModeOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accessModeOpen]);

  useEffect(() => {
    if (!shouldShowAgentSettings) {
      setCodexSettingsOpen(false);
    }
  }, [shouldShowAgentSettings]);

  // Re-blur the account email when Settings closes or the signed-in identity
  // changes. Keying the reveal to the identity also keeps a newly rendered
  // account concealed before this effect clears the previous state.
  useEffect(() => {
    setRevealedAccountIdentity(null);
  }, [settingsOpen, accountIdentity]);

  // Poll while the Computer Use tab is visible so grants toggled over in
  // System Settings show up without a manual refresh.
  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'computer-use') return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const state = await window.orion.getComputerUsePermissions();
        if (!cancelled) setComputerUsePerms(state);
      } catch {
        // main process unavailable; leave the last known state in place
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [settingsOpen, settingsTab]);

  const handleRequestComputerUsePermission = useCallback(async (kind: OrionComputerUsePermissionKind) => {
    setComputerUseBusyKind(kind);
    try {
      const result = await window.orion.requestComputerUsePermission(kind);
      if (result.state) setComputerUsePerms(result.state);
      if (!result.ok && result.error) toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not request the permission.');
    } finally {
      setComputerUseBusyKind(null);
    }
  }, []);

  const handleOpenChromeDebugSetup = useCallback(async () => {
    try {
      const result = await window.orion.openChromeDebugSetup();
      if (result.ok) {
        toast.success('Opened Chrome — the setup link is also on your clipboard.');
      } else if (result.error) {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open Chrome.');
    }
  }, []);

  const refreshGitState = useCallback(async () => {
    const projectPath = activeWorkingDir;
    if (!projectPath || !window.orion?.getGitState) {
      setGitState(null);
      return;
    }

    setGitLoading(true);
    try {
      setGitState(await window.orion.getGitState(projectPath));
    } catch (error) {
      setGitState({
        ok: false,
        branches: [],
        hasUncommittedChanges: false,
        error: error instanceof Error ? error.message : 'Unable to read git state',
      });
    } finally {
      setGitLoading(false);
    }
  }, [activeWorkingDir]);

  useEffect(() => {
    void refreshGitState();
  }, [refreshGitState]);

  const refreshCloudState = useCallback(async () => {
    const projectPath = activeWorkingDir;
    if (!projectPath || !window.orion?.getCloudState) {
      setCloudState(null);
      return;
    }

    try {
      setCloudState(await window.orion.getCloudState(projectPath));
    } catch (error) {
      setCloudState({
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to read Orion Cloud state',
      });
    }
  }, [activeWorkingDir]);

  // Cloud state depends on both the account session and local git state
  // (each git action can change what is ahead/behind the cloud copy).
  useEffect(() => {
    void refreshCloudState();
  }, [refreshCloudState, accountState.authenticated, gitState]);

  const handleUpdateProviders = useCallback(async () => {
    if (!window.orion?.updateProviders || providerUpdatesRunning) return;

    setProviderUpdatesRunning(true);
    try {
      const result = await window.orion.updateProviders({ enabledProviderIds });
      setProviderUpdateState(result.state);
      await refreshAgentModels();

      if (result.ok) {
        toast.success('Provider CLIs updated');
      } else {
        toast.error(result.error ?? 'Some provider updates failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update provider CLIs');
    } finally {
      setProviderUpdatesRunning(false);
    }
  }, [enabledProviderIds, providerUpdatesRunning, refreshAgentModels]);

  const handleAppUpdateClick = useCallback(async () => {
    if (!appUpdateState || appUpdateBusy) return;
    if (
      appUpdateState.status === 'downloading' ||
      appUpdateState.status === 'checking' ||
      appUpdateState.status === 'restarting'
    ) {
      return;
    }

    setAppUpdateBusy(true);
    try {
      if (appUpdateState.status === 'downloaded') {
        // Stays busy on success: the app is on its way out. Only a restart that
        // could not go through hands the button back.
        const result = await window.orion?.restartToUpdate?.();
        if (result && result.ok === false) {
          toast.error(result.error ?? 'Could not restart to update');
          setAppUpdateBusy(false);
        }
        return;
      }

      if (appUpdateState.status === 'available') {
        await window.orion?.downloadAppUpdate?.();
        return;
      }

      await window.orion?.checkForAppUpdate?.({ force: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update Orion');
      setAppUpdateBusy(false);
    }
  }, [appUpdateBusy, appUpdateState]);

  const handleStartAccountAuth = useCallback(async () => {
    if (!window.orion?.startAccountAuth || accountBusy) return;

    setAccountBusy(true);
    try {
      const result = await window.orion.startAccountAuth();
      if (!result.ok) {
        toast.error(result.error ?? 'Could not start Orion sign in');
        setAccountBusy(false);
      } else {
        toast.info('Continue sign in in your browser');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Orion sign in');
      setAccountBusy(false);
    }
  }, [accountBusy]);

  const handleSignOutAccount = useCallback(async () => {
    if (!window.orion?.signOutAccount || accountBusy) return;

    setAccountBusy(true);
    try {
      setAccountState(await window.orion.signOutAccount());
      toast.success('Signed out of Orion');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out');
    } finally {
      setAccountBusy(false);
    }
  }, [accountBusy]);

  const handleAuthenticateProvider = useCallback(
    async (providerId: string) => {
      if (!window.orion?.authenticateProvider || authenticatingProviderId) return;

      setAuthenticatingProviderId(providerId);
      try {
        const result = await window.orion.authenticateProvider(providerId);
        if (result.ok) {
          toast.info('Authentication started');
        } else {
          toast.error(result.error ?? 'Could not start authentication');
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not start authentication');
      } finally {
        setAuthenticatingProviderId(null);
      }
    },
    [authenticatingProviderId]
  );

  useEffect(() => {
    if (
      !projectPickerOpen &&
      !branchPickerOpen &&
      !threadSearchOpen &&
      !threadMenuOpen &&
      !goalMenuOpen &&
      !openWithOpen &&
      !epicRepoPickerOpen &&
      projectMenuOpenId === null &&
      threadItemMenuKey === null &&
      epicMenuOpenId === null
    )
      return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (projectPickerOpen && !projectPickerRef.current?.contains(target)) {
        setProjectPickerOpen(false);
      }
      if (branchPickerOpen && !branchPickerRef.current?.contains(target)) {
        setBranchPickerOpen(false);
      }
      if (openWithOpen && !openWithRef.current?.contains(target)) {
        setOpenWithOpen(false);
      }
      if (threadSearchOpen && !threadSearchRef.current?.contains(target)) {
        setThreadSearchOpen(false);
      }
      if (threadMenuOpen && !threadMenuRef.current?.contains(target)) {
        setThreadMenuOpen(false);
      }
      if (goalMenuOpen && !goalMenuRef.current?.contains(target)) {
        setGoalMenuOpen(false);
      }
      if (projectMenuOpenId !== null && !projectMenuRef.current?.contains(target)) {
        setProjectMenuOpenId(null);
      }
      if (threadItemMenuKey !== null && !threadItemMenuRef.current?.contains(target)) {
        setThreadItemMenuKey(null);
      }
      if (epicMenuOpenId !== null && !epicMenuRef.current?.contains(target)) {
        setEpicMenuOpenId(null);
      }
      if (epicRepoPickerOpen && !epicRepoPickerRef.current?.contains(target)) {
        setEpicRepoPickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectPickerOpen(false);
        setBranchPickerOpen(false);
        setThreadSearchOpen(false);
        setThreadMenuOpen(false);
        setGoalMenuOpen(false);
        setOpenWithOpen(false);
        setProjectMenuOpenId(null);
        setThreadItemMenuKey(null);
        setEpicMenuOpenId(null);
        setEpicRepoPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    branchPickerOpen,
    projectPickerOpen,
    threadMenuOpen,
    goalMenuOpen,
    threadSearchOpen,
    openWithOpen,
    projectMenuOpenId,
    threadItemMenuKey,
    epicMenuOpenId,
    epicRepoPickerOpen,
  ]);

  useEffect(() => {
    setThreadMenuOpen(false);
  }, [selectedThreadId]);

  useEffect(() => {
    setEpicRepoPickerOpen(false);
  }, [selectedEpicId]);

  useEffect(() => {
    let cancelled = false;
    void window.orion?.listOpenWithApps?.().then((apps) => {
      if (!cancelled && Array.isArray(apps)) setOpenWithApps(apps);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Streamed chunks can arrive many times per second; buffer them briefly so
  // each token doesn't trigger a full store update (and a store persist).
  const chunkBuffers = useRef(new Map<string, { threadId: string; messageId: string; text: string }>());
  const chunkFlushTimer = useRef<number | null>(null);

  // --- Linked board tasks (Orion web kanban) -----------------------------------

  // Forget one card locally (the web side unlinked or deleted it, or the user
  // unlinked it here). `undefined` rather than an empty array once the last one
  // goes, so a thread that never linked anything looks the same as one that
  // unlinked everything.
  // Replace one card in place, keeping its position in the list.
  const updateLinkedTask = useCallback(
    (threadId: string, taskId: string, next: LinkedBoardTask) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const linkedTasks = thread?.linkedTasks;
      if (!linkedTasks?.some((task) => task.id === taskId)) return;
      updateThread(threadId, {
        linkedTasks: linkedTasks.map((task) => (task.id === taskId ? next : task)),
      });
    },
    [updateThread]
  );

  const dropLinkedTask = useCallback(
    (threadId: string, taskId: string) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const remaining = (thread?.linkedTasks ?? []).filter((task) => task.id !== taskId);
      if (remaining.length === (thread?.linkedTasks?.length ?? 0)) return;
      updateThread(threadId, {
        linkedTasks: remaining.length > 0 ? remaining : undefined,
      });
    },
    [updateThread]
  );

  // Push a status to the thread's injected cards by default, or just `taskIds`
  // when the action targets one chip (e.g. "mark done"). Pending cards have
  // not been sent to the agent and must not inherit the active run's lifecycle.
  const pushLinkedTaskStatus = useCallback(
    (threadId: string, status: 'running' | 'finished' | 'done' | 'error', notes?: string, taskIds?: string[]) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const linkedTasks = thread?.linkedTasks ?? [];
      const targets = taskIds
        ? linkedTasks.filter((task) => taskIds.includes(task.id))
        : linkedTasks.filter((task) => task.injected);
      if (targets.length === 0 || !window.orion?.updateBoardTaskThreadStatus) return;
      const targetIds = new Set(targets.map((task) => task.id));
      updateThread(threadId, {
        linkedTasks: linkedTasks.map((task) => (targetIds.has(task.id) ? { ...task, lastStatus: status } : task)),
      });
      for (const linked of targets) {
        void window.orion
          .updateBoardTaskThreadStatus({
            taskId: linked.id,
            threadId,
            status,
            notes,
          })
          .then((result) => {
            if (result.ok || !result.stale) return;
            // The card was unlinked or relinked on the web — drop our side.
            dropLinkedTask(threadId, linked.id);
          })
          .catch(() => {});
      }
    },
    [dropLinkedTask, updateThread]
  );

  // Desktop notification when a thread finishes. Suppressed while the user is
  // already looking at that thread in any visible pane. Sound rides on the OS
  // notification via `silent`, so there is no separate audio path to keep in
  // sync.
  const notifyThreadFinished = useCallback((threadId: string, outcome: 'done' | 'error') => {
    const state = useOrionStore.getState();
    const settings = {
      ...defaultNotificationSettings,
      ...state.notificationSettings,
    };
    if (!settings.enabled) return;
    if (
      document.hasFocus() &&
      isAgentsPanelVisible(state) &&
      state.paneThreadIds.includes(threadId)
    ) {
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    const thread = state.threads.find((t) => t.id === threadId);
    const notification = new Notification(outcome === 'error' ? 'Agent stopped with an error' : 'Agent finished', {
      body: thread?.title?.trim() || 'Agent thread',
      silent: !settings.sound,
      tag: `thread-finished-${threadId}`,
    });
    notification.onclick = () => {
      window.orion?.focusWindow?.().catch(() => {});
      const store = useOrionStore.getState();
      store.setActiveTab('agents');
      store.selectThread(threadId);
    };
  }, []);

  // Embedded terminals do not emit agent-run events, so mirror their prompt
  // and process lifecycle into the persisted thread/board state explicitly.
  useEffect(() => {
    if (!window.orion?.onTerminalActivity || !window.orion?.onTerminalExit) return undefined;
    const offActivity = window.orion.onTerminalActivity((event) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === event.threadId);
      if (!thread || thread.modelId !== claudeCodeCliModelId) return;
      if (event.kind === 'turn-complete') {
        // Claude's Stop hook fired: the turn is done even though the TUI (and
        // its PTY) stay alive waiting for the next prompt.
        if (thread.status !== 'running') return;
        updateThread(event.threadId, {
          status: 'done',
          terminalActivityAt: new Date().toISOString(),
        });
        notifyThreadFinished(event.threadId, 'done');
        const stillRunning = (thread.linkedTasks ?? []).filter((task) => task.lastStatus === 'running');
        if (stillRunning.length > 0) {
          pushLinkedTaskStatus(
            event.threadId,
            'finished',
            undefined,
            stillRunning.map((task) => task.id)
          );
        }
        return;
      }
      if (event.kind === 'started') {
        // A freshly spawned/reattached TUI is idle at its prompt — record the
        // activity for recency ordering but leave the run status alone.
        if (thread.status !== 'running') {
          updateThread(event.threadId, {
            terminalActivityAt: new Date().toISOString(),
          });
        }
        return;
      }
      updateThread(event.threadId, {
        status: 'running',
        terminalActivityAt: new Date().toISOString(),
      });
      if (event.kind === 'prompt') {
        const notRunning = (thread.linkedTasks ?? []).filter((task) => task.injected && task.lastStatus !== 'running');
        if (notRunning.length > 0) {
          pushLinkedTaskStatus(
            event.threadId,
            'running',
            undefined,
            notRunning.map((task) => task.id)
          );
        }
      }
    });
    const offExit = window.orion.onTerminalExit((event) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === event.threadId);
      if (!thread || thread.modelId !== claudeCodeCliModelId) return;
      const failed = event.exitCode != null && event.exitCode !== 0;
      updateThread(event.threadId, {
        status: failed ? 'error' : 'done',
        terminalActivityAt: new Date().toISOString(),
      });
      if (thread.status === 'running') {
        notifyThreadFinished(event.threadId, failed ? 'error' : 'done');
      }
      if (thread.linkedTasks?.length) {
        pushLinkedTaskStatus(event.threadId, failed ? 'error' : 'finished');
      }
    });
    return () => {
      offActivity?.();
      offExit?.();
    };
  }, [notifyThreadFinished, pushLinkedTaskStatus, updateThread]);

  const unlinkTaskFromThread = useCallback(
    async (threadId: string, taskId: string): Promise<boolean> => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      if (!thread?.linkedTasks?.some((task) => task.id === taskId)) return true;

      const key = `${threadId}:${taskId}`;
      const existing = linkedTaskUnlinksRef.current.get(key);
      if (existing) return existing;

      const unlink = (async () => {
        if (!window.orion?.unlinkBoardTask) {
          toast.error('Board tasks are unavailable in this build.');
          return false;
        }
        try {
          const result = await window.orion.unlinkBoardTask({
            taskId,
            threadId,
          });
          if (!result.ok && !result.stale) {
            toast.error(result.error ?? 'Could not unlink the task');
            return false;
          }
          dropLinkedTask(threadId, taskId);
          return true;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not unlink the task');
          return false;
        }
      })();
      linkedTaskUnlinksRef.current.set(key, unlink);
      try {
        return await unlink;
      } finally {
        if (linkedTaskUnlinksRef.current.get(key) === unlink) {
          linkedTaskUnlinksRef.current.delete(key);
        }
      }
    },
    [dropLinkedTask]
  );

  const markLinkedTaskDone = useCallback(
    (threadId: string, taskId: string) => {
      pushLinkedTaskStatus(threadId, 'done', undefined, [taskId]);
      toast.success('Task moved to Done on your board');
    },
    [pushLinkedTaskStatus]
  );

  // Picking a task in the popover links it; picking one that is already linked
  // unlinks it, so the popover doubles as the multi-select list.
  const toggleTaskOnSelectedThread = useCallback(
    async (task: OrionBoardTask) => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === state.selectedThreadId);
      if (!thread) return;
      const linkedTasks = thread.linkedTasks ?? [];
      if (linkedTasks.some((linked) => linked.id === task.id)) {
        await unlinkTaskFromThread(thread.id, task.id);
        return;
      }
      if (!window.orion?.linkBoardTask) return;
      const project = state.projects.find((p) => p.id === thread.projectId);
      // A fresh, untitled thread adopts the first task's title.
      const adoptTitle = linkedTasks.length === 0 && thread.messages.length === 0 && isDefaultTitle(thread.title);

      const result = await window.orion.linkBoardTask({
        taskId: task.id,
        threadId: thread.id,
        threadTitle: adoptTitle ? task.title : thread.title,
        projectName: project?.name,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not link the task');
        return;
      }
      const linkedTask = linkedTaskFromBoardTask(result.task ?? task);
      // Re-read: the link round-trip is async, so the list may have moved.
      const current = useOrionStore.getState().threads.find((t) => t.id === thread.id)?.linkedTasks ?? [];
      updateThread(thread.id, {
        linkedTasks: current.some((linked) => linked.id === linkedTask.id) ? current : [...current, linkedTask],
        ...(adoptTitle ? { title: task.title } : {}),
      });
      const unavailableCount = linkedTask.attachments?.filter((attachment) => !attachment.path).length ?? 0;
      if (unavailableCount > 0) {
        toast.warning(
          `${unavailableCount} task attachment${unavailableCount === 1 ? '' : 's'} could not be downloaded.`
        );
      }
    },
    [unlinkTaskFromThread, updateThread]
  );

  // Refresh and locally download the linked-task snapshot (and detect web-side
  // unlink or deletion) whenever a thread whose context has not been injected
  // is selected, so the agent gets current text and attachments.
  const refreshLinkedTaskSnapshot = useCallback(
    (threadId: string, linked: LinkedBoardTask): Promise<void> => {
      if (!window.orion?.getBoardTask) return Promise.resolve();

      const key = `${threadId}:${linked.id}`;
      const existing = linkedTaskRefreshesRef.current.get(key);
      if (existing) return existing;

      const refresh = window.orion
        .getBoardTask(linked.id)
        .then((result) => {
          const current = useOrionStore
            .getState()
            .threads.find((thread) => thread.id === threadId)
            ?.linkedTasks?.find((task) => task.id === linked.id);
          if (!current || current.injected) return;

          if (!result.ok) {
            if (result.stale) dropLinkedTask(threadId, linked.id);
            return;
          }

          const fresh = result.task;
          if (!fresh || fresh.linked?.threadId !== threadId) {
            dropLinkedTask(threadId, linked.id);
            return;
          }
          updateLinkedTask(threadId, linked.id, {
            ...linkedTaskFromBoardTask(fresh),
            lastStatus: current.lastStatus,
          });
        })
        .catch(() => {});
      const sharedRefresh = refresh.finally(() => {
        if (linkedTaskRefreshesRef.current.get(key) === sharedRefresh) {
          linkedTaskRefreshesRef.current.delete(key);
        }
      });
      linkedTaskRefreshesRef.current.set(key, sharedRefresh);
      return sharedRefresh;
    },
    [dropLinkedTask, updateLinkedTask]
  );

  const refreshLinkedTasksBeforeDispatch = useCallback(
    async (threadId: string) => {
      const pending = (
        useOrionStore.getState().threads.find((thread) => thread.id === threadId)?.linkedTasks ?? []
      ).filter((task) => !task.injected);
      if (pending.length === 0) return;
      await Promise.all(pending.map((task) => refreshLinkedTaskSnapshot(threadId, task)));
    },
    [refreshLinkedTaskSnapshot]
  );

  // Cards linked but not yet sent to the agent: the ones the composer shows as
  // removable chips and the next turn will inject.
  const pendingLinkedTasks = useMemo(
    () => (selectedThread?.linkedTasks ?? []).filter((task) => !task.injected),
    [selectedThread?.linkedTasks]
  );
  const hasPendingLinkedTasks = pendingLinkedTasks.length > 0;
  // Every card linked to the thread, injected or not — the picker's selection
  // state and the composer's board button read from these.
  const linkedTaskIds = useMemo(
    () => (selectedThread?.linkedTasks ?? []).map((task) => task.id),
    [selectedThread?.linkedTasks]
  );
  const linkedTasksLabel = selectedThread?.linkedTasks?.length
    ? `Linked ${selectedThread.linkedTasks.length === 1 ? 'task' : 'tasks'}: ${selectedThread.linkedTasks
        .map((task) => task.title)
        .join(', ')}`
    : 'Link tasks from your Orion board';
  // Signature of that set, so selecting a thread re-refreshes only when it
  // actually changed (not on every status push).
  const pendingLinkedTaskKey = pendingLinkedTasks.map((task) => task.id).join(':');

  useEffect(() => {
    const threadId = selectedThread?.id;
    if (!threadId || !pendingLinkedTaskKey) return;
    void refreshLinkedTasksBeforeDispatch(threadId);
  }, [selectedThread?.id, pendingLinkedTaskKey, refreshLinkedTasksBeforeDispatch]);

  const flushChunkBuffers = useCallback(() => {
    if (chunkFlushTimer.current !== null) {
      window.clearTimeout(chunkFlushTimer.current);
      chunkFlushTimer.current = null;
    }
    if (chunkBuffers.current.size === 0) return;
    const buffered = Array.from(chunkBuffers.current.values());
    chunkBuffers.current.clear();
    for (const { threadId, messageId, text } of buffered) {
      if (text) appendToThreadMessage(threadId, messageId, text);
    }
  }, [appendToThreadMessage]);

  useEffect(() => {
    if (!window.orion?.onAgentTurnEvent) return undefined;
    const unsubscribe = window.orion.onAgentTurnEvent((event) => {
      // `/btw` aside runs stream into their exchange, not the transcript.
      // Their `session` events are deliberately dropped: the fork's id must
      // never replace the thread's real session id.
      const btwRun = btwRuns.current.get(event.runId);
      if (btwRun) {
        if (event.type === 'chunk' && event.chunk) {
          appendToBtwExchange(btwRun.threadId, btwRun.exchangeId, event.chunk);
        }
        if (event.type === 'done') {
          updateBtwExchange(btwRun.threadId, btwRun.exchangeId, {
            status: 'done',
            completedAt: new Date().toISOString(),
          });
          btwRuns.current.delete(event.runId);
        }
        if (event.type === 'error') {
          // Same logged-out detection as transcript turns: the aside's answer
          // tail carries the CLI's stderr text.
          const asideAnswerTail =
            useOrionStore
              .getState()
              .threads.find((thread) => thread.id === btwRun.threadId)
              ?.btwExchanges?.find((exchange) => exchange.id === btwRun.exchangeId)
              ?.answer.slice(-1200) ?? '';
          const asideLoggedOut = isProviderAuthErrorText(event.error) || isProviderAuthErrorText(asideAnswerTail);
          updateBtwExchange(btwRun.threadId, btwRun.exchangeId, {
            status: 'error',
            completedAt: new Date().toISOString(),
            error: event.error,
            authProviderId: asideLoggedOut && event.providerId !== 'orion' ? event.providerId : undefined,
          });
          btwRuns.current.delete(event.runId);
        }
        return;
      }

      // Goal state belongs to the thread, not to the transcript message. Stop
      // deliberately untracks a run before IPC so late text/result events
      // cannot rewrite the stopped message; the persisted paused-goal update
      // must still land after that untracking.
      if (event.type === 'goal') {
        updateThread(event.threadId, { goal: event.goal ?? null });
        return;
      }

      // A claude session's background work settled with no re-invocation
      // coming (task killed/failed, notification suppressed, or the session
      // itself was disposed): flip a thread left "working — waiting on
      // background agents" to done. No-op unless the thread is idle-running.
      if (event.type === 'background-settled') {
        const retainedRunId = activeRunsByThreadRef.current[event.threadId];
        // A mapping without a tracked output message is the retained
        // background-session handle. A mapping with one is a genuine live
        // foreground turn, which this stale settle event must not finish.
        if (retainedRunId && runOutputMessages.current.has(retainedRunId)) return;
        // runOutputMessages updates synchronously when a run starts, so it
        // also covers the render tick before activeRunsByThreadRef syncs.
        for (const run of runOutputMessages.current.values()) {
          if (run.threadId === event.threadId) return;
        }
        if (retainedRunId) clearActiveRun(retainedRunId);
        const thread = useOrionStore.getState().threads.find((t) => t.id === event.threadId);
        if (!thread || thread.status !== 'running') return;
        const lastRun = [...thread.messages].reverse().find((m) => m.kind === 'agent-run');
        updateThread(event.threadId, { status: 'done' });
        notifyThreadFinished(event.threadId, 'done');
        pushLinkedTaskStatus(event.threadId, 'finished', lastRun?.content.trim() || undefined);
        if (lastRun && lastRun.status === 'done') {
          updateThreadMessage(event.threadId, lastRun.id, {
            statusText: 'Finished.',
          });
        }
        return;
      }

      // Provider-native subagents (claude Agent tool, codex collaboration
      // spawns, cursor Task tool, grok spawn_subagent): main tails each
      // subagent's on-disk transcript and streams it here. Every subagent
      // becomes a hidden child thread of the run's thread, so the agents
      // switcher can flip between main and subagents uniformly.
      if (
        (event.type === 'subagent' && event.subagent) ||
        ((event.type === 'subagent-chunk' || event.type === 'subagent-activity') && event.subagentId)
      ) {
        const info = event.type === 'subagent' ? event.subagent : undefined;
        const subagentId = info?.id ?? event.subagentId;
        if (!subagentId) return;
        const state = useOrionStore.getState();
        const runThread = state.threads.find((t) => t.id === event.threadId);
        if (!runThread) return;
        const providerId = (info?.providerId ?? event.providerId ?? runThread.modelId.split(':')[0]) as ProviderId;
        const key = `${event.threadId}:${providerId}:${subagentId}`;
        const familyThreadIds = descendantThreadIds(state.threads, runThread.id);
        const findFamilySubagent = (providerSubagentId: string) =>
          state.threads.find(
            (thread) =>
              familyThreadIds.has(thread.id) &&
              thread.subagent?.providerId === providerId &&
              thread.subagent.id === providerSubagentId
          );
        let target = nativeSubagentTargets.current.get(key) ?? null;

        // Rebind after an app reload: the child thread persists, the ref map
        // doesn't. Search the run's descendants for nested agents, but keep
        // provider-local ids inside this run's thread family.
        if (!target) {
          const existing = findFamilySubagent(subagentId);
          const lastRun = existing ? [...existing.messages].reverse().find((m) => m.kind === 'agent-run') : undefined;
          if (existing && lastRun) {
            target = { threadId: existing.id, messageId: lastRun.id };
            nativeSubagentTargets.current.set(key, target);
          }
        }

        if (!target && info) {
          // A subagent can spawn its own subagents (codex collaboration
          // spawns). Hang it off the spawning subagent's thread when main
          // reports one, so the switcher shows the real tree instead of
          // flattening every descendant onto the run's thread.
          const parent = (info.parentSubagentId && findFamilySubagent(info.parentSubagentId)) || runThread;
          const childThreadId = state.createThread(parent.projectId, info.title || info.kind || 'Subagent', {
            parentThreadId: parent.id,
            modelId: parent.modelId,
            hiddenFromRecent: true,
            accessMode: parent.accessMode,
            epicId: parent.epicId,
            select: false,
            subagent: {
              id: subagentId,
              providerId,
              kind: info.kind,
              model: info.model,
              prompt: info.prompt,
            },
          });
          if (info.prompt) {
            addMessageToThread(childThreadId, {
              role: 'user',
              content: info.prompt,
            });
          }
          const messageId = addMessageToThread(childThreadId, {
            role: 'agent',
            content: '',
            kind: 'agent-run',
            status: 'running',
            statusText: 'Subagent working…',
            startedAt: new Date(info.startedAt ?? Date.now()).toISOString(),
            activities: [],
          });
          updateThread(childThreadId, { status: 'running' });
          target = { threadId: childThreadId, messageId };
          nativeSubagentTargets.current.set(key, target);
        }
        if (!target) return;

        if (event.type === 'subagent-chunk' && event.chunk) {
          appendToThreadMessage(target.threadId, target.messageId, event.chunk);
        } else if (event.type === 'subagent-activity' && event.activity) {
          addActivityToThreadMessage(target.threadId, target.messageId, event.activity);
        } else if (info) {
          const fresh = useOrionStore.getState();
          const childThread = fresh.threads.find((t) => t.id === target.threadId);
          if (childThread?.subagent && (info.prompt || info.summary)) {
            updateThread(target.threadId, {
              subagent: {
                ...childThread.subagent,
                ...(info.prompt ? { prompt: info.prompt } : {}),
                ...(info.summary ? { summary: info.summary } : {}),
              },
            });
          }
          // A late-arriving prompt (codex delivers it inside the rollout)
          // fills in the transcript's opening user bubble.
          if (childThread && info.prompt && !childThread.messages.some((m) => m.role === 'user')) {
            updateThread(target.threadId, {
              messages: [
                {
                  id: crypto.randomUUID(),
                  role: 'user',
                  content: info.prompt,
                  ts: childThread.messages[0]?.ts ?? new Date().toISOString(),
                },
                ...childThread.messages,
              ],
            });
          }
          if (info.status && info.status !== 'running') {
            const failed = info.status === 'error';
            const stopped = info.status === 'stopped';
            updateThreadMessage(target.threadId, target.messageId, {
              status: stopped ? 'stopped' : failed ? 'error' : 'done',
              completedAt: new Date(info.completedAt ?? Date.now()).toISOString(),
              statusText: stopped ? 'Stopped by user.' : failed ? 'The subagent stopped with an error.' : 'Finished.',
              ...(info.stats?.totalTokens ? { stats: { totalTokens: info.stats.totalTokens } } : {}),
            });
            updateThread(target.threadId, {
              status: stopped ? 'idle' : failed ? 'error' : 'done',
            });
          }
        }
        return;
      }

      const tracked = runOutputMessages.current.get(event.runId);
      if (!tracked) {
        // A steer interrupt can lose the race with the run settling on its
        // own: the message was untracked before this terminal event arrived.
        // Keep late chunks as well as the terminal outcome. A failed CLI run
        // emits its trailing stderr immediately before `error`; after steer
        // untracks the message, dropping that chunk would lose both the real
        // diagnostic and the text used to recognize authentication failures.
        if (steeringRunsRef.current.has(event.runId)) {
          const raced = steerLostRaceOutcomes.current.get(event.runId) ?? {
            chunks: '',
          };
          if (event.type === 'chunk' && event.chunk) {
            raced.chunks += event.chunk;
            steerLostRaceOutcomes.current.set(event.runId, raced);
          } else if (event.type === 'done' || event.type === 'error') {
            steerLostRaceOutcomes.current.set(event.runId, {
              ...raced,
              type: event.type,
              error: event.error,
              providerId: event.providerId,
              changedFiles: event.changedFiles,
              stats: event.stats,
              pendingBackgroundTasks: event.pendingBackgroundTasks,
            });
          }
        }
        // A persistent claude session can start a turn on its own when a
        // background subagent finishes (task notification re-invokes the
        // model). Grow the transcript with a fresh agent message for it.
        if (event.type === 'started' && event.background) {
          const thread = useOrionStore.getState().threads.find((t) => t.id === event.threadId);
          if (!thread) return;
          const messageId = addMessageToThread(event.threadId, {
            role: 'agent',
            content: '',
            kind: 'agent-run',
            status: 'running',
            statusText: 'Continuing background work.',
            command: event.command,
            startedAt: new Date().toISOString(),
            activities: [],
          });
          runOutputMessages.current.set(event.runId, {
            threadId: event.threadId,
            messageId,
          });
          setActiveRunsByThread((current) => ({
            ...current,
            [event.threadId]: event.runId,
          }));
          updateThread(event.threadId, { status: 'running' });
          pushLinkedTaskStatus(event.threadId, 'running');
        }
        return;
      }

      if (event.type === 'started') {
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          kind: 'agent-run',
          status: 'running',
          statusText: "I'm working on this now.",
          command: event.command,
          startedAt: new Date().toISOString(),
        });
      }

      if (event.type === 'activity' && event.activity) {
        // Flush buffered text first so the activity anchors after the text
        // that streamed before it (contentOffset), not before it.
        flushChunkBuffers();
        addActivityToThreadMessage(tracked.threadId, tracked.messageId, event.activity);
      }

      if (event.type === 'session' && event.sessionId && event.providerId) {
        setThreadAgentSession(tracked.threadId, event.providerId as ProviderId, event.sessionId);
      }

      if (event.type === 'chunk' && event.chunk) {
        const buffer = chunkBuffers.current.get(event.runId);
        if (buffer) {
          buffer.text += event.chunk;
        } else {
          chunkBuffers.current.set(event.runId, {
            threadId: tracked.threadId,
            messageId: tracked.messageId,
            text: event.chunk,
          });
        }
        if (chunkFlushTimer.current === null) {
          chunkFlushTimer.current = window.setTimeout(flushChunkBuffers, 60);
        }
      }

      if (event.type === 'done') {
        flushChunkBuffers();
        // Background subagents/workflows the model is still waiting on: the
        // turn is over, but the task isn't. Keep the thread in the working
        // state — the harness re-invokes the model (a `started {background}`
        // turn) when each task settles, and a `background-settled` event
        // covers tasks that die without re-invoking.
        const waitingOn = event.pendingBackgroundTasks ?? [];
        const waiting = waitingOn.length > 0;
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'done',
          completedAt: new Date().toISOString(),
          statusText: waiting
            ? `Waiting on ${waitingOn.length} background ${waitingOn.length === 1 ? 'agent' : 'agents'}…`
            : 'Finished.',
          changedFiles: event.changedFiles ?? [],
          ...(event.stats ? { stats: event.stats } : {}),
        });
        if (waiting) {
          updateThread(tracked.threadId, { status: 'running' });
          // The thread stays 'running', so the count-based tree refresh
          // can't see this turn's completion — tick it explicitly so the
          // files the foreground turn wrote surface in the Code tree.
          setTreeTurnRefreshTick((t) => t + 1);
        } else {
          updateThread(tracked.threadId, { status: 'done' });
          notifyThreadFinished(tracked.threadId, 'done');
          // Turn finished — surface the work on the board (In Review column)
          // with the response the user sees in this completed agent message.
          const finalResponse = useOrionStore
            .getState()
            .threads.find((thread) => thread.id === tracked.threadId)
            ?.messages.find((message) => message.id === tracked.messageId)
            ?.content.trim();
          pushLinkedTaskStatus(tracked.threadId, 'finished', finalResponse || undefined);
        }
        runOutputMessages.current.delete(event.runId);
        // Keep the completed run id as a cancellable handle while Claude's
        // background agents are still live. Main recognizes it until the
        // session settles; the mapping also keeps Stop/queue UI active.
        if (!waiting) clearActiveRun(event.runId);
      }

      if (event.type === 'error') {
        flushChunkBuffers();
        if (event.error) {
          appendToThreadMessage(tracked.threadId, tracked.messageId, `\n\n${event.error}`);
        }
        // A logged-out provider CLI surfaces as a turn error. Recognize it —
        // in the terminal error text or in the tail of the streamed output,
        // where stderr lands — and mark the message so the transcript offers
        // an Authenticate button instead of a dead-end error.
        const errorThread = useOrionStore.getState().threads.find((thread) => thread.id === tracked.threadId);
        const contentTail =
          errorThread?.messages.find((message) => message.id === tracked.messageId)?.content.slice(-1200) ?? '';
        const looksLoggedOut = isProviderAuthErrorText(event.error) || isProviderAuthErrorText(contentTail);
        const rawAuthProviderId = looksLoggedOut ? (event.providerId ?? errorThread?.modelId.split(':')[0]) : undefined;
        // The Orion pseudo-provider has no CLI of its own to authenticate.
        const authProviderId = rawAuthProviderId === 'orion' ? undefined : rawAuthProviderId;
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'error',
          completedAt: new Date().toISOString(),
          statusText: authProviderId ? 'The agent is logged out.' : 'The agent stopped with an error.',
          error: event.error,
          authProviderId,
          changedFiles: event.changedFiles ?? [],
        });
        updateThread(tracked.threadId, { status: 'error' });
        notifyThreadFinished(tracked.threadId, 'error');
        pushLinkedTaskStatus(tracked.threadId, 'error');
        runOutputMessages.current.delete(event.runId);
        clearActiveRun(event.runId);
      }
    });

    return () => {
      unsubscribe?.();
      flushChunkBuffers();
    };
  }, [
    addActivityToThreadMessage,
    addMessageToThread,
    appendToThreadMessage,
    appendToBtwExchange,
    clearActiveRun,
    flushChunkBuffers,
    notifyThreadFinished,
    pushLinkedTaskStatus,
    setThreadAgentSession,
    updateBtwExchange,
    updateThread,
    updateThreadMessage,
  ]);

  useEffect(() => {
    if (recoveredInterruptedRuns.current || threads.length === 0) return;
    recoveredInterruptedRuns.current = true;
    for (const thread of threads) {
      for (const exchange of thread.btwExchanges ?? []) {
        if (exchange.status === 'running') {
          updateBtwExchange(thread.id, exchange.id, {
            status: 'error',
            error: 'Interrupted before Orion received the answer.',
          });
        }
      }
      if (thread.status !== 'running') continue;
      const lastMessage = thread.messages.at(-1);
      if (lastMessage?.role === 'agent' && lastMessage.content.trim().length === 0) {
        appendToThreadMessage(
          thread.id,
          lastMessage.id,
          'The previous agent run was interrupted before Orion received output. Send the prompt again to start a fresh run.'
        );
      } else {
        addMessageToThread(thread.id, {
          role: 'system',
          content: 'The previous agent run was interrupted before Orion received completion.',
        });
      }
      updateThread(thread.id, { status: 'error' });
    }
  }, [addMessageToThread, appendToThreadMessage, threads, updateBtwExchange, updateThread]);

  // Sync workspace with first project if none set
  useEffect(() => {
    if (!workspacePath && projects.length > 0) {
      setWorkspacePath(projects[0].path);
    }
  }, [workspacePath, projects, setWorkspacePath]);

  // Add a project. Keep this stable because it crosses the memoized transcript
  // boundary and App also renders on every composer edit.
  const handleAddProject = useCallback(
    async (options?: { createInitialThread?: boolean; expectedGitRoot?: string }) => {
      if (!window.orion || repositoryOperationBusy) return;
      const dir = await window.orion.openDirectory();
      if (!dir) return;

      if (options?.expectedGitRoot) {
        const selectedRepository = await window.orion.getGitState(dir);
        const selectedRoot = selectedRepository.ok ? selectedRepository.root : undefined;
        if (
          !selectedRoot ||
          normalizeRepositoryPath(selectedRoot) !== normalizeRepositoryPath(options.expectedGitRoot)
        ) {
          toast.error('That folder belongs to a different repository', {
            description: `Select ${options.expectedGitRoot}`,
          });
          return;
        }
      }

      const name = await window.orion.basename(dir);
      const projectId = addProject({ name, path: dir });

      // Also set workspace to this project
      setWorkspacePath(dir);

      // Adding a project means the user wants to work in it now — drop them
      // straight into a fresh thread for it unless a caller needs to attach its
      // own thread metadata first.
      if (options?.createInitialThread !== false) createThread(projectId);
      setActiveTab('agents');
      return projectId;
    },
    [addProject, createThread, repositoryOperationBusy, setActiveTab, setWorkspacePath]
  );

  const handleSetActiveTab = (tab: 'agents' | 'code') => {
    // Open the directory the agents are actually editing: a rift workspace
    // when the current thread's epic has one, else the project.
    const codeRoot = activeWorkingDir;
    if (tab === 'code' && activeRiftUnavailable) {
      toast.error('Wait for the epic’s rift workspace to become available');
      return;
    }
    if (tab === 'code' && codeRoot && workspacePath !== codeRoot) {
      setWorkspacePath(codeRoot);
      closeAllFiles();
    }

    setActiveTab(tab);
  };

  const handleNewAgent = () => {
    const projectId = defaultNewThreadProject?.id ?? projects[0]?.id;
    if (!projectId) {
      void handleAddProject();
      return;
    }

    handleCreateThread(projectId);
  };

  const handleChangeSelectedThreadProject = useCallback(
    (projectId: string) => {
      if (repositoryOperationBusy) return;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;

      // Read the thread at call time instead of depending on the Thread
      // object: its identity churns with every shell-signature change, and a
      // churning callback would break ChatTranscript's memo boundary.
      const thread = useOrionStore.getState().threads.find((candidate) => candidate.id === selectedThreadId);
      if (!thread) {
        selectProject(projectId);
        setProjectPickerOpen(false);
        return;
      }

      const threadEpic = thread.epicId
        ? useOrionStore.getState().epics.find((epic) => epic.id === thread.epicId)
        : undefined;
      if (threadEpic?.riftPath || threadEpic?.riftRequest) {
        toast.error('Threads in a rift stay bound to the epic’s source project');
        setProjectPickerOpen(false);
        return;
      }
      if (thread.epicId && riftSetupEpicIdsRef.current[thread.epicId]) {
        toast.error('Wait for the epic’s rift setup to finish before changing projects');
        setProjectPickerOpen(false);
        return;
      }
      if (!canChangeSelectedThreadProject) {
        toast.error('Project can only be changed before the agent runs in this thread');
        setProjectPickerOpen(false);
        return;
      }

      updateThread(thread.id, { projectId });
      selectProject(projectId);
      setProjectPickerOpen(false);
    },
    [canChangeSelectedThreadProject, projects, repositoryOperationBusy, selectProject, selectedThreadId, updateThread]
  );

  const handleCheckoutBranch = async (branchName: string) => {
    if (!activeWorkingDir || !window.orion?.checkoutGitBranch || repositoryOperationBusy) return;
    if (gitState?.hasUncommittedChanges) {
      toast.error('Commit or discard local changes before checking out another branch');
      return;
    }

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeWorkingDir,
        branchName,
      });
      if (result.ok) {
        toast.success(`Checked out ${branchName}`);
        setBranchPickerOpen(false);
        await refreshGitState();
      } else {
        toast.error(result.error ?? `Could not check out ${branchName}`);
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCreateBranch = async (branchName: string) => {
    if (!activeWorkingDir || !window.orion?.checkoutGitBranch || repositoryOperationBusy) return;

    const normalized = branchName.trim();
    if (!normalized) return;

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeWorkingDir,
        branchName: normalized,
        create: true,
      });
      if (result.ok) {
        toast.success(`Created ${normalized}`);
        setBranchPickerOpen(false);
        await refreshGitState();
      } else {
        toast.error(result.error ?? `Could not create ${normalized}`);
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCommitAndPush = async () => {
    if (!activeWorkingDir || !window.orion?.commitAndPush || repositoryOperationBusy) return;

    setGitBusy(true);
    try {
      const result = await window.orion.commitAndPush({
        projectPath: activeWorkingDir,
        // Same message model the epic commit uses, so navbar commits get a
        // written message instead of "Update 5 files".
        ...resolveUtilityTurn(),
      });
      if (result.ok) {
        toast.success(`Committed and pushed ${result.branch ?? gitState?.currentBranch ?? 'branch'}`, {
          description: result.message?.split('\n')[0],
        });
        await refreshGitState();
      } else {
        toast.error(result.error ?? 'Commit and push failed');
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCloudPublish = async () => {
    if (!activeWorkingDir || !window.orion?.publishToCloud || repositoryOperationBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.publishToCloud({
        projectPath: activeWorkingDir,
      });
      if (result.ok && result.alreadyLinked) {
        toast.success(result.upToDate ? 'Orion Cloud is already up to date' : 'Pushed to Orion Cloud');
        await refreshCloudState();
      } else if (result.ok) {
        toast.success(`Published to Orion Cloud as ${result.repo?.name ?? 'repository'}`, {
          description: 'Press Deploy on Orion Cloud to host it as an app.',
          action: {
            label: 'Open',
            onClick: () => void window.orion?.openCloudRepoInBrowser?.(activeWorkingDir),
          },
        });
        await refreshCloudState();
      } else if (result.needsAuth) {
        toast.error(result.error ?? 'Sign in first.');
        setSettingsTab('account');
        setSettingsOpen(true);
      } else {
        toast.error(result.error ?? 'Publish failed');
      }
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudPush = async () => {
    if (!activeWorkingDir || !window.orion?.pushToCloud || repositoryOperationBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pushToCloud(activeWorkingDir);
      if (result.ok && result.upToDate) {
        toast.info('Orion Cloud is already up to date');
      } else if (result.ok) {
        toast.success(
          `Pushed ${result.pushed?.length === 1 ? result.pushed[0] : `${result.pushed?.length ?? 0} branches`} to Orion Cloud`,
          result.app?.url
            ? {
                description: `Redeploying ${new URL(result.app.url).host}`,
                action: {
                  label: 'Open app',
                  onClick: () => void window.orion?.openExternalUrl?.(result.app!.url),
                },
              }
            : undefined
        );
      } else {
        toast.error(result.error ?? 'Push to Orion Cloud failed');
      }
      if (result.skipped?.length) {
        toast.info(`Skipped ${result.skipped.map((item) => item.branch).join(', ')}: ${result.skipped[0].reason}`);
      }
      await refreshCloudState();
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudPull = async () => {
    if (!activeWorkingDir || !window.orion?.pullFromCloud || repositoryOperationBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pullFromCloud(activeWorkingDir);
      if (!result.ok) {
        toast.error(result.error ?? 'Pull from Orion Cloud failed');
      } else {
        const merge = result.merge;
        if (merge?.status === 'fast-forwarded' || merge?.status === 'checked-out') {
          toast.success('Pulled latest changes from Orion Cloud');
        } else if (merge?.status === 'up-to-date') {
          toast.info('Already up to date with Orion Cloud');
        } else if (merge?.status === 'diverged') {
          toast.info(merge.hint ?? 'Local and cloud history diverged — merge manually.');
        } else if (merge?.status === 'ff-failed' || merge?.status === 'unborn-dirty') {
          toast.info(merge.error ?? merge.hint ?? 'Fetched, but could not update your branch.');
        } else if (merge?.status === 'local-ahead') {
          toast.info('Fetched — your branch is ahead of Orion Cloud. Push when ready.');
        } else {
          toast.success('Fetched from Orion Cloud');
        }
      }
      await refreshGitState();
      await refreshCloudState();
    } finally {
      setCloudBusy(false);
    }
  };

  // Create new thread for a project
  const handleCreateThread = (projectId: string) => {
    setCollapsedProjects((prev) => (prev[projectId] ? { ...prev, [projectId]: false } : prev));
    // Prevent spamming empty threads: if selected thread for this project is empty and nothing typed, do nothing.
    // CLI threads are exempt — their conversation lives in the terminal PTY, so
    // messages.length is always 0 even when the thread is heavily used.
    if (
      selectedThread &&
      selectedThread.projectId === projectId &&
      selectedThread.modelId !== claudeCodeCliModelId &&
      selectedThread.messages.length === 0 &&
      !chatInput.trim() &&
      chatAttachments.length === 0
    ) {
      setActiveTab('agents');
      return selectedThread.id;
    }
    const id = createThread(projectId);
    setActiveTab('agents');
    return id;
  };

  // Unknown availability (null, still fetching) stays optimistic; the create
  // IPC reports a clear error if the binary is genuinely missing.
  const riftsAvailable = riftStatus?.available !== false;
  const riftsActive = riftsSettings.enabled && riftsAvailable;

  const persistAndAcknowledgeRift = useCallback(
    async (ownership: {
      epicId: string;
      projectId?: string;
      projectPath: string;
      riftPath: string;
      riftWorkingDir: string;
      gitRoot?: string;
      branch?: string;
    }) => {
      const state = useOrionStore.getState();
      const epic = state.epics.find((candidate) => candidate.id === ownership.epicId);
      if (!epic) {
        return { ok: false, error: 'The epic no longer exists.' };
      }
      // Bind the completed workspace to the project that requested it, not
      // the epic's mutable repository selection. The id survives canonical
      // path differences; the path fallback supports a removed/re-added
      // project after renderer recovery.
      const requestedProjectId = ownership.projectId ?? epic.riftRequest?.projectId;
      const project =
        state.projects.find((candidate) => candidate.id === requestedProjectId) ??
        state.projects.find((candidate) => candidate.path === ownership.projectPath) ??
        state.projects.find((candidate) => candidate.path === epic.riftRequest?.projectPath);
      if (!project) {
        return {
          ok: false,
          error: 'The project that requested this Rift is no longer available in Orion.',
        };
      }
      updateEpic(ownership.epicId, {
        riftPath: ownership.riftPath,
        riftWorkingDir: ownership.riftWorkingDir,
        riftRequest: undefined,
        // The epic has a workspace again, so it is no longer a freed one.
        riftReleased: undefined,
        ...(ownership.gitRoot ? { gitRoot: ownership.gitRoot } : {}),
        ...(ownership.branch ? { gitBranch: ownership.branch } : {}),
        repositoryProjectId: project.id,
      });
      for (const thread of useOrionStore.getState().threads) {
        if (thread.epicId === ownership.epicId && thread.projectId !== project.id) {
          updateThread(thread.id, { projectId: project.id });
        }
      }

      // Main verifies the saved store itself before releasing its ownership
      // journal and source-workspace lock.
      if (!(await flushOrionStoreSave())) {
        return { ok: false, error: 'Could not save Rift ownership.' };
      }
      return (
        (await window.orion?.epicAcknowledgeRift?.({
          epicId: ownership.epicId,
          riftPath: ownership.riftPath,
        })) ?? {
          ok: false,
          error: 'This Orion build cannot acknowledge Rift ownership.',
        }
      );
    },
    [updateEpic, updateThread]
  );

  useEffect(() => {
    const getRiftStatus = window.orion?.riftStatus;
    if (!getRiftStatus) return;
    let disposed = false;
    let refreshTimer: number | null = null;
    let recoveryRetryCount = 0;
    let releaseRecoveryRetryCount = 0;
    let pendingRemovalObserved = false;
    const recoveringEpicIds = new Set<string>();
    const refresh = async () => {
      let shouldRetryReadyRift = false;
      let shouldRetryReleasedRifts = false;
      try {
        const status = await getRiftStatus();
        if (disposed) return;
        setRiftStatus(status);
        const pending = Object.fromEntries(
          [...(status.pendingEpicIds ?? []), ...locallyStartedRiftEpicIdsRef.current].map((epicId) => [epicId, true])
        );
        // Main owns this lock across macOS window recreation. Mirror its
        // current state so the reopened UI also disables controls immediately
        // after hydration; launch IPCs enforce the same lock authoritatively.
        riftSetupEpicIdsRef.current = pending;
        setRiftSetupEpicIds(pending);
        for (const ownership of status.readyRifts ?? []) {
          if (recoveringEpicIds.has(ownership.epicId)) continue;
          recoveringEpicIds.add(ownership.epicId);
          let acknowledged = false;
          try {
            const acknowledgement = await persistAndAcknowledgeRift(ownership);
            acknowledged = acknowledgement.ok;
            if (acknowledgement.ok) {
              if (locallyStartedRiftEpicIdsRef.current.delete(ownership.epicId)) {
                const recoveredPending = Object.fromEntries(
                  [...(status.pendingEpicIds ?? []), ...locallyStartedRiftEpicIdsRef.current].map((epicId) => [
                    epicId,
                    true,
                  ])
                );
                riftSetupEpicIdsRef.current = recoveredPending;
                setRiftSetupEpicIds(recoveredPending);
              }
            }
          } finally {
            if (!acknowledged) shouldRetryReadyRift = true;
            recoveringEpicIds.delete(ownership.epicId);
          }
        }
        if (shouldRetryReadyRift) {
          recoveryRetryCount += 1;
        } else if ((status.readyRifts?.length ?? 0) > 0) {
          recoveryRetryCount = 0;
        }
        const hasMainPendingSetup = (status.pendingEpicIds?.length ?? 0) > 0;
        const hasMainPendingRemoval = (status.pendingRemovalEpicIds?.length ?? 0) > 0;
        pendingRemovalObserved = hasMainPendingRemoval;
        if (hasMainPendingRemoval && window.orion?.getRiftStorageState) {
          try {
            const storageState = await window.orion.getRiftStorageState();
            if (disposed) return;
            setRiftStorageState(storageState);
            if ((storageState.pendingReleases?.length ?? 0) > 0) {
              shouldRetryReleasedRifts = !(await finalizeReleasedRifts(storageState.pendingReleases ?? []));
            }
          } catch (error) {
            shouldRetryReleasedRifts = true;
            console.error('Could not reconcile released Rifts', error);
          }
        }
        if (shouldRetryReleasedRifts) {
          releaseRecoveryRetryCount += 1;
        } else if (hasMainPendingRemoval) {
          releaseRecoveryRetryCount = 0;
        }
        if (
          hasMainPendingSetup ||
          hasMainPendingRemoval ||
          locallyStartedRiftEpicIdsRef.current.size > 0 ||
          shouldRetryReadyRift
        ) {
          // Main-owned setup remains on the existing fast cadence. Failed
          // setup or release persistence backs off so a persistent storage
          // failure cannot create a hot IPC/save loop.
          const retryDelay = shouldRetryReleasedRifts
            ? Math.min(500 * 2 ** Math.min(releaseRecoveryRetryCount, 4), 5000)
            : hasMainPendingSetup
              ? 500
              : hasMainPendingRemoval
                ? 500
                : Math.min(500 * 2 ** Math.min(recoveryRetryCount, 4), 5000);
          refreshTimer = window.setTimeout(() => void refresh(), retryDelay);
        }
      } catch {
        if (
          !disposed &&
          (locallyStartedRiftEpicIdsRef.current.size > 0 || shouldRetryReadyRift || pendingRemovalObserved)
        ) {
          if (pendingRemovalObserved) {
            releaseRecoveryRetryCount += 1;
          } else {
            recoveryRetryCount += 1;
          }
          const retryDelay = Math.min(
            500 * 2 ** Math.min(pendingRemovalObserved ? releaseRecoveryRetryCount : recoveryRetryCount, 4),
            5000
          );
          refreshTimer = window.setTimeout(() => void refresh(), retryDelay);
        }
      }
    };
    void refresh();
    return () => {
      disposed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [finalizeReleasedRifts, persistAndAcknowledgeRift, riftRecoveryRefreshNonce]);

  const openCreateEpicModal = useCallback(() => {
    setNewEpicName('');
    setNewEpicDescription('');
    setNewEpicProjectId(
      (projects.find((project) => project.id === lastMessagedProjectId) ?? defaultNewThreadProject)?.id ?? null
    );
    setNewEpicCreateRift(riftsActive && riftsSettings.autoCreateForEpics);
    setEpicsSectionOpen(true);
    setCreateEpicOpen(true);
  }, [defaultNewThreadProject, lastMessagedProjectId, projects, riftsActive, riftsSettings.autoCreateForEpics]);

  const closeCreateEpicModal = useCallback(() => {
    setCreateEpicOpen(false);
    setNewEpicName('');
    setNewEpicDescription('');
    setNewEpicProjectId(null);
    setNewEpicRiftBaseBranch(null);
    setNewEpicRiftBranches(null);
    setCreateEpicProjectPickerOpen(false);
    setCreateEpicRiftBranchPickerOpen(false);
  }, []);

  // Local branches for the create-epic modal's rift base picker. Refetched
  // when the selected project changes; the selection resets to the current
  // branch (null) so a choice made for one project can't apply to another.
  useEffect(() => {
    setNewEpicRiftBaseBranch(null);
    setNewEpicRiftBranches(null);
    setCreateEpicRiftBranchPickerOpen(false);
    if (!createEpicOpen || !newEpicCreateRift || !riftsActive) return;
    const project = projects.find((candidate) => candidate.id === newEpicProjectId);
    if (!project || !window.orion?.getGitState) return;
    let cancelled = false;
    void window.orion
      .getGitState(project.path)
      .then((state) => {
        if (cancelled || !state.ok) return;
        setNewEpicRiftBranches({
          projectId: project.id,
          currentBranch: state.currentBranch ?? null,
          branches: state.branches.map((candidate) => candidate.name),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [createEpicOpen, newEpicCreateRift, newEpicProjectId, riftsActive, projects]);

  // Creates the epic's copy-on-write rift workspace and its feature branch
  // (named by the epic message model), then binds them to the epic. Runs in
  // the background after the create modal closes.
  const setupRiftForEpic = async (epicId: string) => {
    if (riftSetupEpicIdsRef.current[epicId]) return;
    const state = useOrionStore.getState();
    const epic = state.epics.find((candidate) => candidate.id === epicId);
    const request = epic?.riftRequest;
    if (!epic || !request || epic.riftPath) return;
    const project =
      state.projects.find(
        (candidate) => candidate.id === request.projectId && candidate.path === request.projectPath
      ) ?? state.projects.find((candidate) => candidate.path === request.projectPath);
    if (!project) {
      updateEpic(epicId, {
        riftRequest: {
          ...request,
          error: 'The project selected for this Rift is no longer available in Orion.',
        },
      });
      return;
    }
    if (!window.orion?.epicCreateRift) {
      updateEpic(epicId, {
        riftRequest: {
          ...request,
          error: 'This Orion build cannot create Rift workspaces.',
        },
      });
      return;
    }
    updateEpic(epicId, {
      repositoryProjectId: project.id,
      riftRequest: { ...request, error: undefined },
    });
    markRiftSetup(epicId, true);
    let keepSetupLocked = false;
    try {
      // The request must reach disk before main starts creating anything.
      // That way a renderer/app restart after a recoverable setup failure
      // still knows this epic must not fall back to the source checkout.
      if (!(await flushOrionStoreSave())) {
        updateEpic(epicId, {
          riftRequest: {
            ...request,
            error: 'Could not save the Rift request. Retry after Orion storage is available.',
          },
        });
        toast.error('Could not save the Rift request');
        return;
      }
      // A freed epic already owns a branch; recreating its workspace must land
      // back on that branch rather than opening a second one for the same work.
      const restoringBranch = epic.riftReleased && epic.gitBranch ? epic.gitBranch : null;
      const result = await window.orion.epicCreateRift({
        epicId,
        projectId: project.id,
        projectPath: project.path,
        epicName: epic.name,
        epicDescription: epic.description,
        ...resolveUtilityTurn(),
        ...(restoringBranch
          ? { existingBranch: restoringBranch }
          : request.baseBranch
            ? { baseBranch: request.baseBranch }
            : {}),
      });
      if (result.ok && result.riftPath) {
        // Keep the local launch lock if persistence throws as well as when it
        // returns { ok: false }; main retains the ready ownership journal for
        // the recovery poll in either case.
        keepSetupLocked = true;
        const acknowledgement = await persistAndAcknowledgeRift({
          epicId,
          projectId: project.id,
          projectPath: project.path,
          riftPath: result.riftPath,
          riftWorkingDir: result.riftWorkingDir ?? result.riftPath,
          gitRoot: result.gitRoot,
          branch: result.branch,
        });
        if (!acknowledgement.ok) {
          // The status effect may have gone idle before this local creation
          // began. Wake it only when recovery is needed, avoiding polling and
          // duplicate store saves during the normal successful setup path.
          setRiftRecoveryRefreshNonce((current) => current + 1);
          toast.error('Rift created, but its ownership could not be persisted', {
            description: acknowledgement.error,
          });
          return;
        }
        keepSetupLocked = false;
        toast.success(`Rift ready — working on ${result.branch}`, {
          description: result.riftPath,
        });
      } else {
        // Main normally removes a rift when post-create branch setup fails.
        // If even that cleanup failed, retain the incomplete path on the epic
        // so deletion can retry it after reload; never run threads there.
        if (result.riftPath) {
          updateEpic(epicId, {
            riftPath: result.riftPath,
            riftCleanupPending: true,
            repositoryProjectId: project.id,
            riftRequest: {
              ...request,
              error: result.error ?? 'Rift setup failed and its incomplete workspace needs cleanup.',
            },
          });
        } else {
          updateEpic(epicId, {
            riftRequest: {
              ...request,
              error: result.error ?? 'Rift setup failed. Try again after fixing the source repository.',
            },
          });
        }
        await flushOrionStoreSave();
        toast.error('Could not create a rift for this epic', {
          description: result.error ?? undefined,
        });
      }
    } catch (error) {
      if (keepSetupLocked) {
        setRiftRecoveryRefreshNonce((current) => current + 1);
      } else {
        updateEpic(epicId, {
          riftRequest: {
            ...request,
            error: error instanceof Error ? error.message : 'Rift setup failed.',
          },
        });
        await flushOrionStoreSave();
      }
      toast.error(
        keepSetupLocked
          ? 'Rift created, but its ownership could not be persisted'
          : 'Could not create a rift for this epic',
        {
          description: error instanceof Error ? error.message : undefined,
        }
      );
    } finally {
      if (!keepSetupLocked) markRiftSetup(epicId, false);
    }
  };

  const handleCreateEpic = () => {
    const trimmed = newEpicName.trim();
    if (!trimmed) return;
    const description = newEpicDescription.trim();
    const epicProject = projects.find((project) => project.id === newEpicProjectId) ?? null;
    const riftProject = epicProject;
    // Only a base differing from the current branch is recorded: the current
    // branch needs no checkout, and a list fetched for another project is
    // ignored rather than trusted.
    const riftBaseBranch =
      newEpicRiftBaseBranch &&
      riftProject &&
      newEpicRiftBranches?.projectId === riftProject.id &&
      newEpicRiftBaseBranch !== newEpicRiftBranches.currentBranch
        ? newEpicRiftBaseBranch
        : undefined;
    const riftRequest =
      newEpicCreateRift && riftsActive && riftProject
        ? {
            projectId: riftProject.id,
            projectPath: riftProject.path,
            ...(riftBaseBranch ? { baseBranch: riftBaseBranch } : {}),
          }
        : undefined;
    const epicId = addEpic(trimmed, {
      ...(description ? { description } : {}),
      ...(epicProject ? { repositoryProjectId: epicProject.id } : {}),
      ...(riftRequest ? { riftRequest } : {}),
    });
    closeCreateEpicModal();
    setActiveTab('agents');
    if (newEpicCreateRift && riftsActive) {
      if (riftProject) {
        void setupRiftForEpic(epicId);
      } else {
        toast.info('Pick a project to create a rift for this epic');
      }
    }
  };

  useEffect(() => {
    if (!createEpicOpen) return;
    const id = window.setTimeout(() => createEpicTitleRef.current?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Close an open dropdown first; only dismiss the modal when none are open.
      if (createEpicProjectPickerOpen) {
        setCreateEpicProjectPickerOpen(false);
        return;
      }
      if (createEpicRiftBranchPickerOpen) {
        setCreateEpicRiftBranchPickerOpen(false);
        return;
      }
      closeCreateEpicModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeCreateEpicModal, createEpicOpen, createEpicProjectPickerOpen, createEpicRiftBranchPickerOpen]);

  // Click-outside for create-epic Tailwind dropdowns.
  useEffect(() => {
    if (!createEpicProjectPickerOpen && !createEpicRiftBranchPickerOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (createEpicProjectPickerOpen && !createEpicProjectPickerRef.current?.contains(target)) {
        setCreateEpicProjectPickerOpen(false);
      }
      if (createEpicRiftBranchPickerOpen && !createEpicRiftBranchPickerRef.current?.contains(target)) {
        setCreateEpicRiftBranchPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [createEpicProjectPickerOpen, createEpicRiftBranchPickerOpen]);

  const handleCreateThreadForEpic = async (epic: Epic) => {
    const project = projectForEpic(epic);
    let projectId = project?.id;
    if (!project) {
      if (epic.gitRoot) {
        toast.info('Select the claimed repository to re-add it to Orion', {
          description: epic.gitRoot,
        });
      }
      projectId = await handleAddProject({
        createInitialThread: false,
        expectedGitRoot: epic.gitRoot,
      });
      if (!projectId) return;
    }
    setCollapsedEpics((prev) => (prev[epic.id] ? { ...prev, [epic.id]: false } : prev));
    // Same anti-spam rule as handleCreateThread: reuse an untouched draft
    // thread already under this epic.
    if (
      selectedThread &&
      selectedThread.epicId === epic.id &&
      selectedThread.projectId === projectId &&
      selectedThread.modelId !== claudeCodeCliModelId &&
      selectedThread.messages.length === 0 &&
      !chatInput.trim() &&
      chatAttachments.length === 0
    ) {
      setActiveTab('agents');
      return selectedThread.id;
    }
    const id = createThread(projectId, undefined, { epicId: epic.id });
    setActiveTab('agents');
    return id;
  };

  // Shared setup for the epic git handlers: the directory the epic's git
  // actions act on. The rift workspace wins when one exists; otherwise the
  // claimed gitRoot, then the picked project. projectPath stays optional so
  // each caller can word its own toast.
  //
  // Without a rift, the epic shares its repository with everything else, so
  // main must still refuse a drifted checkout or a branch another epic
  // claimed. A rift is exclusively this epic's workspace, so those claims
  // don't apply there.
  const resolveEpicGitTarget = (epic: Epic) => {
    const project = epic.repositoryProjectId
      ? (projects.find((candidate) => candidate.id === epic.repositoryProjectId) ?? null)
      : null;
    const isRift = Boolean(epic.riftPath && !epic.riftCleanupPending);
    return {
      project,
      projectPath: epic.riftCleanupPending ? undefined : (epic.riftPath ?? epic.gitRoot ?? project?.path),
      claim: isRift
        ? {
            isRift: true as const,
            expectedGitRoot: epic.riftPath,
            expectedBranch: epic.gitBranch,
          }
        : {
            isRift: false as const,
            expectedGitRoot: epic.gitRoot,
            expectedBranch: epic.gitBranch,
            claimedBranches: epics
              .filter(
                (candidate) =>
                  candidate.id !== epic.id && !candidate.riftPath && candidate.gitRoot && candidate.gitBranch
              )
              .map((candidate) => ({
                gitRoot: candidate.gitRoot!,
                branch: candidate.gitBranch!,
                epicName: candidate.name,
              })),
          },
    };
  };

  // Claimed non-rift epics lock by their canonical Git root rather than the
  // selected project folder, because multiple folders can share one checkout
  // and index. Before the first action returns that root, serialize unclaimed
  // non-rift epics under one conservative wildcard key, which also waits for
  // claimed shared-checkout work because the unknown root could be that same
  // checkout. Rifts use their private roots, so unrelated rift-backed epics can
  // still run concurrently.
  const epicGitWorkspaceKey = (epic: Epic) => {
    if (epic.riftPath && !epic.riftCleanupPending) {
      return `rift:${normalizeRepositoryPath(epic.riftPath)}`;
    }
    if (epic.gitRoot) {
      return `git:${normalizeRepositoryPath(epic.gitRoot)}`;
    }
    return resolveEpicGitTarget(epic).projectPath ? UNCLAIMED_EPIC_GIT_WORKSPACE_KEY : undefined;
  };

  // Click-time guard for one epic's git actions. Shell git/cloud work still
  // blocks them — it can touch the same checkout — as does an epic sharing this
  // one's workspace, but an unrelated epic's in-flight commit or PR does not.
  const epicOperationBusy = (epic: Epic) =>
    gitBusy || cloudBusy || epicGitWorkspaceBusy(epic.id, epicGitWorkspaceKey(epic), epicGitBusyRef.current);

  // A rift epic's gitRoot stays the source repository root (it associates the
  // epic with its project); the main process reports the rift itself as the
  // git root, which must not overwrite that binding.
  const claimEpicGitTarget = (epic: Epic, result: { gitRoot?: string; branch?: string }) => {
    if (!result.gitRoot || !result.branch) return;
    updateEpic(epic.id, {
      ...(epic.riftPath ? {} : { gitRoot: result.gitRoot }),
      gitBranch: result.branch,
    });
  };

  // Keeps the selected epic's git-button status fresh: fetched on selection
  // and after every epic git action (the epic's busy kind clearing re-runs the
  // effect), plus a light local-only poll while the view stays open so agent
  // work re-enables "Commit & push". The PR state lookup hits GitHub, so it
  // runs only on the initial fetch, not on every poll tick.
  const refreshEpicGitStatus = async (epic: Epic, options?: { includePr?: boolean }) => {
    if (!window.orion?.epicGitStatus) return;
    const { projectPath } = resolveEpicGitTarget(epic);
    if (!projectPath) return;
    try {
      const result = await window.orion.epicGitStatus({
        projectPath,
        ...(options?.includePr && epic.prUrl ? { prUrl: epic.prUrl } : {}),
      });
      return result.ok ? result : undefined;
    } catch {
      // Keep the last known status; the buttons fail open without one.
      return undefined;
    }
  };

  // Order every PR lookup when it starts. A later request immediately
  // supersedes an earlier one for the same epic, regardless of which network
  // response completes first.
  const epicPrLookupOrderRef = useRef(0);
  const latestEpicPrLookupOrderRef = useRef<Map<string, number>>(new Map());

  // Opening a PR on GitHub is the one moment Orion knows the user is looking at
  // it, so the next focus refreshes without waiting on any throttle. Only a
  // hint: a teammate can merge, or the user can merge from elsewhere entirely,
  // which is why the background interval remains what actually catches merges.
  // Lives outside the poll effect so it survives that effect restarting.
  const epicPrRefreshArmedRef = useRef(false);
  const openEpicPrUrl = useCallback((prUrl: string) => {
    epicPrRefreshArmedRef.current = true;
    void window.orion?.openExternalUrl?.(prUrl);
  }, []);
  const beginEpicPrLookup = (epicId: string, expectedPrUrl: string): EpicPrLookupRequest => {
    const order = ++epicPrLookupOrderRef.current;
    latestEpicPrLookupOrderRef.current.set(epicId, order);
    return {
      expectedPrUrl,
      order,
      startedAt: new Date().toISOString(),
    };
  };

  const persistEpicPrLookup = (epicId: string, state: 'OPEN' | 'CLOSED' | 'MERGED', request: EpicPrLookupRequest) => {
    const currentEpic = useOrionStore.getState().epics.find((epic) => epic.id === epicId);
    if (
      !currentEpic ||
      currentEpic.prUrl !== request.expectedPrUrl ||
      latestEpicPrLookupOrderRef.current.get(epicId) !== request.order
    ) {
      return;
    }
    // A tick that only confirms the state we already hold must not touch the
    // store: updateEpic allocates a new epics array, which re-renders all of
    // App and re-serializes the persisted blob. Steady-state polling is then
    // free, so the refresh interval can stay short. This makes prStateCheckedAt
    // mean "when this state became known" rather than "when we last polled" —
    // nothing reads it, and the former is the more useful of the two.
    if (currentEpic.prState === state) return;
    updateEpic(epicId, {
      prState: state,
      // Record the accepted request's start time rather than its completion
      // time, which could make an older slow request appear newer in storage.
      prStateCheckedAt: request.startedAt,
    });
  };

  const selectedEpicGitPollKey = selectedEpic
    ? JSON.stringify([
        selectedEpic.id,
        selectedEpic.prUrl ?? null,
        resolveEpicGitTarget(selectedEpic).projectPath ?? null,
      ])
    : null;
  const selectedEpicRemovalPending = selectedEpic ? Boolean(riftRemovalEpicIds[selectedEpic.id]) : false;
  // Only the selected epic's own git action pauses its status poll and names
  // the in-progress label; work running in an unrelated epic leaves this view
  // alone. The button guard also stands down for an epic sharing this one's
  // checkout, matching the click-time guard.
  const selectedEpicGitBusy = selectedEpic ? (epicGitBusy[selectedEpic.id]?.kind ?? null) : null;
  const selectedEpicOperationBusy =
    gitBusy ||
    cloudBusy ||
    (selectedEpic ? epicGitWorkspaceBusy(selectedEpic.id, epicGitWorkspaceKey(selectedEpic), epicGitBusy) : false);

  useEffect(() => {
    if (!selectedEpic || selectedEpicGitBusy || activeRiftUnavailable || selectedEpicRemovalPending) {
      return;
    }
    let cancelled = false;
    let refreshTimer: number | undefined;
    const run = async (includePr: boolean) => {
      const prLookup = includePr && selectedEpic.prUrl ? beginEpicPrLookup(selectedEpic.id, selectedEpic.prUrl) : null;
      const result = await refreshEpicGitStatus(selectedEpic, { includePr });
      if (cancelled) return;
      if (result) {
        setEpicGitStatuses((current) => ({
          ...current,
          [selectedEpic.id]: {
            hasChangesToCommit: Boolean(result.hasChangesToCommit),
            hasUnpushedCommits: Boolean(result.hasUnpushedCommits),
          },
        }));
        // Mirror into the store so the sidebar icon agrees with the badge.
        if (result.pr?.state && prLookup) {
          persistEpicPrLookup(selectedEpic.id, result.pr.state, prLookup);
        }
      }
      refreshTimer = window.setTimeout(() => void run(false), 5000);
    };
    void run(true);
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
    // refreshEpicGitStatus is recreated every render; depending on it would
    // refire the effect every render and defeat the refresh loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEpicGitPollKey, selectedEpicGitBusy, activeRiftUnavailable, selectedEpicRemovalPending]);

  // The sidebar and archive both colour epic icons by PR state, so include
  // settled epics as well as active ones. Merged PRs are immutable and need no
  // further network reads; excluding them keeps the archive cheap after its
  // initial migration from epics that predate persisted prState.
  const epicPrTargets = useMemo(() => {
    if (!epicsEnabled) return [];
    const projectPathsById = new Map(projects.map((project) => [project.id, project.path]));
    return epics.flatMap((epic) => {
      if (!epic.prUrl || epic.prState === 'MERGED') return [];
      const projectPath = epic.riftCleanupPending
        ? undefined
        : (epic.riftPath ??
          epic.gitRoot ??
          (epic.repositoryProjectId ? projectPathsById.get(epic.repositoryProjectId) : undefined));
      return [
        {
          epicId: epic.id,
          prUrl: epic.prUrl,
          ...(projectPath ? { projectPath } : {}),
        },
      ];
    });
  }, [epics, epicsEnabled, projects]);
  const epicPrTargetsRef = useRef(epicPrTargets);
  epicPrTargetsRef.current = epicPrTargets;
  const hasEpicPrTargets = epicPrTargets.length > 0;

  useEffect(() => {
    if (!hasEpicPrTargets || !window.orion?.epicPrStates) return;
    let cancelled = false;
    let inFlight = false;
    let pendingFocus = false;
    let timer: number | undefined;
    let lastLookupAt = 0;

    const run = async (reason: EpicPrRefreshReason = 'tick') => {
      if (cancelled) return;
      if (inFlight) {
        // A focus can be the return from a just-merged PR. Keep it pending so
        // the current batch cannot swallow the armed, immediate refresh.
        if (reason === 'focus') pendingFocus = true;
        return;
      }
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      // Do not wake up periodically while hidden. Focus catches up using its
      // own shorter throttle below.
      if (document.hidden) return;
      // Focus is the highest-signal moment — the user may have just merged in
      // the browser — and having opened this PR from Orion first is stronger
      // still, so that skips the throttle entirely.
      const armed = reason === 'focus' && epicPrRefreshArmedRef.current;
      const minElapsed = armed ? 0 : reason === 'focus' ? EPIC_PR_STATE_FOCUS_REFRESH_MS : EPIC_PR_STATE_REFRESH_MS;
      const elapsed = Date.now() - lastLookupAt;
      if (lastLookupAt > 0 && elapsed < minElapsed) {
        // Reschedule at the background cadence, never at the focus one: a focus
        // arriving just after a tick must not convert the loop into a 15s poll.
        timer = window.setTimeout(() => void run(), Math.max(0, EPIC_PR_STATE_REFRESH_MS - elapsed));
        return;
      }
      // Spend the arm only now that this refresh is definitely going ahead: a
      // focus that returned early above must leave it for the next one.
      if (armed) epicPrRefreshArmedRef.current = false;
      inFlight = true;
      lastLookupAt = Date.now();
      try {
        const requestedTargets = epicPrTargetsRef.current;
        const lookupRequests = new Map(
          requestedTargets.map((target) => [target.epicId, beginEpicPrLookup(target.epicId, target.prUrl)])
        );
        const result = await window.orion.epicPrStates({
          epics: requestedTargets,
        });
        if (cancelled) return;
        const knownById = new Map(useOrionStore.getState().epics.map((epic) => [epic.id, epic]));
        for (const entry of result.states ?? []) {
          if (!knownById.has(entry.epicId)) continue;
          const request = lookupRequests.get(entry.epicId);
          if (request) persistEpicPrLookup(entry.epicId, entry.state, request);
        }
      } catch {
        // Offline or gh unavailable: keep the persisted colours.
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      if (pendingFocus) {
        pendingFocus = false;
        void run('focus');
        return;
      }
      // Always reschedule off the latest run so a focus-triggered refresh
      // replaces the pending tick instead of stacking a second chain.
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), EPIC_PR_STATE_REFRESH_MS);
    };

    void run();
    const onFocus = () => void run('focus');
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
    // updateEpic is a stable store action; target changes are read from a ref
    // and do not restart the timer or duplicate a whole batch lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEpicPrTargets]);

  // Click-time recheck that no agent grouped under the epic — including
  // descendant subagent threads — is still running. The rendered disabled
  // state can lag a just-started run, and the sidebar Settle menu reuses the
  // same guard. The ref can lag until the next render while the output map is
  // updated synchronously, so merge both views (same as handleDeleteEpic).
  const epicHasRunningAgents = (epicId: string) => {
    const state = useOrionStore.getState();
    const runsByThread = new Map<string, string>(Object.entries(activeRunsByThreadRef.current));
    for (const [runId, tracked] of runOutputMessages.current) {
      runsByThread.set(tracked.threadId, runId);
    }
    const epicThreadIds = new Set(
      state.threads.filter((thread) => thread.epicId === epicId).map((thread) => thread.id)
    );
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      for (const thread of state.threads) {
        if (thread.parentThreadId && epicThreadIds.has(thread.parentThreadId) && !epicThreadIds.has(thread.id)) {
          epicThreadIds.add(thread.id);
          foundChild = true;
        }
      }
    }
    return state.threads.some(
      (thread) => epicThreadIds.has(thread.id) && (thread.status === 'running' || runsByThread.has(thread.id))
    );
  };

  const epicCommitBlocked = (epic: Epic) =>
    epicOperationBusy(epic) ||
    riftSetupEpicIdsRef.current[epic.id] ||
    riftRemovalEpicIdsRef.current.has(epic.id) ||
    epic.riftRequest ||
    epic.riftCleanupPending ||
    (!epic.riftPath && riftsSettings.enabled && riftStatus === null) ||
    !window.orion?.epicCommitAndPush;

  // "Commit & push" with the message prompt on: run the same click-time guards
  // the commit itself runs, then let the user write the message (or leave it
  // empty for the epic message model).
  const openEpicCommitDialog = (epic: Epic) => {
    if (epicCommitBlocked(epic)) return;
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before committing');
      return;
    }
    if (!resolveEpicGitTarget(epic).projectPath) {
      toast.error('Select a repository for this epic before committing');
      return;
    }
    setEpicCommitDialog({ epic, message: '' });
  };

  const handleEpicCommitAndPush = async (epic: Epic, message = '') => {
    if (epicCommitBlocked(epic) || !window.orion?.epicCommitAndPush) {
      return;
    }
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before committing');
      return;
    }
    const { project, projectPath, claim } = resolveEpicGitTarget(epic);
    if (!projectPath) {
      toast.error('Select a repository for this epic before committing');
      return;
    }

    let committed = false;
    markEpicGitBusy(epic.id, 'commit', epicGitWorkspaceKey(epic));
    try {
      const trimmedMessage = message.trim();
      const result = await window.orion.epicCommitAndPush({
        epicId: epic.id,
        projectPath,
        // A hand-written message needs no model turn.
        ...(trimmedMessage ? { modelId: null } : resolveUtilityTurn()),
        epicName: epic.name,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
        ...claim,
      });
      if (result.ok || result.committed) {
        claimEpicGitTarget(epic, result);
      }
      if (result.ok) {
        committed = true;
        toast.success(`Committed and pushed ${result.branch ?? 'branch'}`, {
          description: result.message?.split('\n')[0],
        });
        // Refresh only when the shell is showing the directory just committed
        // (the epic's rift, or its repository when it has none).
        if (projectPath === activeWorkingDir || (project && activeThreadProject?.id === project.id)) {
          await refreshGitState();
        }
      } else {
        toast.error(result.error ?? 'Commit and push failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Commit and push failed');
    } finally {
      markEpicGitBusy(epic.id, null);
    }

    // "Auto create PR on commit": a successful commit carries straight on into
    // the pull request, so the user can start the commit and navigate away.
    // Runs after the busy marker clears — the PR's own guards read it.
    if (committed) await runEpicAutoPr(epic.id);
  };

  // Follow-up PR for an epic whose auto-create-PR tick is on. Reads the epic
  // back from the store: the commit just claimed its repository and branch,
  // and the tick may have been toggled while the commit was in flight.
  const runEpicAutoPr = async (epicId: string) => {
    const epic = useOrionStore.getState().epics.find((candidate) => candidate.id === epicId);
    if (!epic?.autoPrAfterCommit) return;
    // Nothing to open: the push already updated this epic's existing pull
    // request. A closed one still gets a replacement, matching the button.
    if (epic.prUrl && epic.prState !== 'CLOSED') return;
    // Unattended by design, so the base-branch dialog is skipped even when
    // message prompts are on — the PR takes the promptless button's base.
    await createEpicPrWithoutPrompt(epic);
  };

  const epicCreatePrBlocked = (epic: Epic) =>
    epicOperationBusy(epic) ||
    riftSetupEpicIdsRef.current[epic.id] ||
    riftRemovalEpicIdsRef.current.has(epic.id) ||
    epic.riftRequest ||
    epic.riftCleanupPending ||
    (!epic.riftPath && riftsSettings.enabled && riftStatus === null) ||
    !window.orion?.epicCreatePr;

  // The epic's real repository checkout. A rift-backed epic works in a clone,
  // so its own projectPath is the rift; the branch a PR should merge back into
  // lives in the source repository the rift was made from.
  const resolveEpicSourceProjectPath = (epic: Epic) => {
    const project = epic.repositoryProjectId
      ? (projects.find((candidate) => candidate.id === epic.repositoryProjectId) ?? null)
      : null;
    return epic.gitRoot ?? project?.path;
  };

  // Step one of Create PR: fetch the branches on origin and work out which one
  // to merge into by default — the branch checked out in the epic's real
  // repository, whenever origin has a branch by that name — falling back to
  // the remote default branch.
  const resolveEpicPrBaseOptions = async (epic: Epic) => {
    if (!window.orion?.epicListRemoteBranches) return null;
    const { projectPath } = resolveEpicGitTarget(epic);
    if (!projectPath) return null;
    const result = await window.orion.epicListRemoteBranches({
      projectPath,
      ...(() => {
        const sourceProjectPath = resolveEpicSourceProjectPath(epic);
        return sourceProjectPath ? { sourceProjectPath } : {};
      })(),
    });
    if (!result.ok) {
      return { error: result.error ?? 'Could not list the branches on origin' };
    }
    // The PR's head branch cannot be its own base.
    const branches = (result.branches ?? []).filter((name) => name !== result.currentBranch);
    if (branches.length === 0) {
      return { error: 'No branches found on origin to use as the PR base' };
    }
    const defaultBranch = result.defaultBranch && branches.includes(result.defaultBranch) ? result.defaultBranch : '';
    const sourceBranch = result.sourceBranch && branches.includes(result.sourceBranch) ? result.sourceBranch : '';
    return {
      branches,
      defaultBranch,
      sourceBranch,
      baseBranch: sourceBranch || defaultBranch || branches[0],
    };
  };

  // Only touch the exact dialog invocation that started a load. The same epic
  // can be closed and reopened while an earlier request is still in flight.
  const patchEpicPrBaseDialog = (
    instanceId: number,
    patch: (current: NonNullable<typeof epicPrBaseDialog>) => Partial<NonNullable<typeof epicPrBaseDialog>>
  ) =>
    setEpicPrBaseDialog((current) =>
      current && current.instanceId === instanceId ? { ...current, ...patch(current) } : current
    );

  // The base branch as local git alone can answer it: no network, so it lands
  // in the just-opened dialog within milliseconds. Origin's list corrects it
  // moments later if it names a branch origin does not have.
  const preloadEpicPrLocalBase = async (epic: Epic, instanceId: number) => {
    if (!window.orion?.epicLocalPrBase) return;
    const { projectPath } = resolveEpicGitTarget(epic);
    if (!projectPath) return;
    const sourceProjectPath = resolveEpicSourceProjectPath(epic);
    try {
      const result = await window.orion.epicLocalPrBase({
        projectPath,
        ...(sourceProjectPath ? { sourceProjectPath } : {}),
      });
      if (!result.ok) return;
      // The PR's head branch cannot be its own base.
      const usable = (name?: string | null) => (name && name !== result.currentBranch ? name : '');
      const sourceBranch = usable(result.sourceBranch);
      const defaultBranch = usable(result.defaultBranch);
      patchEpicPrBaseDialog(instanceId, (current) =>
        // Origin already answered — its list is the authoritative one.
        current.branches.length > 0 || current.baseBranch
          ? {}
          : {
              sourceBranch,
              defaultBranch,
              baseBranch: sourceBranch || defaultBranch,
            }
      );
    } catch {
      // The picker still fills from origin.
    }
  };

  // Origin's branch list, for the picker of an already-open dialog.
  const loadEpicPrRemoteBranches = async (epic: Epic, instanceId: number) => {
    markEpicGitBusy(epic.id, 'pr-branches', epicGitWorkspaceKey(epic));
    try {
      const options = await resolveEpicPrBaseOptions(epic);
      if (!options) {
        patchEpicPrBaseDialog(instanceId, () => ({ branchesLoading: false }));
        return;
      }
      if ('error' in options) {
        patchEpicPrBaseDialog(instanceId, () => ({
          branchesLoading: false,
          branchesError: options.error,
        }));
        return;
      }
      patchEpicPrBaseDialog(instanceId, () => ({
        ...options,
        branchesLoading: false,
        branchesError: '',
      }));
    } catch (error) {
      patchEpicPrBaseDialog(instanceId, () => ({
        branchesLoading: false,
        branchesError: error instanceof Error ? error.message : 'Could not list the branches on origin',
      }));
    } finally {
      markEpicGitBusy(epic.id, null);
    }
  };

  // "Create PR" with the message prompt on. Listing origin's branches is a
  // network round trip, so the dialog opens first — with the base branch local
  // git already knows — and the picker fills itself while the user reads it.
  const openEpicPrBaseDialog = (epic: Epic) => {
    if (epicCreatePrBlocked(epic) || !window.orion?.epicListRemoteBranches) return;
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before opening a PR');
      return;
    }
    const { projectPath } = resolveEpicGitTarget(epic);
    if (!projectPath) {
      toast.error('Select a repository for this epic before opening a PR');
      return;
    }

    setEpicPrBaseBranchPickerOpen(false);
    const instanceId = ++epicPrBaseDialogInstanceRef.current;
    setEpicPrBaseDialog({
      instanceId,
      epic,
      branches: [],
      branchesLoading: true,
      branchesError: '',
      defaultBranch: '',
      sourceBranch: '',
      baseBranch: '',
      message: '',
    });
    void preloadEpicPrLocalBase(epic, instanceId);
    void loadEpicPrRemoteBranches(epic, instanceId);
  };

  // "Create PR" with the message prompt off: no dialog, and the PR targets the
  // branch checked out in the epic's real repository. If origin cannot be
  // reached, an empty base lets main fall back to the remote default branch.
  const createEpicPrWithoutPrompt = async (epic: Epic) => {
    if (epicCreatePrBlocked(epic)) return;
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before opening a PR');
      return;
    }
    const { projectPath } = resolveEpicGitTarget(epic);
    if (!projectPath) {
      toast.error('Select a repository for this epic before opening a PR');
      return;
    }

    let baseBranch = '';
    markEpicGitBusy(epic.id, 'pr-branches', epicGitWorkspaceKey(epic));
    try {
      const options = await resolveEpicPrBaseOptions(epic);
      if (options && !('error' in options)) baseBranch = options.baseBranch;
    } catch {
      // Fall through to the remote default branch.
    } finally {
      markEpicGitBusy(epic.id, null);
    }
    await handleEpicCreatePr(epic, baseBranch);
  };

  const handleEpicCreatePr = async (epic: Epic, baseBranch: string, message = '') => {
    if (epicCreatePrBlocked(epic)) {
      return;
    }
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before opening a PR');
      return;
    }
    const { projectPath, claim } = resolveEpicGitTarget(epic);
    if (!projectPath) {
      toast.error('Select a repository for this epic before opening a PR');
      return;
    }

    markEpicGitBusy(epic.id, 'pr', epicGitWorkspaceKey(epic));
    try {
      const trimmedMessage = message.trim();
      const result = await window.orion.epicCreatePr({
        epicId: epic.id,
        projectPath,
        // A hand-written title and description need no model turn.
        ...(trimmedMessage ? { modelId: null } : resolveUtilityTurn()),
        epicName: epic.name,
        baseBranch,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
        ...claim,
      });
      if (result.ok) {
        claimEpicGitTarget(epic, result);
        const url = result.url;
        if (url) {
          updateEpic(epic.id, {
            prUrl: url,
            prState: 'OPEN',
            prStateCheckedAt: new Date().toISOString(),
          });
        }
        toast.success(
          result.alreadyExists ? 'A pull request for this branch is already open' : 'Pull request opened',
          url
            ? {
                action: {
                  label: 'Open',
                  onClick: () => openEpicPrUrl(url),
                },
              }
            : undefined
        );
      } else {
        toast.error(result.error ?? 'Could not open a pull request');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open a pull request');
    } finally {
      markEpicGitBusy(epic.id, null);
    }
  };

  const handleRemoveThreadFromEpic = async (threadId: string) => {
    const state = useOrionStore.getState();
    const thread = state.threads.find((candidate) => candidate.id === threadId);
    const epic = thread?.epicId ? state.epics.find((candidate) => candidate.id === thread.epicId) : undefined;
    if (!thread || !epic) return;
    if (!epic.riftPath) {
      updateThread(thread.id, { epicId: undefined });
      return;
    }
    if (riftRemovalEpicIdsRef.current.has(epic.id)) return;

    const disposeAgentThread = window.orion?.disposeAgentThread;
    if (!disposeAgentThread) {
      toast.error('This Orion build cannot safely detach a thread from a live rift');
      return;
    }

    markRiftRemoval(epic.id, true);
    try {
      // Capture both renderer tracking views before changing membership. A
      // just-started run may only be present in runOutputMessages until React
      // publishes activeRunsByThreadRef.
      const runIds = new Set<string>();
      const activeRunId = activeRunsByThreadRef.current[thread.id];
      if (activeRunId) runIds.add(activeRunId);
      for (const [runId, tracked] of runOutputMessages.current) {
        if (tracked.threadId === thread.id) runIds.add(runId);
      }

      for (const runId of runIds) {
        const tracked = runOutputMessages.current.get(runId);
        runOutputMessages.current.delete(runId);
        clearActiveRun(runId);
        if (tracked) {
          updateThreadMessage(tracked.threadId, tracked.messageId, {
            status: 'stopped',
            completedAt: new Date().toISOString(),
            statusText: 'Stopped because the thread left its epic rift.',
          });
        }
      }
      flushChunkBuffers();

      if (window.orion?.stopAgentTurn) {
        await Promise.allSettled(
          [...runIds].map((runId) => window.orion!.stopAgentTurn(runId, { terminateBackground: true }))
        );
      }
      await disposeAgentThread(thread.id);

      if (thread.spawnId) {
        void window.orion?.reportSubagentResult?.({
          spawnId: thread.spawnId,
          ok: false,
          result: 'Subagent run was stopped because its thread left the epic rift.',
        });
      }
      updateThread(thread.id, {
        epicId: undefined,
        status: thread.status === 'running' ? 'idle' : thread.status,
        queuedMessages: [],
        spawnId: undefined,
        agentSessionIds: undefined,
        pendingForkProviders: undefined,
      });
    } catch (error) {
      toast.error('Could not safely detach this thread from its epic rift', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      markRiftRemoval(epic.id, false);
    }
  };

  // Confirms and deletes an epic. Its threads survive and normally lose their
  // epicId, so a rift-backed epic needs a fuller warning: the workspace those
  // threads were editing goes away with it.
  const deleteEpicRestoreRef = async (epic: Epic) => {
    // Ordinary Git-backed epics never create this ref. Do not make deleting
    // them depend on a repository that may since have moved or disappeared.
    if (!epic.riftPath && !epic.riftReleased) return true;
    const cleanup = window.orion?.epicDeleteRiftRestoreRef;
    if (!cleanup) {
      toast.warning('Could not clean up the epic’s saved Rift restore data');
      return true;
    }
    try {
      const projectPath = epic.repositoryProjectId
        ? useOrionStore.getState().projects.find((project) => project.id === epic.repositoryProjectId)?.path
        : undefined;
      const result = await cleanup({
        epicId: epic.id,
        ...(epic.gitRoot ? { gitRoot: epic.gitRoot } : {}),
        ...(projectPath ? { projectPath } : {}),
      });
      if (result.ok) {
        if (result.warning) {
          toast.warning('The epic’s saved Rift restore data could not be cleaned up', {
            description: result.warning,
          });
        }
        return true;
      }
      toast.warning('Could not clean up the epic’s saved Rift restore data', {
        description: result.error,
      });
    } catch (error) {
      toast.warning('Could not clean up the epic’s saved Rift restore data', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
    return true;
  };

  const handleDeleteEpic = async (epic: Epic) => {
    if (repositoryOperationBusy) {
      toast.error('Wait for the current repository operation to finish before deleting this epic');
      return;
    }
    if (riftSetupEpicIdsRef.current[epic.id]) {
      toast.error('Wait for this epic’s rift setup to finish before deleting it');
      return;
    }
    if (riftRemovalEpicIdsRef.current.has(epic.id)) return;

    // Re-read at click time so a rift that completed between render and the
    // click cannot be mistaken for a non-rift epic and orphaned.
    const state = useOrionStore.getState();
    const currentEpic = state.epics.find((candidate) => candidate.id === epic.id);
    if (!currentEpic) return;
    const epicThreads = state.threads.filter((thread) => thread.epicId === currentEpic.id);
    const originalEpicIndex = state.epics.findIndex((candidate) => candidate.id === currentEpic.id);
    const directThreadIds = new Set(epicThreads.map((thread) => thread.id));
    const restoreDeletedEpic = async () => {
      // Preserve unrelated state changes that may land during deletion while
      // restoring only this Epic, its direct thread memberships, and prior
      // selection. Main keeps the Rift/ref intact whenever rollback is used.
      useOrionStore.setState((latest) => {
        const nextEpics = latest.epics.some((candidate) => candidate.id === currentEpic.id)
          ? latest.epics
          : (() => {
              const restored = [...latest.epics];
              restored.splice(Math.min(Math.max(originalEpicIndex, 0), restored.length), 0, currentEpic);
              return restored;
            })();
        return {
          epics: nextEpics,
          threads: latest.threads.map((thread) =>
            directThreadIds.has(thread.id) && !thread.epicId ? { ...thread, epicId: currentEpic.id } : thread
          ),
          selectedEpicId:
            latest.selectedEpicId === null && state.selectedEpicId === currentEpic.id
              ? currentEpic.id
              : latest.selectedEpicId,
        };
      });
      const [storeSaved, threadsSaved] = await Promise.all([flushOrionStoreSave(), flushOrionThreadsSave()]);
      return storeSaved && threadsSaved;
    };
    if (!currentEpic.riftPath) {
      if (!confirm(`Delete epic "${currentEpic.name}"? Its threads are kept — they just leave this group.`)) {
        return;
      }
      if (!currentEpic.riftReleased) {
        deleteEpic(currentEpic.id);
        return;
      }
      // Reserve deletion before persistence/ref cleanup, which can touch slow
      // or unavailable storage. Repeated clicks and new launches stay blocked
      // for the whole asynchronous operation.
      markRiftRemoval(currentEpic.id, true);
      try {
        // The restore ref can be the only surviving copy of a force-freed,
        // never-pushed branch. First make the epic deletion durable so a crash
        // can only leak the ref, never resurrect an epic whose ref is gone.
        deleteEpic(currentEpic.id);
        if (!(await flushOrionStoreSave())) {
          await restoreDeletedEpic();
          toast.error('Could not save the epic deletion; its Rift restore data was kept');
          return;
        }
        if (!(await deleteEpicRestoreRef(currentEpic))) return;
      } finally {
        markRiftRemoval(currentEpic.id, false);
      }
      return;
    }

    const fallbackProject =
      state.projects.find((project) => project.id === currentEpic.repositoryProjectId)?.name ?? 'their project';
    if (
      !confirm(
        `Delete epic "${currentEpic.name}"?\n\n` +
          `Its rift workspace moves to Rift trash — commit and push anything you still need ` +
          `(recoverable with rift until \`rift gc\`).` +
          (epicThreads.length > 0
            ? `\n\n${epicThreads.length} thread${epicThreads.length === 1 ? '' : 's'} ` +
              `${epicThreads.length === 1 ? 'is' : 'are'} kept, but ` +
              `${epicThreads.length === 1 ? 'it goes' : 'they go'} back to ${fallbackProject} ` +
              `and ${epicThreads.length === 1 ? 'starts' : 'start'} a fresh agent session.`
            : '')
      )
    ) {
      return;
    }

    const removeRift = window.orion?.epicRemoveRift;
    if (!removeRift) {
      toast.error('This Orion build cannot safely remove a live epic rift');
      return;
    }

    // Take the synchronous renderer lock before any asynchronous cleanup or
    // teardown so repeated confirmed deletes cannot enter this flow together.
    markRiftRemoval(currentEpic.id, true);
    let removalThreadIds: string[] = [];
    try {
      // Include descendants as well as directly grouped threads. This safely
      // covers children created before epic inheritance was added.
      const runtimeThreadIds = new Set(epicThreads.map((thread) => thread.id));
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const thread of state.threads) {
          if (
            thread.parentThreadId &&
            runtimeThreadIds.has(thread.parentThreadId) &&
            !runtimeThreadIds.has(thread.id)
          ) {
            runtimeThreadIds.add(thread.id);
            foundChild = true;
          }
        }
      }
      const runtimeThreads = state.threads.filter((thread) => runtimeThreadIds.has(thread.id));
      removalThreadIds = [...runtimeThreadIds];
      // Some descendants predate epic inheritance and have no epicId of their
      // own. Guard the complete runtime set explicitly so those threads cannot
      // launch in the source checkout while their inherited Rift is removed.
      markRiftRemovalThreads(removalThreadIds, true);

      // The restore ref can be the only surviving copy of a force-freed,
      // never-pushed branch. Persist the Epic deletion before main is allowed
      // to drop that ref or move the Rift. A crash can now only leave an
      // orphaned, recoverable Rift/ref behind; it cannot resurrect an Epic
      // whose last commit copy has already been removed.
      // Keep the surviving threads attached while removal is pending. Every
      // renderer and main-process workspace guard keys off this epicId; clearing
      // it before the store flush/removal finishes would let a selected thread
      // remount in the source checkout with its old Rift session.
      deleteEpic(currentEpic.id, { retainThreadMembership: true });
      if (!(await flushOrionStoreSave())) {
        await restoreDeletedEpic();
        toast.error('Could not save the epic deletion; its Rift and restore data were kept');
        return;
      }

      // The ref can lag a just-started run until the next render, while the
      // output map is updated synchronously. Merge both views so every tracked
      // foreground or retained background run is stopped.
      const runsByThread = new Map<string, string>(Object.entries(activeRunsByThreadRef.current));
      for (const [runId, tracked] of runOutputMessages.current) {
        runsByThread.set(tracked.threadId, runId);
      }
      const runsToStop = runtimeThreads
        .map((thread) => {
          const runId = runsByThread.get(thread.id);
          return runId ? { threadId: thread.id, runId } : null;
        })
        .filter((entry): entry is { threadId: string; runId: string } => entry !== null);

      // Untrack before IPC so terminal events racing with teardown cannot mark
      // an intentionally stopped run as finished.
      for (const { threadId, runId } of runsToStop) {
        const tracked = runOutputMessages.current.get(runId);
        runOutputMessages.current.delete(runId);
        clearActiveRun(runId);
        if (tracked) {
          updateThreadMessage(tracked.threadId, tracked.messageId, {
            status: 'stopped',
            completedAt: new Date().toISOString(),
            statusText: 'Stopped because the epic rift was removed.',
          });
        } else {
          const thread = state.threads.find((candidate) => candidate.id === threadId);
          const lastRun = thread
            ? [...thread.messages].reverse().find((message) => message.kind === 'agent-run')
            : undefined;
          if (lastRun) {
            updateThreadMessage(threadId, lastRun.id, {
              completedAt: new Date().toISOString(),
              statusText: 'Stopped because the epic rift was removed.',
            });
          }
        }
      }
      flushChunkBuffers();

      const pendingSpawnIds: string[] = [];
      for (const thread of runtimeThreads) {
        const updates: Partial<Thread> = {};
        if (thread.status === 'running') updates.status = 'idle';
        if ((thread.queuedMessages?.length ?? 0) > 0) updates.queuedMessages = [];
        if (thread.spawnId) {
          updates.spawnId = undefined;
          pendingSpawnIds.push(thread.spawnId);
        }
        if (Object.keys(updates).length > 0) updateThread(thread.id, updates);
      }
      for (const spawnId of pendingSpawnIds) {
        void window.orion?.reportSubagentResult?.({
          spawnId,
          ok: false,
          result: 'Subagent run was stopped because its epic rift was removed.',
        });
      }

      const finalizeDeletedEpicThreads = async () => {
        for (const thread of runtimeThreads) {
          const latestThread = useOrionStore.getState().threads.find((candidate) => candidate.id === thread.id);
          updateThread(thread.id, {
            ...(latestThread?.epicId === currentEpic.id ? { epicId: undefined } : {}),
            agentSessionIds: undefined,
            pendingForkProviders: undefined,
          });
        }
        return flushOrionThreadsSave();
      };

      let removalResult;
      try {
        const projectPath = currentEpic.repositoryProjectId
          ? state.projects.find((project) => project.id === currentEpic.repositoryProjectId)?.path
          : undefined;
        removalResult = await removeRift({
          epicId: currentEpic.id,
          riftPath: currentEpic.riftPath,
          runtimeThreadIds: runtimeThreads.map((thread) => thread.id),
          ...(currentEpic.gitRoot ? { gitRoot: currentEpic.gitRoot } : {}),
          ...(projectPath ? { projectPath } : {}),
        });
      } catch (error) {
        // An IPC failure is ambiguous: main may have completed the move before
        // the response was lost. Keep the durable Epic deletion rather than
        // resurrecting metadata that could point at an absent Rift/ref. Since
        // the threads now leave the deleted Epic, also drop every session tied
        // to its old Rift before releasing the workspace guard.
        const threadsSaved = await finalizeDeletedEpicThreads();
        toast.error('The epic was deleted, but Orion could not confirm Rift cleanup', {
          description: [
            error instanceof Error ? error.message : undefined,
            !threadsSaved ? 'Thread cleanup is still being retried.' : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        });
        return;
      }
      if (!removalResult?.ok) {
        const rollbackSaved = await restoreDeletedEpic();
        toast.error('Could not remove the epic rift', {
          description: [
            removalResult?.error,
            !rollbackSaved ? 'The Epic could not be durably restored for retry.' : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        });
        return;
      }
      if (removalResult.warning) {
        toast.warning('The epic’s saved Rift restore data could not be cleaned up', {
          description: removalResult.warning,
        });
      }

      // These sessions were recorded with the removed rift as their working
      // directory. Detach and clear them only after removal succeeds; on failure
      // the epic and riftPath remain intact and deletion can be retried. Flush
      // before releasing the guard so a restart cannot revive an old Rift
      // session in the shared source checkout.
      if (!(await finalizeDeletedEpicThreads())) {
        toast.error('The Rift was removed, but thread cleanup is still being retried', {
          description: 'Orion will keep retrying the thread save in the background.',
        });
      }
    } finally {
      markRiftRemovalThreads(removalThreadIds, false);
      markRiftRemoval(currentEpic.id, false);
    }
  };

  const handleSettleEpic = async (epic: Epic) => {
    if (epicOperationBusy(epic)) return;
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before settling it');
      return;
    }

    // Git and PR state only shapes the warning. It never blocks settlement:
    // archiving an epic is a user choice, even when its work has not been
    // committed, pushed, or opened as a pull request.
    let status;
    const riftUnavailable =
      riftSetupEpicIdsRef.current[epic.id] ||
      riftRemovalEpicIdsRef.current.has(epic.id) ||
      epic.riftRequest ||
      epic.riftCleanupPending ||
      (!epic.riftPath && riftsSettings.enabled && riftStatus === null);
    if (!riftUnavailable) {
      markEpicGitBusy(epic.id, 'settle', epicGitWorkspaceKey(epic));
      const prLookup = epic.prUrl ? beginEpicPrLookup(epic.id, epic.prUrl) : null;
      try {
        status = await refreshEpicGitStatus(epic, { includePr: true });
      } finally {
        markEpicGitBusy(epic.id, null);
      }
      if (status?.pr?.state && prLookup) {
        persistEpicPrLookup(epic.id, status.pr.state, prLookup);
      }
    }

    if (status) {
      setEpicGitStatuses((current) => ({
        ...current,
        [epic.id]: {
          hasChangesToCommit: Boolean(status.hasChangesToCommit),
          hasUnpushedCommits: Boolean(status.hasUnpushedCommits),
        },
      }));
    }

    const warnings: string[] = [];
    if (status?.hasChangesToCommit) {
      warnings.push('This workspace has uncommitted changes. The epic will be archived without committing them.');
    }
    if (status?.hasUnpushedCommits) {
      warnings.push('This workspace has commits that have not been pushed. Settling will not publish them.');
    }
    if (!epic.prUrl) {
      warnings.push('This epic has no pull request. It will be archived without one.');
    } else if (status?.pr?.state === 'OPEN') {
      warnings.push(
        'Its pull request is still open. Settling only archives the epic in Orion; it will not merge or close the pull request.'
      );
    } else if (!status?.pr) {
      warnings.push(
        'Orion could not verify the pull request state. Settling will not merge or close the pull request.'
      );
    }
    if (!status) {
      warnings.push(
        'Orion could not inspect the workspace. Any work that has not been committed or pushed will remain unpublished.'
      );
    }

    // A run may have started while the status request was in flight.
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before settling it');
      return;
    }

    // Freeing the rift is only ever offered when Orion positively verified the
    // workspace has nothing left in it — settling warns about uncommitted and
    // unpushed work but never publishes it, so an unverified workspace must
    // not be swept. A missing status means the inspection itself failed.
    const canReleaseRift = Boolean(epic.riftPath && status && !status.hasChangesToCommit && !status.hasUnpushedCommits);
    const releaseRift = canReleaseRift && (riftsSettings.releaseOnSettle ?? defaultRiftsSettings.releaseOnSettle);

    const confirmSettle = epicsSettings?.confirmSettle ?? defaultEpicsSettings.confirmSettle;
    if (confirmSettle || warnings.length > 0) {
      setEpicSettleDialog({ epic, warnings, canReleaseRift, releaseRift });
      return;
    }
    settleEpic(epic.id);
    toast.success(`Settled ${epic.name}`);
    if (releaseRift && epic.riftPath) {
      void releaseRiftStorage([{ riftPath: epic.riftPath }], {
        queueIfBusy: true,
      });
    }
  };

  // Restoring an epic whose rift was freed rebuilds the workspace on the
  // branch it already owns. Keep it archived until recreation can actually
  // start so its threads cannot become active without an isolated workspace.
  const handleRestoreEpic = (epic: Epic) => {
    if (riftRemovalEpicIdsRef.current.has(epic.id) || riftStatus?.pendingRemovalEpicIds?.includes(epic.id)) {
      toast.info(`Wait for ${epic.name}’s rift cleanup to finish before restoring it`);
      return;
    }
    if (!epic.riftReleased) {
      unsettleEpic(epic.id);
      return;
    }
    if (!epic.gitBranch) {
      toast.error(`Could not restore ${epic.name} because its Rift branch is missing`);
      return;
    }
    if (!riftsActive) {
      toast.info(`Enable Rifts before restoring ${epic.name}`);
      return;
    }
    const project = epic.gitRoot
      ? projectForGitRoot(epic.gitRoot, epic.repositoryProjectId)
      : projects.find((candidate) => candidate.id === epic.repositoryProjectId);
    if (!project) {
      toast.error(`Could not restore ${epic.name} because its project is unavailable`);
      return;
    }
    updateEpic(epic.id, {
      riftRequest: { projectId: project.id, projectPath: project.path },
    });
    unsettleEpic(epic.id);
    toast.info(`Recreating the rift for ${epic.name} on ${epic.gitBranch}`);
    void setupRiftForEpic(epic.id);
  };

  // Frees rift directories and clears the pointers of whichever epics owned
  // them. Main re-checks every guard; the renderer only contributes the live
  // run information the persisted store cannot show.
  const releaseRiftStorage = (
    entries: Array<{ riftPath: string }>,
    {
      runGc = false,
      forcePaths = [],
      queueIfBusy = false,
    }: { runGc?: boolean; forcePaths?: string[]; queueIfBusy?: boolean } = {}
  ) => {
    if (!runGc && entries.length === 0) return Promise.resolve();
    // Storage controls are disabled during a sweep, but automatic cleanup can
    // be requested by settling another epic at any time. Preserve that intent
    // and run it after the active operation instead of silently dropping it.
    if (riftStorageQueueDepthRef.current > 0 && !queueIfBusy) return Promise.resolve();
    riftStorageQueueDepthRef.current += 1;
    setRiftStorageBusy(true);
    const request = riftStorageQueueRef.current
      .catch(() => {})
      .then(async () => {
        const markedEpicIds = new Set<string>();
        try {
          const state = useOrionStore.getState();
          const requestedPaths = new Set(entries.map((entry) => entry.riftPath));
          const requestedEpics = state.epics.filter((epic) => epic.riftPath && requestedPaths.has(epic.riftPath));
          // Register the renderer guard before the first await. Restore and
          // launch actions can otherwise cross the store flush while main is
          // about to act on the still-settled snapshot.
          for (const epic of requestedEpics) {
            markedEpicIds.add(epic.id);
            markRiftRemoval(epic.id, true);
          }
          // Main reads epic ownership and settled state from the persisted store,
          // so the store has to be on disk before it looks.
          if (!(await flushOrionStoreSave())) {
            toast.error('Rift cleanup could not start because Orion storage is unavailable');
            return;
          }
          const busyEpicIds = state.epics.filter((epic) => epicHasRunningAgents(epic.id)).map((epic) => epic.id);
          const runtimeThreadIdsByEpic = Object.fromEntries(
            requestedEpics.map((epic) => [
              epic.id,
              runtimeThreadsForEpic(state.threads, epic.id).map((thread) => thread.id),
            ])
          );
          const result = await window.orion?.releaseRiftStorage?.({
            riftPaths: entries.map((entry) => entry.riftPath),
            // Force approval belongs only to the manual confirmation that supplied
            // this list. Automatic release-on-settle calls omit it and must pass
            // main's fresh unpublished-work guard.
            forcePaths,
            busyEpicIds,
            runtimeThreadIdsByEpic,
            runGc,
          });
          if (!result) {
            toast.error('Rift storage cleanup is unavailable in this build');
            return;
          }
          setRiftStorageForced({});

          const freed = (result.results ?? []).filter((entry) => entry.ok);
          const skipped = (result.results ?? []).filter((entry) => !entry.ok);
          const ownedReleases = freed.flatMap((entry) =>
            typeof entry.epicId === 'string' && entry.epicId.length > 0
              ? [{ riftPath: entry.riftPath, epicId: entry.epicId }]
              : []
          );
          const releasePersisted = await finalizeReleasedRifts(ownedReleases, {
            disposeRuntimes: false,
          });
          if (freed.length > 0) {
            if (releasePersisted) {
              // The per-rift sizes count blocks a clone still shares with its source,
              // so report what free space actually moved rather than that estimate.
              const reclaimed =
                result.reclaimedBytes != null ? ` — reclaimed ${formatBytes(result.reclaimedBytes)}` : '';
              toast.success(`Freed ${freed.length} rift${freed.length === 1 ? '' : 's'}${reclaimed}`);
            } else {
              // Main retains the durable release journal and launch guard
              // until acknowledgement. The status poll may be idle after a
              // manual/release-on-settle sweep, so wake its backoff retry now.
              setRiftRecoveryRefreshNonce((current) => current + 1);
              toast.error('Rifts were freed, but Orion could not durably finish their cleanup');
            }
          } else if (runGc && !result.gcError) {
            const reclaimed = result.reclaimedBytes != null ? ` — reclaimed ${formatBytes(result.reclaimedBytes)}` : '';
            toast.success(`Emptied Rift trash${reclaimed}`);
          }
          for (const entry of skipped) {
            const label = RIFT_RELEASE_REASON_LABELS[entry.reason ?? ''] ?? entry.error ?? 'was skipped';
            toast.warning(`${entry.riftPath.split('/').pop()}: ${label}`);
          }
          if (result.gcError) toast.error(`Could not empty the rift trash: ${result.gcError}`);
        } catch (error) {
          toast.error(`Rift cleanup failed: ${(error as Error)?.message ?? String(error)}`);
        } finally {
          for (const epicId of markedEpicIds) markRiftRemoval(epicId, false);
        }
      })
      .finally(() => {
        riftStorageQueueDepthRef.current = Math.max(0, riftStorageQueueDepthRef.current - 1);
        if (riftStorageQueueDepthRef.current === 0) setRiftStorageBusy(false);
      });
    riftStorageQueueRef.current = request;
    return request;
  };

  const confirmEpicSettlement = (epic: Epic, releaseRift = false) => {
    setEpicSettleDialog(null);
    // The dialog can stay open while a new run starts, so the sole settlement
    // blocker gets one final click-time check.
    if (epicHasRunningAgents(epic.id)) {
      toast.error('Agents are still running in this epic — wait for them to finish before settling it');
      return;
    }
    const currentEpic = useOrionStore.getState().epics.find((candidate) => candidate.id === epic.id);
    if (!currentEpic || currentEpic.settledAt) return;
    settleEpic(epic.id);
    toast.success(`Settled ${currentEpic.name}`);
    // Main only frees a rift whose epic is already settled, and
    // releaseRiftStorage flushes the store first, so this ordering is what
    // makes the guard pass.
    if (releaseRift && currentEpic.riftPath) {
      void releaseRiftStorage([{ riftPath: currentEpic.riftPath }], {
        queueIfBusy: true,
      });
    }
  };

  const attachMediaFiles = useCallback(
    async (files: FileList | File[]) => {
      const mediaFiles = Array.from(files).filter(isMediaFile);
      if (mediaFiles.length === 0) return false;

      let targetThreadId = selectedThreadId;
      if (!targetThreadId) {
        const projectId = selectedProject?.id ?? projects[0]?.id;
        if (!projectId) {
          toast.error('Add a project before attaching files');
          return true;
        }
        targetThreadId = handleCreateThread(projectId);
      }

      if (activeTab !== 'agents') {
        setActiveTab('agents');
      }
      selectThread(targetThreadId);

      if (!window.orion?.saveImageAttachment) {
        toast.error('Attachments are unavailable');
        return true;
      }

      const savedAttachments: ImageAttachment[] = [];
      for (const file of mediaFiles) {
        const fallbackMimeType = isVideoFile(file) ? 'video/*' : 'image/*';
        const droppedPath = getDroppedFilePath(file);
        if (droppedPath) {
          savedAttachments.push({
            id: crypto.randomUUID(),
            name: file.name || droppedPath.split(/[\\/]/).pop() || 'file',
            path: droppedPath,
            mimeType: file.type || fallbackMimeType,
            size: file.size,
          });
          continue;
        }

        try {
          const result = await window.orion.saveImageAttachment({
            name: file.name || 'file',
            mimeType: file.type || fallbackMimeType,
            data: await file.arrayBuffer(),
          });

          if (result.ok && result.attachment) {
            savedAttachments.push(result.attachment);
          } else {
            toast.error(result.error ?? `Could not attach ${file.name || 'file'}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          toast.error(
            message.includes('No handler registered')
              ? 'Restart Orion to finish enabling attachments.'
              : message || `Could not attach ${file.name || 'file'}`
          );
        }
      }

      if (savedAttachments.length > 0) {
        setChatAttachments((current) => [...current, ...savedAttachments]);
      }

      return true;
    },
    [activeTab, handleCreateThread, projects, selectThread, selectedProject?.id, selectedThreadId, setActiveTab]
  );

  const handleRootDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingImages(true);
  }, []);

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleRootDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDraggingImages(false);
    }
  }, []);

  const handleRootDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDraggingImages(false);
      void attachMediaFiles(event.dataTransfer.files);
    },
    [attachMediaFiles]
  );

  const removeChatAttachment = (id: string) => {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  // Start a turn on any thread — not just the selected one — so queued
  // follow-ups can dispatch for threads running in the background. Linked-task
  // freshness is awaited first; transcript setup stays synchronous once that
  // snapshot is ready, and the CLI spawn result is handled in the continuation.
  const startTurnForThread = useCallback(
    async (
      threadId: string,
      promptText: string,
      attachments: ImageAttachment[]
    ): Promise<{ ok: boolean; error?: string }> => {
      if (pendingTurnStartsRef.current.has(threadId)) {
        return { ok: false, error: 'An agent turn is already starting' };
      }
      pendingTurnStartsRef.current.add(threadId);
      try {
        await refreshLinkedTasksBeforeDispatch(threadId);
      } finally {
        pendingTurnStartsRef.current.delete(threadId);
      }
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      if (thread.subagent) {
        return {
          ok: false,
          error: 'Subagent transcripts are read-only — steer from the parent thread.',
        };
      }
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      // The epic's rift is still being created: starting now would run the
      // turn in the source repository and record a session against it, which
      // the next turn — by then inside the rift — could not resume.
      if (thread.epicId && riftSetupEpicIdsRef.current[thread.epicId]) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is still being created — try again in a moment',
        };
      }
      const threadEpic = thread.epicId ? state.epics.find((epic) => epic.id === thread.epicId) : undefined;
      if (threadEpic?.riftRequest) {
        return {
          ok: false,
          error: threadEpic.riftRequest.error
            ? 'This epic’s rift setup needs to be retried before work can continue'
            : 'This epic’s rift workspace is still being created — try again in a moment',
        };
      }
      if (threadEpic?.riftCleanupPending) {
        return {
          ok: false,
          error: 'This epic has an incomplete rift that must be removed before work can continue',
        };
      }
      if (
        riftRemovalThreadIdsRef.current.has(thread.id) ||
        (thread.epicId && riftRemovalEpicIdsRef.current.has(thread.epicId))
      ) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is being removed',
        };
      }
      const workingDir = threadWorkingDir(state.epics, thread, project);
      if (!workingDir) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      let model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };

      // Orion pseudo-model: resolve the configured main driver EARLY and
      // replace `model` with it, so every downstream use (enabled/available
      // checks, session ids, reasoning params, provider options) applies to
      // the real provider. thread.modelId stays 'orion:orchestrator'.
      let orchestration:
        | {
            isOrchestrator: boolean;
            roles: Array<{
              role: string;
              roleLabel: string;
              modelId: string;
              providerId: string;
              slug: string;
              modelLabel: string;
            }>;
            generalInstructions: string;
          }
        | undefined;
      if (model.providerId === 'orion' || isOrionModelId(thread.modelId)) {
        const roleModels = {
          ...defaultOrchestrationSettings.models,
          ...state.orchestrationSettings?.models,
        };
        const generalInstructions =
          state.orchestrationSettings?.generalInstructions ?? defaultOrchestrationSettings.generalInstructions;
        let driverModel = agentModels.find((candidate) => candidate.id === roleModels.mainDriver);
        if (!driverModel || driverModel.providerId === 'orion' || driverModel.id === claudeCodeCliModelId) {
          // Misconfigured/pseudo driver: fall back to a real agent model.
          driverModel =
            agentModels.find((candidate) => candidate.id === defaultAgentModelId) ??
            agentModels.find((candidate) => candidate.providerId !== 'orion' && candidate.id !== claudeCodeCliModelId);
        }
        if (!driverModel || driverModel.providerId === 'orion' || driverModel.id === claudeCodeCliModelId) {
          return {
            ok: false,
            error: 'Pick a main driver model in Settings → Orchestration',
          };
        }
        const roles = orchestrationRoleMeta.map((meta) => {
          const configuredRoleModel = agentModels.find((candidate) => candidate.id === roleModels[meta.id]);
          const roleModel =
            meta.id === 'mainDriver' ||
            !configuredRoleModel ||
            configuredRoleModel.providerId === 'orion' ||
            configuredRoleModel.id === claudeCodeCliModelId
              ? driverModel
              : configuredRoleModel;
          return {
            role: meta.id,
            roleLabel: meta.label,
            modelId: roleModel.id,
            providerId: roleModel.providerId,
            slug: roleModel.slug,
            modelLabel: roleModel.label,
          };
        });
        orchestration = { isOrchestrator: true, roles, generalInstructions };
        model = driverModel;
      }

      if (normalizedProviderSettings[model.providerId]?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return {
          ok: false,
          error: model.unavailableReason ?? `${model.label} is unavailable`,
        };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      // First turn carrying linked board tasks: the tasks themselves are the
      // prompt, so an empty draft is fine — their titles and descriptions
      // become the agent context (later turns resume the same session, so the
      // agent already has them). The chips move onto this turn's user message.
      const tasksToInject = (thread.linkedTasks ?? []).filter((task) => !task.injected);
      if (!promptText && attachments.length === 0 && tasksToInject.length === 0) {
        return { ok: false, error: 'Type a message first' };
      }

      const taskMediaAttachments = linkedTaskMediaAttachments(tasksToInject);
      const turnAttachments = [...taskMediaAttachments, ...attachments];
      const userContent = promptText || (attachments.length > 0 ? 'Attached image' : '');
      let agentPrompt = buildPromptWithAttachments(promptText, attachments);
      if (tasksToInject.length > 0) {
        agentPrompt = agentPrompt
          ? `${buildLinkedTaskContext(tasksToInject, true)}\n\n${agentPrompt}`
          : buildLinkedTaskContext(tasksToInject, false);
        const injectedIds = new Set(tasksToInject.map((task) => task.id));
        updateThread(threadId, {
          linkedTasks: (thread.linkedTasks ?? []).map((task) =>
            injectedIds.has(task.id) ? { ...task, injected: true } : task
          ),
        });
      }
      // @-model mentions in the user's original text: tell the agent which
      // models were referenced so it can delegate to them. Works on any
      // thread, not just Orion ones.
      const mentionedModels = promptText ? parseModelMentions(promptText, agentModels) : [];
      if (mentionedModels.length > 0) {
        const mentionsContext = buildModelMentionsContext(mentionedModels);
        agentPrompt = agentPrompt ? `${mentionsContext}\n\n${agentPrompt}` : mentionsContext;
      }
      if (orchestration) {
        // Prepended last so it sits before the linked-task context when both apply.
        const orchestrationContext = buildOrchestrationContext(
          orchestration.roles,
          orchestration.generalInstructions,
          thread.accessMode ?? 'full-access'
        );
        agentPrompt = agentPrompt ? `${orchestrationContext}\n\n${agentPrompt}` : orchestrationContext;
      }

      // Auto-generate a relevant thread title from the first user message (like Codex / T3 Code)
      if (thread.messages.length === 0 && isDefaultTitle(thread.title)) {
        const titleSeed = userContent || tasksToInject[0]?.title || '';
        const initialTitle = deriveTitle(titleSeed);
        if (isPlausibleTitle(initialTitle)) {
          updateThread(threadId, { title: initialTitle });
        }
        // Kick off async LLM refinement for a nicer title. The thread's own
        // model may be a slow reasoning one (or Orion, which can't run a
        // one-shot), so this goes through the text-generation model instead.
        void tryGenerateBetterTitle(threadId, titleSeed, resolveUtilityTurn(), workingDir, updateThread, thread.epicId);
      }

      pinThreadToBottom(threadId);
      addMessageToThread(threadId, {
        role: 'user',
        content: userContent,
        attachments: turnAttachments,
        ...(tasksToInject.length > 0
          ? {
              linkedTasks: tasksToInject.map((task) => ({
                id: task.id,
                title: task.title,
                description: task.description,
              })),
            }
          : {}),
      });
      updateThread(threadId, { status: 'running' });
      pushLinkedTaskStatus(threadId, 'running');

      const messageId = addMessageToThread(threadId, {
        role: 'agent',
        content: '',
        kind: 'agent-run',
        status: 'running',
        statusText: "I'm working on this now.",
        startedAt: new Date().toISOString(),
        activities: [],
      });
      const runId = crypto.randomUUID();
      runOutputMessages.current.set(runId, { threadId, messageId });
      setActiveRunsByThread((current) => ({ ...current, [threadId]: runId }));

      const startup = trackRunStartup(
        runId,
        window.orion.runAgentTurn({
          runId,
          threadId,
          epicId: thread.epicId,
          projectPath: workingDir,
          prompt: agentPrompt,
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.[model.providerId],
          // Branched thread's first turn per provider: fork the inherited
          // session instead of resuming the parent's in place.
          forkSession: Boolean(
            thread.agentSessionIds?.[model.providerId] && thread.pendingForkProviders?.includes(model.providerId)
          ),
          providerOptions: normalizedProviderSettings[model.providerId]?.options,
          // Kimi's ACP adapter accepts native image content blocks. Preserve
          // the text/path context as a fallback, but also pass the attachment
          // metadata so main can read the bytes without routing them through
          // the renderer or relying on Kimi to reproduce a Unicode file path.
          ...(model.providerId === 'kimi' && turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
          ...(model.providerId === 'codex'
            ? {
                codexReasoningEffort: getEffectiveCodexReasoningEffort(model, thread.codexReasoningEffort),
                codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
              }
            : {}),
          ...(model.providerId === 'claude'
            ? {
                claudeReasoningEffort: thread.claudeReasoningEffort ?? getDefaultClaudeReasoningEffort(model),
                claudeContextWindow: getEffectiveClaudeContextWindow(
                  model,
                  thread.claudeContextWindow ?? defaultClaudeContextWindow
                ),
              }
            : {}),
          ...(model.providerId === 'grok'
            ? {
                grokReasoningEffort: thread.grokReasoningEffort ?? defaultGrokReasoningEffort,
              }
            : {}),
          ...(mentionedModels.length > 0 ? { mentions: mentionedModels } : {}),
          ...(orchestration ? { orchestration } : {}),
        })
      );
      void startup.then((result) => {
        if (result.ok && result.runId) {
          if (result.runId !== runId) {
            runOutputMessages.current.delete(runId);
            runOutputMessages.current.set(result.runId, {
              threadId,
              messageId,
            });
            setActiveRunsByThread((current) =>
              current[threadId] === runId ? { ...current, [threadId]: result.runId! } : current
            );
          }
        } else {
          runOutputMessages.current.delete(runId);
          clearActiveRun(runId);
          appendToThreadMessage(threadId, messageId, result.error ?? 'The agent failed to start.');
          updateThreadMessage(threadId, messageId, {
            status: 'error',
            completedAt: new Date().toISOString(),
            statusText: 'The agent failed to start.',
            error: result.error,
          });
          updateThread(threadId, { status: 'error' });
        }
      });

      return { ok: true };
    },
    [
      agentModels,
      normalizedProviderSettings,
      addMessageToThread,
      appendToThreadMessage,
      updateThread,
      updateThreadMessage,
      clearActiveRun,
      pushLinkedTaskStatus,
      trackRunStartup,
      refreshLinkedTasksBeforeDispatch,
    ]
  );

  useEffect(() => {
    startTurnForThreadRef.current = startTurnForThread;
  }, [startTurnForThread]);

  // Orchestrator spawn_subagent requests from main: create a hidden child
  // thread in the driver's project, run the prompt on the requested model,
  // and report the final output back (which unblocks the driver's MCP tool
  // call). Mounts once; live state comes from the store and refs.
  useEffect(() => {
    if (!window.orion?.onSubagentSpawnRequest) return undefined;
    const unsubscribe = window.orion.onSubagentSpawnRequest((request) => {
      const report = (ok: boolean, result: string) => {
        void window.orion?.reportSubagentResult?.({
          spawnId: request.spawnId,
          ok,
          result,
        });
      };
      const state = useOrionStore.getState();
      const driverThread = state.threads.find((t) => t.id === request.threadId);
      if (!driverThread) {
        report(false, 'Driver thread not found');
        return;
      }
      const driverEpic = driverThread.epicId ? state.epics.find((epic) => epic.id === driverThread.epicId) : undefined;
      if (
        riftRemovalThreadIdsRef.current.has(driverThread.id) ||
        (driverThread.epicId &&
          (riftSetupEpicIdsRef.current[driverThread.epicId] || riftRemovalEpicIdsRef.current.has(driverThread.epicId)))
      ) {
        report(false, 'The driver epic’s rift workspace is not available');
        return;
      }
      if (driverEpic?.riftRequest) {
        report(false, 'The driver epic’s rift setup must finish before spawning subagents');
        return;
      }
      if (driverEpic?.riftCleanupPending || driverEpic?.riftReleased) {
        report(false, 'The driver epic’s rift workspace is not available');
        return;
      }
      const projectId = driverThread.projectId;
      if (!state.projects.some((project) => project.id === projectId)) {
        report(false, 'Driver project not found');
        return;
      }

      // Resolve the model fuzzily: exact id → exact slug → exact label →
      // includes on slug/label.
      const models = agentModelsRef.current;
      const wanted = request.model.trim();
      const wantedLower = wanted.toLowerCase();
      const model =
        models.find((m) => m.id === wanted) ??
        models.find((m) => m.slug.toLowerCase() === wantedLower) ??
        models.find((m) => m.label.toLowerCase() === wantedLower) ??
        models.find((m) => m.slug.toLowerCase().includes(wantedLower) || m.label.toLowerCase().includes(wantedLower));
      if (!model) {
        const available = models
          .filter((m) => m.providerId !== 'orion')
          .slice(0, 10)
          .map((m) => m.slug)
          .join(', ');
        report(false, `Unknown model "${request.model}". Available: ${available}`);
        return;
      }
      if (model.providerId === 'orion' || model.id === claudeCodeCliModelId) {
        report(
          false,
          model.providerId === 'orion'
            ? 'Cannot spawn a subagent on the Orion orchestrator itself'
            : 'Claude Code CLI is an interactive terminal and cannot run as a subagent'
        );
        return;
      }

      const promptSlice = request.prompt.trim().slice(0, 44);
      const roleMeta = orchestrationRoleMeta.find((meta) => meta.id === request.role);
      const title =
        request.title || (roleMeta ? `${roleMeta.label}: ${promptSlice}` : `${model.label}: ${promptSlice}`);

      // Background spawn: never touch the user's selection (thread, project,
      // or epic view) — restoring it after the fact loses the epic overview,
      // which no selection field of a thread spawn round-trips.
      const childThreadId = state.createThread(projectId, title, {
        parentThreadId: request.threadId,
        modelId: model.id,
        hiddenFromRecent: true,
        epicId: driverThread.epicId,
        select: false,
        // Persisted on the thread so stop/delete/reload can still resolve the
        // driver's blocked spawn_subagent call.
        spawnId: request.spawnId,
        // Deterministic: subagents run with the driver's access mode, never
        // whatever an unrelated project thread last used.
        accessMode: request.accessMode ?? driverThread.accessMode,
      });

      // The spawnId was persisted at creation so the completion watcher can't
      // miss a fast run. Async start failures set the thread status to
      // 'error', which the watcher reports.
      const start = startTurnForThreadRef.current?.(childThreadId, request.prompt, []);
      if (!start) {
        state.updateThread(childThreadId, { spawnId: undefined });
        report(false, 'The subagent turn could not start');
        return;
      }
      void start.then(
        (result) => {
          if (result.ok) return;
          state.updateThread(childThreadId, { spawnId: undefined });
          report(false, result.error ?? 'The subagent turn could not start');
        },
        (error) => {
          state.updateThread(childThreadId, { spawnId: undefined });
          report(false, error instanceof Error ? error.message : 'The subagent turn could not start');
        }
      );
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // A run id can outlive its runOutputMessages entry: a Claude turn that
  // finishes while background agents are still live is untracked by the done
  // handler but keeps its run id in activeRunsByThread as a cancellable
  // handle. Stopping such a run finds no tracked message to mark, so without
  // this the thread's last agent-run bubble would say "Waiting on N
  // background agents…" forever after the runtime is disposed.
  const markUntrackedRunStopped = useCallback(
    (threadId: string, statusText: string) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const lastRun = thread
        ? [...thread.messages].reverse().find((message) => message.kind === 'agent-run')
        : undefined;
      if (!lastRun) return;
      updateThreadMessage(threadId, lastRun.id, {
        statusText,
        completedAt: new Date().toISOString(),
      });
    },
    [updateThreadMessage]
  );

  // Orchestrator stop_subagent requests from main: match the target among the
  // driver's running child threads (by model and/or title, or the single
  // running one when neither is given), halt its runtime like the user's stop
  // button would, resolve its pending spawn_subagent call, and report what
  // was stopped back to the driver's blocked stop_subagent call.
  const stopSubagentsForRequest = useCallback(
    async (request: { stopId: string; threadId: string; model?: string; title?: string; all?: boolean }) => {
      const report = (ok: boolean, result: string) => {
        void window.orion?.reportSubagentStopResult?.({
          stopId: request.stopId,
          ok,
          result,
        });
      };
      const state = useOrionStore.getState();
      // activeRunsByThreadRef only catches up in an effect after the next
      // render, so a stop arriving right after a spawn would miss the child's
      // just-registered run there and falsely report success without ever
      // terminating the provider process. runOutputMessages is maintained
      // synchronously through registration, runId swaps, and completion, so
      // its entries win over the ref.
      const runsByThread = new Map<string, string>(Object.entries(activeRunsByThreadRef.current));
      for (const [runId, tracked] of runOutputMessages.current) {
        runsByThread.set(tracked.threadId, runId);
      }
      const models = agentModelsRef.current;
      const describe = (thread: Thread) => {
        const model = models.find((m) => m.id === thread.modelId);
        return `"${thread.title}" (${model?.slug ?? thread.modelId})`;
      };

      // Native subagent mirrors have no independent runtime to stop; the provider CLI owns that subagent.
      const running = state.threads.filter(
        (thread) =>
          thread.parentThreadId === request.threadId &&
          !thread.subagent &&
          (thread.status === 'running' || runsByThread.has(thread.id))
      );
      if (running.length === 0) {
        report(false, 'This agent has no running subagents.');
        return;
      }

      const wantedModel = request.model?.trim().toLowerCase();
      const wantedTitle = request.title?.trim().toLowerCase();
      let targets = running;
      if (wantedModel) {
        targets = targets.filter((thread) => {
          const model = models.find((m) => m.id === thread.modelId);
          return [thread.modelId, model?.slug, model?.label]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(wantedModel));
        });
      }
      if (wantedTitle) {
        targets = targets.filter((thread) => thread.title.toLowerCase().includes(wantedTitle));
      }
      if (targets.length === 0) {
        report(false, `No running subagent matches. Running subagents: ${running.map(describe).join(', ')}.`);
        return;
      }
      // A broad selector (or none) must not take down parallel siblings by
      // accident: multiple matches only proceed when the caller explicitly
      // asked for every match.
      if (targets.length > 1 && !request.all) {
        report(
          false,
          `Matched ${targets.length} running subagents — pass a more specific model/title, or all=true to stop every match: ${targets.map(describe).join(', ')}.`
        );
        return;
      }

      // Each target's own spawned children have independent runtimes, so walk
      // the full subtree — same as the user's stop button.
      const threadIds = new Set(targets.map((thread) => thread.id));
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const candidate of state.threads) {
          if (candidate.parentThreadId && threadIds.has(candidate.parentThreadId) && !threadIds.has(candidate.id)) {
            threadIds.add(candidate.id);
            foundChild = true;
          }
        }
      }

      const stoppedThreads = state.threads.filter((candidate) => threadIds.has(candidate.id));
      const runsToStop: Array<{ threadId: string; runId: string }> = [];
      for (const candidate of stoppedThreads) {
        const runId = runsByThread.get(candidate.id);
        if (runId) runsToStop.push({ threadId: candidate.id, runId });
      }
      const pendingSpawnIds: string[] = [];

      // Untrack and mark every run in the subtree stopped BEFORE the IPC
      // calls: interrupted result events can otherwise race in and mark them
      // Finished.
      for (const { threadId: runThreadId, runId } of runsToStop) {
        const tracked = runOutputMessages.current.get(runId);
        runOutputMessages.current.delete(runId);
        clearActiveRun(runId);
        if (tracked) {
          appendToThreadMessage(tracked.threadId, tracked.messageId, '\n\nStopped by the orchestrator.');
          updateThreadMessage(tracked.threadId, tracked.messageId, {
            status: 'stopped',
            completedAt: new Date().toISOString(),
            statusText: 'Stopped by the orchestrator.',
          });
        } else {
          markUntrackedRunStopped(runThreadId, 'Stopped by the orchestrator.');
        }
      }
      for (const stoppedThread of stoppedThreads) {
        if (stoppedThread.status === 'running') updateThread(stoppedThread.id, { status: 'idle' });
        if ((stoppedThread.queuedMessages?.length ?? 0) > 0) {
          updateThread(stoppedThread.id, { queuedMessages: [] });
        }
        if (stoppedThread.spawnId) {
          updateThread(stoppedThread.id, { spawnId: undefined });
          pendingSpawnIds.push(stoppedThread.spawnId);
        }
      }
      flushChunkBuffers();

      // Each Orion child is its own provider runtime, so terminate every
      // active run and dispose every stopped thread before reporting back.
      await Promise.all(
        runsToStop.map(({ runId }) => window.orion?.stopAgentTurn?.(runId, { terminateBackground: true }))
      );
      await Promise.all(stoppedThreads.map((candidate) => disposeThreadRuntime(candidate.id)));
      for (const spawnId of pendingSpawnIds) {
        void window.orion?.reportSubagentResult?.({
          spawnId,
          ok: false,
          result: 'Subagent run was stopped by the orchestrator.',
        });
      }
      report(true, `Stopped subagent ${targets.map(describe).join(', ')}.`);
    },
    [
      clearActiveRun,
      appendToThreadMessage,
      updateThreadMessage,
      updateThread,
      flushChunkBuffers,
      disposeThreadRuntime,
      markUntrackedRunStopped,
    ]
  );

  const stopSubagentsForRequestRef = useRef(stopSubagentsForRequest);
  useEffect(() => {
    stopSubagentsForRequestRef.current = stopSubagentsForRequest;
  }, [stopSubagentsForRequest]);

  useEffect(() => {
    if (!window.orion?.onSubagentStopRequest) return undefined;
    const unsubscribe = window.orion.onSubagentStopRequest((request) => {
      void stopSubagentsForRequestRef.current?.(request);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // A spawned subthread reaching 'done' or 'error' (turn finished, failed to
  // start, or app-restart recovery) resolves the driver's blocked
  // spawn_subagent call with the child's final output. The persisted spawnId
  // is cleared after the first report — later runs on the subthread
  // (steer/queued follow-ups) fire more transitions, but main also ignores
  // unknown spawnIds.
  useEffect(() => {
    for (const thread of threads) {
      const spawnId = thread.spawnId;
      if (!spawnId) continue;
      if (thread.status !== 'done' && thread.status !== 'error') continue;
      updateThread(thread.id, { spawnId: undefined });
      const lastAgentMessage = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'agent' && (message.content.trim() || message.error));
      const output = lastAgentMessage?.content.trim();
      void window.orion?.reportSubagentResult?.({
        spawnId,
        ok: thread.status === 'done',
        result:
          thread.status === 'done'
            ? output || '(no output)'
            : lastAgentMessage?.error || output || 'The subagent run failed.',
      });
    }
  }, [threads, updateThread]);

  // `/btw` — ask the agent a side question without interrupting the thread
  // (Claude Code's /btw). The question runs against a read-only FORK of the
  // thread's Claude session (--resume <id> --fork-session), so it sees the
  // full conversation context but the main session, transcript, thread
  // status, and queued-message dispatch are all untouched. Works mid-run: the
  // fork reads whatever the session file holds so far.
  const askBtwQuestion = useCallback(
    (threadId: string, question: string): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const threadEpic = thread.epicId ? state.epics.find((epic) => epic.id === thread.epicId) : undefined;
      if (
        (thread.epicId && riftSetupEpicIdsRef.current[thread.epicId]) ||
        threadEpic?.riftRequest ||
        threadEpic?.riftCleanupPending ||
        threadEpic?.riftReleased ||
        riftRemovalThreadIdsRef.current.has(thread.id) ||
        (thread.epicId && riftRemovalEpicIdsRef.current.has(thread.epicId))
      ) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      const workingDir = threadWorkingDir(state.epics, thread, project);
      if (!workingDir) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      let model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      // Orion threads run on their configured main-driver model. Resolve the
      // pseudo-model here just as startTurnForThread does so a Claude-backed
      // orchestrator can fork its live Claude session for /btw.
      if (model?.providerId === 'orion' || isOrionModelId(thread.modelId)) {
        const roleModels = {
          ...defaultOrchestrationSettings.models,
          ...state.orchestrationSettings?.models,
        };
        model = findAgentModel(agentModels, roleModels.mainDriver);
      }
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (model.providerId !== 'claude') {
        return {
          ok: false,
          error: '/btw is only available on Claude agents for now',
        };
      }
      if (normalizedProviderSettings.claude?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return {
          ok: false,
          error: model.unavailableReason ?? `${model.label} is unavailable`,
        };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      const sessionId = thread.agentSessionIds?.claude;
      if (!sessionId) {
        return {
          ok: false,
          error: 'Wait for Claude to start this thread before using /btw.',
        };
      }
      const prompt =
        'The user has a quick aside question about this session (asked via /btw). ' +
        'Answer it directly and concisely. Do not make any changes and do not treat ' +
        'it as a new task — this exchange is a side conversation that the main ' +
        'session will never see.\n\n' +
        question;

      // Persist any already-received main-turn text before recording the
      // anchor offset. Chunks that arrive after this point then sort below the
      // aside even though the main turn continues in the same message.
      flushChunkBuffers();
      const exchangeId = addBtwExchange(threadId, question);
      const runId = crypto.randomUUID();
      btwRuns.current.set(runId, { threadId, exchangeId });
      pinThreadToBottom(threadId);

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          epicId: thread.epicId,
          projectPath: workingDir,
          prompt,
          modelId: model.id,
          // Plan mode: the aside can read the repo but never mutate it.
          accessMode: 'read-only',
          resumeSessionId: sessionId,
          forkSession: Boolean(sessionId),
          // Asides run one-shot on a forked CLI; they must never reuse (or
          // replace) the thread's persistent claude session.
          aside: true,
          providerOptions: normalizedProviderSettings.claude?.options,
          claudeReasoningEffort: thread.claudeReasoningEffort ?? getDefaultClaudeReasoningEffort(model),
          claudeContextWindow: getEffectiveClaudeContextWindow(
            model,
            thread.claudeContextWindow ?? defaultClaudeContextWindow
          ),
        })
        .then((result) => {
          if (result.ok && result.runId) {
            if (result.runId !== runId) {
              const tracked = btwRuns.current.get(runId);
              btwRuns.current.delete(runId);
              if (tracked) btwRuns.current.set(result.runId, tracked);
            }
          } else {
            btwRuns.current.delete(runId);
            updateBtwExchange(threadId, exchangeId, {
              status: 'error',
              completedAt: new Date().toISOString(),
              error: result.error ?? 'The agent failed to start.',
            });
          }
        });

      return { ok: true };
    },
    [agentModels, normalizedProviderSettings, addBtwExchange, flushChunkBuffers, updateBtwExchange]
  );

  // `/goal` — codex goal runs. The whole pursuit (codex auto-continues turns
  // until the goal completes, blocks, or hits budget) is one agent-run
  // message driven over `codex app-server`.
  const startGoalRunForThread = useCallback(
    (
      threadId: string,
      rawText: string,
      goalAction: {
        action: 'set' | 'resume';
        objective?: string;
        tokenBudget?: number;
      }
    ): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const threadEpic = thread.epicId ? state.epics.find((epic) => epic.id === thread.epicId) : undefined;
      // Wait for the epic's rift: see startTurnForThread.
      if (thread.epicId && riftSetupEpicIdsRef.current[thread.epicId]) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is still being created — try again in a moment',
        };
      }
      if (threadEpic?.riftRequest) {
        return {
          ok: false,
          error: 'This epic’s rift setup needs to finish before work can continue',
        };
      }
      if (threadEpic?.riftCleanupPending) {
        return {
          ok: false,
          error: 'This epic has an incomplete rift that must be removed before work can continue',
        };
      }
      if (
        riftRemovalThreadIdsRef.current.has(thread.id) ||
        (thread.epicId && riftRemovalEpicIdsRef.current.has(thread.epicId))
      ) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is being removed',
        };
      }
      if (threadEpic?.riftReleased) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      const workingDir = threadWorkingDir(state.epics, thread, project);
      if (!workingDir) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      const model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (model.providerId !== 'codex') {
        return { ok: false, error: '/goal is only available on Codex agents' };
      }
      if (normalizedProviderSettings.codex?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return {
          ok: false,
          error: model.unavailableReason ?? `${model.label} is unavailable`,
        };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      addMessageToThread(threadId, { role: 'user', content: rawText });
      const messageId = addMessageToThread(threadId, {
        role: 'agent',
        content: '',
        kind: 'agent-run',
        status: 'running',
        statusText: 'Pursuing the goal.',
        startedAt: new Date().toISOString(),
        activities: [],
      });
      const runId = crypto.randomUUID();
      runOutputMessages.current.set(runId, { threadId, messageId });
      setActiveRunsByThread((current) => ({ ...current, [threadId]: runId }));
      updateThread(threadId, { status: 'running' });
      pinThreadToBottom(threadId);

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          epicId: thread.epicId,
          projectPath: workingDir,
          prompt: goalAction.objective || 'Resume the goal.',
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.codex,
          forkSession: Boolean(thread.agentSessionIds?.codex && thread.pendingForkProviders?.includes('codex')),
          providerOptions: normalizedProviderSettings.codex?.options,
          codexReasoningEffort: getEffectiveCodexReasoningEffort(model, thread.codexReasoningEffort),
          codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
          codexGoal: goalAction,
        })
        .then((result) => {
          if (result.ok && result.runId) {
            if (result.runId !== runId) {
              runOutputMessages.current.delete(runId);
              runOutputMessages.current.set(result.runId, {
                threadId,
                messageId,
              });
              setActiveRunsByThread((current) =>
                current[threadId] === runId ? { ...current, [threadId]: result.runId! } : current
              );
            }
          } else {
            runOutputMessages.current.delete(runId);
            clearActiveRun(runId);
            appendToThreadMessage(threadId, messageId, result.error ?? 'The agent failed to start.');
            updateThreadMessage(threadId, messageId, {
              status: 'error',
              completedAt: new Date().toISOString(),
              statusText: 'The agent failed to start.',
              error: result.error,
            });
            updateThread(threadId, { status: 'error' });
          }
        });

      return { ok: true };
    },
    [
      agentModels,
      normalizedProviderSettings,
      addMessageToThread,
      appendToThreadMessage,
      updateThread,
      updateThreadMessage,
      clearActiveRun,
    ]
  );

  // `/review` — Codex's dedicated reviewer, run inline on the current native
  // Codex session so it can see the conversation that led to the changes.
  const startReviewForThread = useCallback(
    (
      threadId: string,
      rawText: string,
      review: {
        mode: 'uncommitted' | 'base' | 'commit' | 'custom';
        base?: string;
        commit?: string;
        instructions?: string;
      }
    ): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const threadEpic = thread.epicId ? state.epics.find((epic) => epic.id === thread.epicId) : undefined;
      // Wait for the epic's rift: see startTurnForThread.
      if (thread.epicId && riftSetupEpicIdsRef.current[thread.epicId]) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is still being created — try again in a moment',
        };
      }
      if (threadEpic?.riftRequest) {
        return {
          ok: false,
          error: 'This epic’s rift setup needs to finish before work can continue',
        };
      }
      if (threadEpic?.riftCleanupPending) {
        return {
          ok: false,
          error: 'This epic has an incomplete rift that must be removed before work can continue',
        };
      }
      if (
        riftRemovalThreadIdsRef.current.has(thread.id) ||
        (thread.epicId && riftRemovalEpicIdsRef.current.has(thread.epicId))
      ) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is being removed',
        };
      }
      if (threadEpic?.riftReleased) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      const workingDir = threadWorkingDir(state.epics, thread, project);
      if (!workingDir) {
        return {
          ok: false,
          error: 'This epic’s rift workspace is not available',
        };
      }
      const model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (model.providerId !== 'codex') {
        return {
          ok: false,
          error: '/review is only available on Codex agents',
        };
      }
      if (normalizedProviderSettings.codex?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return {
          ok: false,
          error: model.unavailableReason ?? `${model.label} is unavailable`,
        };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      const reviewLabel =
        review.mode === 'base'
          ? `Code review against ${review.base}`
          : review.mode === 'commit'
            ? `Code review of commit ${review.commit}`
            : review.mode === 'custom'
              ? 'Code review (custom instructions)'
              : 'Code review (uncommitted changes)';

      // Codex titles review threads "Review Changes" — mirror that rather
      // than leaving the default timestamp title in the sidebar. The /review
      // path never reaches the normal send flow that seeds thread titles.
      if (isDefaultTitle(thread.title)) {
        updateThread(threadId, { title: 'Review Changes' });
      }

      addMessageToThread(threadId, { role: 'user', content: rawText });
      const messageId = addMessageToThread(threadId, {
        role: 'agent',
        content: '',
        kind: 'agent-run',
        status: 'running',
        statusText: 'Reviewing changes.',
        startedAt: new Date().toISOString(),
        activities: [],
      });
      const runId = crypto.randomUUID();
      runOutputMessages.current.set(runId, { threadId, messageId });
      setActiveRunsByThread((current) => ({ ...current, [threadId]: runId }));
      updateThread(threadId, { status: 'running' });
      pinThreadToBottom(threadId);

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          epicId: thread.epicId,
          projectPath: workingDir,
          prompt: review.instructions || reviewLabel,
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.codex,
          forkSession: Boolean(thread.agentSessionIds?.codex && thread.pendingForkProviders?.includes('codex')),
          providerOptions: normalizedProviderSettings.codex?.options,
          codexReasoningEffort: getEffectiveCodexReasoningEffort(model, thread.codexReasoningEffort),
          codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
          codexReview: {
            ...review,
            threadContext: buildReviewThreadContext(thread),
          },
        })
        .then((result) => {
          if (result.ok && result.runId) {
            if (result.runId !== runId) {
              runOutputMessages.current.delete(runId);
              runOutputMessages.current.set(result.runId, {
                threadId,
                messageId,
              });
              setActiveRunsByThread((current) =>
                current[threadId] === runId ? { ...current, [threadId]: result.runId! } : current
              );
            }
          } else {
            runOutputMessages.current.delete(runId);
            clearActiveRun(runId);
            appendToThreadMessage(threadId, messageId, result.error ?? 'The review failed to start.');
            updateThreadMessage(threadId, messageId, {
              status: 'error',
              completedAt: new Date().toISOString(),
              statusText: 'The review failed to start.',
              error: result.error,
            });
            updateThread(threadId, { status: 'error' });
          }
        });

      return { ok: true };
    },
    [
      agentModels,
      normalizedProviderSettings,
      addMessageToThread,
      appendToThreadMessage,
      updateThread,
      updateThreadMessage,
      clearActiveRun,
    ]
  );

  // Dismissing a still-running aside also kills its forked run.
  const dismissBtwExchange = useCallback(
    (threadId: string, exchangeId: string) => {
      for (const [runId, tracked] of btwRuns.current) {
        if (tracked.threadId === threadId && tracked.exchangeId === exchangeId) {
          btwRuns.current.delete(runId);
          void window.orion?.stopAgentTurn?.(runId);
        }
      }
      removeBtwExchange(threadId, exchangeId);
    },
    [removeBtwExchange]
  );

  // Queued follow-ups dispatch as soon as their thread has no run in flight —
  // after a turn finishes (done or error) and after app-restart recovery. Each
  // dispatch resumes the provider session, so the agent keeps its context.
  useEffect(() => {
    for (const thread of threads) {
      const next = thread.queuedMessages?.[0];
      if (!next) continue;
      if (thread.status === 'running' || activeRunsByThread[thread.id] || pendingTurnStartsRef.current.has(thread.id)) {
        continue;
      }
      removeQueuedThreadMessage(thread.id, next.id);
      void startTurnForThread(thread.id, next.text, next.attachments ?? []).then(
        (result) => {
          if (result.ok) return;
          addMessageToThread(thread.id, {
            role: 'system',
            content: `Could not send the queued message: ${result.error}`,
          });
        },
        (error) => {
          addMessageToThread(thread.id, {
            role: 'system',
            content: `Could not send the queued message: ${error instanceof Error ? error.message : 'unknown error'}`,
          });
        }
      );
    }
  }, [threads, activeRunsByThread, removeQueuedThreadMessage, startTurnForThread, addMessageToThread]);

  // Goal pause/clear is an intentional cancellation, so detach the live run
  // before stopping its app-server. Otherwise the SIGTERM tail can race back
  // through the normal error handler and turn a successful pause into a
  // failed transcript entry.
  const stopTrackedGoalRun = async (runId: string, statusText: string) => {
    const tracked = runOutputMessages.current.get(runId);
    runOutputMessages.current.delete(runId);
    clearActiveRun(runId);
    flushChunkBuffers();
    if (tracked) {
      updateThreadMessage(tracked.threadId, tracked.messageId, {
        status: 'stopped',
        completedAt: new Date().toISOString(),
        statusText,
      });
      updateThread(tracked.threadId, { status: 'idle' });
    }
    return (await window.orion?.stopAgentTurn?.(runId)) ?? false;
  };

  // `/goal <objective> [budget:500k]` sets (or replaces) the codex goal and
  // starts pursuing it; `/goal pause|resume|clear|status` manage it. Stop on
  // a goal run pauses the goal, so pause and Stop are the same gesture.
  const handleGoalCommand = (promptText: string, rest: string) => {
    if (!selectedThreadId || !selectedThread) return;
    const state = useOrionStore.getState();
    const model = findAgentModel(agentModels, selectedThread.modelId ?? defaultAgentModelId);
    if (model?.providerId !== 'codex') {
      toast.error('/goal is only available on Codex agents');
      return;
    }
    const goal = selectedThread.goal;
    const sessionId = selectedThread.agentSessionIds?.codex;
    const project = state.projects.find((p) => p.id === selectedThread.projectId);
    const workingDir = project ? threadWorkingDir(state.epics, selectedThread, project) : null;
    const finishInput = () => {
      setChatInput('');
      setChatMention(null);
    };
    const sub = rest.toLowerCase();

    if (!rest || sub === 'status') {
      if (!goal && !sessionId) {
        toast.error('No goal on this thread yet — set one with “/goal <objective>”.');
        return;
      }
      if (sessionId && workingDir && window.orion?.codexGoalCommand) {
        void window.orion
          .codexGoalCommand({
            sessionId,
            threadId: selectedThreadId,
            epicId: selectedThread.epicId,
            projectPath: workingDir,
            action: 'get',
          })
          .then((result) => {
            if (result.ok) updateThread(selectedThreadId, { goal: result.goal ?? null });
            const latest = result.ok ? result.goal : goal;
            if (latest) toast.success(goalSummaryLine(latest));
            else toast.error(result.ok ? 'No goal on this thread.' : (result.error ?? 'Could not read the goal.'));
          });
      } else if (goal) {
        toast.success(goalSummaryLine(goal));
      } else {
        toast.error('No goal on this thread.');
      }
      finishInput();
      return;
    }

    if (sub === 'pause') {
      if (!goal || goal.status !== 'active') {
        toast.error('No active goal to pause.');
        return;
      }
      const activeRun = activeRunsByThread[selectedThreadId];
      if (activeRun) {
        // Stopping the goal run pauses the goal (main records it in codex).
        void stopTrackedGoalRun(activeRun, 'Goal paused.').then((stopped) => {
          if (!stopped) {
            toast.error('Could not stop the live goal run.');
            return;
          }
          // The main-process goal event normally installed the authoritative
          // paused state while stopAgentTurn was awaiting the app-server. Use
          // a local fallback only if that event did not arrive.
          const latest = useOrionStore.getState().threads.find((thread) => thread.id === selectedThreadId)?.goal;
          if (latest?.status === 'active') {
            updateThread(selectedThreadId, {
              goal: { ...latest, status: 'paused' },
            });
          }
          toast.success('Goal paused.');
        });
      } else if (sessionId && workingDir && window.orion?.codexGoalCommand) {
        void window.orion
          .codexGoalCommand({
            sessionId,
            threadId: selectedThreadId,
            epicId: selectedThread.epicId,
            projectPath: workingDir,
            action: 'pause',
          })
          .then((result) => {
            if (result.ok) {
              updateThread(selectedThreadId, {
                goal: result.goal ?? { ...goal, status: 'paused' },
              });
              toast.success('Goal paused.');
            } else {
              toast.error(result.error ?? 'Could not pause the goal.');
            }
          });
      }
      finishInput();
      return;
    }

    if (sub === 'clear') {
      if (!goal) {
        toast.error('No goal to clear.');
        return;
      }
      const clearGoal = () => {
        if (sessionId && workingDir && window.orion?.codexGoalCommand) {
          void window.orion
            .codexGoalCommand({
              sessionId,
              threadId: selectedThreadId,
              epicId: selectedThread.epicId,
              projectPath: workingDir,
              action: 'clear',
            })
            .then((result) => {
              if (result.ok) {
                updateThread(selectedThreadId, { goal: null });
                toast.success('Goal cleared.');
              } else {
                toast.error(result.error ?? 'Could not clear the goal.');
              }
            });
        } else {
          updateThread(selectedThreadId, { goal: null });
        }
      };
      const activeRun = activeRunsByThread[selectedThreadId];
      if (activeRun) {
        void stopTrackedGoalRun(activeRun, 'Goal stopped.').then((stopped) => {
          if (!stopped) {
            toast.error('Could not stop the live goal run.');
            return;
          }
          // Let the killed app-server release the thread before a short-lived
          // goal-op process resumes it to clear the persisted goal.
          setTimeout(clearGoal, 500);
        });
      } else {
        clearGoal();
      }
      finishInput();
      return;
    }

    if (sub === 'resume') {
      if (!goal) {
        toast.error('No goal to resume — set one with “/goal <objective>”.');
        return;
      }
      if (isSending) {
        toast.error('A run is already in flight on this thread.');
        return;
      }
      const result = startGoalRunForThread(selectedThreadId, promptText, {
        action: 'resume',
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      finishInput();
      return;
    }

    // New objective. Optional trailing "budget:500k" / "budget:2m" caps tokens.
    if (isSending) {
      toast.error('Stop or finish the current run before setting a goal.');
      return;
    }
    let objective = rest;
    let tokenBudget: number | undefined;
    const budgetMatch = rest.match(/(?:^|\s)budget[:=]\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i);
    if (budgetMatch) {
      const value = parseFloat(budgetMatch[1]);
      const unit = (budgetMatch[2] ?? '').toLowerCase();
      tokenBudget = Math.round(value * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1));
      objective = rest.slice(0, budgetMatch.index).trim();
    }
    if (!objective) {
      toast.error('Describe the goal, e.g. “/goal get all tests passing budget:500k”.');
      return;
    }
    const result = startGoalRunForThread(selectedThreadId, promptText, {
      action: 'set',
      objective,
      ...(tokenBudget ? { tokenBudget } : {}),
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    finishInput();
  };

  // `/review` → codex reviewer. Bare = uncommitted changes; `base <branch>`,
  // `commit <sha>`, anything else = custom instructions (codex's own modes).
  const dispatchReview = (
    rawText: string,
    review: {
      mode: 'uncommitted' | 'base' | 'commit' | 'custom';
      base?: string;
      commit?: string;
      instructions?: string;
    }
  ) => {
    if (!selectedThreadId) return;
    if (isSending) {
      toast.error('Wait for the current run to finish before starting a review.');
      return;
    }
    const result = startReviewForThread(selectedThreadId, rawText, review);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setChatInput('');
    setChatMention(null);
  };

  const handleReviewCommand = (promptText: string, rest: string) => {
    if (!selectedThread) return;
    const model = findAgentModel(agentModels, selectedThread.modelId ?? defaultAgentModelId);
    if (model?.providerId !== 'codex') {
      toast.error('/review is only available on Codex agents');
      return;
    }
    if (!rest) {
      dispatchReview(promptText, { mode: 'uncommitted' });
      return;
    }
    const baseMatch = rest.match(/^base(?:\s+(\S+))?$/i);
    if (baseMatch) {
      if (!baseMatch[1]) {
        toast.error('Name a base branch, e.g. “/review base main”.');
        return;
      }
      dispatchReview(promptText, { mode: 'base', base: baseMatch[1] });
      return;
    }
    const commitMatch = rest.match(/^commit(?:\s+([0-9a-fA-F]{4,40}))?$/i);
    if (commitMatch) {
      if (!commitMatch[1]) {
        toast.error('Name a commit, e.g. “/review commit abc1234”.');
        return;
      }
      dispatchReview(promptText, { mode: 'commit', commit: commitMatch[1] });
      return;
    }
    dispatchReview(promptText, { mode: 'custom', instructions: rest });
  };

  // Async delivery can outlive the originating thread selection. Restore a
  // failed submission to that thread's draft rather than overwriting whatever
  // the user is currently composing elsewhere.
  const restoreComposerDraft = (threadId: string, promptText: string, attachments: ImageAttachment[]) => {
    if (composerDraftKeyRef.current === threadId) {
      setChatInput((current) => [promptText, current].filter(Boolean).join('\n\n'));
      setChatAttachments((current) => [...attachments, ...current]);
      return;
    }
    const draft = composerDraftsRef.current.get(threadId);
    composerDraftsRef.current.set(threadId, {
      text: [promptText, draft?.text ?? ''].filter(Boolean).join('\n\n'),
      attachments: [...attachments, ...(draft?.attachments ?? [])],
    });
  };

  const sendMessage = async () => {
    if (!selectedThreadId || !selectedThread) return;
    // Native subagent transcripts are read-only mirrors — nothing to talk to.
    if (selectedThread.subagent) {
      toast.error('This is a read-only subagent transcript. Steer from the parent thread.');
      return;
    }
    const promptText = chatInput.trim();
    // Freshly linked board tasks can be sent on their own — the cards are the
    // prompt. Mid-run they can't (queued follow-ups need their own text).
    const canSendLinkedTasksAlone = !isSending && hasPendingLinkedTasks;
    if (!promptText && chatAttachments.length === 0 && !canSendLinkedTasksAlone) return;

    if (selectedThreadRiftUnavailable) {
      toast.error(
        selectedThreadRiftRemoving
          ? 'This epic’s rift workspace is being removed'
          : 'This epic’s rift workspace is still being created — try again in a moment'
      );
      return;
    }

    // Claude Code CLI thread: the composer feeds the embedded terminal —
    // the draft is delivered to the TUI exactly as if typed there (so claude
    // slash commands like /compact work too). Nothing goes through runTurn.
    if (isTerminalThread) {
      if (pendingTurnStartsRef.current.has(selectedThreadId)) return;
      const submittedThreadId = selectedThreadId;
      const submittedInput = chatInput;
      const submittedAttachments = chatAttachments;
      // Clear before the linked-task refresh so edits made during that wait
      // belong to the current composer and are never erased by this submission.
      setChatInput('');
      setChatMention(null);
      setChatAttachments([]);
      pendingTurnStartsRef.current.add(selectedThreadId);
      try {
        await refreshLinkedTasksBeforeDispatch(submittedThreadId);
      } catch (error) {
        restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
        toast.error(error instanceof Error ? error.message : 'The linked tasks could not be refreshed');
        return;
      } finally {
        pendingTurnStartsRef.current.delete(submittedThreadId);
      }
      const currentThread = useOrionStore.getState().threads.find((thread) => thread.id === submittedThreadId);
      if (
        currentThread &&
        (riftRemovalThreadIdsRef.current.has(currentThread.id) ||
          (currentThread.epicId && riftRemovalEpicIdsRef.current.has(currentThread.epicId)))
      ) {
        restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
        toast.error('This epic’s rift workspace is being removed');
        return;
      }
      const tasksToInject = (currentThread?.linkedTasks ?? []).filter((task) => !task.injected);
      let text = buildPromptWithAttachments(promptText, submittedAttachments);
      if (tasksToInject.length > 0) {
        text = text
          ? `${buildLinkedTaskContext(tasksToInject, true)}\n\n${text}`
          : buildLinkedTaskContext(tasksToInject, false);
      }
      if (!text) {
        restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
        return;
      }
      const restoreTerminalDraft = () => {
        restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
      };
      let result: Awaited<ReturnType<NonNullable<typeof window.orion>['terminalSendPrompt']>> | undefined;
      pendingTurnStartsRef.current.add(submittedThreadId);
      try {
        result = await window.orion?.terminalSendPrompt?.({
          threadId: submittedThreadId,
          text,
        });
      } catch (error) {
        restoreTerminalDraft();
        toast.error(error instanceof Error ? error.message : 'The Claude Code terminal is not running.');
        return;
      } finally {
        pendingTurnStartsRef.current.delete(submittedThreadId);
      }
      if (!result?.ok) {
        restoreTerminalDraft();
        toast.error(result?.error ?? 'The Claude Code terminal is not running.');
        return;
      }
      if (tasksToInject.length > 0) {
        const injectedIds = new Set(tasksToInject.map((task) => task.id));
        const currentLinkedTasks =
          useOrionStore.getState().threads.find((thread) => thread.id === submittedThreadId)?.linkedTasks ?? [];
        if (currentLinkedTasks.some((task) => injectedIds.has(task.id) && !task.injected)) {
          updateThread(submittedThreadId, {
            linkedTasks: currentLinkedTasks.map((task) =>
              injectedIds.has(task.id) ? { ...task, injected: true } : task
            ),
          });
        }
        pushLinkedTaskStatus(
          submittedThreadId,
          'running',
          undefined,
          tasksToInject.map((task) => task.id)
        );
      }
      // Terminal threads have no transcript, so seed the sidebar title from
      // the first prompt sent through the composer.
      if (currentThread && isDefaultTitle(currentThread.title) && promptText) {
        const initialTitle = deriveTitle(promptText);
        if (isPlausibleTitle(initialTitle)) {
          updateThread(submittedThreadId, { title: initialTitle });
        }
        void tryGenerateBetterTitle(
          submittedThreadId,
          promptText,
          resolveUtilityTurn(),
          selectedThreadProjectPath ?? '',
          updateThread,
          currentThread.epicId
        );
      }
      return;
    }

    // `/goal …` — codex goal management. Handled before the mid-run queue
    // branch: pause/clear act on the live run, and set/resume must never be
    // queued as plain follow-up text.
    const goalMatch = promptText.match(/^\/goal(?:\s+([\s\S]+))?$/i);
    if (goalMatch) {
      handleGoalCommand(promptText, goalMatch[1]?.trim() ?? '');
      return;
    }

    // `/review …` — codex code review (uncommitted / base branch / commit /
    // custom instructions). Also before the queue branch: it must never be
    // queued as plain follow-up text.
    const reviewMatch = promptText.match(/^\/review(?:\s+([\s\S]+))?$/i);
    if (reviewMatch) {
      handleReviewCommand(promptText, reviewMatch[1]?.trim() ?? '');
      return;
    }

    // `/btw <question>` — side question, handled before the mid-run queue
    // branch because asking while the agent works is exactly its use case.
    const btwMatch = promptText.match(/^\/btw(?:\s+([\s\S]+))?$/i);
    if (btwMatch) {
      const question = btwMatch[1]?.trim();
      if (!question) {
        toast.error('Ask something after /btw, e.g. “/btw why did you pick zustand?”');
        return;
      }
      const result = askBtwQuestion(selectedThreadId, question);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setChatInput('');
      setChatMention(null);
      return;
    }

    // Agent mid-run: hold the message; it dispatches when the current turn ends.
    if (isSending) {
      pinThreadToBottom(selectedThreadId);
      queueMessageToThread(selectedThreadId, {
        text: promptText,
        attachments: chatAttachments,
      });
      setChatInput('');
      setChatMention(null);
      setChatAttachments([]);
      return;
    }

    const submittedThreadId = selectedThreadId;
    const submittedInput = chatInput;
    const submittedAttachments = chatAttachments;
    setChatInput('');
    setChatMention(null);
    setChatAttachments([]);
    let result: { ok: boolean; error?: string };
    try {
      result = await startTurnForThread(submittedThreadId, promptText, submittedAttachments);
    } catch (error) {
      restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
      toast.error(error instanceof Error ? error.message : 'The agent turn could not start');
      return;
    }
    if (!result.ok) {
      restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
      toast.error(result.error);
      return;
    }
    setModelPickerOpen(false);
    setCodexSettingsOpen(false);
    setAccessModeOpen(false);
  };

  // Steering = interrupt the running CLI and immediately resume its session
  // with the new instruction. Needs the harness to have reported a session id
  // (arrives within the first events of a run).
  // Optional chain: 'orion' has no follow-up-support entry (steering an
  // orchestrated thread would bypass the driver resolution), so treat it as
  // unsupported instead of crashing mid-run.
  const steerSupported =
    isSending && !!selectedAgentModel && providerFollowUpSupport[selectedAgentModel.providerId]?.steer === true;
  const steerReady =
    steerSupported && !!selectedAgentModel && !!selectedThread?.agentSessionIds?.[selectedAgentModel.providerId];

  // Runs with an interrupt in flight. Steering claude can take a few seconds
  // (interrupt ack + finalize wait, possibly a session teardown), and the run
  // must stay mapped as active for that whole window — otherwise the composer
  // reads as idle and a message submitted mid-wait starts a new turn inside
  // the very session the interrupt may be about to dispose, which would kill
  // or falsely complete it. Kept active, that submission queues instead.
  const steeringRunsRef = useRef<Set<string>>(new Set());
  // Terminal events that arrived for a steered run after it was untracked but
  // before the stop IPC resolved — the run settled on its own and lost the
  // race. Consumed by steerWithContent so the real outcome (including a
  // failure) survives instead of being reported as a clean finish.
  const steerLostRaceOutcomes = useRef<
    Map<
      string,
      {
        // Chunks can arrive before the terminal event, so `type` stays
        // optional until the run's final outcome is stashed.
        type?: 'done' | 'error';
        chunks: string;
        error?: string;
        providerId?: string;
        changedFiles?: ChangedFileSummary[];
        stats?: TurnTokenStats;
        pendingBackgroundTasks?: string[];
      }
    >
  >(new Map());
  const steerTargetForThread = (threadId: string) => {
    const runId = activeRunsByThreadRef.current[threadId];
    const thread = useOrionStore.getState().threads.find((candidate) => candidate.id === threadId);
    const agentModel = thread
      ? findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId)
      : undefined;
    if (
      !runId ||
      !thread ||
      !agentModel ||
      providerFollowUpSupport[agentModel.providerId]?.steer !== true ||
      !thread.agentSessionIds?.[agentModel.providerId] ||
      !window.orion?.stopAgentTurn ||
      steeringRunsRef.current.has(runId)
    ) {
      return null;
    }
    return { runId };
  };
  const canSteerNow = () => !!selectedThreadId && !!steerTargetForThread(selectedThreadId);

  const steerWithContent = async (
    threadId: string,
    promptText: string,
    attachments: ImageAttachment[]
  ) => {
    const target = steerTargetForThread(threadId);
    if (!target) return;
    if (!promptText && attachments.length === 0) return;

    const { runId } = target;
    steeringRunsRef.current.add(runId);
    // Untrack the transcript message before killing so the dying process's
    // tail events can't write into it; the run itself stays in
    // activeRunsByThread until the interrupt settles (see steeringRunsRef).
    const tracked = runOutputMessages.current.get(runId);
    const trackedMessage = tracked
      ? useOrionStore
          .getState()
          .threads.find((thread) => thread.id === tracked.threadId)
          ?.messages.find((message) => message.id === tracked.messageId)
      : undefined;
    runOutputMessages.current.delete(runId);
    flushChunkBuffers();
    if (tracked) {
      updateThreadMessage(tracked.threadId, tracked.messageId, {
        status: 'stopped',
        completedAt: new Date().toISOString(),
        statusText: 'Interrupted — steered to a new instruction.',
      });
    }
    try {
      const interrupted = await window.orion.stopAgentTurn(runId);
      if (!interrupted) {
        // stopAgentTurn returns false only when main no longer knows the
        // run — no claude session holds it as an active turn and no child
        // process maps to it — i.e. the run settled naturally between the
        // untracking above and the interrupt landing. Its final done/error
        // event was discarded by the untracked-event guard, so nothing else
        // will ever clear the active-run mapping or the thread status.
        // Reattaching here (the old failure path) marked the dead run's
        // message and thread as running again with no future event to clear
        // them, wedging the thread permanently. Settle the thread instead
        // and hand the prompt back — with the run's real outcome, which the
        // untracked-event guard stashed when it discarded the terminal event.
        // Main forgets a run at the START of finalize, before it awaits the
        // changed-file summary and emits the terminal event — so the outcome
        // may still be in flight when the stop resolved false. Main tracks
        // that gap (agent:isRunFinalizing): while it reports the run as
        // finalizing, a terminal event is guaranteed, so keep waiting for the
        // stash (the steering marker stays set here, so the guard keeps
        // stashing). Terminal events are sent before the finalizing flag
        // clears and IPC preserves ordering, so once isRunFinalizing resolves
        // false the stash is authoritative: still empty means no outcome is
        // coming (e.g. the run settled via background-settled).
        let outcome = steerLostRaceOutcomes.current.get(runId);
        while (!outcome?.type) {
          const finalizing = await window.orion.isRunFinalizing?.(runId);
          outcome = steerLostRaceOutcomes.current.get(runId);
          if (outcome?.type || !finalizing) break;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
          outcome = steerLostRaceOutcomes.current.get(runId);
        }
        steerLostRaceOutcomes.current.delete(runId);
        let startupError: string | undefined;
        let startupFailureAlreadyHandled = false;
        try {
          const startupResult = await runStartupResults.current.get(runId);
          if (startupResult && !startupResult.ok) {
            startupError = startupResult.error ?? 'The agent failed to start.';
            // startTurnForThread's startup continuation has already written
            // this error into the transcript; the steer handoff only needs to
            // preserve its status, not append the same diagnostic twice.
            startupFailureAlreadyHandled = true;
          }
        } catch (error) {
          startupError = error instanceof Error ? error.message : 'The agent failed to start.';
        }
        const failed = outcome?.type === 'error' || Boolean(startupError);
        const failureError = outcome?.error ?? startupError;
        // A racing done event can carry background agents main still awaits;
        // mirror the normal done handler — waiting caption, thread kept in
        // the working state, and the run handle retained so Stop keeps
        // working while those agents may modify the workspace.
        const waitingOn = (!failed && outcome?.pendingBackgroundTasks) || [];
        const waiting = waitingOn.length > 0;
        if (tracked) {
          if (outcome?.chunks) {
            appendToThreadMessage(tracked.threadId, tracked.messageId, outcome.chunks);
          }
          if (failed && failureError && !startupFailureAlreadyHandled) {
            appendToThreadMessage(tracked.threadId, tracked.messageId, `\n\n${failureError}`);
          }
          const errorThread = useOrionStore.getState().threads.find((thread) => thread.id === tracked.threadId);
          const looksLoggedOut =
            failed && (isProviderAuthErrorText(failureError) || isProviderAuthErrorText(outcome?.chunks));
          const rawAuthProviderId = looksLoggedOut
            ? (outcome?.providerId ?? errorThread?.modelId.split(':')[0])
            : undefined;
          const authProviderId = rawAuthProviderId === 'orion' ? undefined : rawAuthProviderId;
          updateThreadMessage(tracked.threadId, tracked.messageId, {
            status: failed ? 'error' : 'done',
            completedAt: new Date().toISOString(),
            statusText: failed
              ? authProviderId
                ? 'The agent is logged out.'
                : 'Failed before the steer could interrupt it.'
              : waiting
                ? `Waiting on ${waitingOn.length} background ${waitingOn.length === 1 ? 'agent' : 'agents'}…`
                : 'Finished before the steer could interrupt it.',
            ...(failed && failureError ? { error: failureError } : {}),
            ...(authProviderId ? { authProviderId } : {}),
            ...(outcome?.changedFiles ? { changedFiles: outcome.changedFiles } : {}),
            ...(outcome?.stats ? { stats: outcome.stats } : {}),
          });
        }
        if (activeRunsByThreadRef.current[threadId] === runId) {
          updateThread(threadId, {
            status: failed ? 'error' : waiting ? 'running' : 'done',
          });
          if (waiting) {
            // Mirror the normal done handler: the thread remains running, so
            // runningAgentCount cannot reveal that the foreground turn wrote
            // files which the visible Code tree now needs to re-list.
            setTreeTurnRefreshTick((t) => t + 1);
          }
          // The normal done/error handlers were bypassed (the event was
          // stashed, not handled) — mirror their side effects, or a linked
          // Board task stays 'running' forever and no finish notification
          // fires. Skipped while waiting on background agents, matching the
          // normal done handler.
          if (!waiting) {
            notifyThreadFinished(threadId, failed ? 'error' : 'done');
            const finalResponse =
              !failed && tracked
                ? useOrionStore
                    .getState()
                    .threads.find((thread) => thread.id === tracked.threadId)
                    ?.messages.find((message) => message.id === tracked.messageId)
                    ?.content.trim()
                : undefined;
            pushLinkedTaskStatus(threadId, failed ? 'error' : 'finished', finalResponse || undefined);
          }
        }
        if (!waiting) clearActiveRun(runId);
        restoreComposerDraft(threadId, promptText, attachments);
        toast.error(
          failed
            ? 'The agent failed before it could be steered — your message is back in the composer.'
            : 'The agent finished before it could be steered — your message is back in the composer.'
        );
        return;
      }
      // Give the CLI a beat to flush its session file before we resume it.
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    } catch (error) {
      // A genuine interrupt failure (IPC error): the run may still be live in
      // main. The prompt may already have been removed from the composer or
      // its queued bubble. Put it back, and reattach the transcript only if
      // this is still the active run (Stop/background settlement may have won
      // the race while the IPC was pending).
      restoreComposerDraft(threadId, promptText, attachments);
      if (activeRunsByThreadRef.current[threadId] === runId && tracked) {
        runOutputMessages.current.set(runId, tracked);
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: trackedMessage?.status ?? 'running',
          completedAt: trackedMessage?.completedAt,
          statusText: trackedMessage?.statusText ?? "I'm working on this now.",
        });
        updateThread(tracked.threadId, { status: 'running' });
      }
      toast.error(error instanceof Error ? error.message : 'Could not steer the active agent.');
      return;
    } finally {
      steeringRunsRef.current.delete(runId);
      // A successfully interrupted run's own terminal event may have been
      // stashed during the flush wait above; it was not lost to a race.
      steerLostRaceOutcomes.current.delete(runId);
    }
    // Someone else settled the run mid-wait (Stop, background-settled):
    // restarting now would contradict that, so hand the prompt back to the
    // composer instead of silently dropping it.
    if (activeRunsByThreadRef.current[threadId] !== runId) {
      restoreComposerDraft(threadId, promptText, attachments);
      return;
    }
    clearActiveRun(runId);
    const result = await startTurnForThread(threadId, promptText, attachments);
    if (!result.ok) {
      toast.error(result.error);
      updateThread(threadId, { status: 'error' });
      restoreComposerDraft(threadId, promptText, attachments);
    } else {
      // The interrupted and replacement runs are swapped in one render, so
      // runningAgentCount never falls. Explicitly surface files written by
      // the interrupted turn while the Code tree remains visible.
      setTreeTurnRefreshTick((t) => t + 1);
    }
  };

  // Composer ⚡ / ⌘⏎: steer with the current draft.
  const steerActiveAgent = async () => {
    if (!canSteerNow()) return;
    const promptText = chatInput.trim();
    const attachments = chatAttachments;
    if (!promptText && attachments.length === 0) return;
    setChatInput('');
    setChatMention(null);
    setChatAttachments([]);
    if (!selectedThreadId) return;
    await steerWithContent(selectedThreadId, promptText, attachments);
  };

  // "Steer now" on a queued transcript bubble: promote that message to an
  // immediate interrupt-and-resume instead of waiting for the turn to end.
  const steerQueuedMessageRef = useRef<(threadId: string, queuedId: string) => Promise<void>>(
    async () => {}
  );
  useLayoutEffect(() => {
    steerQueuedMessageRef.current = async (threadId: string, queuedId: string) => {
      if (!steerTargetForThread(threadId)) return;
      const thread = useOrionStore.getState().threads.find((candidate) => candidate.id === threadId);
      const queued = thread?.queuedMessages?.find((q) => q.id === queuedId);
      if (!queued) return;
      removeQueuedThreadMessage(threadId, queuedId);
      await steerWithContent(threadId, queued.text, queued.attachments ?? []);
    };
  });
  const steerQueuedMessage = useCallback((threadId: string, queuedId: string) => {
    void steerQueuedMessageRef.current(threadId, queuedId);
  }, []);

  const stopActiveAgent = async () => {
    if (!activeRunId || !window.orion?.stopAgentTurn) return;
    // Stop means "halt everything": queued follow-ups return to the composer
    // instead of auto-dispatching against the stopped run's session.
    const state = useOrionStore.getState();
    const thread = state.threads.find((t) => t.id === selectedThreadId);
    const queued = thread?.queuedMessages ?? [];
    if (thread && queued.length > 0) {
      updateThread(thread.id, { queuedMessages: [] });
      setChatInput((current) => [...queued.map((q) => q.text), current].filter(Boolean).join('\n\n'));
      setChatAttachments((current) => [...queued.flatMap((q) => q.attachments ?? []), ...current]);
    }
    const threadIds = new Set(thread ? [thread.id] : []);
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      for (const candidate of state.threads) {
        if (candidate.parentThreadId && threadIds.has(candidate.parentThreadId) && !threadIds.has(candidate.id)) {
          threadIds.add(candidate.id);
          foundChild = true;
        }
      }
    }

    const stoppedThreads = state.threads.filter((candidate) => threadIds.has(candidate.id));
    const runsToStop: Array<{ threadId: string; runId: string }> = [];
    for (const candidate of stoppedThreads) {
      const runId = activeRunsByThread[candidate.id];
      if (runId) runsToStop.push({ threadId: candidate.id, runId });
    }
    const pendingSpawnIds: string[] = [];

    // Untrack and mark every run in the subtree stopped BEFORE the IPC calls:
    // interrupted result events can otherwise race in and mark them Finished.
    for (const { threadId: runThreadId, runId } of runsToStop) {
      const tracked = runOutputMessages.current.get(runId);
      runOutputMessages.current.delete(runId);
      clearActiveRun(runId);
      if (tracked) {
        appendToThreadMessage(tracked.threadId, tracked.messageId, '\n\nStopped by user.');
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'stopped',
          completedAt: new Date().toISOString(),
          statusText: 'Stopped by user.',
        });
      } else {
        markUntrackedRunStopped(runThreadId, 'Stopped by user.');
      }
    }
    for (const stoppedThread of stoppedThreads) {
      if (stoppedThread.status === 'running') updateThread(stoppedThread.id, { status: 'idle' });
      // Descendant follow-ups must not auto-dispatch as soon as their active
      // run is cleared. Only the selected/root thread's queue is restored to
      // the visible composer above.
      if (stoppedThread.id !== thread?.id && (stoppedThread.queuedMessages?.length ?? 0) > 0) {
        updateThread(stoppedThread.id, { queuedMessages: [] });
      }
      if (stoppedThread.spawnId) {
        updateThread(stoppedThread.id, { spawnId: undefined });
        pendingSpawnIds.push(stoppedThread.spawnId);
      }
    }
    flushChunkBuffers();

    // Each Orion child is its own provider runtime, so terminate every active
    // run and dispose every descendant before unblocking the parent's tool.
    await Promise.all(runsToStop.map(({ runId }) => window.orion.stopAgentTurn(runId, { terminateBackground: true })));
    await Promise.all(
      stoppedThreads
        .filter((candidate) => candidate.id !== thread?.id)
        .map((candidate) => disposeThreadRuntime(candidate.id))
    );
    for (const spawnId of pendingSpawnIds) {
      void window.orion?.reportSubagentResult?.({
        spawnId,
        ok: false,
        result: 'Subagent run was stopped by the user before completing.',
      });
    }
  };

  // Track the composer's active @-mention token: the last '@' at/before the
  // caret whose preceding character is start-of-text or whitespace, with no
  // whitespace between the '@' and the caret.
  const updateChatMention = useCallback((value: string, caret: number | null) => {
    let next: { start: number; query: string } | null = null;
    if (caret !== null) {
      const beforeCaret = value.slice(0, caret);
      const atIndex = beforeCaret.lastIndexOf('@');
      if (atIndex !== -1) {
        const charBefore = atIndex > 0 ? beforeCaret[atIndex - 1] : '';
        const query = beforeCaret.slice(atIndex + 1);
        if ((!charBefore || /\s/.test(charBefore)) && !/\s/.test(query)) {
          next = { start: atIndex, query };
        }
      }
    }
    // A token dismissed with Escape stays closed until a new '@' is typed.
    if (next && chatMentionDismissRef.current === next.start) {
      setChatMention(null);
      return;
    }
    chatMentionDismissRef.current = null;
    setChatMention(next);
  }, []);

  // Selecting a mention replaces the typed token with the model's unambiguous
  // mention token and puts the caret right after the inserted text.
  const insertChatMention = (model: AgentModel) => {
    if (!chatMention) return;
    const inserted = `@${modelMentionToken(model, agentModels)} `;
    // Completing mid-token replaces the whole token: consume slug-like
    // characters after the caret too, so no dangling suffix is left behind.
    let replaceEnd = chatMention.start + 1 + chatMention.query.length;
    while (replaceEnd < chatInput.length && /[A-Za-z0-9._:/-]/.test(chatInput[replaceEnd])) {
      replaceEnd += 1;
    }
    const nextValue = chatInput.slice(0, chatMention.start) + inserted + chatInput.slice(replaceEnd);
    const caret = chatMention.start + inserted.length;
    setChatInput(nextValue);
    setChatMention(null);
    chatMentionDismissRef.current = null;
    requestAnimationFrame(() => {
      const el = chatInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  // Handle chat submit: ⏎ sends (or queues mid-run), ⌘⏎ steers mid-run.
  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    // The open @-mention dropdown captures navigation keys first.
    if (chatMentionOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const count = chatMentionCandidates.length;
        setChatMentionIndex((index) => (index + delta + count) % count);
        return;
      }
      // Shift+Enter keeps its newline meaning even with the dropdown open;
      // plain Enter and Tab select the highlighted mention.
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        insertChatMention(chatMentionCandidates[chatMentionIndex] ?? chatMentionCandidates[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        chatMentionDismissRef.current = chatMention?.start ?? null;
        setChatMention(null);
        return;
      }
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if ((e.metaKey || e.ctrlKey) && isSending && steerReady) {
      void steerActiveAgent();
      return;
    }
    sendMessage();
  };

  const openAccountSettings = useCallback(() => {
    setSettingsTab('account');
    setSettingsOpen(true);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const sidebarFooterProps = useMemo<SidebarFooterProps>(
    () => ({
      appUpdateVisible,
      appUpdateState,
      appUpdateBusy,
      appUpdatePercent,
      appUpdateLabel,
      appUpdateTitle,
      accountState,
      accountName,
      accountInitials,
      accountLoading,
      accountBusy,
      onAppUpdateClick: handleAppUpdateClick,
      onOpenAccount: openAccountSettings,
      onStartAccountAuth: handleStartAccountAuth,
      onOpenSettings: openSettings,
    }),
    [
      accountBusy,
      accountInitials,
      accountLoading,
      accountName,
      accountState,
      appUpdateBusy,
      appUpdateLabel,
      appUpdatePercent,
      appUpdateState,
      appUpdateTitle,
      appUpdateVisible,
      handleAppUpdateClick,
      handleStartAccountAuth,
      openAccountSettings,
      openSettings,
    ]
  );

  const settingsEpicActionsRef = useRef({ handleDeleteEpic, handleRestoreEpic });
  useLayoutEffect(() => {
    settingsEpicActionsRef.current = { handleDeleteEpic, handleRestoreEpic };
  });
  const stableSettingsEpicActions = useMemo(
    () => ({
      handleDeleteEpic: (...args: Parameters<typeof handleDeleteEpic>) =>
        settingsEpicActionsRef.current.handleDeleteEpic(...args),
      handleRestoreEpic: (...args: Parameters<typeof handleRestoreEpic>) =>
        settingsEpicActionsRef.current.handleRestoreEpic(...args),
    }),
    []
  );

  const settingsPageModel: SettingsPageProps = {
    notificationSettings,
    setNotificationSettings,
    setTextGenerationSettings,
    setEpicsSettings,
    epicsSettings,
    splitViewSettings,
    setSplitViewSettings,
    savedViews,
    deleteSavedView,
    providerSettings,
    setProviderEnabled,
    setProviderOptions,
    setOrchestrationRoleModel,
    setOrchestrationGeneralInstructions,
    riftsSettings,
    setRiftsSettings,
    setUtilityModelPickerOpen,
    utilityModelPickerOpen,
    setUtilityModelSearch,
    utilityModelSearch,
    setUtilityModelTab,
    utilityModelTab,
    riftStatus,
    riftStorageState,
    riftStorageBusy,
    riftStorageForced,
    setRiftStorageForced,
    setRiftSweepDialog,
    riftStorageEntries,
    riftStorageSummary,
    riftSweepSelection,
    providerUpdateState,
    providerUpdatesRunning,
    appUpdateState,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    authenticatingProviderId,
    accountState,
    accountLoading,
    accountBusy,
    computerUsePerms,
    computerUseBusyKind,
    revealedProviderEmails,
    setRevealedProviderEmails,
    setRevealedAccountIdentity,
    expandedProviderOptions,
    setExpandedProviderOptions,
    utilityModelPickerRef,
    normalizedProviderSettings,
    normalizedOrchestrationSettings,
    orchestrationModelGroups,
    providerStatusById,
    accountName,
    accountEmail,
    accountIdentity,
    accountEmailRevealed,
    accountInitials,
    epicsEnabled,
    epicPromptGitMessages,
    archivedEpics,
    utilityCandidateModels,
    utilityProviders,
    resolvedUtilityModelId,
    resolvedUtilityModel,
    utilityModelProviderId,
    utilityReasoningOptions,
    resolvedUtilityReasoningEffort,
    refreshProviderUpdates,
    handleRequestComputerUsePermission,
    handleOpenChromeDebugSetup,
    handleStartAccountAuth,
    handleSignOutAccount,
    handleAuthenticateProvider,
    openEpicPrUrl,
    ...stableSettingsEpicActions,
    formatCheckedTime,
    formatBytes,
    epicPrStatus,
  };

  const appDialogsModel: AppDialogsModel = {
    projects,
    createEpicOpen,
    newEpicName,
    setNewEpicName,
    newEpicDescription,
    setNewEpicDescription,
    newEpicProjectId,
    setNewEpicProjectId,
    setCreateEpicProjectPickerOpen,
    createEpicProjectPickerOpen,
    setCreateEpicRiftBranchPickerOpen,
    createEpicRiftBranchPickerOpen,
    newEpicCreateRift,
    setNewEpicCreateRift,
    newEpicRiftBaseBranch,
    setNewEpicRiftBaseBranch,
    newEpicRiftBranches,
    createEpicTitleRef,
    createEpicProjectPickerRef,
    createEpicRiftBranchPickerRef,
    riftsActive,
    closeCreateEpicModal,
    handleCreateEpic,
    epicCommitDialog,
    setEpicCommitDialog,
    handleEpicCommitAndPush,
    epicPrBaseDialog,
    setEpicPrBaseDialog,
    setEpicPrBaseBranchPickerOpen,
    epicPrBaseBranchPickerOpen,
    epicPrBaseBranchPickerRef,
    handleEpicCreatePr,
    epicSettleDialog,
    setEpicSettleDialog,
    confirmEpicSettlement,
    riftStorageForced,
    setRiftStorageForced,
    riftSweepDialog,
    setRiftSweepDialog,
    dismissRiftSweepDialog,
    releaseRiftStorage,
    formatBytes,
  };
  const hasOpenDialog = Boolean(
    epicCommitDialog || epicPrBaseDialog || epicSettleDialog || riftSweepDialog || createEpicOpen
  );

  // Keep the memoized sidebar detached from composer typing. These wrappers
  // retain stable identities while their targets advance only after a render
  // commits, so they never point at an abandoned concurrent render.
  const agentsSidebarActionsRef = useRef({
    handleNewAgent,
    handleCreateThread,
    handleCreateThreadForEpic,
    handleRemoveThreadFromEpic,
    handleDeleteEpic,
    handleSettleEpic,
  });
  useLayoutEffect(() => {
    agentsSidebarActionsRef.current = {
      handleNewAgent,
      handleCreateThread,
      handleCreateThreadForEpic,
      handleRemoveThreadFromEpic,
      handleDeleteEpic,
      handleSettleEpic,
    };
  });
  const stableAgentsSidebarActions = useMemo(
    () => ({
      handleNewAgent: (...args: Parameters<typeof handleNewAgent>) =>
        agentsSidebarActionsRef.current.handleNewAgent(...args),
      handleCreateThread: (...args: Parameters<typeof handleCreateThread>) =>
        agentsSidebarActionsRef.current.handleCreateThread(...args),
      handleCreateThreadForEpic: (...args: Parameters<typeof handleCreateThreadForEpic>) =>
        agentsSidebarActionsRef.current.handleCreateThreadForEpic(...args),
      handleRemoveThreadFromEpic: (...args: Parameters<typeof handleRemoveThreadFromEpic>) =>
        agentsSidebarActionsRef.current.handleRemoveThreadFromEpic(...args),
      handleDeleteEpic: (...args: Parameters<typeof handleDeleteEpic>) =>
        agentsSidebarActionsRef.current.handleDeleteEpic(...args),
      handleSettleEpic: (...args: Parameters<typeof handleSettleEpic>) =>
        agentsSidebarActionsRef.current.handleSettleEpic(...args),
    }),
    []
  );

  // Saved views hold ids only, so the sidebar reads its pane titles from here.
  const threadTitlesById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread.title])),
    [threads]
  );

  const agentsSidebarModel: AgentsSidebarModel = {
    projects,
    selectThread,
    setActiveTab,
    selectedThreadId,
    paneThreadIds,
    savedViews,
    activeSavedViewId,
    threadTitlesById,
    openSavedView,
    deleteSavedView,
    savedViewsSectionOpen,
    setSavedViewsSectionOpen,
    updateThread,
    branchThread,
    selectedEpicId,
    renameEpic,
    selectEpic,
    renameProject,
    selectProject,
    threadSearchOpen,
    setThreadSearchOpen,
    threadSearchQuery,
    setThreadSearchQuery,
    projectMenuOpenId,
    setProjectMenuOpenId,
    threadItemMenuKey,
    setThreadItemMenuKey,
    threadRenameKey,
    setThreadRenameKey,
    projectRenameId,
    setProjectRenameId,
    threadListLimits,
    setThreadListLimits,
    collapsedProjects,
    setCollapsedProjects,
    setRecentAgentsOpen,
    recentAgentsOpen,
    setRecentAgentsShowAll,
    recentAgentsShowAll,
    setPinnedAgentsOpen,
    pinnedAgentsOpen,
    setPinnedAgentsShowAll,
    pinnedAgentsShowAll,
    setEpicsSectionOpen,
    epicsSectionOpen,
    collapsedEpics,
    setCollapsedEpics,
    epicMenuOpenId,
    setEpicMenuOpenId,
    epicRenameId,
    setEpicRenameId,
    threadSearchRef,
    projectMenuRef,
    threadItemMenuRef,
    epicMenuRef,
    selectedProject,
    sortedProjects,
    recentAgentsTargetProject,
    pinnedThreads,
    recentThreads,
    pinThread,
    unpinThread,
    runningAgentCount,
    projectThreadsByProject,
    epicsEnabled,
    activeEpics,
    threadsByEpic,
    runningAgentEpicIds,
    projectForGitRoot,
    deleteThreadWithRuntime,
    removeProjectWithRuntimes,
    handleAddProject,
    ...stableAgentsSidebarActions,
    openCreateEpicModal,
    renderThreadCliBadge,
    renderThreadStatusDot,
    sidebarFooterProps,
    epicPrStatus,
  };

  // The main view's unit of display. paneThreadIds is authoritative; falling
  // back to the selected thread only matters for a store written before the
  // split view existed, or if a pane ever outlives its thread.
  const threadPanes = useMemo(() => {
    const ids = paneThreadIds.length > 0 ? paneThreadIds : selectedThreadId ? [selectedThreadId] : [];
    return ids.flatMap((threadId) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return [];
      const context = threadViewContext(thread);
      const agentModel = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      const paneSending = Boolean(activeRunsByThread[threadId]);
      const paneSteerSupported =
        paneSending && !!agentModel && providerFollowUpSupport[agentModel.providerId]?.steer === true;
      const focused = threadId === selectedThreadId;
      return [
        {
          thread,
          focused,
          project: context.project,
          projectPath: context.projectPath,
          riftUnavailable: context.riftUnavailable,
          mediaBaseDirs: stableMediaBaseDirs(threadId, context.mediaBaseDirs),
          isTerminal: agentModel?.id === claudeCodeCliModelId,
          isSending: paneSending,
          steerSupported: paneSteerSupported,
          steerReady:
            paneSteerSupported && !!agentModel && !!thread.agentSessionIds?.[agentModel.providerId],
          // Retargeting an empty thread's project runs through the composer's
          // handler, which only ever addresses the focused thread.
          canChangeProject: focused && canChangeSelectedThreadProject,
        },
      ];
    });
  }, [
    activeRunsByThread,
    agentModels,
    canChangeSelectedThreadProject,
    paneThreadIds,
    selectedThreadId,
    stableMediaBaseDirs,
    threadViewContext,
    threads,
  ]);
  const splitFull = threadPanes.length >= MAX_THREAD_PANES;

  // Threads dragged out of the sidebar land here as an extra pane. Other drags
  // (image files, text) fall through to the shell's own handlers untouched.
  const [threadDropActive, setThreadDropActive] = useState(false);
  const isThreadDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes(THREAD_DRAG_MIME);

  const handleThreadDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isThreadDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = splitFull ? 'none' : 'copy';
      setThreadDropActive(true);
    },
    [splitFull]
  );

  const handleThreadDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isThreadDrag(event)) return;
    // Moving between panes fires leave on the panel before enter on the child;
    // ignore those so the hint doesn't strobe across the split.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setThreadDropActive(false);
  }, []);

  const handleThreadDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isThreadDrag(event)) return;
      event.preventDefault();
      setThreadDropActive(false);
      const threadId = event.dataTransfer.getData(THREAD_DRAG_MIME);
      if (threadId) openThreadInSplit(threadId);
    },
    [openThreadInSplit]
  );

  // Width every composer chip would take if they all stayed on the row. Depends
  // only on the labels, so it never changes as a result of collapsing them —
  // the compact row can't measure the full one, and a measured switch would
  // oscillate at the boundary.
  const composerControlsNeededWidth = (() => {
    const widths: number[] = [
      Math.min(260, estimateChipWidth(selectedAgentModel?.label ?? 'Select model', 6.6, 68)),
    ];
    if (shouldShowAgentSettings) {
      widths.push(
        estimateChipWidth(
          selectedAgentModel?.providerId === 'grok'
            ? selectedGrokReasoningLabel
            : selectedAgentModel?.providerId === 'claude'
              ? `${selectedClaudeReasoningLabel} · ${selectedClaudeContextWindowLabel}`
              : `${selectedCodexReasoningLabel} · ${selectedCodexServiceTierLabel}`,
          7.4,
          52
        )
      );
    }
    widths.push(estimateChipWidth(selectedAccessModeLabel, 7.4, 60));
    if (!isTerminalThread) widths.push(34);
    widths.push(36); // Send, or stop while a run is in flight.
    if (isSending && (chatInput.trim() || chatAttachments.length > 0)) {
      widths.push(36); // Queue.
      if (steerSupported) widths.push(36);
    }
    return widths.reduce((total, width) => total + width, 0) + (widths.length - 1) * 8;
  })();

  // Only a narrow pane ever trips this; a full-width composer has room to
  // spare, so it keeps every control as its own chip exactly as before.
  const composerControlsCompact =
    composerControlsWidth !== null && composerControlsWidth < composerControlsNeededWidth;

  useEffect(() => {
    // The chips and the overflow menu own separate open state; whichever form
    // just went away should not come back expanded.
    if (composerControlsCompact) {
      setCodexSettingsOpen(false);
      setAccessModeOpen(false);
      setTaskPickerOpen(false);
    } else {
      setComposerMenuOpen(false);
      setComposerMenuSection(null);
    }
  }, [composerControlsCompact]);

  useEffect(() => {
    if (!composerMenuOpen) return undefined;

    const close = () => {
      setComposerMenuOpen(false);
      setComposerMenuSection(null);
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !composerMenuRef.current?.contains(target) &&
        !composerMenuPopoverRef.current?.contains(target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [composerMenuOpen]);

  useLayoutEffect(() => {
    if (!composerMenuOpen) return undefined;
    const anchor = composerMenuRef.current;
    const menu = composerMenuPopoverRef.current;
    if (!anchor || !menu) return undefined;

    const fit = () => {
      const margin = 12;
      const gap = 8;
      const anchorRect = anchor.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - margin * 2);
      const roomAbove = Math.max(0, anchorRect.top - margin - gap);
      const roomBelow = Math.max(0, window.innerHeight - anchorRect.bottom - margin - gap);
      const placeAbove = roomAbove >= roomBelow;
      const maxHeight = Math.min(520, placeAbove ? roomAbove : roomBelow);
      const left = Math.min(
        Math.max(anchorRect.right - width, margin),
        Math.max(margin, window.innerWidth - margin - width)
      );

      menu.style.left = `${Math.round(left)}px`;
      menu.style.width = `${Math.round(width)}px`;
      menu.style.maxHeight = `${Math.floor(maxHeight)}px`;
      if (placeAbove) {
        menu.style.top = 'auto';
        menu.style.bottom = `${Math.round(window.innerHeight - anchorRect.top + gap)}px`;
      } else {
        menu.style.top = `${Math.round(anchorRect.bottom + gap)}px`;
        menu.style.bottom = 'auto';
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(anchor);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [composerMenuOpen]);

  // Popover bodies, lifted out of their chips so the overflow menu can show the
  // same options inline instead of duplicating them.
  const agentSettingsOptions = selectedThread && shouldShowAgentSettings ? (
    selectedAgentModel?.providerId === 'grok' ? (
      <div className="codex-settings-section">
        <div className="codex-settings-heading">Reasoning</div>
        <div className="codex-settings-options">
          {grokReasoningOptions.map((option) => {
            const selected = selectedGrokReasoning === option.value;
            return (
              <button
                key={option.value}
                className={`codex-settings-row ${selected ? 'selected' : ''}`}
                onClick={() =>
                  updateThread(selectedThread.id, {
                    grokReasoningEffort: option.value as GrokReasoningEffort,
                  })
                }
              >
                <span className="settings-check">{selected && <Check size={17} />}</span>
                <span>
                  {option.label}
                  {option.default ? ' (default)' : ''}
                  {option.description && (
                    <span className="codex-settings-row-description">{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : selectedAgentModel?.providerId === 'claude' ? (
      <>
        <div className="codex-settings-section">
          <div className="codex-settings-heading">Reasoning</div>
          <div className="codex-settings-options">
            {claudeReasoningOptions.map((option) => {
              const selected = selectedClaudeReasoning === option.value;
              const isDefault = option.value === selectedClaudeDefaultReasoning;
              return (
                <button
                  key={option.value}
                  className={`codex-settings-row ${selected ? 'selected' : ''}`}
                  onClick={() =>
                    updateThread(selectedThread.id, {
                      claudeReasoningEffort: option.value as ClaudeReasoningEffort,
                    })
                  }
                >
                  <span className="settings-check">{selected && <Check size={17} />}</span>
                  <span>
                    {option.label}
                    {isDefault ? ' (default)' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="codex-settings-divider" />

        <div className="codex-settings-section">
          <div className="codex-settings-heading">Context Window</div>
          <div className="codex-settings-options">
            {claudeContextWindowOptions.map((option) => {
              const selected = effectiveClaudeContextWindow === option.value;
              const oneMillionOnly =
                !!selectedAgentModel && claudeOneMillionOnlyModelSlugs.has(selectedAgentModel.slug);
              const disabled = oneMillionOnly && option.value === '200k';
              return (
                <button
                  key={option.value}
                  className={`codex-settings-row ${selected ? 'selected' : ''}`}
                  onClick={() =>
                    updateThread(selectedThread.id, {
                      claudeContextWindow: option.value as ClaudeContextWindow,
                    })
                  }
                  disabled={disabled}
                  title={
                    disabled && selectedAgentModel
                      ? `${selectedAgentModel.label} always uses 1M context`
                      : undefined
                  }
                >
                  <span className="settings-check">{selected && <Check size={17} />}</span>
                  <span>
                    {option.label}
                    {option.value === defaultClaudeContextWindow && !oneMillionOnly
                      ? ' (default)'
                      : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </>
    ) : (
      <>
        <div className="codex-settings-section">
          <div className="codex-settings-heading">Reasoning</div>
          <div className="codex-settings-options">
            {selectedCodexReasoningOptions.map((option) => {
              const selected = selectedCodexReasoning === option.value;
              return (
                <button
                  key={option.value}
                  className={`codex-settings-row ${selected ? 'selected' : ''}`}
                  onClick={() =>
                    updateThread(selectedThread.id, {
                      codexReasoningEffort: option.value as CodexReasoningEffort,
                    })
                  }
                >
                  <span className="settings-check">{selected && <Check size={17} />}</span>
                  <span>
                    {option.label}
                    {option.default ? ' (default)' : ''}
                    {option.description && (
                      <span className="codex-settings-row-description">{option.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="codex-settings-divider" />

        <div className="codex-settings-section">
          <div className="codex-settings-heading">Service Tier</div>
          <div className="codex-settings-options">
            {codexServiceTierOptions.map((option) => {
              const selected = selectedCodexServiceTier === option.value;
              return (
                <button
                  key={option.value}
                  className={`codex-settings-row ${selected ? 'selected' : ''}`}
                  onClick={() =>
                    updateThread(selectedThread.id, {
                      codexServiceTier: option.value as CodexServiceTier,
                    })
                  }
                >
                  <span className="settings-check">{selected && <Check size={17} />}</span>
                  <span>
                    {option.label}
                    {option.default ? ' (default)' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </>
    )
  ) : null;

  const accessModeList = selectedThread ? (
    <div className="codex-settings-options">
      {accessModeOptions.map((option) => {
        const selected = selectedAccessMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`codex-settings-row ${selected ? 'selected' : ''}`}
            onClick={() => {
              updateThread(selectedThread.id, { accessMode: option.value });
              setAccessModeOpen(false);
              setComposerMenuSection(null);
            }}
          >
            <span className="settings-check">{selected && <Check size={17} />}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  const agentSettingsSummary =
    selectedAgentModel?.providerId === 'grok'
      ? selectedGrokReasoningLabel
      : selectedAgentModel?.providerId === 'claude'
        ? `${selectedClaudeReasoningLabel} · ${selectedClaudeContextWindowLabel}`
        : `${selectedCodexReasoningLabel} · ${selectedCodexServiceTierLabel}`;

  // The composer belongs to the focused pane: one thread takes input at a
  // time and clicking any pane moves it there. Built once, outside the pane
  // loop, so a six-way split never duplicates the picker/mention machinery.
  const composerNode = selectedThread ? (
    <div className="chat-input-area">
      <AgentFamilySwitcher currentThread={selectedThread} threads={threads} onSelect={selectThread} />
      <div className="composer-shell">
        {chatAttachments.length > 0 && (
          <div className="composer-attachments">
            {chatAttachments.map((attachment) => (
              <div key={attachment.id} className="composer-attachment" title={attachment.path}>
                <AttachmentThumb attachment={attachment} />
                <span className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachment.name}</span>
                  <span className="composer-attachment-size">
                    {formatAttachmentSize(attachment.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => removeChatAttachment(attachment.id)}
                  title="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {hasPendingLinkedTasks && (
          <div className="composer-task-row">
            {pendingLinkedTasks.map((linkedTask) => (
              <div
                key={linkedTask.id}
                className={`composer-task-chip status-${linkedTask.lastStatus ?? 'linked'}`}
                title={linkedTask.description || linkedTask.title}
              >
                <SquareKanban size={13} />
                <span className="composer-task-title">{linkedTask.title}</span>
                <span className="composer-task-status">
                  {linkedTaskStatusLabel(linkedTask.lastStatus)}
                </span>
                {linkedTask.lastStatus !== 'done' && !isSending && (
                  <button
                    type="button"
                    className="composer-task-action done"
                    onClick={() => markLinkedTaskDone(selectedThread.id, linkedTask.id)}
                    title="Mark the task as done on the board"
                  >
                    <CircleCheck size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="composer-task-action"
                  onClick={() => unlinkTaskFromThread(selectedThread.id, linkedTask.id)}
                  title="Unlink task"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {!isTerminalThread && /^\/review(\s|$)/i.test(chatInput.trimStart()) && (
          <div className="composer-btw-hint">
            <SquarePen size={12} />
            <span>
              {selectedAgentModel?.providerId === 'codex'
                ? 'Code review — Codex reviews uncommitted changes by default. “/review base <branch>”, “/review commit <sha>”, or “/review <custom instructions>”.'
                : '/review is only available on Codex agents.'}
            </span>
          </div>
        )}
        {!isTerminalThread && /^\/goal(\s|$)/i.test(chatInput.trimStart()) && (
          <div className="composer-btw-hint">
            <Target size={12} />
            <span>
              {selectedAgentModel?.providerId === 'codex'
                ? 'Goal — Codex pursues it autonomously across turns until it’s achieved, blocked, or the budget runs out. “/goal <objective> [budget:500k]”, or pause / resume / clear / status.'
                : '/goal is only available on Codex agents.'}
            </span>
          </div>
        )}
        {!isTerminalThread && /^\/btw(\s|$)/i.test(chatInput.trimStart()) && (
          <div className="composer-btw-hint">
            <Sparkles size={12} />
            <span>
              {selectedAgentModel?.providerId === 'claude' ||
              (isOrionModelId(selectedThread.modelId) &&
                findAgentModel(agentModels, normalizedOrchestrationSettings.models.mainDriver)
                  ?.providerId === 'claude')
                ? 'Aside question — answered by a read-only fork of this thread’s Claude session. It won’t interrupt the agent or join the thread.'
                : '/btw is only available on Claude agents for now.'}
            </span>
          </div>
        )}
        {selectedAgentModel?.providerId === 'codex' &&
          /^\/review\s*$/i.test(chatInput.trimStart()) && (
            <ComposerPopover className="review-popover">
              <button
                type="button"
                role="option"
                className="mention-row"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  dispatchReview('/review', {
                    mode: 'uncommitted',
                  })
                }
              >
                <SquarePen size={14} />
                <span className="mention-row-label">Review uncommitted changes</span>
              </button>
              <button
                type="button"
                role="option"
                className="mention-row"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setChatInput('/review base ')}
              >
                <GitBranch size={14} />
                <span className="mention-row-label">Review against a base branch</span>
              </button>
            </ComposerPopover>
          )}
        {selectedAgentModel?.providerId === 'codex' &&
          /^\/review\s+base\s*$/i.test(chatInput.trimStart()) && (
            <ComposerPopover className="review-popover">
              {(gitState?.branches ?? [])
                .filter((branch) => !branch.current)
                .slice(0, 12)
                .map((branch) => (
                  <button
                    key={branch.name}
                    type="button"
                    role="option"
                    className="mention-row"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      dispatchReview(`/review base ${branch.name}`, {
                        mode: 'base',
                        base: branch.name,
                      })
                    }
                  >
                    <GitBranch size={14} />
                    <span className="mention-row-label">{branch.name}</span>
                  </button>
                ))}
              {!(gitState?.branches ?? []).some((branch) => !branch.current) && (
                <div className="mention-row" aria-disabled="true">
                  <GitBranch size={14} />
                  <span className="mention-row-label">No other branches — type a branch name</span>
                </div>
              )}
            </ComposerPopover>
          )}
        {chatMentionOpen && (
          <ComposerPopover>
            {chatMentionCandidates.map((model, index) => {
              const ProviderIcon =
                agentProviders.find((provider) => provider.id === model.providerId)?.icon ?? Play;
              return (
                <button
                  key={model.id}
                  ref={index === chatMentionIndex ? chatMentionSelectedRef : null}
                  type="button"
                  role="option"
                  aria-selected={index === chatMentionIndex}
                  className={`mention-row ${index === chatMentionIndex ? 'selected' : ''}`}
                  onMouseEnter={() => setChatMentionIndex(index)}
                  // Keep the textarea focused so selection doesn't blur the composer.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertChatMention(model)}
                  title={modelMentionToken(model, agentModels)}
                >
                  <ProviderIcon size={16} />
                  <span className="mention-row-label">{model.label}</span>
                  <span className="mention-row-slug">{modelMentionToken(model, agentModels)}</span>
                </button>
              );
            })}
          </ComposerPopover>
        )}
        <textarea
          ref={setChatInputRef}
          className="chat-input min-h-[52px]"
          disabled={isNativeSubagentThread || selectedThreadRiftUnavailable}
          placeholder={
            isNativeSubagentThread
              ? 'Read-only subagent transcript — steer from the parent thread.'
              : selectedThreadRiftUnavailable
                ? selectedThreadRiftRemoving
                  ? 'Removing this epic’s rift workspace…'
                  : selectedThreadEpic?.riftRequest?.error
                    ? 'Rift setup needs attention — retry it from the epic view.'
                    : 'Creating this epic’s rift workspace — one moment…'
                : isTerminalThread
                  ? 'Type a prompt — ⏎ sends it to the Claude Code terminal…'
                  : isSending
                    ? steerSupported
                      ? 'Queue a follow-up (⏎) or steer the agent now (⌘⏎)…'
                      : 'Queue a follow-up — sends when the agent finishes (⏎)…'
                    : chatAttachments.length > 0
                      ? `Ask something about the attached ${chatAttachments.some(isVideoAttachment) ? 'media' : 'image'}...`
                      : hasPendingLinkedTasks
                        ? `Add details (optional) — send starts on the linked ${
                            pendingLinkedTasks.length > 1 ? 'tasks' : 'task'
                          }...`
                        : 'Describe what you want the agent to do...'
          }
          value={chatInput}
          onChange={(e) => {
            setChatInput(e.target.value);
            updateChatMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={handleChatKeyDown}
          // Caret moves without input still open/close the mention
          // dropdown. Dropdown-navigation keys are excluded so a
          // handled keydown can't immediately recompute the token.
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              updateChatMention(e.currentTarget.value, e.currentTarget.selectionStart);
            }
          }}
          onClick={(e) => updateChatMention(e.currentTarget.value, e.currentTarget.selectionStart)}
          rows={2}
        />
        <div
          className={`composer-controls${composerControlsCompact ? ' compact' : ''}`}
          ref={composerControlsRef}
        >
          <div className="model-picker-anchor" ref={modelPickerRef}>
            <button
              className="model-trigger"
              onClick={() => {
                if (!modelPickerOpen) {
                  const providerId = selectedAgentModel?.providerId;
                  if (providerId) setActiveProviderTab(providerId);
                }
                setModelPickerOpen(!modelPickerOpen);
              }}
              disabled={isSending}
            >
              {selectedAgentModel &&
                (() => {
                  const ProviderIcon =
                    agentProviders.find((provider) => provider.id === selectedAgentModel.providerId)
                      ?.icon ?? Play;
                  return <ProviderIcon size={15} />;
                })()}
              <span>{selectedAgentModel?.label ?? 'Select model'}</span>
              <ChevronDown
                size={14}
                className={`model-trigger-chevron ${modelPickerOpen ? 'open' : ''}`}
              />
            </button>

            {modelPickerOpen && (
              <ModelPickerPopover
                providers={agentProviders}
                models={visibleAgentModels}
                activeProviderId={activeProviderTab}
                onActiveProviderChange={setActiveProviderTab}
                search={modelSearch}
                onSearchChange={setModelSearch}
                selectedModelId={selectedThread.modelId}
                onSelect={async (model) => {
                  if (
                    selectedThread.modelId === claudeCodeCliModelId &&
                    model.id !== claudeCodeCliModelId
                  ) {
                    try {
                      await window.orion?.terminalKill?.(selectedThread.id);
                    } catch (error) {
                      console.error('Could not stop Claude Code terminal', error);
                    }
                  }
                  updateThread(selectedThread.id, {
                    modelId: model.id,
                    ...(selectedThread.modelId === claudeCodeCliModelId &&
                    model.id !== claudeCodeCliModelId
                      ? { status: 'idle' as const }
                      : {}),
                  });
                  setModelPickerOpen(false);
                  setModelSearch('');
                  if (
                    model.providerId !== 'codex' &&
                    model.providerId !== 'claude' &&
                    model.providerId !== 'grok'
                  ) {
                    setCodexSettingsOpen(false);
                  }
                }}
                overlay={
                  activeProviderTab === 'claude' && claudeCodeCliModel ? (
                    <button
                      type="button"
                      className={`model-cli-overlay${
                        selectedThread.modelId === claudeCodeCliModelId ? ' selected' : ''
                      }`}
                      onClick={() => {
                        if (selectedThread.modelId !== claudeCodeCliModelId) {
                          updateThread(selectedThread.id, {
                            modelId: claudeCodeCliModelId,
                          });
                        }
                        setModelPickerOpen(false);
                        setModelSearch('');
                      }}
                      disabled={claudeCodeCliModel.available === false}
                      title={
                        claudeCodeCliModel.unavailableReason ??
                        'Open an interactive Claude Code terminal in this thread'
                      }
                    >
                      <span className="model-cli-overlay-glow" aria-hidden />
                      <Terminal size={14} strokeWidth={2.25} />
                      <span className="model-cli-overlay-label">Claude Code CLI</span>
                      {selectedThread.modelId === claudeCodeCliModelId && (
                        <Check size={13} strokeWidth={2.5} />
                      )}
                    </button>
                  ) : undefined
                }
              />
            )}
          </div>

          {composerControlsCompact ? (
            /* No room for a chip per control: everything but the model picker
               folds into one menu whose groups expand in place. */
            <div className="composer-menu-anchor" ref={composerMenuRef}>
              <button
                type="button"
                className={`composer-menu-trigger${composerMenuOpen ? ' open' : ''}`}
                onClick={() => {
                  setComposerMenuOpen((open) => !open);
                  setComposerMenuSection(null);
                }}
                aria-haspopup="menu"
                aria-expanded={composerMenuOpen}
                aria-label="Composer options"
                title={`Options — ${agentSettingsSummary} · ${selectedAccessModeLabel}`}
              >
                <Menu size={16} />
                {linkedTaskIds.length > 0 && (
                  <span className="task-link-count">{linkedTaskIds.length}</span>
                )}
              </button>

              {composerMenuOpen &&
                createPortal(
                  <div ref={composerMenuPopoverRef} className="composer-menu" role="menu">
                    {shouldShowAgentSettings && (
                      <div className="composer-menu-group">
                        <button
                          type="button"
                          className={`composer-menu-row ${composerMenuSection === 'agent' ? 'open' : ''}`}
                          onClick={() =>
                            setComposerMenuSection((section) =>
                              section === 'agent' ? null : 'agent'
                            )
                          }
                          disabled={isSending}
                        >
                          <SlidersHorizontal size={14} />
                          <span className="composer-menu-row-label">
                            {selectedAgentModel?.providerId === 'claude'
                              ? 'Reasoning & context'
                              : selectedAgentModel?.providerId === 'grok'
                                ? 'Reasoning'
                                : 'Reasoning & tier'}
                          </span>
                          <span className="composer-menu-row-value">{agentSettingsSummary}</span>
                          <ChevronDown
                            size={13}
                            className={`model-trigger-chevron ${
                              composerMenuSection === 'agent' ? 'open' : ''
                            }`}
                          />
                        </button>
                        {composerMenuSection === 'agent' && (
                          <div className="composer-menu-panel">{agentSettingsOptions}</div>
                        )}
                      </div>
                    )}

                    <div className="composer-menu-group">
                      <button
                        type="button"
                        className={`composer-menu-row ${composerMenuSection === 'access' ? 'open' : ''}`}
                        onClick={() =>
                          setComposerMenuSection((section) =>
                            section === 'access' ? null : 'access'
                          )
                        }
                        disabled={isSending}
                      >
                        <Shield size={14} />
                        <span className="composer-menu-row-label">Access</span>
                        <span className="composer-menu-row-value">{selectedAccessModeLabel}</span>
                        <ChevronDown
                          size={13}
                          className={`model-trigger-chevron ${
                            composerMenuSection === 'access' ? 'open' : ''
                          }`}
                        />
                      </button>
                      {composerMenuSection === 'access' && (
                        <div className="composer-menu-panel">{accessModeList}</div>
                      )}
                    </div>

                    {!isTerminalThread && (
                      <div className="composer-menu-group">
                        <button
                          type="button"
                          className={`composer-menu-row ${composerMenuSection === 'tasks' ? 'open' : ''}`}
                          onClick={() =>
                            setComposerMenuSection((section) =>
                              section === 'tasks' ? null : 'tasks'
                            )
                          }
                          title={linkedTasksLabel}
                        >
                          <SquareKanban size={14} />
                          <span className="composer-menu-row-label">Board tasks</span>
                          <span className="composer-menu-row-value">
                            {linkedTaskIds.length > 0 ? `${linkedTaskIds.length} linked` : 'None'}
                          </span>
                          <ChevronDown
                            size={13}
                            className={`model-trigger-chevron ${
                              composerMenuSection === 'tasks' ? 'open' : ''
                            }`}
                          />
                        </button>
                        {composerMenuSection === 'tasks' && (
                          <div className="composer-menu-panel embedded-picker">
                            <TaskPickerPopover
                              linkedTaskIds={linkedTaskIds}
                              authenticated={accountState.authenticated}
                              onSignIn={() => void handleStartAccountAuth()}
                              onPick={toggleTaskOnSelectedThread}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>,
                  document.body
                )}
            </div>
          ) : (
            <>
              {shouldShowAgentSettings && (
                <div className="codex-settings-anchor" ref={codexSettingsRef}>
                  <button
                    className="codex-settings-trigger"
                    onClick={() => setCodexSettingsOpen((open) => !open)}
                    disabled={isSending}
                    title={
                      selectedAgentModel?.providerId === 'claude'
                        ? 'Claude reasoning and context window'
                        : selectedAgentModel?.providerId === 'grok'
                          ? 'Grok reasoning effort'
                          : 'Codex reasoning and service tier'
                    }
                  >
                    <span>
                      {selectedAgentModel?.providerId === 'claude'
                        ? selectedClaudeReasoningLabel
                        : selectedAgentModel?.providerId === 'grok'
                          ? selectedGrokReasoningLabel
                          : selectedCodexReasoningLabel}
                    </span>
                    {selectedAgentModel?.providerId !== 'grok' && (
                      <>
                        <span className="control-dot">·</span>
                        <span>
                          {selectedAgentModel?.providerId === 'claude'
                            ? selectedClaudeContextWindowLabel
                            : selectedCodexServiceTierLabel}
                        </span>
                      </>
                    )}
                    <ChevronDown
                      size={14}
                      className={`model-trigger-chevron ${codexSettingsOpen ? 'open' : ''}`}
                    />
                  </button>

                  {codexSettingsOpen && (
                    <div className="codex-settings-popover">{agentSettingsOptions}</div>
                  )}
                </div>
              )}

              <div className="access-mode-anchor" ref={accessModeRef}>
                <button
                  type="button"
                  className="access-select"
                  onClick={() => setAccessModeOpen((open) => !open)}
                  disabled={isSending}
                  title="Access level"
                >
                  <Shield size={15} />
                  <span>{selectedAccessModeLabel}</span>
                  <ChevronDown
                    size={13}
                    className={`model-trigger-chevron ${accessModeOpen ? 'open' : ''}`}
                  />
                </button>

                {accessModeOpen && !isSending && (
                  <div className="access-mode-popover">{accessModeList}</div>
                )}
              </div>

              {!isTerminalThread && (
                <div className="task-picker-anchor" ref={taskPickerRef}>
                  <button
                    className={`model-trigger task-link-trigger ${linkedTaskIds.length > 0 ? 'linked' : ''}`}
                    onClick={() => setTaskPickerOpen((open) => !open)}
                    title={linkedTasksLabel}
                    aria-label={linkedTasksLabel}
                  >
                    <SquareKanban size={15} />
                    {linkedTaskIds.length > 1 && (
                      <span className="task-link-count">{linkedTaskIds.length}</span>
                    )}
                  </button>
                  {taskPickerOpen && (
                    <TaskPickerPopover
                      linkedTaskIds={linkedTaskIds}
                      authenticated={accountState.authenticated}
                      onSignIn={() => void handleStartAccountAuth()}
                      onPick={toggleTaskOnSelectedThread}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {isSending ? (
            <>
              {(chatInput.trim() || chatAttachments.length > 0) && (
                <>
                  <button
                    className="send-button"
                    onClick={sendMessage}
                    title="Queue — sends when the current run finishes (⏎)"
                  >
                    <ListPlus size={15} />
                  </button>
                  {steerSupported && (
                    <button
                      className="send-button steer"
                      onClick={steerActiveAgent}
                      disabled={!steerReady}
                      title={
                        steerReady
                          ? 'Steer — interrupt the agent and redirect it now (⌘⏎)'
                          : 'Steer becomes available once the agent reports its session'
                      }
                    >
                      <Zap size={14} />
                    </button>
                  )}
                </>
              )}
              <button className="send-button stop" onClick={stopActiveAgent} title="Stop agent">
                <Square size={14} fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={
                (!chatInput.trim() && chatAttachments.length === 0 && !hasPendingLinkedTasks) ||
                selectedAgentModel?.available === false
              }
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`app-container ${draggingImages ? 'dragging-images' : ''}`}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <Toaster position="top-center" richColors closeButton />
      {draggingImages && (
        <div className="image-drop-overlay">
          <div className="image-drop-target">
            <ImageIcon size={28} />
            <span>Drop images or videos to attach</span>
          </div>
        </div>
      )}

      <div className="app-shellbar">
        <div className="shell-sidebar-chrome">
          <div className="shell-brand">
            <img src={orionIconUrl} alt="Orion" className="shell-brand-logo" width={28} height={28} draggable={false} />
            <span className="shell-brand-name">Orion</span>
          </div>
        </div>

        <div className="shell-main-chrome">
          <div className="shell-title-group">
            {activeTab === 'agents' && selectedThread ? (
              <div className="thread-title-menu shell-thread-title-menu" ref={threadMenuRef}>
                {threadRenameKey === `shell:${selectedThread.id}` ? (
                  <InlineRenameInput
                    className="shell-title-rename-input"
                    initialValue={selectedThread.title}
                    onSubmit={(title) => {
                      updateThread(selectedThread.id, { title });
                      setThreadRenameKey(null);
                    }}
                    onCancel={() => setThreadRenameKey(null)}
                  />
                ) : (
                  <span className="shell-title truncate">{shellTitle}</span>
                )}
                <button
                  type="button"
                  className="thread-title-menu-trigger"
                  onClick={() => setThreadMenuOpen((open) => !open)}
                  aria-label="Thread options"
                  aria-haspopup="menu"
                  aria-expanded={threadMenuOpen}
                  title="Thread options"
                >
                  <Ellipsis size={14} />
                </button>
                {threadMenuOpen && (
                  <div className="thread-menu" role="menu">
                    <button
                      type="button"
                      className="project-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuOpen(false);
                        if (!selectedThread) return;
                        setThreadRenameKey(`shell:${selectedThread.id}`);
                      }}
                    >
                      <SquarePen size={13} /> Rename
                    </button>
                    <button
                      type="button"
                      className="project-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuOpen(false);
                        if (selectedThread) branchThread(selectedThread.id);
                      }}
                    >
                      <GitBranch size={13} /> Branch
                    </button>
                    <button
                      type="button"
                      className="project-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuOpen(false);
                        if (confirm('Delete this thread?')) {
                          void deleteThreadWithRuntime(selectedThread.id);
                        }
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <span className="shell-title truncate">{shellTitle}</span>
            )}
            {activeTab === 'agents' && selectedThread?.goal && (
              <div className="goal-chip-wrap" ref={goalMenuRef}>
                <button
                  type="button"
                  className={`goal-chip status-${selectedThread.goal.status}`}
                  onClick={() => setGoalMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={goalMenuOpen}
                  title={goalSummaryLine(selectedThread.goal)}
                >
                  <Target size={12} />
                  <span className="goal-chip-status">
                    {goalStatusLabels[selectedThread.goal.status] ?? selectedThread.goal.status}
                  </span>
                  <span className="goal-chip-objective truncate">{selectedThread.goal.objective}</span>
                  {goalUsageSummary(selectedThread.goal) && (
                    <span className="goal-chip-usage">{goalUsageSummary(selectedThread.goal)}</span>
                  )}
                </button>
                {goalMenuOpen && (
                  <div className="thread-menu goal-menu" role="menu">
                    {selectedThread.goal.status === 'active' ? (
                      <button
                        type="button"
                        className="project-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setGoalMenuOpen(false);
                          handleGoalCommand('/goal pause', 'pause');
                        }}
                      >
                        <Pause size={13} /> Pause goal
                      </button>
                    ) : selectedThread.goal.status !== 'complete' ? (
                      <button
                        type="button"
                        className="project-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setGoalMenuOpen(false);
                          handleGoalCommand('/goal resume', 'resume');
                        }}
                      >
                        <Play size={13} /> Resume goal
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="project-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        setGoalMenuOpen(false);
                        handleGoalCommand('/goal clear', 'clear');
                      }}
                    >
                      <X size={13} /> Clear goal
                    </button>
                  </div>
                )}
              </div>
            )}
            {shellSubtitle && (
              <>
                <span className="shell-title-divider" />
                <span className="shell-subtitle truncate">{shellSubtitle}</span>
              </>
            )}
            {activeTab === 'agents' && activeThreadProject && (
              <>
                <span className="shell-title-divider" />
                <div className="shell-project-control" ref={projectPickerRef}>
                  <button
                    type="button"
                    className="shell-project-trigger"
                    onClick={() => {
                      if (repositoryOperationBusy || activeRiftUnavailable) return;
                      if (selectedThread && !canChangeSelectedThreadProject) return;
                      setProjectPickerOpen((open) => !open);
                    }}
                    disabled={
                      repositoryOperationBusy ||
                      activeRiftUnavailable ||
                      (!!selectedThread && !canChangeSelectedThreadProject)
                    }
                    title={
                      repositoryOperationBusy
                        ? 'Repository operation in progress'
                        : activeRiftUnavailable
                          ? 'Wait for the epic’s rift workspace to become available'
                          : selectedThread && !canChangeSelectedThreadProject
                            ? selectedThreadEpic?.riftPath || selectedThreadRiftPending
                              ? 'Project is locked to the epic’s rift'
                              : 'Project is locked after an agent runs'
                            : activeThreadProject.path
                    }
                    aria-haspopup="menu"
                    aria-expanded={projectPickerOpen && !repositoryOperationBusy}
                  >
                    <ProjectIcon projectPath={activeThreadProject.path} size={14} />
                    <span className="truncate">{activeThreadProject.name}</span>
                    {(!selectedThread || canChangeSelectedThreadProject) && (
                      <ChevronDown size={13} className={`project-pill-chevron ${projectPickerOpen ? 'open' : ''}`} />
                    )}
                  </button>
                  {projectPickerOpen &&
                    !repositoryOperationBusy &&
                    !activeRiftUnavailable &&
                    (!selectedThread || canChangeSelectedThreadProject) && (
                      <div className="shell-project-picker" role="menu">
                        {projects.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`project-picker-item ${option.id === activeThreadProject.id ? 'selected' : ''}`}
                            onClick={() => handleChangeSelectedThreadProject(option.id)}
                            title={option.path}
                          >
                            <ProjectIcon projectPath={option.path} size={13} />
                            <span className="truncate">{option.name}</span>
                            {option.id === activeThreadProject.id && <Check size={13} />}
                          </button>
                        ))}
                        <div className="project-picker-divider" />
                        <button
                          type="button"
                          className="project-picker-item"
                          onClick={() => {
                            setProjectPickerOpen(false);
                            void handleAddProject();
                          }}
                        >
                          <Plus size={13} /> Add project
                        </button>
                        {activeThreadProject && projects.length > 1 && (
                          <button
                            type="button"
                            className="project-picker-item danger"
                            onClick={() => {
                              setProjectPickerOpen(false);
                              if (confirm(`Remove project "${activeThreadProject.name}"?`)) {
                                void removeProjectWithRuntimes(activeThreadProject.id);
                              }
                            }}
                          >
                            <Trash2 size={13} /> Remove project
                          </button>
                        )}
                      </div>
                    )}
                </div>

                <div className="shell-branch-control" ref={branchPickerRef}>
                  <button
                    type="button"
                    className="shell-branch-trigger"
                    onClick={() => {
                      if (!activeRiftUnavailable) setBranchPickerOpen((open) => !open);
                    }}
                    disabled={activeRiftUnavailable || gitLoading || repositoryOperationBusy || !gitState?.ok}
                    title={gitState?.error ?? gitState?.root ?? 'Git state'}
                    aria-haspopup="menu"
                    aria-expanded={branchPickerOpen && !repositoryOperationBusy}
                  >
                    <GitBranch size={14} />
                    <span className="truncate">
                      {gitLoading
                        ? 'Git...'
                        : (gitState?.currentBranch ??
                          (gitState?.detachedHead ? `Detached @ ${gitState.detachedHead}` : 'No Git'))}
                    </span>
                    <ChevronDown size={13} className={`project-pill-chevron ${branchPickerOpen ? 'open' : ''}`} />
                  </button>
                  {branchPickerOpen && !repositoryOperationBusy && !activeRiftUnavailable && (
                    <div className="shell-branch-picker" role="menu">
                      {gitState?.hasUncommittedChanges && (
                        <div className="branch-picker-note">Commit local changes before switching branches.</div>
                      )}
                      {gitState?.branches.map((branch) => (
                        <button
                          key={branch.name}
                          type="button"
                          className={`branch-picker-item ${branch.current ? 'selected' : ''}`}
                          onClick={() => handleCheckoutBranch(branch.name)}
                          disabled={branch.current || gitState.hasUncommittedChanges || repositoryOperationBusy}
                          title={
                            gitState.hasUncommittedChanges && !branch.current
                              ? 'Unavailable with uncommitted changes'
                              : branch.name
                          }
                        >
                          <GitBranch size={13} />
                          <span className="truncate">{branch.name}</span>
                          {branch.current && <Check size={13} />}
                        </button>
                      ))}
                      {gitState?.branches.length === 0 && (
                        <div className="branch-picker-empty">{gitState?.error ?? 'No branches found'}</div>
                      )}
                      <div className="project-picker-divider" />
                      {creatingBranch ? (
                        <div className="branch-picker-item branch-picker-create-row">
                          <Plus size={13} />
                          <InlineRenameInput
                            className="thread-rename-input"
                            initialValue=""
                            onSubmit={(name) => {
                              setCreatingBranch(false);
                              void handleCreateBranch(name);
                            }}
                            onCancel={() => setCreatingBranch(false)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="branch-picker-item"
                          onClick={() => setCreatingBranch(true)}
                          disabled={repositoryOperationBusy || !gitState?.ok}
                        >
                          <Plus size={13} /> New branch
                        </button>
                      )}
                      <button
                        type="button"
                        className="branch-picker-item"
                        onClick={() => {
                          setBranchPickerOpen(false);
                          void handleCommitAndPush();
                        }}
                        disabled={repositoryOperationBusy || !gitState?.ok || !gitState.currentBranch}
                        title="git add . && git commit && git push"
                      >
                        <GitCommit size={13} /> Commit and Push
                      </button>
                    </div>
                  )}
                </div>

                {gitState?.ok && cloudState?.ok && (
                  <button
                    type="button"
                    className={`shell-cloud-button ${
                      cloudState.linked && (cloudState.sync === 'ahead' || cloudState.sync === 'diverged')
                        ? 'attention'
                        : ''
                    }`}
                    onClick={() => {
                      if (!cloudState.authenticated) {
                        toast.info('Sign in to your Orion account to publish this repository.');
                        setSettingsTab('account');
                        setSettingsOpen(true);
                        return;
                      }
                      if (cloudState.linked) {
                        void handleCloudPush();
                      } else {
                        void handleCloudPublish();
                      }
                    }}
                    disabled={repositoryOperationBusy}
                    title={
                      !cloudState.linked
                        ? 'Publish this repository to Orion Cloud'
                        : cloudState.sync === 'diverged'
                          ? 'Local and cloud history diverged'
                          : 'Push local commits to Orion Cloud'
                    }
                  >
                    {cloudState.linked ? <CloudUpload size={14} /> : <Cloud size={14} />}
                    <span>
                      {cloudBusy
                        ? cloudState.linked
                          ? 'Pushing…'
                          : 'Publishing…'
                        : cloudState.linked
                          ? 'Push'
                          : 'Publish'}
                    </span>
                  </button>
                )}

                {gitState?.ok && cloudState?.ok && cloudState.linked && (
                  <div className="shell-cloud-group" title={`Orion Cloud: ${cloudState.repoName ?? ''}`}>
                    <button
                      type="button"
                      className={`shell-cloud-icon-button ${
                        cloudState.sync === 'behind' || cloudState.sync === 'diverged' ? 'attention' : ''
                      }`}
                      onClick={() => void handleCloudPull()}
                      disabled={repositoryOperationBusy}
                      title={
                        cloudState.sync === 'behind'
                          ? 'Orion Cloud has new changes — pull them'
                          : 'Pull from Orion Cloud'
                      }
                    >
                      <CloudDownload size={14} />
                    </button>
                    <button
                      type="button"
                      className="shell-cloud-icon-button"
                      onClick={() => activeWorkingDir && void window.orion?.openCloudRepoInBrowser?.(activeWorkingDir)}
                      disabled={!cloudState.linked}
                      title="Open on Orion Cloud"
                    >
                      <Globe size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
            {activeTab === 'agents' && selectedThread && (
              <span className={`status-dot shell-status-dot ${selectedThread.status}`} />
            )}
          </div>

          <div className="shell-right-group">
            {openWithApps.length > 0 && activeWorkingDir && (
              <div className="shell-openwith-control" ref={openWithRef}>
                <button
                  type="button"
                  className="shell-openwith-trigger"
                  onClick={() => setOpenWithOpen((open) => !open)}
                  title={`Open ${activeWorkingDir.split(/[\\/]/).pop() || activeWorkingDir} in another app`}
                  aria-label="Open with"
                  aria-haspopup="menu"
                  aria-expanded={openWithOpen}
                >
                  <SquareArrowOutUpRight size={14} />
                  <ChevronDown size={13} className={`project-pill-chevron ${openWithOpen ? 'open' : ''}`} />
                </button>
                {openWithOpen && (
                  <div className="shell-openwith-menu" role="menu">
                    {openWithApps.map((appOption) => (
                      <button
                        key={appOption.id}
                        type="button"
                        className="openwith-item"
                        role="menuitem"
                        onClick={() => {
                          setOpenWithOpen(false);
                          void window.orion
                            ?.openProjectWith?.({
                              appId: appOption.id,
                              projectPath: activeWorkingDir,
                            })
                            .then((result) => {
                              if (result && !result.ok && result.error) {
                                toast.error(result.error);
                              }
                            });
                        }}
                      >
                        {appOption.icon ? (
                          <img
                            src={appOption.icon}
                            alt=""
                            className="openwith-item-icon"
                            width={18}
                            height={18}
                            draggable={false}
                          />
                        ) : (
                          <AppWindow size={16} className="openwith-item-icon" />
                        )}
                        <span className="truncate">{appOption.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="shell-mode-tabs" role="tablist" aria-label="Mode">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'agents'}
                className={`shell-mode-tab ${activeTab === 'agents' ? 'active' : ''}`}
                onClick={() => handleSetActiveTab('agents')}
              >
                <MessageSquare size={15} /> Agents
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'code'}
                className={`shell-mode-tab ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => handleSetActiveTab('code')}
              >
                <Code2 size={15} /> Code
              </button>
            </div>
          </div>
        </div>
      </div>

      {!settingsOpen && availableProviderUpdates.length > 0 && (
        <div className="provider-update-banner" role="status">
          <div className="provider-update-copy" title={providerUpdateTooltip}>
            <RefreshCw size={14} className={providerUpdatesRunning ? 'spinning' : ''} />
            <span>{providerUpdateSummary}</span>
          </div>
          <button
            type="button"
            className="provider-update-button"
            onClick={handleUpdateProviders}
            disabled={providerUpdatesRunning}
            aria-busy={providerUpdatesRunning}
          >
            Update providers
          </button>
        </div>
      )}

      {settingsOpen && (
        <React.Suspense fallback={<div className="settings-page" />}>
          <SettingsPage {...settingsPageModel} />
        </React.Suspense>
      )}

      {!settingsOpen && (
        <div className="main-content">
          {/* ========== AGENTS TAB ========== */}
          {activeTab === 'agents' && (
            <>
              {/* Sidebar: Projects + Threads */}
              <AgentsSidebar {...agentsSidebarModel} />

              {/* Main Panel: Thread view */}
              <div
                className={`panel agents-panel${threadDropActive ? ' thread-drop-active' : ''}`}
                onDragOver={handleThreadDragOver}
                onDragLeave={handleThreadDragLeave}
                onDrop={handleThreadDrop}
              >
                {threadDropActive && (
                  <div className={`thread-drop-hint${splitFull ? ' full' : ''}`}>
                    <Columns3 size={18} />
                    <span>
                      {splitFull
                        ? `Split view is full — ${MAX_THREAD_PANES} panes is the limit`
                        : threadPanes.length === 0
                          ? 'Drop to open this thread'
                          : 'Drop to open beside the current view'}
                    </span>
                  </div>
                )}
                {threadPanes.length === 0 && selectedEpic ? (
                  <div className="epic-view">
                    <div className="epic-view-header">
                      <div
                        className={`epic-view-icon ${
                          selectedEpicPrStatus ? `epic-view-icon--${selectedEpicPrStatus}` : ''
                        }`}
                      >
                        <SquareKanban size={24} />
                      </div>
                      <div className="epic-view-heading">
                        <h2 className="epic-view-title">{selectedEpic.name}</h2>
                        <div className="epic-view-meta">
                          {(selectedEpicRepositoryProject || selectedEpicClaimedProject) && (
                            <span
                              className="epic-view-project"
                              title={
                                selectedEpic.gitRoot ??
                                selectedEpicRepositoryProject?.path ??
                                selectedEpicClaimedProject?.path
                              }
                            >
                              <ProjectIcon
                                projectPath={
                                  selectedEpic.gitRoot ??
                                  selectedEpicRepositoryProject?.path ??
                                  selectedEpicClaimedProject!.path
                                }
                                size={13}
                              />
                              {selectedEpicRepositoryProject?.name ?? selectedEpicClaimedProject?.name}
                            </span>
                          )}
                          <span>
                            {selectedEpicThreads.length === 1 ? '1 thread' : `${selectedEpicThreads.length} threads`}
                          </span>
                          <span>Created {formatShortTime(new Date(selectedEpic.createdAt))}</span>
                        </div>
                      </div>
                    </div>

                    <div className="epic-view-description-block">
                      <label className="epic-view-description-label" htmlFor="epic-description">
                        Description
                      </label>
                      <EpicDescriptionEditor
                        key={selectedEpic.id}
                        epicId={selectedEpic.id}
                        initialValue={selectedEpic.description ?? ''}
                        onCommit={(epicId, description) => updateEpic(epicId, { description })}
                      />
                    </div>

                    <div className="epic-view-repository-block">
                      <label className="epic-view-description-label" id="epic-repository-label">
                        Repository
                      </label>
                      {selectedEpic.gitRoot ? (
                        <div className="epic-view-repository-claimed" title={selectedEpic.gitRoot}>
                          <GitBranch size={14} />
                          <span>
                            {selectedEpicClaimedProject?.name ?? selectedEpic.gitRoot}
                            {selectedEpic.gitBranch ? ` · ${selectedEpic.gitBranch}` : ''}
                          </span>
                        </div>
                      ) : (
                        <div className="epic-view-repository-picker" ref={epicRepoPickerRef}>
                          <button
                            type="button"
                            id="epic-repository"
                            className="epic-view-repository-trigger"
                            disabled={
                              selectedEpicOperationBusy || Boolean(selectedEpic.riftRequest) || projects.length === 0
                            }
                            onClick={() => {
                              if (selectedEpicOperationBusy || selectedEpic.riftRequest) return;
                              setEpicRepoPickerOpen((open) => !open);
                            }}
                            aria-haspopup="menu"
                            aria-expanded={epicRepoPickerOpen && !selectedEpicOperationBusy}
                            aria-labelledby="epic-repository-label"
                            title={
                              selectedEpicRepositoryProject?.path ??
                              (projects.length === 0 ? 'Add a project first' : 'Choose the repository for this epic')
                            }
                          >
                            {selectedEpicRepositoryProject ? (
                              <>
                                <ProjectIcon projectPath={selectedEpicRepositoryProject.path} size={14} />
                                <span className="truncate">{selectedEpicRepositoryProject.name}</span>
                              </>
                            ) : (
                              <span className="epic-view-repository-placeholder truncate">
                                {projects.length === 0 ? 'No projects available' : 'Select repository…'}
                              </span>
                            )}
                            <ChevronDown
                              size={14}
                              className={`project-pill-chevron ${epicRepoPickerOpen ? 'open' : ''}`}
                            />
                          </button>
                          {epicRepoPickerOpen &&
                            !selectedEpicOperationBusy &&
                            !selectedEpic.riftRequest &&
                            projects.length > 0 && (
                              <div
                                className="shell-project-picker epic-view-repository-menu"
                                role="menu"
                                aria-labelledby="epic-repository-label"
                              >
                                {projects.map((option) => {
                                  const selected = option.id === selectedEpic.repositoryProjectId;
                                  return (
                                    <button
                                      key={option.id}
                                      type="button"
                                      role="menuitemradio"
                                      aria-checked={selected}
                                      className={`project-picker-item ${selected ? 'selected' : ''}`}
                                      onClick={() => {
                                        setEpicRepoPickerOpen(false);
                                        updateEpic(selectedEpic.id, {
                                          repositoryProjectId: option.id,
                                        });
                                      }}
                                      title={option.path}
                                    >
                                      <ProjectIcon projectPath={option.path} size={13} />
                                      <span className="truncate">{option.name}</span>
                                      {selected && <Check size={13} />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                        </div>
                      )}
                      {selectedEpic.riftPath && (
                        <div className="epic-view-repository-claimed epic-view-rift" title={selectedEpic.riftPath}>
                          <FlaskConical size={14} />
                          <span className="truncate">Rift · {selectedEpic.riftPath}</span>
                        </div>
                      )}
                      <span className="epic-view-repository-hint">
                        {selectedEpic.riftPath
                          ? 'Threads and git actions run inside this epic’s rift workspace.'
                          : selectedEpic.riftRequest
                            ? 'This epic stays locked to its requested project until Rift setup succeeds.'
                            : selectedEpic.gitRoot
                              ? 'This epic is locked to its claimed repository and feature branch.'
                              : 'Choose the repository explicitly before using git actions.'}
                      </span>
                    </div>

                    <div className="epic-view-actions">
                      <div className="flex flex-col items-start gap-1.5">
                        <button
                          type="button"
                          className="btn"
                          disabled={
                            selectedEpicOperationBusy ||
                            activeRiftUnavailable ||
                            riftRemovalEpicIds[selectedEpic.id] ||
                            (!selectedEpicRepositoryProject && !selectedEpic.gitRoot) ||
                            !selectedEpicHasWorkToPush ||
                            selectedEpicHasRunningAgents
                          }
                          onClick={() => {
                            if (epicPromptGitMessages) openEpicCommitDialog(selectedEpic);
                            else void handleEpicCommitAndPush(selectedEpic);
                          }}
                          title={
                            selectedEpicHasRunningAgents
                              ? 'Agents are still running in this epic — wait for them to finish before committing'
                              : !selectedEpicHasWorkToPush
                                ? 'Nothing to commit — the workspace is clean and fully pushed'
                                : epicPromptGitMessages
                                  ? 'Stage all changes, write or generate a commit message, then commit and push'
                                  : 'Stage all changes, generate a commit message, then commit and push'
                          }
                        >
                          <GitCommit size={14} />
                          {selectedEpicGitBusy === 'commit' ? 'Committing…' : 'Commit & push'}
                        </button>
                        <label
                          className="inline-flex items-center gap-1.5 cursor-pointer select-none group"
                          title={
                            selectedEpicPrBadge && selectedEpicPrBadge.modifier !== 'closed'
                              ? 'This epic already has a pull request — the push updates it, so no new PR is opened'
                              : 'Open the pull request as soon as commit & push succeeds, with a generated title and description into your project’s current branch — start the commit and navigate away'
                          }
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={Boolean(selectedEpic.autoPrAfterCommit)}
                            onChange={(e) =>
                              updateEpic(selectedEpic.id, {
                                autoPrAfterCommit: e.target.checked,
                              })
                            }
                          />
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:[&_svg]:opacity-100 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)] group-hover:border-[var(--text-muted)]"
                            aria-hidden
                          >
                            <Check size={10} strokeWidth={3} className="text-white opacity-0 transition-opacity" />
                          </span>
                          <span className="text-[11px] leading-none text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                            Auto create PR on commit
                          </span>
                        </label>
                      </div>
                      {selectedEpicPrBadge && (
                        <button
                          type="button"
                          className={`btn epic-view-pr-state epic-view-pr-state--${selectedEpicPrBadge.modifier}`}
                          onClick={() => openEpicPrUrl(selectedEpic.prUrl as string)}
                          title={
                            selectedEpicPrBadge.modifier === 'merged'
                              ? 'The pull request is merged — settle the epic to archive it'
                              : 'This epic already has a pull request — click to view it on GitHub'
                          }
                        >
                          {selectedEpicPrBadge.modifier === 'merged' ? (
                            <GitMerge size={14} />
                          ) : selectedEpicPrBadge.modifier === 'closed' ? (
                            <GitPullRequestClosed size={14} />
                          ) : (
                            <GitPullRequest size={14} />
                          )}
                          {selectedEpicPrBadge.label}
                        </button>
                      )}
                      {(!selectedEpicPrBadge || selectedEpicPrBadge.modifier === 'closed') && (
                        <button
                          type="button"
                          className="btn"
                          disabled={
                            selectedEpicOperationBusy ||
                            activeRiftUnavailable ||
                            riftRemovalEpicIds[selectedEpic.id] ||
                            (!selectedEpicRepositoryProject && !selectedEpic.gitRoot) ||
                            selectedEpicHasRunningAgents
                          }
                          onClick={() => {
                            if (epicPromptGitMessages) openEpicPrBaseDialog(selectedEpic);
                            else void createEpicPrWithoutPrompt(selectedEpic);
                          }}
                          title={
                            selectedEpicHasRunningAgents
                              ? 'Agents are still running in this epic — wait for them to finish before opening a PR'
                              : selectedEpicPrBadge?.modifier === 'closed'
                                ? 'Open a replacement pull request for this branch'
                                : epicPromptGitMessages
                                  ? 'Choose a base branch and optionally write the title and description, then open a pull request'
                                  : 'Open a pull request into your project’s current branch with a generated title and description'
                          }
                        >
                          <GitPullRequest size={14} />
                          {selectedEpicGitBusy === 'pr'
                            ? 'Opening PR…'
                            : selectedEpicGitBusy === 'pr-branches'
                              ? 'Loading branches…'
                              : selectedEpicPrBadge?.modifier === 'closed'
                                ? 'Create replacement PR'
                                : 'Create PR'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn epic-view-settle"
                        disabled={!!selectedEpicGitBusy || selectedEpicHasRunningAgents}
                        onClick={() => void handleSettleEpic(selectedEpic)}
                        title={
                          selectedEpicHasRunningAgents
                            ? 'Agents are still running in this epic — wait for them to finish before settling it'
                            : 'Archive this epic; uncommitted work or pull request state will be explained before settling'
                        }
                      >
                        <Archive size={14} />
                        Settle
                      </button>
                    </div>

                    {(selectedEpicGitBusy || riftSetupEpicIds[selectedEpic.id]) && (
                      <div className="epic-view-status">
                        <span className="working-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        {riftSetupEpicIds[selectedEpic.id]
                          ? 'Creating the epic’s rift workspace and branch…'
                          : selectedEpicGitBusy === 'commit'
                            ? 'Staging all changes and writing a commit message, then pushing…'
                            : selectedEpicGitBusy === 'pr-branches'
                              ? 'Fetching the branches on origin…'
                              : selectedEpicGitBusy === 'settle'
                                ? 'Checking the workspace and pull request state…'
                                : 'Writing the PR message and opening the pull request…'}
                      </div>
                    )}

                    {selectedEpic.riftRequest &&
                      !riftSetupEpicIds[selectedEpic.id] &&
                      !selectedEpic.riftCleanupPending && (
                        <div className="epic-view-rift-retry">
                          <span>
                            {selectedEpic.riftRequest.error ??
                              'Rift setup still needs to finish before this epic can run.'}
                          </span>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={repositoryOperationBusy}
                            onClick={() => void setupRiftForEpic(selectedEpic.id)}
                          >
                            <RefreshCw size={13} />
                            Retry Rift setup
                          </button>
                        </div>
                      )}

                    {selectedEpic.prUrl && (
                      <button
                        type="button"
                        className="epic-view-pr-link"
                        onClick={() => openEpicPrUrl(selectedEpic.prUrl as string)}
                        title="Open the pull request in your browser"
                      >
                        <GitPullRequest size={13} />
                        <span className="truncate">{selectedEpic.prUrl}</span>
                        <SquareArrowOutUpRight size={12} />
                      </button>
                    )}

                    <div className="epic-view-threads">
                      <div className="epic-view-threads-header">
                        <span>Threads</span>
                        <button
                          type="button"
                          className="sidebar-section-action"
                          title="New thread"
                          aria-label="New thread"
                          onClick={() => handleCreateThreadForEpic(selectedEpic)}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      {selectedEpicThreads.length === 0 ? (
                        <div className="epic-view-empty">No threads yet — spawn one to start working this epic.</div>
                      ) : (
                        <div className="threads-list epic-view-threads-list">
                          {selectedEpicThreads.map((thread) => (
                            <div key={thread.id} className="thread-item" onClick={() => selectThread(thread.id)}>
                              {renderThreadStatusDot(thread)}
                              <span className="thread-title">
                                {renderThreadCliBadge(thread)}
                                <span className="thread-title-text">{thread.title}</span>
                              </span>
                              <span className="thread-project-tag thread-meta">
                                {projects.find((p) => p.id === thread.projectId)?.name}
                              </span>
                              <span className="thread-time thread-meta">
                                {formatShortTime(getThreadActivityTime(thread))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : threadPanes.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Bot size={30} />
                    </div>
                    <div className="empty-state-title">Select a thread</div>
                    <div className="text-xs text-[#6b6b74]">Pick a conversation or start a new one</div>
                    {projects.length > 0 && (
                      <button
                        onClick={() => handleCreateThread(selectedProject?.id ?? projects[0].id)}
                        className="btn mt-2"
                      >
                        <Plus size={15} /> Start new thread
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={`thread-panes count-${threadPanes.length}`}>
                    {threadPanes.map((pane) => {
                      const tasksCardState = tasksCardStates[pane.thread.id] ?? {
                        position: null,
                        collapsed: false,
                        dismissedFor: null,
                      };
                      return (
                        <ThreadPane
                          key={pane.thread.id}
                          thread={pane.thread}
                          project={pane.project}
                          focused={pane.focused}
                          split={threadPanes.length > 1}
                          onFocus={() => selectThread(pane.thread.id)}
                          onClose={() => closeThreadPane(pane.thread.id)}
                          statusDot={renderThreadStatusDot(pane.thread)}
                        >
                          {pane.isTerminal ? (
                            // Mounting spawns the CLI: hold off until the epic's
                            // rift exists so the terminal never opens in the source
                            // repository and then has to move.
                            pane.riftUnavailable ? (
                              <div className="terminal-view" />
                            ) : (
                              <React.Suspense fallback={<div className="terminal-view" />}>
                                <TerminalView
                                  key={pane.thread.id}
                                  threadId={pane.thread.id}
                                  epicId={pane.thread.epicId}
                                  projectPath={pane.projectPath ?? ''}
                                  accessMode={pane.thread.accessMode ?? 'full-access'}
                                  focused={pane.focused}
                                  resumeSessionId={pane.thread.agentSessionIds?.claude}
                                  forkSession={pane.thread.pendingForkProviders?.includes('claude')}
                                />
                              </React.Suspense>
                            )
                          ) : (
                            <ChatTranscript
                              threadId={pane.thread.id}
                              projectName={pane.project?.name}
                              projects={projects}
                              canChangeProject={pane.canChangeProject}
                              onSelectProject={handleChangeSelectedThreadProject}
                              onAddProject={handleAddProject}
                              mediaBaseDirs={pane.mediaBaseDirs}
                              isSending={pane.isSending}
                              steerSupported={pane.steerSupported}
                              steerReady={pane.steerReady}
                              authenticatingProviderId={authenticatingProviderId}
                              {...paneChatRefs(pane.thread.id)}
                              chatScrollPositionsRef={chatScrollPositionsRef}
                              tasksCardPosition={tasksCardState.position}
                              tasksCardCollapsed={tasksCardState.collapsed}
                              tasksCardDismissedFor={tasksCardState.dismissedFor}
                              onMoveTasksCard={moveTasksCard}
                              onToggleTasksCard={toggleTasksCard}
                              onDismissTasksCard={dismissTasksCard}
                              onMarkTaskDone={markLinkedTaskDone}
                              onUnlinkTask={unlinkTaskFromThread}
                              onDismissBtwExchange={dismissBtwExchange}
                              onAuthenticateProvider={handleAuthenticateProvider}
                              onSteerQueuedMessage={steerQueuedMessage}
                            />
                          )}
                          {pane.focused ? composerNode : null}
                        </ThreadPane>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ========== CODE TAB ========== */}
          {activeTab === 'code' && (
            <CodeWorkspace
              runningAgentCount={runningAgentCount}
              turnRefreshTick={treeTurnRefreshTick}
              sidebarFooterProps={sidebarFooterProps}
            />
          )}
        </div>
      )}

      {hasOpenDialog && (
        <React.Suspense fallback={null}>
          <AppDialogs model={appDialogsModel} />
        </React.Suspense>
      )}
    </div>
  );
};

export default App;
