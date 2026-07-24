import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import {
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
  MessageSquare,
  Code2,
  GitBranch,
  GitCommit,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  EyeOff,
  SquarePen,
  Check,
  X,
  Folder,
  FileText,
  Pin,
  PinOff,
  Play,
  Pause,
  Target,
  Search,
  Shield,
  Square,
  Terminal,
  Wrench,
  Bot,
  Sparkles,
  ArrowUp,
  Download,
  Image as ImageIcon,
  RefreshCw,
  Settings,
  Keyboard,
  Link,
  Archive,
  Plug,
  Palette,
  UserRound,
  LogIn,
  LogOut,
  Cloud,
  CloudUpload,
  CloudDownload,
  Globe,
  Copy,
  AppWindow,
  SquareArrowOutUpRight,
  ListPlus,
  Zap,
  SquareKanban,
  CircleCheck,
  MousePointerClick,
  ListChecks,
  FilePen,
  BookOpen,
  Workflow,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  useOrionStore,
  defaultProviderSettings,
  defaultOrchestrationSettings,
  defaultNotificationSettings,
  type AgentActivity,
  type BtwExchange,
  type ChangedFileSummary,
  type ImageAttachment,
  type LinkedBoardTask,
  type Message,
  type OrchestrationRoleId,
  type Project,
  type ProviderId,
  type ProviderRuntimeOptions,
  type Thread,
  type ThreadGoal,
  type TurnTokenStats,
} from './store';
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
  defaultClaudeReasoningEffort,
  defaultCodexServiceTier,
  defaultGrokReasoningEffort,
  getEffectiveCodexReasoningEffort,
  grokReasoningOptions,
  fallbackAgentModels,
  findAgentModel,
  isClaudeCodeCliModelId,
  isOrionModelId,
  providerFollowUpSupport,
  providerOptionDefs,
  type AgentModel,
  type AgentProviderId,
  type ClaudeContextWindow,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type CodexServiceTier,
  type GrokReasoningEffort,
} from './agentCatalog';
import orionIconUrl from '../assets/icon.png';
import { CodeEditorPane } from './app/CodeEditorPane';
import { ProjectIcon } from './app/ProjectIcon';
import { TaskPickerPopover } from './app/TaskPickerPopover';
import { goalStatusLabels, goalSummaryLine, goalUsageSummary } from './app/activity';
import { AttachmentThumb, buildPromptWithAttachments, formatAttachmentSize, getDroppedFilePath, isMediaFile, isVideoAttachment, isVideoFile } from './app/attachments';
import { AgentFamilySwitcher, ChatTranscript, isProviderAuthErrorText } from './app/chat';
import { type FileTreeItem, FileTreeNode, InlineRenameInput } from './app/fileTree';
import { claudeOneMillionOnlyModelSlugs, getDefaultClaudeReasoningEffort, getEffectiveClaudeContextWindow } from './app/modelPrefs';
import { accessModeOptions, buildLinkedTaskContext, buildModelMentionsContext, buildOrchestrationContext, buildReviewThreadContext, linkedTaskFromBoardTask, linkedTaskMediaAttachments, linkedTaskStatusLabel, modelMentionToken, orchestrationRoleMeta, parseModelMentions } from './app/promptContext';
import { ThreadSearchResults } from './app/threadSearch';
import { formatShortTime, getThreadActivityTime } from './app/time';
import { deriveTitle, isDefaultTitle, isPlausibleTitle, tryGenerateBetterTitle } from './app/titles';

// Lazy-loaded so xterm (and the TerminalView code) is split into its own
// chunk and only fetched/parsed when a Claude Code CLI thread is actually
// opened — the pseudo-model costs nothing at startup. (Its main-process
// counterpart, node-pty, is likewise only import()ed on first terminal:ensure.)
const TerminalView = React.lazy(() => import('./TerminalView'));

type GitBranchInfo = {
  name: string;
  current: boolean;
  hasUpstream: boolean;
};

type GitRepoState = {
  ok: boolean;
  root?: string;
  currentBranch?: string;
  branches: GitBranchInfo[];
  hasUncommittedChanges: boolean;
  ahead?: number;
  behind?: number;
  error?: string;
};

type ProviderUpdateItem = {
  id: string;
  label: string;
  command: string;
  enabled: boolean;
  installed: boolean;
  path?: string | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  status: 'available' | 'current' | 'unknown' | 'missing' | 'error';
  auth: {
    authenticated: boolean | null;
    status: 'authenticated' | 'unauthenticated' | 'unknown' | 'missing' | 'error';
    label: string;
    detail?: string;
  };
  error?: string;
};

type ProviderUpdateState = {
  checkedAt: string;
  updatesAvailable: number;
  providers: ProviderUpdateItem[];
};

type AppUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  currentVersion: string;
  checkedAt?: string | null;
  availableVersion?: string | null;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  } | null;
  error?: string | null;
};

type OrionAccountState = {
  authenticated: boolean;
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    imageUrl?: string | null;
  } | null;
  expiresAt: string | null;
};

type SettingsTab =
  | 'account'
  | 'general'
  | 'providers'
  | 'orchestration'
  | 'computer-use'
  | 'cosmetics';

const THREADS_VISIBLE_LIMIT = 5;

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
    thread.parentThreadId,
    thread.branchedFromThreadId,
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
    JSON.stringify(thread.linkedTask ?? null),
  ].join('\u0000');
  threadShellSignatureCache.set(thread, signature);
  return signature;
};

const App: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    projects,
    selectedProjectId,
    selectedThreadId,
    addProject,
    removeProject,
    renameProject,
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
    openFile,
    closeFile,
    setActiveFile,
    closeAllFiles,
    providerSettings,
    setProviderEnabled,
    setProviderOptions,
    orchestrationSettings,
    setOrchestrationRoleModel,
    setOrchestrationGeneralInstructions,
    notificationSettings,
    setNotificationSettings,
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
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      selectedThreadId: state.selectedThreadId,
      addProject: state.addProject,
      removeProject: state.removeProject,
      renameProject: state.renameProject,
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
      openFile: state.openFile,
      closeFile: state.closeFile,
      setActiveFile: state.setActiveFile,
      closeAllFiles: state.closeAllFiles,
      providerSettings: state.providerSettings,
      setProviderEnabled: state.setProviderEnabled,
      setProviderOptions: state.setProviderOptions,
      orchestrationSettings: state.orchestrationSettings,
      setOrchestrationRoleModel: state.setOrchestrationRoleModel,
      setOrchestrationGeneralInstructions: state.setOrchestrationGeneralInstructions,
      notificationSettings: state.notificationSettings,
      setNotificationSettings: state.setNotificationSettings,
      setThreadAgentSession: state.setThreadAgentSession,
      queueMessageToThread: state.queueMessageToThread,
      removeQueuedThreadMessage: state.removeQueuedThreadMessage,
      addBtwExchange: state.addBtwExchange,
      appendToBtwExchange: state.appendToBtwExchange,
      updateBtwExchange: state.updateBtwExchange,
      removeBtwExchange: state.removeBtwExchange,
    }))
  );
  const threadShellSignatures = useOrionStore(
    useShallow((state) => state.threads.map(threadShellSignature))
  );
  const threads = useMemo(
    () => useOrionStore.getState().threads,
    [threadShellSignatures]
  );
  const openFileShellSignatures = useOrionStore(
    useShallow((state) =>
      state.openFiles.map((file) => `${file.path}\u0000${file.isDirty ? '1' : '0'}`)
    )
  );
  const openFiles = useMemo(
    () => useOrionStore.getState().openFiles,
    [openFileShellSignatures]
  );

  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [treeItems, setTreeItems] = useState<FileTreeItem[]>([]);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
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
  const activeRunId = selectedThreadId ? activeRunsByThread[selectedThreadId] ?? null : null;
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
  // Active @-mention token in the composer: index of the '@' and the query
  // typed after it (null when the caret isn't inside a mention token).
  const [chatMention, setChatMention] = useState<{ start: number; query: string } | null>(null);
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
  const [openWithApps, setOpenWithApps] = useState<
    Array<{ id: string; name: string; icon: string | null }>
  >([]);
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
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState | null>(null);
  const [providerUpdatesRunning, setProviderUpdatesRunning] = useState(false);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [expandedProviderOptions, setExpandedProviderOptions] = useState<Record<string, boolean>>({});
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const openWithRef = useRef<HTMLDivElement>(null);
  const threadSearchRef = useRef<HTMLDivElement>(null);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  const goalMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const threadItemMenuRef = useRef<HTMLDivElement>(null);
  const runOutputMessages = useRef(new Map<string, { threadId: string; messageId: string }>());
  // Startup IPC resolves long before a normal turn ends. Retain its result for
  // a short grace window so a steer whose stop lands just after startup failed
  // can distinguish that failure from a run that completed naturally.
  const runStartupResults = useRef(
    new Map<string, Promise<{ ok: boolean; runId?: string; error?: string }>>()
  );
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
  // subagent-activity events): `${parentThreadId}:${subagentId}` → the child
  // thread + agent-run message their transcript streams into.
  const nativeSubagentTargets = useRef(
    new Map<string, { threadId: string; messageId: string }>()
  );
  const agentModelsRef = useRef<AgentModel[]>(fallbackAgentModels);
  const startTurnForThreadRef = useRef<
    | ((
        threadId: string,
        promptText: string,
        attachments: ImageAttachment[]
      ) => Promise<{ ok: boolean; error?: string }>)
    | null
  >(null);
  const linkedTaskRefreshesRef = useRef(
    new Map<string, { taskId: string; promise: Promise<void> }>()
  );
  const pendingTurnStartsRef = useRef(new Set<string>());
  const recoveredInterruptedRuns = useRef(false);
  const dragDepth = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatPinnedRef = useRef(true);
  const chatScrollTopRef = useRef(0);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const taskPickerRef = useRef<HTMLDivElement>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const codexSettingsRef = useRef<HTMLDivElement>(null);
  const accessModeRef = useRef<HTMLDivElement>(null);

  // The Agents pane unmounts while the Code tab is active, so the textarea must
  // be re-measured when it remounts, not only when the text changes.
  useLayoutEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [chatInput, activeTab]);

  useEffect(() => {
    chatPinnedRef.current = true;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [selectedThreadId]);

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const selectedThreadProject = selectedThread
    ? projects.find((p) => p.id === selectedThread.projectId)
    : null;
  // Candidate dirs for resolving relative media paths in agent markdown: the
  // thread's project dir, plus the grok CLI's per-session dir — Grok Imagine
  // saves generated images there (~/.grok/sessions/<encoded-cwd>/<session-id>/
  // images/N.jpg) and references them relative to it, not to the project.
  const selectedThreadProjectPath = selectedThreadProject?.path;
  const selectedThreadGrokSessionId = selectedThread?.agentSessionIds?.grok;
  const mediaBaseDirs = useMemo(() => {
    if (!selectedThreadProjectPath) return [];
    const dirs = [selectedThreadProjectPath];
    if (selectedThreadGrokSessionId) {
      dirs.push(
        `~/.grok/sessions/${encodeURIComponent(selectedThreadProjectPath)}/${selectedThreadGrokSessionId}`
      );
    }
    return dirs;
  }, [selectedThreadProjectPath, selectedThreadGrokSessionId]);
  // The card's placement is shell-level so it survives switching to Code and
  // back; only its plan lookup/rendering lives in the streaming chat boundary.
  const [tasksCardPosition, setTasksCardPosition] = useState<{ x: number; y: number } | null>(null);
  const [tasksCardCollapsed, setTasksCardCollapsed] = useState(false);
  const [tasksCardDismissedFor, setTasksCardDismissedFor] = useState<string | null>(null);
  const toggleTasksCard = useCallback(
    () => setTasksCardCollapsed((current) => !current),
    []
  );
  const dismissTasksCard = useCallback((messageId: string) => {
    setTasksCardDismissedFor(messageId);
  }, []);
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? selectedThreadProject ?? null;
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
  const defaultNewThreadProject =
    selectedProject ??
    projects.find((project) => project.id === latestThreadProjectId) ??
    projects[0] ??
    null;
  const activeThreadProject = selectedThreadProject ?? defaultNewThreadProject;

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
    composerDraftsRef.current.set(composerDraftKey, { text: chatInput, attachments: chatAttachments });
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
    !!selectedThread && selectedThread.messages.length === 0 && selectedThread.status === 'idle' && !isSending;

  const shellTitle =
    activeTab === 'agents'
      ? selectedThread?.title ?? 'New thread'
      : activeFilePath
        ? activeFilePath.split(/[\\/]/).pop() ?? 'Code'
        : 'Code';
  const shellSubtitle =
    activeTab === 'agents'
      ? undefined
      : workspacePath
        ? workspacePath.split(/[\\/]/).pop() ?? workspacePath
        : undefined;
  const selectedAgentModel = findAgentModel(
    agentModels,
    selectedThread?.modelId ?? defaultAgentModelId
  );
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
    selectedCodexReasoningOptions.find((option) => option.value === selectedCodexReasoning)
      ?.label ?? 'Medium';
  const selectedCodexServiceTierLabel =
    codexServiceTierOptions.find((option) => option.value === selectedCodexServiceTier)?.label ??
    'Standard';
  const selectedClaudeDefaultReasoning = getDefaultClaudeReasoningEffort(selectedAgentModel);
  const selectedClaudeReasoning =
    selectedThread?.claudeReasoningEffort ?? selectedClaudeDefaultReasoning;
  const selectedClaudeContextWindow =
    selectedThread?.claudeContextWindow ?? defaultClaudeContextWindow;
  const effectiveClaudeContextWindow = getEffectiveClaudeContextWindow(
    selectedAgentModel,
    selectedClaudeContextWindow
  );
  const selectedClaudeReasoningLabel =
    claudeReasoningOptions.find((option) => option.value === selectedClaudeReasoning)?.label ??
    'High';
  const selectedClaudeContextWindowLabel =
    claudeContextWindowOptions.find((option) => option.value === effectiveClaudeContextWindow)
      ?.label ?? '200k';
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
        .filter(
          (id) => id === 'orion' || normalizedProviderSettings[id as ProviderId]?.enabled !== false
        ),
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
  // Role-model options for Settings → Orchestration: every real model grouped
  // by provider. The Orion pseudo-model can't delegate to itself.
  const orchestrationModelGroups = useMemo(
    () =>
      agentProviders
        .filter((provider) => provider.id !== 'orion')
        .map((provider) => ({
          provider,
          models: agentModels.filter(
            (model) =>
              model.providerId === provider.id && model.id !== claudeCodeCliModelId
          ),
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
    ['available', 'downloading', 'downloaded', 'error'].includes(appUpdateState.status);
  const appUpdatePercent = Math.max(
    0,
    Math.min(100, Math.round(appUpdateState?.progress?.percent ?? 0))
  );
  const appUpdateLabel =
    appUpdateState?.status === 'downloaded'
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
      ? appUpdateState.error ?? 'Update failed'
      : appUpdateState?.availableVersion
        ? `Orion ${appUpdateState.availableVersion} is available`
        : appUpdateLabel;
  const accountName =
    accountState.user?.name ||
    accountState.user?.email ||
    (accountState.authenticated ? 'Orion account' : 'Not signed in');
  const accountEmail = accountState.user?.email ?? null;
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
      (a, b) =>
        (lastActivityByProject.get(b.id) ?? -Infinity) -
        (lastActivityByProject.get(a.id) ?? -Infinity)
    );
  }, [projects, threads]);

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
        .sort(
          (a, b) => new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime()
        ),
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

  const runningAgentCount = useMemo(
    () => threads.filter((t) => t.status === 'running').length,
    [threads]
  );

  const projectThreadsByProject = useMemo(
    () => {
      const grouped = new Map<string, Thread[]>();
      for (const thread of threads) {
        // Top-level rows only; children render nested under their parent.
        if (childThreadIds.has(thread.id)) continue;
        const projectThreads = grouped.get(thread.projectId);
        if (projectThreads) projectThreads.push(thread);
        else grouped.set(thread.projectId, [thread]);
      }
      for (const projectThreads of grouped.values()) {
        projectThreads.sort(
          (a, b) =>
            getThreadActivityTime(b).getTime() - getThreadActivityTime(a).getTime()
        );
      }
      return grouped;
    },
    [childThreadIds, threads]
  );

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
          if (
            thread.parentThreadId &&
            threadIds.has(thread.parentThreadId) &&
            !threadIds.has(thread.id)
          ) {
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

      await Promise.all(
        runIds.map((runId) =>
          window.orion?.stopAgentTurn?.(runId, { terminateBackground: true })
        )
      );
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
      const projectThreads = useOrionStore
        .getState()
        .threads.filter((thread) => thread.projectId === projectId);
      const runIds = projectThreads
        .map((thread) => activeRunsByThread[thread.id])
        .filter((runId): runId is string => Boolean(runId));
      for (const runId of runIds) {
        runOutputMessages.current.delete(runId);
        clearActiveRun(runId);
      }
      await Promise.all(
        runIds.map((runId) =>
          window.orion?.stopAgentTurn?.(runId, { terminateBackground: true })
        )
      );
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

  useEffect(() => {
    let mounted = true;

    void window.orion?.getAccountSession?.()
      .then((state) => {
        if (mounted) setAccountState(state);
      })
      .catch(() => {
        if (mounted) {
          setAccountState({ authenticated: false, user: null, expiresAt: null });
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
    const projectPath = activeThreadProject?.path;
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
  }, [activeThreadProject?.path]);

  useEffect(() => {
    void refreshGitState();
  }, [refreshGitState]);

  const refreshCloudState = useCallback(async () => {
    const projectPath = activeThreadProject?.path;
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
  }, [activeThreadProject?.path]);

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
    if (appUpdateState.status === 'downloading' || appUpdateState.status === 'checking') return;

    setAppUpdateBusy(true);
    try {
      if (appUpdateState.status === 'downloaded') {
        await window.orion?.restartToUpdate?.();
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

  const handleAuthenticateProvider = useCallback(async (providerId: string) => {
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
  }, [authenticatingProviderId]);

  useEffect(() => {
    if (
      !projectPickerOpen &&
      !branchPickerOpen &&
      !threadSearchOpen &&
      !threadMenuOpen &&
      !goalMenuOpen &&
      !openWithOpen &&
      projectMenuOpenId === null &&
      threadItemMenuKey === null
    ) return undefined;

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
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchPickerOpen, projectPickerOpen, threadMenuOpen, goalMenuOpen, threadSearchOpen, openWithOpen, projectMenuOpenId, threadItemMenuKey]);

  useEffect(() => {
    setThreadMenuOpen(false);
  }, [selectedThreadId]);

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
  const chunkBuffers = useRef(
    new Map<string, { threadId: string; messageId: string; text: string }>()
  );
  const chunkFlushTimer = useRef<number | null>(null);

  // --- Linked board tasks (Orion web kanban) -----------------------------------

  const pushLinkedTaskStatus = useCallback(
    (
      threadId: string,
      status: 'running' | 'finished' | 'done' | 'error',
      notes?: string
    ) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const linked = thread?.linkedTask;
      if (!linked || !window.orion?.updateBoardTaskThreadStatus) return;
      updateThread(threadId, { linkedTask: { ...linked, lastStatus: status } });
      void window.orion
        .updateBoardTaskThreadStatus({ taskId: linked.id, threadId, status, notes })
        .then((result) => {
          if (result.ok || !result.stale) return;
          // The card was unlinked or relinked on the web — drop our side.
          const current = useOrionStore.getState().threads.find((t) => t.id === threadId);
          if (current?.linkedTask?.id === linked.id) {
            updateThread(threadId, { linkedTask: undefined });
          }
        })
        .catch(() => {});
    },
    [updateThread]
  );

  // Desktop notification when a thread finishes. Suppressed while the user is
  // already looking at that thread (window focused + thread selected). Sound
  // rides on the OS notification via `silent`, so there is no separate audio
  // path to keep in sync.
  const notifyThreadFinished = useCallback((threadId: string, outcome: 'done' | 'error') => {
    const state = useOrionStore.getState();
    const settings = { ...defaultNotificationSettings, ...state.notificationSettings };
    if (!settings.enabled) return;
    if (document.hasFocus() && state.selectedThreadId === threadId) return;
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    const thread = state.threads.find((t) => t.id === threadId);
    const notification = new Notification(
      outcome === 'error' ? 'Agent stopped with an error' : 'Agent finished',
      {
        body: thread?.title?.trim() || 'Agent thread',
        silent: !settings.sound,
        tag: `thread-finished-${threadId}`,
      }
    );
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
        if (thread.linkedTask && thread.linkedTask.lastStatus === 'running') {
          pushLinkedTaskStatus(event.threadId, 'finished');
        }
        return;
      }
      if (event.kind === 'started') {
        // A freshly spawned/reattached TUI is idle at its prompt — record the
        // activity for recency ordering but leave the run status alone.
        if (thread.status !== 'running') {
          updateThread(event.threadId, { terminalActivityAt: new Date().toISOString() });
        }
        return;
      }
      updateThread(event.threadId, {
        status: 'running',
        terminalActivityAt: new Date().toISOString(),
      });
      if (
        event.kind === 'prompt' &&
        thread.linkedTask &&
        thread.linkedTask.lastStatus !== 'running'
      ) {
        pushLinkedTaskStatus(event.threadId, 'running');
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
      if (thread.linkedTask) {
        pushLinkedTaskStatus(event.threadId, failed ? 'error' : 'finished');
      }
    });
    return () => {
      offActivity?.();
      offExit?.();
    };
  }, [notifyThreadFinished, pushLinkedTaskStatus, updateThread]);

  const unlinkTaskFromThread = useCallback(
    (threadId: string) => {
      const thread = useOrionStore.getState().threads.find((t) => t.id === threadId);
      const linked = thread?.linkedTask;
      if (!linked) return;
      updateThread(threadId, { linkedTask: undefined });
      void window.orion?.unlinkBoardTask?.({ taskId: linked.id, threadId }).catch(() => {});
    },
    [updateThread]
  );

  const markLinkedTaskDone = useCallback(
    (threadId: string) => {
      pushLinkedTaskStatus(threadId, 'done');
      toast.success('Task moved to Done on your board');
    },
    [pushLinkedTaskStatus]
  );

  const linkTaskToSelectedThread = useCallback(
    async (task: OrionBoardTask) => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === state.selectedThreadId);
      if (!thread || !window.orion?.linkBoardTask) return;
      const project = state.projects.find((p) => p.id === thread.projectId);
      // A fresh, untitled thread adopts the task's title.
      const adoptTitle = thread.messages.length === 0 && isDefaultTitle(thread.title);
      const previous = thread.linkedTask;

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
      if (previous && previous.id !== task.id) {
        void window.orion.unlinkBoardTask?.({ taskId: previous.id, threadId: thread.id }).catch(() => {});
      }
      const linkedTask = linkedTaskFromBoardTask(result.task ?? task);
      updateThread(thread.id, {
        linkedTask,
        ...(adoptTitle ? { title: task.title } : {}),
      });
      const unavailableCount = linkedTask.attachments?.filter((attachment) => !attachment.path).length ?? 0;
      if (unavailableCount > 0) {
        toast.warning(
          `${unavailableCount} task attachment${unavailableCount === 1 ? '' : 's'} could not be downloaded.`
        );
      }
      setTaskPickerOpen(false);
    },
    [updateThread]
  );

  // Refresh and locally download the linked-task snapshot (and detect web-side
  // unlink or deletion) whenever a thread whose context has not been injected
  // is selected, so the agent gets current text and attachments.
  const refreshLinkedTaskSnapshot = useCallback(
    (threadId: string, linked: LinkedBoardTask): Promise<void> => {
      if (!window.orion?.getBoardTask) return Promise.resolve();

      const existing = linkedTaskRefreshesRef.current.get(threadId);
      if (existing?.taskId === linked.id) return existing.promise;

      const refresh = window.orion
        .getBoardTask(linked.id)
        .then((result) => {
          const current = useOrionStore
            .getState()
            .threads.find((thread) => thread.id === threadId)?.linkedTask;
          if (!current || current.id !== linked.id || current.injected) return;

          if (!result.ok) {
            if (result.stale) {
              updateThread(threadId, { linkedTask: undefined });
            }
            return;
          }

          const fresh = result.task;
          if (!fresh || fresh.linked?.threadId !== threadId) {
            updateThread(threadId, { linkedTask: undefined });
            return;
          }
          updateThread(threadId, {
            linkedTask: {
              ...linkedTaskFromBoardTask(fresh),
              lastStatus: current.lastStatus,
            },
          });
        })
        .catch(() => {});
      const sharedRefresh = refresh.finally(() => {
        if (linkedTaskRefreshesRef.current.get(threadId)?.promise === sharedRefresh) {
          linkedTaskRefreshesRef.current.delete(threadId);
        }
      });
      linkedTaskRefreshesRef.current.set(threadId, {
        taskId: linked.id,
        promise: sharedRefresh,
      });
      return sharedRefresh;
    },
    [updateThread]
  );

  const refreshLinkedTaskBeforeDispatch = useCallback(
    async (threadId: string) => {
      const linked = useOrionStore
        .getState()
        .threads.find((thread) => thread.id === threadId)?.linkedTask;
      if (!linked || linked.injected) return;
      await refreshLinkedTaskSnapshot(threadId, linked);
    },
    [refreshLinkedTaskSnapshot]
  );

  useEffect(() => {
    const threadId = selectedThread?.id;
    const linked = selectedThread?.linkedTask;
    if (!threadId || !linked || linked.injected) return;
    void refreshLinkedTaskSnapshot(threadId, linked);
  }, [
    selectedThread?.id,
    selectedThread?.linkedTask?.id,
    selectedThread?.linkedTask?.injected,
    refreshLinkedTaskSnapshot,
  ]);

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
          const asideLoggedOut =
            isProviderAuthErrorText(event.error) || isProviderAuthErrorText(asideAnswerTail);
          updateBtwExchange(btwRun.threadId, btwRun.exchangeId, {
            status: 'error',
            completedAt: new Date().toISOString(),
            error: event.error,
            authProviderId:
              asideLoggedOut && event.providerId !== 'orion' ? event.providerId : undefined,
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
          updateThreadMessage(event.threadId, lastRun.id, { statusText: 'Finished.' });
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
        ((event.type === 'subagent-chunk' || event.type === 'subagent-activity') &&
          event.subagentId)
      ) {
        const info = event.type === 'subagent' ? event.subagent : undefined;
        const subagentId = info?.id ?? event.subagentId;
        if (!subagentId) return;
        const key = `${event.threadId}:${subagentId}`;
        const state = useOrionStore.getState();
        let target = nativeSubagentTargets.current.get(key) ?? null;

        // Rebind after an app reload: the child thread persists, the ref map
        // doesn't.
        if (!target) {
          const existing = state.threads.find(
            (t) => t.parentThreadId === event.threadId && t.subagent?.id === subagentId
          );
          const lastRun = existing
            ? [...existing.messages].reverse().find((m) => m.kind === 'agent-run')
            : undefined;
          if (existing && lastRun) {
            target = { threadId: existing.id, messageId: lastRun.id };
            nativeSubagentTargets.current.set(key, target);
          }
        }

        if (!target && info) {
          const parent = state.threads.find((t) => t.id === event.threadId);
          if (!parent) return;
          const childThreadId = state.createThread(
            parent.projectId,
            info.title || info.kind || 'Subagent',
            {
              parentThreadId: parent.id,
              modelId: parent.modelId,
              hiddenFromRecent: true,
              accessMode: parent.accessMode,
              select: false,
              subagent: {
                id: subagentId,
                providerId: (info.providerId ??
                  parent.modelId.split(':')[0]) as ProviderId,
                kind: info.kind,
                model: info.model,
                prompt: info.prompt,
              },
            }
          );
          if (info.prompt) {
            addMessageToThread(childThreadId, { role: 'user', content: info.prompt });
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
          if (
            childThread &&
            info.prompt &&
            !childThread.messages.some((m) => m.role === 'user')
          ) {
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
              statusText: stopped
                ? 'Stopped by user.'
                : failed
                  ? 'The subagent stopped with an error.'
                  : 'Finished.',
              ...(info.stats?.totalTokens
                ? { stats: { totalTokens: info.stats.totalTokens } }
                : {}),
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
          const raced = steerLostRaceOutcomes.current.get(event.runId) ?? { chunks: '' };
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
          runOutputMessages.current.set(event.runId, { threadId: event.threadId, messageId });
          setActiveRunsByThread((current) => ({ ...current, [event.threadId]: event.runId }));
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
        const errorThread = useOrionStore
          .getState()
          .threads.find((thread) => thread.id === tracked.threadId);
        const contentTail =
          errorThread?.messages
            .find((message) => message.id === tracked.messageId)
            ?.content.slice(-1200) ?? '';
        const looksLoggedOut =
          isProviderAuthErrorText(event.error) || isProviderAuthErrorText(contentTail);
        const rawAuthProviderId = looksLoggedOut
          ? event.providerId ?? errorThread?.modelId.split(':')[0]
          : undefined;
        // The Orion pseudo-provider has no CLI of its own to authenticate.
        const authProviderId = rawAuthProviderId === 'orion' ? undefined : rawAuthProviderId;
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'error',
          completedAt: new Date().toISOString(),
          statusText: authProviderId
            ? 'The agent is logged out.'
            : 'The agent stopped with an error.',
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
  }, [addActivityToThreadMessage, addMessageToThread, appendToThreadMessage, appendToBtwExchange, clearActiveRun, flushChunkBuffers, notifyThreadFinished, pushLinkedTaskStatus, setThreadAgentSession, updateBtwExchange, updateThread, updateThreadMessage]);

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

  // Keep treeRoot in sync. The ref mirrors it synchronously so in-flight
  // directory reads can tell they raced a workspace switch.
  const treeRootRef = useRef<string | null>(null);
  useEffect(() => {
    treeRootRef.current = workspacePath;
    setTreeRoot(workspacePath);
  }, [workspacePath]);

  // Load tree when root changes. Only the newest read may set treeItems: the
  // root check discards reads that raced a workspace switch, and the sequence
  // check discards an older same-root read resolving after a newer one (the
  // backend snapshots entries before a potentially slow git status, so the
  // older listing can finish last and resurrect deleted files).
  const loadRootSeqRef = useRef(0);
  const loadRoot = useCallback(async (root: string) => {
    if (!root || !window.orion) return;
    const seq = ++loadRootSeqRef.current;
    const items = await window.orion.readDirectory(root);
    if (treeRootRef.current !== root || loadRootSeqRef.current !== seq) return;
    setTreeItems(items);
  }, []);

  useEffect(() => {
    if (treeRoot) {
      loadRoot(treeRoot);
    } else {
      setTreeItems([]);
    }
  }, [treeRoot, loadRoot]);

  // Load a file into editor (from Code tab)
  const handleOpenFile = async (filePath: string) => {
    if (!window.orion) return;
    const content = await window.orion.readFile(filePath);
    openFile(filePath, content);
  };

  // Load children for tree nodes
  const loadChildren = async (dirPath: string): Promise<FileTreeItem[]> => {
    if (!window.orion) return [];
    return await window.orion.readDirectory(dirPath);
  };

  // Reload the root listing and tell expanded nodes to re-fetch their children.
  const refreshTree = useCallback(() => {
    if (treeRoot) loadRoot(treeRoot);
    setTreeRefreshToken((v) => v + 1);
  }, [treeRoot, loadRoot]);

  // There is no filesystem watcher on the workspace, so files created outside
  // the explorer (typically by agents) only appear on a re-list. Re-list when
  // the Code tab gains focus; while it stays hidden the tree is unmounted and
  // the focus refresh covers anything that changed in the meantime.
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    const gainedFocus = activeTab === 'code' && prevActiveTabRef.current !== 'code';
    prevActiveTabRef.current = activeTab;
    if (gainedFocus) refreshTree();
  }, [activeTab, refreshTree]);

  // Re-list when an agent turn completes while the Code tab is visible.
  // Debounced so a batch of subagents finishing together re-lists once. The
  // timer lives in a ref because the effect re-runs when a queued follow-up
  // starts the next turn (runningAgentCount goes back up) — a cleanup-owned
  // timer would be cancelled right there and the explorer would stay stale
  // for that whole turn.
  const prevRunningAgentCountRef = useRef(runningAgentCount);
  const prevTreeTurnRefreshTickRef = useRef(treeTurnRefreshTick);
  const treeRefreshTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const turnCompleted =
      runningAgentCount < prevRunningAgentCountRef.current ||
      treeTurnRefreshTick !== prevTreeTurnRefreshTickRef.current;
    prevRunningAgentCountRef.current = runningAgentCount;
    prevTreeTurnRefreshTickRef.current = treeTurnRefreshTick;
    if (!turnCompleted || activeTab !== 'code') return;
    if (treeRefreshTimerRef.current !== null) window.clearTimeout(treeRefreshTimerRef.current);
    treeRefreshTimerRef.current = window.setTimeout(() => {
      treeRefreshTimerRef.current = null;
      refreshTree();
    }, 300);
  }, [runningAgentCount, treeTurnRefreshTick, activeTab, refreshTree]);
  useEffect(
    () => () => {
      if (treeRefreshTimerRef.current !== null) window.clearTimeout(treeRefreshTimerRef.current);
    },
    []
  );

  const isPathWithin = (candidate: string, ancestor: string) =>
    candidate === ancestor ||
    candidate.startsWith(`${ancestor}/`) ||
    candidate.startsWith(`${ancestor}\\`);

  // Delete a tree entry after native confirmation; closes any editor tabs
  // showing the deleted file (or files inside the deleted folder).
  const handleDeleteTreeItem = async (item: FileTreeItem) => {
    if (!window.orion) return;
    const confirmed = await window.orion.confirmDeletePath({
      path: item.path,
      isDirectory: item.isDirectory,
    });
    if (!confirmed) return;
    const ok = await window.orion.deletePath(item.path);
    if (!ok) {
      toast.error(`Could not delete ${item.name}`);
      return;
    }
    for (const file of openFiles) {
      if (isPathWithin(file.path, item.path)) closeFile(file.path);
    }
    toast.success(`Deleted ${item.name}`);
    refreshTree();
  };

  // After a rename, retarget open editor tabs and refresh the tree.
  const handleTreeItemRenamed = async (oldPath: string, newPath: string, isDirectory: boolean) => {
    const wasOpen = openFiles.some((file) => file.path === oldPath);
    for (const file of openFiles) {
      if (isPathWithin(file.path, oldPath)) closeFile(file.path);
    }
    if (!isDirectory && wasOpen) {
      await handleOpenFile(newPath);
    }
    refreshTree();
  };

  // Add a project
  const handleAddProject = async () => {
    if (!window.orion) return;
    const dir = await window.orion.openDirectory();
    if (!dir) return;

    const name = await window.orion.basename(dir);
    const projectId = addProject({ name, path: dir });

    // Also set workspace to this project
    setWorkspacePath(dir);

    // Adding a project means the user wants to work in it now — drop them
    // straight into a fresh thread for it.
    handleCreateThread(projectId);
  };

  // Open folder directly for code tab
  const handleOpenFolderForCode = async () => {
    if (!window.orion) return;
    const dir = await window.orion.openDirectory();
    if (dir) {
      setWorkspacePath(dir);
      closeAllFiles();
      toast.success('Workspace opened');
    }
  };

  const handleSetActiveTab = (tab: 'agents' | 'code') => {
    if (tab === 'code' && selectedProject && workspacePath !== selectedProject.path) {
      setWorkspacePath(selectedProject.path);
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

  const handleChangeSelectedThreadProject = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;

    if (!selectedThread) {
      selectProject(projectId);
      setProjectPickerOpen(false);
      return;
    }

    if (!canChangeSelectedThreadProject) {
      toast.error('Project can only be changed before the agent runs in this thread');
      setProjectPickerOpen(false);
      return;
    }

    updateThread(selectedThread.id, { projectId });
    selectProject(projectId);
    setProjectPickerOpen(false);
  };

  const handleCheckoutBranch = async (branchName: string) => {
    if (!activeThreadProject?.path || !window.orion?.checkoutGitBranch || gitBusy) return;
    if (gitState?.hasUncommittedChanges) {
      toast.error('Commit or discard local changes before checking out another branch');
      return;
    }

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeThreadProject.path,
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
    if (!activeThreadProject?.path || !window.orion?.checkoutGitBranch || gitBusy) return;

    const normalized = branchName.trim();
    if (!normalized) return;

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeThreadProject.path,
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
    if (!activeThreadProject?.path || !window.orion?.commitAndPush || gitBusy) return;

    setGitBusy(true);
    try {
      const result = await window.orion.commitAndPush(activeThreadProject.path);
      if (result.ok) {
        toast.success(`Committed and pushed ${result.branch ?? gitState?.currentBranch ?? 'branch'}`);
        await refreshGitState();
      } else {
        toast.error(result.error ?? 'Commit and push failed');
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCloudPublish = async () => {
    if (!activeThreadProject?.path || !window.orion?.publishToCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.publishToCloud({ projectPath: activeThreadProject.path });
      if (result.ok && result.alreadyLinked) {
        toast.success(result.upToDate ? 'Orion Cloud is already up to date' : 'Pushed to Orion Cloud');
        await refreshCloudState();
      } else if (result.ok) {
        toast.success(`Published to Orion Cloud as ${result.repo?.name ?? 'repository'}`, {
          description: 'Press Deploy on Orion Cloud to host it as an app.',
          action: {
            label: 'Open',
            onClick: () => void window.orion?.openCloudRepoInBrowser?.(activeThreadProject.path),
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
    if (!activeThreadProject?.path || !window.orion?.pushToCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pushToCloud(activeThreadProject.path);
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
    if (!activeThreadProject?.path || !window.orion?.pullFromCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pullFromCloud(activeThreadProject.path);
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
    [
      activeTab,
      handleCreateThread,
      projects,
      selectThread,
      selectedProject?.id,
      selectedThreadId,
      setActiveTab,
    ]
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
        await refreshLinkedTaskBeforeDispatch(threadId);
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
          state.orchestrationSettings?.generalInstructions ??
          defaultOrchestrationSettings.generalInstructions;
        let driverModel = agentModels.find((candidate) => candidate.id === roleModels.mainDriver);
        if (
          !driverModel ||
          driverModel.providerId === 'orion' ||
          driverModel.id === claudeCodeCliModelId
        ) {
          // Misconfigured/pseudo driver: fall back to a real agent model.
          driverModel =
            agentModels.find((candidate) => candidate.id === defaultAgentModelId) ??
            agentModels.find(
              (candidate) =>
                candidate.providerId !== 'orion' && candidate.id !== claudeCodeCliModelId
            );
        }
        if (
          !driverModel ||
          driverModel.providerId === 'orion' ||
          driverModel.id === claudeCodeCliModelId
        ) {
          return { ok: false, error: 'Pick a main driver model in Settings → Orchestration' };
        }
        const roles = orchestrationRoleMeta.map((meta) => {
          const configuredRoleModel = agentModels.find(
            (candidate) => candidate.id === roleModels[meta.id]
          );
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
        return { ok: false, error: model.unavailableReason ?? `${model.label} is unavailable` };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      // First turn with a linked board task: the task itself is the prompt,
      // so an empty draft is fine — the card's title and description become
      // the agent context (later turns resume the same session, so the agent
      // already has it). The chip moves onto this turn's user message.
      const taskToInject =
        thread.linkedTask && !thread.linkedTask.injected ? thread.linkedTask : undefined;
      if (!promptText && attachments.length === 0 && !taskToInject) {
        return { ok: false, error: 'Type a message first' };
      }

      const taskMediaAttachments = taskToInject ? linkedTaskMediaAttachments(taskToInject) : [];
      const turnAttachments = [...taskMediaAttachments, ...attachments];
      const userContent = promptText || (attachments.length > 0 ? 'Attached image' : '');
      let agentPrompt = buildPromptWithAttachments(promptText, attachments);
      if (taskToInject) {
        agentPrompt = agentPrompt
          ? `${buildLinkedTaskContext(taskToInject, true)}\n\n${agentPrompt}`
          : buildLinkedTaskContext(taskToInject, false);
        updateThread(threadId, { linkedTask: { ...taskToInject, injected: true } });
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
        agentPrompt = agentPrompt
          ? `${orchestrationContext}\n\n${agentPrompt}`
          : orchestrationContext;
      }

      // Auto-generate a relevant thread title from the first user message (like Codex / T3 Code)
      if (thread.messages.length === 0 && isDefaultTitle(thread.title)) {
        const titleSeed = userContent || taskToInject?.title || '';
        const initialTitle = deriveTitle(titleSeed);
        if (isPlausibleTitle(initialTitle)) {
          updateThread(threadId, { title: initialTitle });
        }
        // Kick off async LLM refinement for a nicer title
        void tryGenerateBetterTitle(threadId, titleSeed, model.id, project.path, updateThread);
      }

      if (threadId === state.selectedThreadId) chatPinnedRef.current = true;
      addMessageToThread(threadId, {
        role: 'user',
        content: userContent,
        attachments: turnAttachments,
        ...(taskToInject
          ? {
              linkedTask: {
                id: taskToInject.id,
                title: taskToInject.title,
                description: taskToInject.description,
              },
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
          projectPath: project.path,
          prompt: agentPrompt,
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.[model.providerId],
          // Branched thread's first turn per provider: fork the inherited
          // session instead of resuming the parent's in place.
          forkSession: Boolean(
            thread.agentSessionIds?.[model.providerId] &&
              thread.pendingForkProviders?.includes(model.providerId)
          ),
          providerOptions: normalizedProviderSettings[model.providerId]?.options,
          // Kimi's ACP adapter accepts native image content blocks. Preserve
          // the text/path context as a fallback, but also pass the attachment
          // metadata so main can read the bytes without routing them through
          // the renderer or relying on Kimi to reproduce a Unicode file path.
          ...(model.providerId === 'kimi' && turnAttachments.length > 0
            ? { attachments: turnAttachments }
            : {}),
          ...(model.providerId === 'codex'
            ? {
                codexReasoningEffort: getEffectiveCodexReasoningEffort(
                  model,
                  thread.codexReasoningEffort
                ),
                codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
              }
            : {}),
          ...(model.providerId === 'claude'
            ? {
                claudeReasoningEffort:
                  thread.claudeReasoningEffort ?? getDefaultClaudeReasoningEffort(model),
                claudeContextWindow: getEffectiveClaudeContextWindow(
                  model,
                  thread.claudeContextWindow ?? defaultClaudeContextWindow
                ),
              }
            : {}),
          ...(model.providerId === 'grok'
            ? { grokReasoningEffort: thread.grokReasoningEffort ?? defaultGrokReasoningEffort }
            : {}),
          ...(mentionedModels.length > 0 ? { mentions: mentionedModels } : {}),
          ...(orchestration ? { orchestration } : {}),
        })
      );
      void startup.then((result) => {
        if (result.ok && result.runId) {
          if (result.runId !== runId) {
            runOutputMessages.current.delete(runId);
            runOutputMessages.current.set(result.runId, { threadId, messageId });
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
      refreshLinkedTaskBeforeDispatch,
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
        void window.orion?.reportSubagentResult?.({ spawnId: request.spawnId, ok, result });
      };
      const state = useOrionStore.getState();
      const driverThread = state.threads.find((t) => t.id === request.threadId);
      if (!driverThread) {
        report(false, 'Driver thread not found');
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
        models.find(
          (m) =>
            m.slug.toLowerCase().includes(wantedLower) ||
            m.label.toLowerCase().includes(wantedLower)
        );
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
        request.title ||
        (roleMeta ? `${roleMeta.label}: ${promptSlice}` : `${model.label}: ${promptSlice}`);

      // createThread selects the new thread; put the user's selection back so
      // a background spawn never yanks the UI away from their current thread.
      const prevThreadId = state.selectedThreadId;
      const prevProjectId = state.selectedProjectId;
      const childThreadId = state.createThread(projectId, title, {
        parentThreadId: request.threadId,
        modelId: model.id,
        hiddenFromRecent: true,
        // Persisted on the thread so stop/delete/reload can still resolve the
        // driver's blocked spawn_subagent call.
        spawnId: request.spawnId,
        // Deterministic: subagents run with the driver's access mode, never
        // whatever an unrelated project thread last used.
        accessMode: request.accessMode ?? driverThread.accessMode,
      });
      if (prevThreadId) {
        state.selectThread(prevThreadId);
      } else {
        state.selectThread(null);
        state.selectProject(prevProjectId);
      }

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
          report(
            false,
            error instanceof Error ? error.message : 'The subagent turn could not start'
          );
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
    async (request: {
      stopId: string;
      threadId: string;
      model?: string;
      title?: string;
      all?: boolean;
    }) => {
      const report = (ok: boolean, result: string) => {
        void window.orion?.reportSubagentStopResult?.({ stopId: request.stopId, ok, result });
      };
      const state = useOrionStore.getState();
      // activeRunsByThreadRef only catches up in an effect after the next
      // render, so a stop arriving right after a spawn would miss the child's
      // just-registered run there and falsely report success without ever
      // terminating the provider process. runOutputMessages is maintained
      // synchronously through registration, runId swaps, and completion, so
      // its entries win over the ref.
      const runsByThread = new Map<string, string>(
        Object.entries(activeRunsByThreadRef.current)
      );
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
        report(
          false,
          `No running subagent matches. Running subagents: ${running.map(describe).join(', ')}.`
        );
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
          if (
            candidate.parentThreadId &&
            threadIds.has(candidate.parentThreadId) &&
            !threadIds.has(candidate.id)
          ) {
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
        runsToStop.map(({ runId }) =>
          window.orion?.stopAgentTurn?.(runId, { terminateBackground: true })
        )
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
        return { ok: false, error: '/btw is only available on Claude agents for now' };
      }
      if (normalizedProviderSettings.claude?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return { ok: false, error: model.unavailableReason ?? `${model.label} is unavailable` };
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
      if (threadId === state.selectedThreadId) chatPinnedRef.current = true;

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          projectPath: project.path,
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
          claudeReasoningEffort:
            thread.claudeReasoningEffort ?? getDefaultClaudeReasoningEffort(model),
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
      goalAction: { action: 'set' | 'resume'; objective?: string; tokenBudget?: number }
    ): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (model.providerId !== 'codex') {
        return { ok: false, error: '/goal is only available on Codex agents' };
      }
      if (normalizedProviderSettings.codex?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return { ok: false, error: model.unavailableReason ?? `${model.label} is unavailable` };
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
      if (threadId === state.selectedThreadId) chatPinnedRef.current = true;

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          projectPath: project.path,
          prompt: goalAction.objective || 'Resume the goal.',
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.codex,
          forkSession: Boolean(
            thread.agentSessionIds?.codex && thread.pendingForkProviders?.includes('codex')
          ),
          providerOptions: normalizedProviderSettings.codex?.options,
          codexReasoningEffort: getEffectiveCodexReasoningEffort(
            model,
            thread.codexReasoningEffort
          ),
          codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
          codexGoal: goalAction,
        })
        .then((result) => {
          if (result.ok && result.runId) {
            if (result.runId !== runId) {
              runOutputMessages.current.delete(runId);
              runOutputMessages.current.set(result.runId, { threadId, messageId });
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
      review: { mode: 'uncommitted' | 'base' | 'commit' | 'custom'; base?: string; commit?: string; instructions?: string }
    ): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (model.providerId !== 'codex') {
        return { ok: false, error: '/review is only available on Codex agents' };
      }
      if (normalizedProviderSettings.codex?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return { ok: false, error: model.unavailableReason ?? `${model.label} is unavailable` };
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
      if (threadId === state.selectedThreadId) chatPinnedRef.current = true;

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          projectPath: project.path,
          prompt: review.instructions || reviewLabel,
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.codex,
          forkSession: Boolean(
            thread.agentSessionIds?.codex && thread.pendingForkProviders?.includes('codex')
          ),
          providerOptions: normalizedProviderSettings.codex?.options,
          codexReasoningEffort: getEffectiveCodexReasoningEffort(
            model,
            thread.codexReasoningEffort
          ),
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
              runOutputMessages.current.set(result.runId, { threadId, messageId });
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
      if (
        thread.status === 'running' ||
        activeRunsByThread[thread.id] ||
        pendingTurnStartsRef.current.has(thread.id)
      ) {
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
            content: `Could not send the queued message: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
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
      if (sessionId && project && window.orion?.codexGoalCommand) {
        void window.orion
          .codexGoalCommand({ sessionId, projectPath: project.path, action: 'get' })
          .then((result) => {
            if (result.ok) updateThread(selectedThreadId, { goal: result.goal ?? null });
            const latest = result.ok ? result.goal : goal;
            if (latest) toast.success(goalSummaryLine(latest));
            else toast.error(result.ok ? 'No goal on this thread.' : result.error ?? 'Could not read the goal.');
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
          const latest = useOrionStore
            .getState()
            .threads.find((thread) => thread.id === selectedThreadId)?.goal;
          if (latest?.status === 'active') {
            updateThread(selectedThreadId, { goal: { ...latest, status: 'paused' } });
          }
          toast.success('Goal paused.');
        });
      } else if (sessionId && project && window.orion?.codexGoalCommand) {
        void window.orion
          .codexGoalCommand({ sessionId, projectPath: project.path, action: 'pause' })
          .then((result) => {
            if (result.ok) {
              updateThread(selectedThreadId, { goal: result.goal ?? { ...goal, status: 'paused' } });
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
        if (sessionId && project && window.orion?.codexGoalCommand) {
          void window.orion
            .codexGoalCommand({ sessionId, projectPath: project.path, action: 'clear' })
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
      const result = startGoalRunForThread(selectedThreadId, promptText, { action: 'resume' });
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
    review: { mode: 'uncommitted' | 'base' | 'commit' | 'custom'; base?: string; commit?: string; instructions?: string }
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
  const restoreComposerDraft = (
    threadId: string,
    promptText: string,
    attachments: ImageAttachment[]
  ) => {
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
    // A freshly linked board task can be sent on its own — the card is the
    // prompt. Mid-run it can't (queued follow-ups need their own text).
    const canSendLinkedTaskAlone =
      !isSending && Boolean(selectedThread.linkedTask && !selectedThread.linkedTask.injected);
    if (!promptText && chatAttachments.length === 0 && !canSendLinkedTaskAlone) return;

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
        await refreshLinkedTaskBeforeDispatch(submittedThreadId);
      } catch (error) {
        restoreComposerDraft(submittedThreadId, submittedInput, submittedAttachments);
        toast.error(
          error instanceof Error ? error.message : 'The linked task could not be refreshed'
        );
        return;
      } finally {
        pendingTurnStartsRef.current.delete(submittedThreadId);
      }
      const currentThread = useOrionStore
        .getState()
        .threads.find((thread) => thread.id === submittedThreadId);
      const taskToInject =
        currentThread?.linkedTask && !currentThread.linkedTask.injected
          ? currentThread.linkedTask
          : undefined;
      let text = buildPromptWithAttachments(promptText, submittedAttachments);
      if (taskToInject) {
        text = text
          ? `${buildLinkedTaskContext(taskToInject, true)}\n\n${text}`
          : buildLinkedTaskContext(taskToInject, false);
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
        toast.error(
          error instanceof Error ? error.message : 'The Claude Code terminal is not running.'
        );
        return;
      } finally {
        pendingTurnStartsRef.current.delete(submittedThreadId);
      }
      if (!result?.ok) {
        restoreTerminalDraft();
        toast.error(result?.error ?? 'The Claude Code terminal is not running.');
        return;
      }
      if (taskToInject) {
        const currentLinkedTask = useOrionStore
          .getState()
          .threads.find((thread) => thread.id === submittedThreadId)?.linkedTask;
        if (currentLinkedTask?.id === taskToInject.id && !currentLinkedTask.injected) {
          updateThread(submittedThreadId, {
            linkedTask: { ...currentLinkedTask, injected: true },
          });
        }
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
          'claude:claude-haiku-4-5',
          selectedThreadProject?.path ?? '',
          updateThread
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
      chatPinnedRef.current = true;
      queueMessageToThread(selectedThreadId, { text: promptText, attachments: chatAttachments });
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
      result = await startTurnForThread(
        submittedThreadId,
        promptText,
        submittedAttachments
      );
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
    isSending &&
    !!selectedAgentModel &&
    providerFollowUpSupport[selectedAgentModel.providerId]?.steer === true;
  const steerReady =
    steerSupported &&
    !!selectedAgentModel &&
    !!selectedThread?.agentSessionIds?.[selectedAgentModel.providerId];

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
  const canSteerNow = () =>
    !!selectedThreadId &&
    !!activeRunId &&
    steerReady &&
    !!window.orion?.stopAgentTurn &&
    !steeringRunsRef.current.has(activeRunId);

  const steerWithContent = async (promptText: string, attachments: ImageAttachment[]) => {
    if (!canSteerNow() || !selectedThreadId || !activeRunId) return;
    if (!promptText && attachments.length === 0) return;

    const runId = activeRunId;
    const threadId = selectedThreadId;
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
          const errorThread = useOrionStore
            .getState()
            .threads.find((thread) => thread.id === tracked.threadId);
          const looksLoggedOut =
            failed &&
            (isProviderAuthErrorText(failureError) || isProviderAuthErrorText(outcome?.chunks));
          const rawAuthProviderId = looksLoggedOut
            ? outcome?.providerId ?? errorThread?.modelId.split(':')[0]
            : undefined;
          const authProviderId =
            rawAuthProviderId === 'orion' ? undefined : rawAuthProviderId;
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
            pushLinkedTaskStatus(
              threadId,
              failed ? 'error' : 'finished',
              finalResponse || undefined
            );
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
    await steerWithContent(promptText, attachments);
  };

  // "Steer now" on a queued transcript bubble: promote that message to an
  // immediate interrupt-and-resume instead of waiting for the turn to end.
  const steerQueuedMessageRef = useRef<(queuedId: string) => Promise<void>>(async () => {});
  steerQueuedMessageRef.current = async (queuedId: string) => {
    if (!canSteerNow() || !selectedThreadId || !activeRunId) return;
    const thread = useOrionStore.getState().threads.find((t) => t.id === selectedThreadId);
    const queued = thread?.queuedMessages?.find((q) => q.id === queuedId);
    if (!queued) return;
    removeQueuedThreadMessage(selectedThreadId, queuedId);
    await steerWithContent(queued.text, queued.attachments ?? []);
  };
  const steerQueuedMessage = useCallback((queuedId: string) => {
    void steerQueuedMessageRef.current(queuedId);
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
      setChatInput((current) =>
        [...queued.map((q) => q.text), current].filter(Boolean).join('\n\n')
      );
      setChatAttachments((current) => [...queued.flatMap((q) => q.attachments ?? []), ...current]);
    }
    const threadIds = new Set(thread ? [thread.id] : []);
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      for (const candidate of state.threads) {
        if (
          candidate.parentThreadId &&
          threadIds.has(candidate.parentThreadId) &&
          !threadIds.has(candidate.id)
        ) {
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
    await Promise.all(
      runsToStop.map(({ runId }) =>
        window.orion.stopAgentTurn(runId, { terminateBackground: true })
      )
    );
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
    const nextValue =
      chatInput.slice(0, chatMention.start) + inserted + chatInput.slice(replaceEnd);
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

  const formatCheckedTime = (iso: string): string => {
    try {
      const then = new Date(iso).getTime();
      const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
      if (mins < 1) return 'just now';
      if (mins === 1) return '1m ago';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return 'recently';
    }
  };

  // Tiny CLI mark for Claude Code CLI threads — sits before the title.
  const renderThreadCliBadge = (thread: Thread) =>
    isClaudeCodeCliModelId(thread.modelId) ? (
      <span className="thread-cli-badge" title="Claude Code CLI" aria-label="Claude Code CLI">
        <Terminal size={10} strokeWidth={2.4} aria-hidden />
      </span>
    ) : null;

  const renderSidebarFooter = () => (
    <div className="sidebar-footer">
      {appUpdateVisible && (
        <button
          type="button"
          className={`sidebar-update-button ${appUpdateState?.status ?? 'idle'}`}
          onClick={handleAppUpdateClick}
          title={appUpdateTitle}
          disabled={appUpdateBusy || appUpdateState?.status === 'downloading'}
        >
          {appUpdateState?.status === 'downloaded' ? (
            <RefreshCw size={15} />
          ) : appUpdateState?.status === 'downloading' ? (
            <span className="sidebar-update-progress" style={{ '--update-progress': `${appUpdatePercent}%` } as React.CSSProperties}>
              <Download size={14} />
            </span>
          ) : (
            <Download size={15} />
          )}
          <span>{appUpdateLabel}</span>
        </button>
      )}
      <button
        type="button"
        className={`sidebar-account-button ${accountState.authenticated ? 'signed-in' : ''}`}
        onClick={() => {
          if (accountState.authenticated) {
            setSettingsTab('account');
            setSettingsOpen(true);
            return;
          }
          handleStartAccountAuth();
        }}
        title={accountState.authenticated ? accountName : 'Sign in to Orion'}
        disabled={accountLoading || accountBusy}
      >
        {accountState.authenticated && accountState.user?.imageUrl ? (
          <img src={accountState.user.imageUrl} alt="" />
        ) : accountState.authenticated ? (
          <span>{accountInitials || 'O'}</span>
        ) : (
          <LogIn size={16} />
        )}
      </button>
      <button
        type="button"
        className="sidebar-settings-button"
        onClick={() => setSettingsOpen(true)}
        title="Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  );

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
                  <span className="goal-chip-objective truncate">
                    {selectedThread.goal.objective}
                  </span>
                  {goalUsageSummary(selectedThread.goal) && (
                    <span className="goal-chip-usage">
                      {goalUsageSummary(selectedThread.goal)}
                    </span>
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
                      if (selectedThread && !canChangeSelectedThreadProject) return;
                      setProjectPickerOpen((open) => !open);
                    }}
                    disabled={!!selectedThread && !canChangeSelectedThreadProject}
                    title={
                      selectedThread && !canChangeSelectedThreadProject
                        ? 'Project is locked after an agent runs'
                        : activeThreadProject.path
                    }
                    aria-haspopup="menu"
                    aria-expanded={projectPickerOpen}
                  >
                    <ProjectIcon projectPath={activeThreadProject.path} size={14} />
                    <span className="truncate">{activeThreadProject.name}</span>
                    {(!selectedThread || canChangeSelectedThreadProject) && (
                      <ChevronDown
                        size={13}
                        className={`project-pill-chevron ${projectPickerOpen ? 'open' : ''}`}
                      />
                    )}
                  </button>
                  {projectPickerOpen && (!selectedThread || canChangeSelectedThreadProject) && (
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
                    onClick={() => setBranchPickerOpen((open) => !open)}
                    disabled={gitLoading || gitBusy || !gitState?.ok}
                    title={gitState?.error ?? gitState?.root ?? 'Git state'}
                    aria-haspopup="menu"
                    aria-expanded={branchPickerOpen}
                  >
                    <GitBranch size={14} />
                    <span className="truncate">
                      {gitLoading ? 'Git...' : gitState?.currentBranch ?? 'No Git'}
                    </span>
                    <ChevronDown
                      size={13}
                      className={`project-pill-chevron ${branchPickerOpen ? 'open' : ''}`}
                    />
                  </button>
                  {branchPickerOpen && (
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
                          disabled={branch.current || gitState.hasUncommittedChanges || gitBusy}
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
                          disabled={gitBusy || !gitState?.ok}
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
                        disabled={gitBusy || !gitState?.ok || !gitState.currentBranch}
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
                    disabled={cloudBusy || gitBusy}
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
                      disabled={cloudBusy || gitBusy}
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
                      onClick={() =>
                        activeThreadProject?.path &&
                        void window.orion?.openCloudRepoInBrowser?.(activeThreadProject.path)
                      }
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
            {openWithApps.length > 0 && activeThreadProject?.path && (
              <div className="shell-openwith-control" ref={openWithRef}>
                <button
                  type="button"
                  className="shell-openwith-trigger"
                  onClick={() => setOpenWithOpen((open) => !open)}
                  title={`Open ${activeThreadProject.name} in another app`}
                  aria-label="Open with"
                  aria-haspopup="menu"
                  aria-expanded={openWithOpen}
                >
                  <SquareArrowOutUpRight size={14} />
                  <ChevronDown
                    size={13}
                    className={`project-pill-chevron ${openWithOpen ? 'open' : ''}`}
                  />
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
                              projectPath: activeThreadProject.path,
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
        <div className="settings-page">
          <div className="settings-sidebar">
            <div className="settings-sidebar-header">
              <Settings size={16} />
              <span>Settings</span>
            </div>
            <div className="settings-nav">
              {[
                { id: 'account', label: 'Account', Icon: UserRound },
                { id: 'general', label: 'General', Icon: Settings },
                { id: 'providers', label: 'Providers', Icon: Plug },
                { id: 'orchestration', label: 'Orchestration', Icon: Workflow },
                { id: 'computer-use', label: 'Computer Use', Icon: MousePointerClick },
                { id: 'cosmetics', label: 'Cosmetics', Icon: Palette },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item ${settingsTab === id ? 'active' : ''}`}
                  onClick={() => setSettingsTab(id as SettingsTab)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="settings-sidebar-footer">
              <button
                type="button"
                className="settings-back-button"
                onClick={() => setSettingsOpen(false)}
              >
                ← Back
              </button>
            </div>
          </div>

          <div className="settings-content">
            <div className="settings-content-header">
              {settingsTab === 'account' && 'ACCOUNT'}
              {settingsTab === 'general' && 'GENERAL'}
              {settingsTab === 'providers' && 'PROVIDERS'}
              {settingsTab === 'orchestration' && 'ORCHESTRATION'}
              {settingsTab === 'computer-use' && 'COMPUTER USE'}
              {settingsTab === 'cosmetics' && 'COSMETICS'}
            </div>

            <div className="settings-panel">
              {settingsTab === 'account' && (
                <>
                  <div className="account-row">
                    <div className="account-card-main">
                      {accountState.user?.imageUrl ? (
                        <img
                          className="account-avatar"
                          src={accountState.user.imageUrl}
                          alt=""
                          aria-hidden
                        />
                      ) : (
                        <div className="account-avatar account-avatar-fallback">
                          {accountInitials || 'O'}
                        </div>
                      )}
                      <div className="account-card-text">
                        <div className="account-card-title">{accountName}</div>
                        <div className="account-card-subtitle">
                          {accountLoading
                            ? 'Checking Orion account...'
                            : accountState.authenticated
                              ? accountEmail || 'Signed in to Orion Web'
                              : 'Sign in through Orion Web to authorize this desktop app.'}
                        </div>
                      </div>
                    </div>
                    <span className={`account-status-chip ${accountState.authenticated ? 'signed-in' : ''}`}>
                      {accountLoading ? 'Checking' : accountState.authenticated ? 'Signed in' : 'Signed out'}
                    </span>
                  </div>

                  {accountState.authenticated && (
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Desktop session</div>
                        <div className="setting-label-desc">
                          Authorized by Orion Web{accountState.expiresAt ? ` until ${formatCheckedTime(accountState.expiresAt)}` : ''}.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="provider-auth-button"
                        onClick={handleSignOutAccount}
                        disabled={accountBusy}
                      >
                        <LogOut size={13} />
                        Sign out
                      </button>
                    </div>
                  )}

                  {!accountState.authenticated && (
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Authorize Orion Desktop</div>
                        <div className="setting-label-desc">
                          Opens Orion Web in your browser and returns here after approval.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="provider-auth-button account-primary-button"
                        onClick={handleStartAccountAuth}
                        disabled={accountBusy || accountLoading}
                      >
                        <LogIn size={13} />
                        {accountBusy ? 'Opening...' : 'Sign in'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {settingsTab === 'general' && (
                <>
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Theme</div>
                      <div className="setting-label-desc">Choose how Orion looks across the app.</div>
                    </div>
                    <select className="setting-select" defaultValue="system">
                      <option value="system">System</option>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Time format</div>
                      <div className="setting-label-desc">System default follows your browser or OS clock preference.</div>
                    </div>
                    <select className="setting-select" defaultValue="system">
                      <option value="system">System default</option>
                      <option value="12h">12-hour</option>
                      <option value="24h">24-hour</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Word wrap</div>
                      <div className="setting-label-desc">Wrap long lines in code blocks, tables, diffs, and file previews by default.</div>
                    </div>
                    <label className="provider-toggle" title="Word wrap">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Hide whitespace changes</div>
                      <div className="setting-label-desc">Set whether the diff panel ignores whitespace-only edits by default.</div>
                    </div>
                    <label className="provider-toggle" title="Hide whitespace">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Assistant output</div>
                      <div className="setting-label-desc">Show token-by-token output while a response is in progress.</div>
                    </div>
                    <label className="provider-toggle" title="Assistant output">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Thread notifications</div>
                      <div className="setting-label-desc">Show a desktop notification when an agent thread finishes while you're looking elsewhere.</div>
                    </div>
                    <label className="provider-toggle" title="Thread notifications">
                      <input
                        type="checkbox"
                        checked={notificationSettings?.enabled ?? true}
                        onChange={(e) => setNotificationSettings({ enabled: e.target.checked })}
                      />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Notification sound</div>
                      <div className="setting-label-desc">Play the system sound with thread-finished notifications.</div>
                    </div>
                    <label className="provider-toggle" title="Notification sound">
                      <input
                        type="checkbox"
                        checked={notificationSettings?.sound ?? true}
                        disabled={!(notificationSettings?.enabled ?? true)}
                        onChange={(e) => setNotificationSettings({ sound: e.target.checked })}
                      />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Provider update checks</div>
                      <div className="setting-label-desc">Check installed provider CLIs for newer available versions.</div>
                    </div>
                    <label className="provider-toggle" title="Provider update checks">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">New threads</div>
                      <div className="setting-label-desc">Pick the default workspace mode for newly created draft threads.</div>
                    </div>
                    <select className="setting-select" defaultValue="local">
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Archive confirmation</div>
                      <div className="setting-label-desc">Require a second click on the inline archive action before a thread is archived.</div>
                    </div>
                    <label className="provider-toggle" title="Archive confirmation">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Delete confirmation</div>
                      <div className="setting-label-desc">Ask before deleting a thread and its chat history.</div>
                    </div>
                    <label className="provider-toggle" title="Delete confirmation">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">About</div>
                      <div className="setting-label-desc">The Orion version currently installed.</div>
                    </div>
                    <span className="setting-version">
                      {appUpdateState?.currentVersion ? `v${appUpdateState.currentVersion}` : '—'}
                    </span>
                  </div>
                </>
              )}

              {settingsTab === 'providers' && (
                <>
                  <div className="providers-toolbar">
                    <div className="providers-toolbar-actions">
                      {providerUpdateState?.checkedAt && (
                        <span className="providers-checked">
                          Checked {formatCheckedTime(providerUpdateState.checkedAt)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="providers-action-btn"
                        title="Refresh"
                        onClick={() => {
                          void refreshProviderUpdates();
                        }}
                        disabled={providerUpdatesRunning}
                      >
                        <RefreshCw size={13} className={providerUpdatesRunning ? 'spinning' : ''} />
                      </button>
                    </div>
                  </div>
                  {agentProviders
                    // Orion is a pseudo-provider (the orchestrator), not an
                    // installable CLI — no row in Providers.
                    .filter((provider) => provider.id !== 'orion')
                    .map((provider) => {
                      const Icon = provider.icon;
                      const status = providerStatusById.get(provider.id);
                      const providerEnabled =
                        normalizedProviderSettings[provider.id as ProviderId]?.enabled !== false;
                      const authenticated = status?.auth?.authenticated === true;
                      const canAuthenticate = status?.installed !== false && status?.auth?.status !== 'missing';
                      const version = status?.currentVersion
                        ? status.currentVersion.replace(/^v/i, '')
                        : null;
                      const hasUpdate = !!status?.updateAvailable;
                      const isEarly =
                        provider.id === 'cursor' || provider.id === 'grok' || provider.id === 'kimi';

                      // Determine subtitle
                      let subtitle = '';
                      if (!providerEnabled) {
                        subtitle = `Disabled – ${provider.label} is disabled in settings.`;
                      } else if (status?.installed === false) {
                        const cmd = status?.command || provider.id;
                        subtitle = `Not found – ${provider.label} CLI (${cmd}) is not installed or not on PATH.`;
                      } else if (authenticated) {
                        const raw = status?.auth?.detail || 'Authenticated';
                        subtitle = /authenticated/i.test(raw) ? raw : `Authenticated as ${raw}`;
                      } else if (status?.auth?.authenticated === false) {
                        subtitle = 'Available – Installed and ready, but authentication could not be verified.';
                      } else if (status?.installed) {
                        subtitle = 'Available – Installed and ready.';
                      } else {
                        subtitle = status?.auth?.label || 'Unknown';
                      }

                      const revealed = !!revealedProviderEmails[provider.id];
                      const displaySubtitle = subtitle.replace(
                        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
                        (email) =>
                          revealed
                            ? email
                            : email.replace(/^(.{1,2}).*?(@.*)$/, '$1••••$2')
                      );
                      const hasEmailInSubtitle = /\S+@\S+/.test(subtitle);

                      const statusColor = !providerEnabled
                        ? 'yellow'
                        : status?.installed === false
                          ? 'red'
                          : 'green';

                      const optionDefs = providerOptionDefs[provider.id] ?? [];
                      const optionsExpanded = !!expandedProviderOptions[provider.id];
                      const optionValues =
                        providerSettings[provider.id as ProviderId]?.options ?? {};

                      return (
                        <div key={provider.id} className="provider-row-wrap">
                        <div className="provider-row">
                          <div className="provider-left">
                            <span className={`provider-status-dot ${statusColor}`} />
                            <span className="provider-icon-wrap">
                              <Icon size={18} />
                            </span>
                            <div className="provider-meta">
                              <div className="provider-head">
                                <span className="provider-name">{provider.label}</span>
                                {version && <span className="provider-version">v{version}</span>}
                                {hasUpdate && <span className="provider-update-arrow" title="Update available">↑</span>}
                                {isEarly && <span className="provider-badge early">Early Access</span>}
                              </div>
                              <div
                                className="provider-subtitle"
                                onClick={() => {
                                  if (hasEmailInSubtitle) {
                                    setRevealedProviderEmails((prev) => ({
                                      ...prev,
                                      [provider.id]: !prev[provider.id],
                                    }));
                                  }
                                }}
                                title={hasEmailInSubtitle && !revealed ? 'Click to reveal email' : undefined}
                              >
                                {displaySubtitle}
                              </div>
                            </div>
                          </div>

                          <div className="provider-right">
                            <button
                              type="button"
                              className={`provider-menu-btn ${optionsExpanded ? 'open' : ''}`}
                              title={optionsExpanded ? 'Hide options' : 'Provider options'}
                              onClick={() => {
                                setExpandedProviderOptions((prev) => ({
                                  ...prev,
                                  [provider.id]: !prev[provider.id],
                                }));
                              }}
                            >
                              <ChevronDown size={14} />
                            </button>

                            {canAuthenticate && (
                              <button
                                type="button"
                                className="provider-auth-button compact"
                                onClick={() => handleAuthenticateProvider(provider.id)}
                                disabled={authenticatingProviderId === provider.id}
                              >
                                {authenticated ? 'Re-authenticate' : 'Authenticate'}
                              </button>
                            )}

                            <label className="provider-toggle" title={providerEnabled ? 'Enabled' : 'Disabled'}>
                              <input
                                type="checkbox"
                                checked={providerEnabled}
                                onChange={(event) => {
                                  setProviderEnabled(provider.id as ProviderId, event.target.checked);
                                }}
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        {optionsExpanded && optionDefs.length > 0 && (
                          <div className="provider-options">
                            {optionDefs.map((option) => {
                              if (option.type === 'boolean') {
                                const checked = optionValues[option.key] === true;
                                return (
                                  <div key={option.key} className="provider-option">
                                    <span className="provider-option-text">
                                      <span className="provider-option-label">{option.label}</span>
                                      <span className="provider-option-description">{option.description}</span>
                                    </span>
                                    <label className="provider-toggle">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => {
                                          setProviderOptions(provider.id as ProviderId, {
                                            [option.key]: event.target.checked,
                                          } as Partial<ProviderRuntimeOptions>);
                                        }}
                                      />
                                      <span />
                                    </label>
                                  </div>
                                );
                              }

                              const value = optionValues[option.key];
                              return (
                                <div key={option.key} className="provider-option column">
                                  <span className="provider-option-text">
                                    <span className="provider-option-label">{option.label}</span>
                                    <span className="provider-option-description">{option.description}</span>
                                  </span>
                                  <input
                                    type="text"
                                    className="provider-option-input"
                                    placeholder={option.placeholder}
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={(event) => {
                                      setProviderOptions(provider.id as ProviderId, {
                                        [option.key]: event.target.value,
                                      } as Partial<ProviderRuntimeOptions>);
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </>
              )}

              {settingsTab === 'orchestration' && (
                <>
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="settings-panel-title">Orchestration</div>
                      <div className="settings-muted">
                        Pick “Orion” as a thread’s model and Fable-style orchestration kicks in: the
                        main driver model coordinates the work, talks to you, and delegates to the
                        role models below via subagents.
                      </div>
                    </div>
                  </div>

                  {orchestrationRoleMeta.map((role) => (
                    <div className="setting-row" key={role.id}>
                      <div className="setting-label">
                        <div className="setting-label-title">{role.label}</div>
                        <div className="setting-label-desc">{role.desc}</div>
                      </div>
                      <select
                        className="setting-select"
                        value={normalizedOrchestrationSettings.models[role.id]}
                        onChange={(e) => setOrchestrationRoleModel(role.id, e.target.value)}
                      >
                        {orchestrationModelGroups.map((group) => (
                          <optgroup key={group.provider.id} label={group.provider.label}>
                            {group.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  ))}

                  <div className="setting-row setting-row-stacked">
                    <div className="setting-label">
                      <div className="setting-label-title">General instructions</div>
                      <div className="setting-label-desc">
                        Free-form guidance included in the orchestrator's instructions
                      </div>
                    </div>
                    <textarea
                      className="setting-textarea"
                      rows={6}
                      value={normalizedOrchestrationSettings.generalInstructions}
                      onChange={(e) => setOrchestrationGeneralInstructions(e.target.value)}
                      placeholder="e.g. Always run the test suite before reporting a task as done."
                    />
                  </div>
                </>
              )}

              {settingsTab === 'computer-use' && (
                computerUsePerms && !computerUsePerms.supported ? (
                  <div className="settings-empty-panel">
                    <div className="settings-panel-title">Computer use</div>
                    <div className="settings-muted">
                      Computer use permissions only apply on macOS. Nothing to configure on this platform.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">macOS permissions</div>
                        <div className="setting-label-desc">
                          Agents that control the mouse, keyboard, and screen (Codex computer use and similar) need
                          Orion to hold these macOS permissions. macOS attributes every CLI Orion launches — codex,
                          claude, grok, cursor — back to Orion, so granting them here covers all providers.
                        </div>
                      </div>
                    </div>

                    {([
                      {
                        kind: 'accessibility',
                        title: 'Accessibility',
                        desc: 'Lets agents read app windows and send clicks and keystrokes. After requesting, enable Orion in the Accessibility list.',
                        status: computerUsePerms?.accessibility ?? 'not-determined',
                      },
                      {
                        kind: 'screen-recording',
                        title: 'Screen Recording',
                        desc: 'Lets agent screenshots include other apps’ window contents. Without it, captures show only the wallpaper.',
                        status: computerUsePerms?.screenRecording ?? 'not-determined',
                      },
                      {
                        kind: 'automation',
                        title: 'Automation (Apple Events)',
                        desc: 'Lets agents drive apps through AppleScript and System Events. macOS asks once per app an agent controls; the status here reflects the System Events grant.',
                        status: computerUsePerms?.automation ?? 'not-determined',
                      },
                    ] as Array<{
                      kind: OrionComputerUsePermissionKind;
                      title: string;
                      desc: string;
                      status: OrionComputerUsePermissionStatus;
                    }>).map((row) => {
                      const granted = row.status === 'granted';
                      const chip =
                        row.status === 'granted'
                          ? { className: 'authenticated', label: 'Granted' }
                          : row.status === 'denied' || row.status === 'restricted'
                            ? { className: 'unauthenticated', label: 'Not granted' }
                            : row.status === 'not-determined'
                              ? { className: '', label: 'Not requested' }
                              : null;
                      return (
                        <div className="setting-row" key={row.kind}>
                          <div className="setting-label">
                            <div className="setting-label-title">{row.title}</div>
                            <div className="setting-label-desc">{row.desc}</div>
                          </div>
                          <div className="setting-row-actions">
                            {chip && (
                              <span className={`provider-status-chip ${chip.className}`}>{chip.label}</span>
                            )}
                            <button
                              type="button"
                              className="provider-auth-button"
                              onClick={() => {
                                void handleRequestComputerUsePermission(row.kind);
                              }}
                              disabled={computerUseBusyKind !== null}
                            >
                              <SquareArrowOutUpRight size={13} />
                              {computerUseBusyKind === row.kind
                                ? 'Requesting...'
                                : granted
                                  ? 'System Settings'
                                  : row.kind === 'automation'
                                    ? 'Request access'
                                    : 'Grant access'}
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Apply new grants</div>
                        <div className="setting-label-desc">
                          macOS applies Screen Recording (and sometimes Accessibility) to an already-running app
                          only after it relaunches. Restart Orion once you’ve granted access.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="provider-auth-button"
                        onClick={() => {
                          void window.orion.relaunchApp();
                        }}
                      >
                        <RefreshCw size={13} />
                        Relaunch Orion
                      </button>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Browser control</div>
                        <div className="setting-label-desc">
                          Codex’s built-in ChatGPT-extension browser only works inside the ChatGPT desktop app, so
                          Orion gives each provider its own browser tooling instead. These mirror the same options
                          under Settings → Providers.
                        </div>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Codex · Browser control</div>
                        <div className="setting-label-desc">
                          Full browser control through chrome-devtools-mcp: navigate, click, read pages, screenshot.
                          Launches a dedicated Chrome with a persistent profile — sign in to sites once there and
                          logins stick across runs.
                        </div>
                      </div>
                      <div className="setting-row-actions">
                        <label className="provider-toggle">
                          <input
                            type="checkbox"
                            checked={providerSettings.codex?.options?.browserControl === true}
                            onChange={(event) => {
                              setProviderOptions('codex', { browserControl: event.target.checked });
                            }}
                          />
                          <span />
                        </label>
                      </div>
                    </div>

                    {(() => {
                      const browserControlOn = providerSettings.codex?.options?.browserControl === true;
                      const autoConnectOn = providerSettings.codex?.options?.browserAutoConnect === true;
                      const debugStatus = computerUsePerms?.chromeDebug?.status ?? 'disabled';
                      const chip =
                        debugStatus === 'enabled'
                          ? { className: 'authenticated', label: 'Ready' }
                          : debugStatus === 'stale'
                            ? { className: '', label: 'Restart Chrome' }
                            : autoConnectOn
                              ? { className: 'unauthenticated', label: 'Setup needed' }
                              : { className: '', label: 'Not set up' };
                      return (
                        <div className="setting-row">
                          <div className="setting-label">
                            <div className="setting-label-title">Codex · Use your signed-in Chrome</div>
                            <div className="setting-label-desc">
                              Attach browser control to your real Chrome profile — existing tabs, logins, and
                              cookies — instead of the dedicated one. Requires Browser control above.
                              {autoConnectOn && debugStatus !== 'enabled' && (
                                <>
                                  <br />
                                  One-time setup: 1. Click “Set up in Chrome” (the link is also copied to your
                                  clipboard — paste it in Chrome’s address bar if no tab opens). 2. On that page,
                                  turn on “Enable remote debugging” (Chrome 144+). 3. Quit Chrome fully (⌘Q) and
                                  reopen it — the server only starts on launch. The status here flips to Ready
                                  automatically.
                                </>
                              )}
                              {autoConnectOn && !browserControlOn && (
                                <>
                                  <br />
                                  Turn on Browser control above for this to take effect.
                                </>
                              )}
                            </div>
                          </div>
                          <div className="setting-row-actions">
                            <span className={`provider-status-chip ${chip.className}`}>{chip.label}</span>
                            <button
                              type="button"
                              className="provider-auth-button"
                              onClick={() => {
                                void handleOpenChromeDebugSetup();
                              }}
                            >
                              <SquareArrowOutUpRight size={13} />
                              Set up in Chrome
                            </button>
                            <label className="provider-toggle">
                              <input
                                type="checkbox"
                                checked={autoConnectOn}
                                onChange={(event) => {
                                  setProviderOptions('codex', { browserAutoConnect: event.target.checked });
                                }}
                              />
                              <span />
                            </label>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Claude · Claude in Chrome</div>
                        <div className="setting-label-desc">
                          Browser control through the Claude Chrome extension (--chrome): drives your real signed-in
                          Chrome. Requires the extension to be installed in Chrome.
                        </div>
                      </div>
                      <div className="setting-row-actions">
                        <label className="provider-toggle">
                          <input
                            type="checkbox"
                            checked={providerSettings.claude?.options?.chrome === true}
                            onChange={(event) => {
                              setProviderOptions('claude', { chrome: event.target.checked });
                            }}
                          />
                          <span />
                        </label>
                      </div>
                    </div>
                  </>
                )
              )}

              {settingsTab === 'cosmetics' && (
                <div className="settings-empty-panel">
                  <div className="settings-panel-title">Cosmetics</div>
                  <div className="settings-muted">Coming soon.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!settingsOpen && (
        <div className="main-content">
        {/* ========== AGENTS TAB ========== */}
        {activeTab === 'agents' && (
          <>
            {/* Sidebar: Projects + Threads */}
            <div className="sidebar agents-sidebar">
              <div className="sidebar-content agents-sidebar-content">
                {projects.length === 0 && (
                  <div className="empty-state p-8 text-center">
                    <div className="empty-state-icon">
                      <FolderOpen size={28} />
                    </div>
                    <div className="empty-state-title">No projects yet</div>
                    <div className="text-xs text-[#6b6b74]">Add a folder to start agent threads</div>
                    <button onClick={handleAddProject} className="btn mt-3">
                      <Plus size={14} /> Add Project
                    </button>
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="sidebar-primary-actions">
                    <button type="button" className="sidebar-action-button primary" onClick={handleNewAgent}>
                      <SquarePen size={15} />
                      <span>New agent</span>
                    </button>
                    <div className="sidebar-search-wrap" ref={threadSearchRef}>
                      <button
                        type="button"
                        className={`sidebar-action-button ${threadSearchOpen ? 'active' : ''}`}
                        onClick={() => setThreadSearchOpen((open) => !open)}
                        aria-expanded={threadSearchOpen}
                      >
                        <Search size={15} />
                        <span>Search</span>
                      </button>
                      {threadSearchOpen && (
                        <div className="thread-search-panel">
                          <div className="thread-search-input">
                            <Search size={14} />
                            <input
                              autoFocus
                              value={threadSearchQuery}
                              onChange={(event) => setThreadSearchQuery(event.target.value)}
                              placeholder="Search threads..."
                            />
                          </div>
                          <div className="thread-search-results">
                            <ThreadSearchResults
                              projects={projects}
                              query={threadSearchQuery}
                              onSelectThread={(threadId) => {
                                selectThread(threadId);
                                setActiveTab('agents');
                                setThreadSearchOpen(false);
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {pinnedThreads.length > 0 && (
                  <div className="recent-agents-section">
                    <button
                      type="button"
                      className="sidebar-section-toggle"
                      onClick={() =>
                        setPinnedAgentsOpen((open) => {
                          // Collapsing resets the list back to the default 5 on next expand.
                          if (open) setPinnedAgentsShowAll(false);
                          return !open;
                        })
                      }
                      aria-expanded={pinnedAgentsOpen}
                    >
                      <ChevronRight
                        size={12}
                        className={`sidebar-section-chevron ${pinnedAgentsOpen ? 'open' : ''}`}
                      />
                      <span>Pinned</span>
                    </button>
                    {pinnedAgentsOpen && (
                      <>
                      <div className="threads-list recent-agents-list">
                        {(pinnedAgentsShowAll
                          ? pinnedThreads
                          : pinnedThreads.slice(0, THREADS_VISIBLE_LIMIT)
                        ).map((thread) => (
                          <div
                            key={thread.id}
                            className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                            onClick={() => {
                              if (threadRenameKey !== `pinned:${thread.id}`) selectThread(thread.id);
                            }}
                          >
                            {threadRenameKey === `pinned:${thread.id}` ? (
                              <InlineRenameInput
                                className="thread-rename-input"
                                initialValue={thread.title}
                                onSubmit={(title) => {
                                  updateThread(thread.id, { title });
                                  setThreadRenameKey(null);
                                }}
                                onCancel={() => setThreadRenameKey(null)}
                              />
                            ) : (
                              <span className="thread-title">
                                {renderThreadCliBadge(thread)}
                                <span className="thread-title-text">{thread.title}</span>
                              </span>
                            )}
                            <span className="thread-project-tag thread-meta">
                              {projects.find((p) => p.id === thread.projectId)?.name}
                            </span>
                            <span className="thread-time thread-meta">
                              {thread.status === 'running' ? (
                                <span className="thread-working-dot" title="Working" />
                              ) : (
                                formatShortTime(getThreadActivityTime(thread))
                              )}
                            </span>
                            <div
                              className="thread-menu-wrap"
                              ref={threadItemMenuKey === `pinned:${thread.id}` ? threadItemMenuRef : undefined}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="thread-options-trigger"
                                title="Thread options"
                                aria-label={`Options for ${thread.title}`}
                                aria-haspopup="menu"
                                aria-expanded={threadItemMenuKey === `pinned:${thread.id}`}
                                onClick={() =>
                                  setThreadItemMenuKey((open) =>
                                    open === `pinned:${thread.id}` ? null : `pinned:${thread.id}`
                                  )
                                }
                              >
                                <Ellipsis size={13} />
                              </button>
                              {threadItemMenuKey === `pinned:${thread.id}` && (
                                <div className="thread-menu thread-item-menu" role="menu">
                                  <button
                                    type="button"
                                    className="project-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                      setThreadItemMenuKey(null);
                                      setThreadRenameKey(`pinned:${thread.id}`);
                                    }}
                                  >
                                    <SquarePen size={13} /> Rename
                                  </button>
                                  <button
                                    type="button"
                                    className="project-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                      setThreadItemMenuKey(null);
                                      branchThread(thread.id);
                                    }}
                                  >
                                    <GitBranch size={13} /> Branch
                                  </button>
                                  <button
                                    type="button"
                                    className="project-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                      setThreadItemMenuKey(null);
                                      unpinThread(thread.id);
                                    }}
                                  >
                                    <PinOff size={13} /> Unpin
                                  </button>
                                  <button
                                    type="button"
                                    className="project-menu-item danger"
                                    role="menuitem"
                                    onClick={() => {
                                      setThreadItemMenuKey(null);
                                      if (confirm('Delete this thread?')) {
                                        void deleteThreadWithRuntime(thread.id);
                                      }
                                    }}
                                  >
                                    <Trash2 size={13} /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {pinnedThreads.length > THREADS_VISIBLE_LIMIT && (
                        <button
                          type="button"
                          className="threads-show-more"
                          onClick={() => setPinnedAgentsShowAll((showAll) => !showAll)}
                        >
                          {pinnedAgentsShowAll ? 'Show less' : 'Show more'}
                        </button>
                      )}
                      </>
                    )}
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="recent-agents-section">
                    <button
                      type="button"
                      className="sidebar-section-toggle"
                      onClick={() =>
                        setRecentAgentsOpen((open) => {
                          // Collapsing resets the list back to the default 5 on next expand.
                          if (open) setRecentAgentsShowAll(false);
                          return !open;
                        })
                      }
                      aria-expanded={recentAgentsOpen}
                    >
                      <ChevronRight
                        size={12}
                        className={`sidebar-section-chevron ${recentAgentsOpen ? 'open' : ''}`}
                      />
                      <span>Recent agents</span>
                      {runningAgentCount > 0 && (
                        <span className="sidebar-section-count">{runningAgentCount}</span>
                      )}
                    </button>
                    {recentAgentsOpen && (
                      <>
                      <div className="threads-list recent-agents-list">
                        {recentThreads.length === 0 ? (
                          <div className="recent-agents-empty">No recent agents</div>
                        ) : (
                          (recentAgentsShowAll
                            ? recentThreads
                            : recentThreads.slice(0, THREADS_VISIBLE_LIMIT)
                          ).map((thread) => (
                            <div
                              key={thread.id}
                              className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                              onClick={() => {
                                if (threadRenameKey !== `recent:${thread.id}`) selectThread(thread.id);
                              }}
                            >
                              {threadRenameKey === `recent:${thread.id}` ? (
                                <InlineRenameInput
                                  className="thread-rename-input"
                                  initialValue={thread.title}
                                  onSubmit={(title) => {
                                    updateThread(thread.id, { title });
                                    setThreadRenameKey(null);
                                  }}
                                  onCancel={() => setThreadRenameKey(null)}
                                />
                              ) : (
                                <span className="thread-title">
                                  {renderThreadCliBadge(thread)}
                                  <span className="thread-title-text">{thread.title}</span>
                                </span>
                              )}
                              <span className="thread-project-tag thread-meta">
                                {projects.find((p) => p.id === thread.projectId)?.name}
                              </span>
                              <span className="thread-time thread-meta">
                                {thread.status === 'running' ? (
                                  <span className="thread-working-dot" title="Working" />
                                ) : (
                                  formatShortTime(getThreadActivityTime(thread))
                                )}
                              </span>
                              <div
                                className="thread-menu-wrap"
                                ref={threadItemMenuKey === `recent:${thread.id}` ? threadItemMenuRef : undefined}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="thread-options-trigger"
                                  title="Thread options"
                                  aria-label={`Options for ${thread.title}`}
                                  aria-haspopup="menu"
                                  aria-expanded={threadItemMenuKey === `recent:${thread.id}`}
                                  onClick={() =>
                                    setThreadItemMenuKey((open) =>
                                      open === `recent:${thread.id}` ? null : `recent:${thread.id}`
                                    )
                                  }
                                >
                                  <Ellipsis size={13} />
                                </button>
                                {threadItemMenuKey === `recent:${thread.id}` && (
                                  <div className="thread-menu thread-item-menu" role="menu">
                                    <button
                                      type="button"
                                      className="project-menu-item"
                                      role="menuitem"
                                      onClick={() => {
                                        setThreadItemMenuKey(null);
                                        setThreadRenameKey(`recent:${thread.id}`);
                                      }}
                                    >
                                      <SquarePen size={13} /> Rename
                                    </button>
                                    <button
                                      type="button"
                                      className="project-menu-item"
                                      role="menuitem"
                                      onClick={() => {
                                        setThreadItemMenuKey(null);
                                        branchThread(thread.id);
                                      }}
                                    >
                                      <GitBranch size={13} /> Branch
                                    </button>
                                    <button
                                      type="button"
                                      className="project-menu-item"
                                      role="menuitem"
                                      onClick={() => {
                                        setThreadItemMenuKey(null);
                                        pinThread(thread.id);
                                      }}
                                    >
                                      <Pin size={13} /> Pin
                                    </button>
                                    <button
                                      type="button"
                                      className="project-menu-item"
                                      role="menuitem"
                                      onClick={() => {
                                        setThreadItemMenuKey(null);
                                        updateThread(thread.id, { hiddenFromRecent: true });
                                      }}
                                    >
                                      <EyeOff size={13} /> Remove from Recent
                                    </button>
                                    <button
                                      type="button"
                                      className="project-menu-item danger"
                                      role="menuitem"
                                      onClick={() => {
                                        setThreadItemMenuKey(null);
                                        if (confirm('Delete this thread?')) {
                                          void deleteThreadWithRuntime(thread.id);
                                        }
                                      }}
                                    >
                                      <Trash2 size={13} /> Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      {recentThreads.length > THREADS_VISIBLE_LIMIT && (
                        <button
                          type="button"
                          className="threads-show-more"
                          onClick={() => setRecentAgentsShowAll((showAll) => !showAll)}
                        >
                          {recentAgentsShowAll ? 'Show less' : 'Show more'}
                        </button>
                      )}
                      </>
                    )}
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="sidebar-section-header">
                    <span className="sidebar-section-title">Projects</span>
                    <button
                      type="button"
                      className="sidebar-section-action"
                      title="Add project"
                      onClick={() => void handleAddProject()}
                    >
                      <FolderPlus size={14} />
                    </button>
                  </div>
                )}

                {sortedProjects.map((project) => {
                  const projectThreads = projectThreadsByProject.get(project.id) ?? [];
                  const isActiveProject = selectedProject?.id === project.id;
                  const isCollapsed = collapsedProjects[project.id] ?? false;
                  const visibleLimit = threadListLimits[project.id] ?? THREADS_VISIBLE_LIMIT;
                  const visibleThreads = projectThreads.slice(0, visibleLimit);
                  const hasMoreThreads = projectThreads.length > visibleLimit;
                  const isListExpanded =
                    visibleLimit > THREADS_VISIBLE_LIMIT &&
                    projectThreads.length > THREADS_VISIBLE_LIMIT;

                  return (
                    <div
                      key={project.id}
                      className={`project-section ${isActiveProject ? 'project-section-active' : ''}`}
                    >
                      <div className="project-section-header-row">
                        <button
                          type="button"
                          className="project-collapse-toggle"
                          title={isCollapsed ? 'Expand threads' : 'Collapse threads'}
                          aria-expanded={!isCollapsed}
                          onClick={() => {
                            // Collapsing resets the list back to the default 5 on next expand.
                            if (!isCollapsed) {
                              setThreadListLimits((prev) => {
                                if (!(project.id in prev)) return prev;
                                const { [project.id]: _removed, ...rest } = prev;
                                return rest;
                              });
                            }
                            setCollapsedProjects((prev) => ({
                              ...prev,
                              [project.id]: !isCollapsed,
                            }));
                          }}
                        >
                          <ChevronRight
                            size={12}
                            className={`sidebar-section-chevron ${isCollapsed ? '' : 'open'}`}
                          />
                        </button>
                        {projectRenameId === project.id ? (
                          <div className="project-section-header project-section-header-renaming">
                            <ProjectIcon projectPath={project.path} size={13} />
                            <InlineRenameInput
                              className="thread-rename-input"
                              initialValue={project.name}
                              onSubmit={(name) => {
                                renameProject(project.id, name);
                                setProjectRenameId(null);
                              }}
                              onCancel={() => setProjectRenameId(null)}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="project-section-header"
                            onClick={() => selectProject(project.id)}
                            title={project.path}
                          >
                            <ProjectIcon projectPath={project.path} size={13} />
                            <span className="truncate">{project.name}</span>
                            {isCollapsed && projectThreads.length > 0 && (
                              <span className="sidebar-section-count">{projectThreads.length}</span>
                            )}
                          </button>
                        )}
                        <div
                          className="project-menu-wrap"
                          ref={projectMenuOpenId === project.id ? projectMenuRef : undefined}
                        >
                          <button
                            type="button"
                            className="project-options-trigger"
                            title="Project options"
                            aria-label={`Options for ${project.name}`}
                            aria-haspopup="menu"
                            aria-expanded={projectMenuOpenId === project.id}
                            onClick={() =>
                              setProjectMenuOpenId((open) =>
                                open === project.id ? null : project.id
                              )
                            }
                          >
                            <Ellipsis size={13} />
                          </button>
                          {projectMenuOpenId === project.id && (
                            <div className="thread-menu project-menu" role="menu">
                              <button
                                type="button"
                                className="project-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuOpenId(null);
                                  setProjectRenameId(project.id);
                                }}
                              >
                                <SquarePen size={13} /> Rename
                              </button>
                              <button
                                type="button"
                                className="project-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuOpenId(null);
                                  if (
                                    confirm(
                                      `Remove "${project.name}" and its threads? Files on disk are not affected.`
                                    )
                                  ) {
                                    void removeProjectWithRuntimes(project.id);
                                  }
                                }}
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="project-new-thread"
                          title={`New thread in ${project.name}`}
                          onClick={() => handleCreateThread(project.id)}
                        >
                          <SquarePen size={13} />
                        </button>
                      </div>

                      {!isCollapsed && (
                        <>
                        <div className="threads-list">
                          {projectThreads.length === 0 ? (
                            <button
                              type="button"
                              className="thread-item thread-item-empty"
                              onClick={() => handleCreateThread(project.id)}
                            >
                              <span className="thread-title">New thread</span>
                            </button>
                          ) : (
                            visibleThreads.map((thread) => (
                              <div
                                key={thread.id}
                                className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                                onClick={() => {
                                  if (threadRenameKey !== `project:${thread.id}`) selectThread(thread.id);
                                }}
                              >
                                {threadRenameKey === `project:${thread.id}` ? (
                                  <InlineRenameInput
                                    className="thread-rename-input"
                                    initialValue={thread.title}
                                    onSubmit={(title) => {
                                      updateThread(thread.id, { title });
                                      setThreadRenameKey(null);
                                    }}
                                    onCancel={() => setThreadRenameKey(null)}
                                  />
                                ) : (
                                  <span className="thread-title">
                                    {renderThreadCliBadge(thread)}
                                    <span className="thread-title-text">{thread.title}</span>
                                  </span>
                                )}
                                <span className="thread-time thread-meta">
                                  {thread.status === 'running' ? (
                                    <span className="thread-working-dot" title="Working" />
                                  ) : (
                                    formatShortTime(getThreadActivityTime(thread))
                                  )}
                                </span>
                                <div
                                  className="thread-menu-wrap"
                                  ref={threadItemMenuKey === `project:${thread.id}` ? threadItemMenuRef : undefined}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    className="thread-options-trigger"
                                    title="Thread options"
                                    aria-label={`Options for ${thread.title}`}
                                    aria-haspopup="menu"
                                    aria-expanded={threadItemMenuKey === `project:${thread.id}`}
                                    onClick={() =>
                                      setThreadItemMenuKey((open) =>
                                        open === `project:${thread.id}` ? null : `project:${thread.id}`
                                      )
                                    }
                                  >
                                    <Ellipsis size={13} />
                                  </button>
                                  {threadItemMenuKey === `project:${thread.id}` && (
                                    <div className="thread-menu thread-item-menu" role="menu">
                                      <button
                                        type="button"
                                        className="project-menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                          setThreadItemMenuKey(null);
                                          setThreadRenameKey(`project:${thread.id}`);
                                        }}
                                      >
                                        <SquarePen size={13} /> Rename
                                      </button>
                                      <button
                                        type="button"
                                        className="project-menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                          setThreadItemMenuKey(null);
                                          branchThread(thread.id);
                                        }}
                                      >
                                        <GitBranch size={13} /> Branch
                                      </button>
                                      <button
                                        type="button"
                                        className="project-menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                          setThreadItemMenuKey(null);
                                          if (thread.pinnedAt) unpinThread(thread.id);
                                          else pinThread(thread.id);
                                        }}
                                      >
                                        {thread.pinnedAt ? (
                                          <>
                                            <PinOff size={13} /> Unpin
                                          </>
                                        ) : (
                                          <>
                                            <Pin size={13} /> Pin
                                          </>
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        className="project-menu-item danger"
                                        role="menuitem"
                                        onClick={() => {
                                          setThreadItemMenuKey(null);
                                          if (confirm('Delete this thread?')) {
                                            void deleteThreadWithRuntime(thread.id);
                                          }
                                        }}
                                      >
                                        <Trash2 size={13} /> Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {(hasMoreThreads || isListExpanded) && (
                          <button
                            type="button"
                            className="threads-show-more"
                            onClick={() =>
                              setThreadListLimits((prev) => {
                                if (hasMoreThreads) {
                                  return { ...prev, [project.id]: projectThreads.length };
                                }
                                const { [project.id]: _removed, ...rest } = prev;
                                return rest;
                              })
                            }
                          >
                            {hasMoreThreads ? 'Show more' : 'Show less'}
                          </button>
                        )}
                        </>
                      )}

                    </div>
                  );
                })}
              </div>
              {renderSidebarFooter()}
            </div>

            {/* Main Panel: Thread view */}
            <div className="panel agents-panel">
              {!selectedThread ? (
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
                <>
                  <div className="panel-content">
                    {isTerminalThread ? (
                      <React.Suspense fallback={<div className="terminal-view" />}>
                        <TerminalView
                          key={selectedThread.id}
                          threadId={selectedThread.id}
                          projectPath={selectedThreadProjectPath ?? ''}
                          accessMode={selectedThread.accessMode ?? 'full-access'}
                          resumeSessionId={selectedThread.agentSessionIds?.claude}
                          forkSession={selectedThread.pendingForkProviders?.includes('claude')}
                        />
                      </React.Suspense>
                    ) : (
                      <>
                        <ChatTranscript
                          threadId={selectedThread.id}
                          projectName={selectedThreadProject?.name}
                          mediaBaseDirs={mediaBaseDirs}
                          isSending={isSending}
                          steerSupported={steerSupported}
                          steerReady={steerReady}
                          authenticatingProviderId={authenticatingProviderId}
                          chatScrollRef={chatScrollRef}
                          chatEndRef={chatEndRef}
                          chatPinnedRef={chatPinnedRef}
                          chatScrollTopRef={chatScrollTopRef}
                          tasksCardPosition={tasksCardPosition}
                          tasksCardCollapsed={tasksCardCollapsed}
                          tasksCardDismissedFor={tasksCardDismissedFor}
                          onMoveTasksCard={setTasksCardPosition}
                          onToggleTasksCard={toggleTasksCard}
                          onDismissTasksCard={dismissTasksCard}
                          onMarkTaskDone={markLinkedTaskDone}
                          onUnlinkTask={unlinkTaskFromThread}
                          onDismissBtwExchange={dismissBtwExchange}
                          onAuthenticateProvider={handleAuthenticateProvider}
                          onSteerQueuedMessage={steerQueuedMessage}
                        />
                      </>
                    )}

                    <div className="chat-input-area">
                      <AgentFamilySwitcher
                        currentThread={selectedThread}
                        threads={threads}
                        onSelect={selectThread}
                      />
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
                        {selectedThread.linkedTask && !selectedThread.linkedTask.injected && (
                          <div className="composer-task-row">
                            <div
                              className={`composer-task-chip status-${selectedThread.linkedTask.lastStatus ?? 'linked'}`}
                              title={selectedThread.linkedTask.description || selectedThread.linkedTask.title}
                            >
                              <SquareKanban size={13} />
                              <span className="composer-task-title">{selectedThread.linkedTask.title}</span>
                              <span className="composer-task-status">
                                {linkedTaskStatusLabel(selectedThread.linkedTask.lastStatus)}
                              </span>
                              {selectedThread.linkedTask.lastStatus !== 'done' && !isSending && (
                                <button
                                  type="button"
                                  className="composer-task-action done"
                                  onClick={() => markLinkedTaskDone(selectedThread.id)}
                                  title="Mark the task as done on the board"
                                >
                                  <CircleCheck size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="composer-task-action"
                                onClick={() => unlinkTaskFromThread(selectedThread.id)}
                                title="Unlink task"
                              >
                                <X size={12} />
                              </button>
                            </div>
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
                                findAgentModel(
                                  agentModels,
                                  normalizedOrchestrationSettings.models.mainDriver
                                )?.providerId === 'claude')
                                ? 'Aside question — answered by a read-only fork of this thread’s Claude session. It won’t interrupt the agent or join the thread.'
                                : '/btw is only available on Claude agents for now.'}
                            </span>
                          </div>
                        )}
                        {selectedAgentModel?.providerId === 'codex' &&
                          /^\/review\s*$/i.test(chatInput.trimStart()) && (
                            <div className="mention-popover review-popover" role="listbox">
                              <button
                                type="button"
                                role="option"
                                className="mention-row"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => dispatchReview('/review', { mode: 'uncommitted' })}
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
                            </div>
                          )}
                        {selectedAgentModel?.providerId === 'codex' &&
                          /^\/review\s+base\s*$/i.test(chatInput.trimStart()) && (
                            <div className="mention-popover review-popover" role="listbox">
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
                                  <span className="mention-row-label">
                                    No other branches — type a branch name
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        {chatMentionOpen && (
                          <div className="mention-popover" role="listbox">
                            {chatMentionCandidates.map((model, index) => {
                              const ProviderIcon =
                                agentProviders.find((provider) => provider.id === model.providerId)
                                  ?.icon ?? Play;
                              return (
                                <button
                                  key={model.id}
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
                                  <span className="mention-row-slug">
                                    {modelMentionToken(model, agentModels)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <textarea
                          ref={chatInputRef}
                          className="chat-input min-h-[52px]"
                          disabled={isNativeSubagentThread}
                          placeholder={
                            isNativeSubagentThread
                              ? 'Read-only subagent transcript — steer from the parent thread.'
                              : isTerminalThread
                              ? 'Type a prompt — ⏎ sends it to the Claude Code terminal…'
                              : isSending
                              ? steerSupported
                                ? 'Queue a follow-up (⏎) or steer the agent now (⌘⏎)…'
                                : 'Queue a follow-up — sends when the agent finishes (⏎)…'
                              : chatAttachments.length > 0
                                ? `Ask something about the attached ${chatAttachments.some(isVideoAttachment) ? 'media' : 'image'}...`
                                : selectedThread.linkedTask && !selectedThread.linkedTask.injected
                                  ? 'Add details (optional) — send starts on the linked task...'
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
                          onClick={(e) =>
                            updateChatMention(e.currentTarget.value, e.currentTarget.selectionStart)
                          }
                          rows={2}
                        />
                        <div className="composer-controls">
                          <div className="model-picker-anchor" ref={modelPickerRef}>
                            <button
                              className="model-trigger"
                              onClick={() => {
                                setModelPickerOpen((open) => {
                                  if (!open) {
                                    setActiveProviderTab(selectedAgentModel.providerId);
                                  }
                                  return !open;
                                });
                              }}
                              disabled={isSending}
                            >
                              {selectedAgentModel && (() => {
                                const ProviderIcon =
                                  agentProviders.find((provider) => provider.id === selectedAgentModel.providerId)
                                    ?.icon ?? Play;
                                return <ProviderIcon size={15} />;
                              })()}
                              <span>{selectedAgentModel?.label ?? 'Select model'}</span>
                              <ChevronDown size={14} className={`model-trigger-chevron ${modelPickerOpen ? 'open' : ''}`} />
                            </button>

                            {modelPickerOpen && (
                              <div className="model-picker-popover">
                              <div className="model-provider-rail">
                                {agentProviders.map((provider) => {
                                  const Icon = provider.icon;
                                  return (
                                    <button
                                      key={provider.id}
                                      className={`provider-rail-button ${activeProviderTab === provider.id ? 'active' : ''}`}
                                      onClick={() => setActiveProviderTab(provider.id)}
                                      title={provider.label}
                                    >
                                      <Icon size={19} />
                                    </button>
                                  );
                                })}
                              </div>
                              <div
                                className={`model-picker-panel${
                                  activeProviderTab === 'claude' ? ' has-cli-overlay' : ''
                                }`}
                              >
                                {activeProviderTab === 'claude' && claudeCodeCliModel && (
                                  <button
                                    type="button"
                                    className={`model-cli-overlay${
                                      selectedThread.modelId === claudeCodeCliModelId
                                        ? ' selected'
                                        : ''
                                    }`}
                                    onClick={async () => {
                                      if (selectedThread.modelId === claudeCodeCliModelId) {
                                        setModelPickerOpen(false);
                                        setModelSearch('');
                                        return;
                                      }
                                      updateThread(selectedThread.id, {
                                        modelId: claudeCodeCliModelId,
                                      });
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
                                )}
                                <div className="model-search">
                                  <Search size={16} />
                                  <input
                                    autoFocus
                                    value={modelSearch}
                                    onChange={(event) => setModelSearch(event.target.value)}
                                    placeholder="Search models..."
                                  />
                                </div>
                                <div className="model-list">
                                  {visibleAgentModels.map((model) => {
                                    const ProviderIcon =
                                      agentProviders.find((provider) => provider.id === model.providerId)
                                        ?.icon ?? Play;
                                    const selected = selectedThread.modelId === model.id;
                                    return (
                                      <button
                                        key={model.id}
                                        className={`model-row ${selected ? 'selected' : ''}`}
                                        onClick={async () => {
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
                                        disabled={model.available === false}
                                        title={model.unavailableReason ?? model.slug}
                                      >
                                        <ProviderIcon size={18} />
                                        <span className="model-row-text">
                                          <span className="model-row-label">{model.label}</span>
                                          <span className="model-row-provider">{model.providerLabel}</span>
                                        </span>
                                        {model.shortcut && <span className="model-shortcut">{model.shortcut}</span>}
                                        {selected && <Check size={15} />}
                                      </button>
                                    );
                                  })}
                                  {visibleAgentModels.length === 0 && (
                                    <div className="model-empty">No models</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

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
                              <div className="codex-settings-popover">
                                {selectedAgentModel?.providerId === 'grok' ? (
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
                                            <span className="settings-check">
                                              {selected && <Check size={17} />}
                                            </span>
                                            <span>
                                              {option.label}
                                              {option.default ? ' (default)' : ''}
                                              {option.description && (
                                                <span className="codex-settings-row-description">
                                                  {option.description}
                                                </span>
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
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{isDefault ? ' (default)' : ''}</span>
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
                                            !!selectedAgentModel &&
                                            claudeOneMillionOnlyModelSlugs.has(selectedAgentModel.slug);
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
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{option.value === defaultClaudeContextWindow && !oneMillionOnly ? ' (default)' : ''}</span>
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
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>
                                                {option.label}{option.default ? ' (default)' : ''}
                                                {option.description && (
                                                  <span className="codex-settings-row-description">
                                                    {option.description}
                                                  </span>
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
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{option.default ? ' (default)' : ''}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
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
                            <div className="access-mode-popover">
                              <div className="codex-settings-options">
                                {accessModeOptions.map((option) => {
                                  const selected = selectedAccessMode === option.value;
                                  return (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className={`codex-settings-row ${selected ? 'selected' : ''}`}
                                      onClick={() => {
                                        updateThread(selectedThread.id, {
                                          accessMode: option.value,
                                        });
                                        setAccessModeOpen(false);
                                      }}
                                    >
                                      <span className="settings-check">
                                        {selected && <Check size={17} />}
                                      </span>
                                      <span>{option.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {!isTerminalThread && (
                        <div className="task-picker-anchor" ref={taskPickerRef}>
                          <button
                            className={`model-trigger task-link-trigger ${selectedThread.linkedTask ? 'linked' : ''}`}
                            onClick={() => setTaskPickerOpen((open) => !open)}
                            title={
                              selectedThread.linkedTask
                                ? `Linked task: ${selectedThread.linkedTask.title}`
                                : 'Link a task from your Orion board'
                            }
                            aria-label={
                              selectedThread.linkedTask
                                ? `Linked task: ${selectedThread.linkedTask.title}`
                                : 'Link a task from your Orion board'
                            }
                          >
                            <SquareKanban size={15} />
                          </button>
                          {taskPickerOpen && (
                            <TaskPickerPopover
                              linkedTaskId={selectedThread.linkedTask?.id}
                              authenticated={accountState.authenticated}
                              onSignIn={() => void handleStartAccountAuth()}
                              onPick={linkTaskToSelectedThread}
                            />
                          )}
                        </div>
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
                              (!chatInput.trim() &&
                                chatAttachments.length === 0 &&
                                !(selectedThread.linkedTask && !selectedThread.linkedTask.injected)) ||
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
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ========== CODE TAB ========== */}
        {activeTab === 'code' && (
          <>
            {/* File Explorer Sidebar */}
            <div className="sidebar">
              <div className="sidebar-header">
                <span>Explorer</span>
                <div className="flex gap-1">
                  <button
                    onClick={handleOpenFolderForCode}
                    className="btn secondary small"
                    title="Open folder"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={() => {
                      const p = selectedProject ?? projects[0];
                      if (p) {
                        setWorkspacePath(p.path);
                        closeAllFiles();
                        toast.info(`Opened ${p.name}`);
                      } else {
                        handleOpenFolderForCode();
                      }
                    }}
                    className="btn secondary small"
                    title="Use selected project as workspace"
                  >
                    <Folder size={13} />
                  </button>
                  <button
                    onClick={() => {
                      if (workspacePath) loadRoot(workspacePath);
                    }}
                    className="btn secondary small"
                    title="Refresh"
                  >
                    ↻
                  </button>
                </div>
              </div>

              <div className="sidebar-content">
                {!treeRoot && (
                  <div className="empty-state p-6">
                    <Folder size={32} />
                    <div className="mt-1">No folder open</div>
                    <button onClick={handleOpenFolderForCode} className="btn mt-3">
                      Open Folder
                    </button>
                    {projects.length > 0 && (
                      <div className="mt-4 text-[11px] text-[#777]">
                        Or select a project in Agents tab
                      </div>
                    )}
                  </div>
                )}

                {treeRoot && (
                  <div className="file-tree pt-1">
                    {treeItems.map((item) => (
                      <FileTreeNode
                        key={item.path}
                        item={item}
                        onFileClick={handleOpenFile}
                        activePath={activeFilePath}
                        loadChildren={loadChildren}
                        rootPath={treeRoot}
                        refreshToken={treeRefreshToken}
                        onRequestDelete={handleDeleteTreeItem}
                        onRenamed={handleTreeItemRenamed}
                      />
                    ))}
                  </div>
                )}
              </div>
              {renderSidebarFooter()}
            </div>

            {/* Editor Panel */}
            <div className="panel">
              {/* Editor Tabs */}
              {openFiles.length > 0 && (
                <div className="editor-tabs">
                  {openFiles.map((file) => {
                    const fileName = file.path.split(/[\\/]/).pop() || file.path;
                    const isActive = file.path === activeFilePath;
                    return (
                      <div
                        key={file.path}
                        className={`editor-tab ${isActive ? 'active' : ''}`}
                        onClick={() => setActiveFile(file.path)}
                        title={file.path}
                      >
                        <span className="truncate">{fileName}</span>
                        {file.isDirty && <span className="text-[#f4a261]">●</span>}
                        <span
                          className="close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeFile(file.path);
                          }}
                        >
                          <X size={13} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <CodeEditorPane />
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
};

export default App;
