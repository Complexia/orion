import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type Project = {
  id: string;
  name: string;
  path: string;
};

export type AgentToolSource = { url: string; title?: string };

export type AgentPlanEntry = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

export type AgentActivity = {
  id: string;
  key?: string;
  type: 'thought' | 'command' | 'tool' | 'result' | 'error' | 'plan';
  /** Provider tool kind (execute/edit/read/search/fetch/task/plan) for iconography. */
  kind?: string;
  title: string;
  detail?: string;
  /** Live tool output (streaming terminal stdout, tool result text). */
  output?: string;
  exitCode?: number;
  /** Line counts for a file edit, rendered as a +N −N chip. */
  diff?: { path: string; additions: number; deletions: number };
  /** Web search / fetch result links. */
  sources?: AgentToolSource[];
  /** Live task checklist (agent plan / todo-list updates). */
  plan?: AgentPlanEntry[];
  /** 'waiting' = blocked on a permission decision. */
  status?: 'running' | 'done' | 'error' | 'waiting';
  ts: string;
  /**
   * Length of the message content when this activity was added — lets the
   * transcript interleave activities with the streamed text in order.
   * Activities updated in place (by key) keep their original offset.
   */
  contentOffset?: number;
};

export type TurnTokenStats = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
};

export type ChangedFileSummary = {
  path: string;
  status: 'added' | 'copied' | 'conflicted' | 'deleted' | 'modified' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
};

export type ImageAttachment = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
};

export type Message = {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: string;
  attachments?: ImageAttachment[];
  kind?: 'text' | 'agent-run';
  status?: 'running' | 'done' | 'error' | 'stopped';
  statusText?: string;
  command?: string;
  activities?: AgentActivity[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /**
   * Set when the turn's error text reads as a logged-out provider CLI: the
   * transcript offers an Authenticate button for this provider instead of a
   * dead-end error.
   */
  authProviderId?: string;
  changedFiles?: ChangedFileSummary[];
  /** Per-turn token usage, when the provider reports it (grok ACP). */
  stats?: TurnTokenStats;
  /** Board-task chip shown on the user message whose turn sent the task to the agent. */
  linkedTask?: Pick<LinkedBoardTask, 'id' | 'title' | 'description'>;
};

export type QueuedMessage = {
  id: string;
  text: string;
  attachments?: ImageAttachment[];
};

/**
 * A `/btw` aside: a quick question answered by a read-only fork of the
 * thread's agent session. It has the thread's full context but never joins
 * the thread — the main session and transcript are untouched.
 */
export type BtwExchange = {
  id: string;
  question: string;
  answer: string;
  status: 'running' | 'done' | 'error';
  createdAt: string;
  completedAt?: string;
  error?: string;
  /** Set when the aside failed because the provider CLI is logged out — renders an Authenticate button. */
  authProviderId?: string;
  /**
   * Id of the transcript message the aside was asked after, so it renders at
   * its chronological spot instead of pinned below the whole transcript.
   * Pre-anchor exchanges (and asides asked on empty threads) fall back to
   * their timestamp when the renderer rebuilds the combined timeline.
   */
  afterMessageId?: string;
  /**
   * Character offset inside a streaming agent-run message at which the aside
   * was asked. Later chunks and tool activity render below the aside even
   * though they belong to the same message.
   */
  contentOffset?: number;
};

/**
 * Codex goal (/goal): a persistent objective the agent pursues autonomously
 * across turns. Owned by codex (~/.codex/goals_1.sqlite, keyed by the
 * thread's codex session id); this is Orion's mirror for the goal chip and
 * /goal status. Updated live from `goal` turn events during goal runs.
 */
export type ThreadGoal = {
  objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  updatedAt?: number;
};

/**
 * A provider-native subagent (claude Agent/Task tool, codex collaboration
 * spawn, cursor Task tool, grok spawn_subagent) rendered as a read-only child
 * thread. Streamed live from the subagent's on-disk transcript by main.
 */
export type NativeSubagentInfo = {
  /** Provider-side id (claude task_id, codex thread id, cursor agentId, grok child session id). */
  id: string;
  providerId: ProviderId;
  /** Subagent type/role label (Explore, general-purpose, codex nickname role, …). */
  kind?: string;
  model?: string;
  prompt?: string;
  /** Final output summary, when the provider reports one. */
  summary?: string;
};

// A kanban card from the Orion web board linked to this thread. Title and
// description plus attachment paths are snapshotted at link time (refreshed
// just before injection) and fed to the agent on the first linked turn.
export type LinkedBoardTaskAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  downloadError?: string;
};

export type LinkedBoardTask = {
  id: string;
  title: string;
  description: string;
  attachments?: LinkedBoardTaskAttachment[];
  /** True once the task context has been injected into an agent turn. */
  injected?: boolean;
  /** Last thread status pushed to the board (running | finished | done | error). */
  lastStatus?: string;
};

export type Thread = {
  id: string;
  projectId: string;
  title: string;
  status: 'idle' | 'running' | 'done' | 'error';
  modelId: string;
  accessMode: 'read-only' | 'workspace-write' | 'full-access';
  codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'ultra';
  codexServiceTier?: 'default' | 'priority';
  claudeReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode' | 'ultrathink';
  claudeContextWindow?: '200k' | '1m';
  grokReasoningEffort?: 'low' | 'medium' | 'high';
  createdAt: string;
  /** Removed from the sidebar Recent agents list (still listed under its project). */
  hiddenFromRecent?: boolean;
  messages: Message[];
  // Per-provider harness session ids so follow-up turns resume the same
  // conversation (claude --resume, codex exec resume, etc.).
  agentSessionIds?: Partial<Record<ProviderId, string>>;
  /**
   * Providers whose session id was inherited by branching and must be forked
   * (never resumed in place) on this thread's next turn, so runs here don't
   * append to the parent thread's CLI-side conversation. Cleared per provider
   * once the fork reports its own session id.
   */
  pendingForkProviders?: ProviderId[];
  /** Thread this one was branched from, if any. */
  branchedFromThreadId?: string;
  /** Driver thread that spawned this one as a subagent, if any. */
  parentThreadId?: string;
  /** Set when this thread is a provider-native subagent's live transcript (read-only). */
  subagent?: NativeSubagentInfo;
  /** Latest start, prompt, or exit observed from an embedded terminal. */
  terminalActivityAt?: string;
  /**
   * Pending spawn_subagent call awaiting this thread's result. Persisted so
   * stop/delete/reload can still resolve the driver's blocked tool call;
   * cleared after the first report.
   */
  spawnId?: string;
  /** Follow-ups submitted while a run was in flight; dispatched in order when the run ends. */
  queuedMessages?: QueuedMessage[];
  /** `/btw` asides answered by session forks; rendered alongside the transcript, never part of it. */
  btwExchanges?: BtwExchange[];
  /** Kanban card on the Orion web board driving/driven by this thread. */
  linkedTask?: LinkedBoardTask;
  /** Codex goal (/goal) this thread is pursuing, if any. Null after /goal clear. */
  goal?: ThreadGoal | null;
};

export type OpenFile = {
  path: string;
  content: string;
  isDirty: boolean;
};

export type ProviderId = 'grok' | 'codex' | 'claude' | 'cursor' | 'kimi' | 'opencode';

// Per-provider harness capabilities, passed through to the CLI invocation.
export type ProviderRuntimeOptions = {
  /** claude: extra tools auto-approved outside Full Access (--allowedTools) */
  allowedTools?: string;
  /** codex: allow network inside the workspace-write sandbox */
  networkAccess?: boolean;
  /** codex: enable the web search tool */
  webSearch?: boolean;
  /** grok: enable cross-session memory (--experimental-memory) */
  experimentalMemory?: boolean;
  /** claude: browser control via the Claude Chrome extension (--chrome) */
  chrome?: boolean;
  /** codex: browser control via chrome-devtools-mcp (the ChatGPT-extension backend is desktop-app-only) */
  browserControl?: boolean;
  /** codex: attach browser control to the user's real signed-in Chrome (--autoConnect) instead of a dedicated profile */
  browserAutoConnect?: boolean;
  /** any provider: extra CLI flags appended to every run */
  extraArgs?: string;
};

export type ProviderSettings = Record<
  ProviderId,
  { enabled: boolean; options?: ProviderRuntimeOptions }
>;

export const defaultProviderSettings: ProviderSettings = {
  grok: { enabled: true },
  codex: { enabled: true },
  claude: { enabled: true },
  cursor: { enabled: true },
  kimi: { enabled: true },
  opencode: { enabled: true },
};

// Roles the Orion orchestrator pseudo-model delegates to. Each maps to an
// AgentModel id picked in Settings → Orchestration.
export type OrchestrationRoleId =
  | 'mainDriver'
  | 'computerUse'
  | 'exploring'
  | 'implementation'
  | 'imageVideoGen';

export type OrchestrationSettings = {
  /** AgentModel id per role, e.g. 'claude:claude-fable-5'. */
  models: Record<OrchestrationRoleId, string>;
  /** Extra instructions given to every orchestrated run. */
  generalInstructions: string;
};

export const defaultOrchestrationSettings: OrchestrationSettings = {
  models: {
    mainDriver: 'claude:claude-fable-5',
    computerUse: 'codex:gpt-5.6-sol',
    exploring: 'claude:claude-haiku-4-5',
    implementation: 'codex:gpt-5.6-sol',
    imageVideoGen: 'grok:grok-4.5',
  },
  generalInstructions: '',
};

export type NotificationSettings = {
  /** Notify when a thread finishes while the user isn't looking at it. */
  enabled: boolean;
  /** Play the system notification sound. */
  sound: boolean;
};

export const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  sound: true,
};

interface OrionState {
  // Tabs
  activeTab: 'agents' | 'code';

  // Projects & Threads
  projects: Project[];
  threads: Thread[];
  selectedProjectId: string | null;
  selectedThreadId: string | null;

  // Code tab workspace
  workspacePath: string | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;

  // UI
  expandedProjects: string[];
  providerSettings: ProviderSettings;
  orchestrationSettings: OrchestrationSettings;
  notificationSettings: NotificationSettings;

  // Actions
  setActiveTab: (tab: 'agents' | 'code') => void;
  setProviderEnabled: (id: ProviderId, enabled: boolean) => void;
  setProviderOptions: (id: ProviderId, options: Partial<ProviderRuntimeOptions>) => void;
  setOrchestrationRoleModel: (role: OrchestrationRoleId, modelId: string) => void;
  setOrchestrationGeneralInstructions: (text: string) => void;
  setNotificationSettings: (updates: Partial<NotificationSettings>) => void;
  setThreadAgentSession: (threadId: string, providerId: ProviderId, sessionId: string) => void;

  addProject: (project: Omit<Project, 'id'>) => string; // returns new project id
  removeProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  createThread: (
    projectId: string,
    title?: string,
    options?: {
      parentThreadId?: string;
      modelId?: string;
      hiddenFromRecent?: boolean;
      spawnId?: string;
      accessMode?: Thread['accessMode'];
      subagent?: NativeSubagentInfo;
      /** false = don't switch the UI to the new thread (background spawns). */
      select?: boolean;
    }
  ) => string; // returns new thread id
  branchThread: (sourceThreadId: string) => string | null; // returns new thread id
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  updateThread: (id: string, updates: Partial<Thread>) => void;
  deleteThread: (id: string) => void;
  addMessageToThread: (threadId: string, message: Omit<Message, 'id' | 'ts'>) => string;
  appendToThreadMessage: (threadId: string, messageId: string, chunk: string) => void;
  updateThreadMessage: (
    threadId: string,
    messageId: string,
    updates: Partial<Omit<Message, 'id'>>
  ) => void;
  addActivityToThreadMessage: (
    threadId: string,
    messageId: string,
    activity: Omit<AgentActivity, 'id' | 'ts'>
  ) => void;
  queueMessageToThread: (threadId: string, message: Omit<QueuedMessage, 'id'>) => string;
  removeQueuedThreadMessage: (threadId: string, messageId: string) => void;
  addBtwExchange: (threadId: string, question: string) => string;
  appendToBtwExchange: (threadId: string, exchangeId: string, chunk: string) => void;
  updateBtwExchange: (
    threadId: string,
    exchangeId: string,
    updates: Partial<Omit<BtwExchange, 'id'>>
  ) => void;
  removeBtwExchange: (threadId: string, exchangeId: string) => void;

  toggleProjectExpanded: (id: string) => void;

  setWorkspacePath: (path: string | null) => void;

  openFile: (path: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateOpenFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string, content?: string) => void;
  closeAllFiles: () => void;
}

const memoryStorage = new Map<string, string>();

// Streaming agent runs update the store many times per second, and zustand's
// persist middleware serializes the whole store on every update. Debounce the
// IPC/file write so tokens don't each trigger a full-store disk write; the
// in-memory copy is always current.
const STORE_SAVE_DEBOUNCE_MS = 400;
let pendingStoreValue: string | null = null;
let storeSaveTimer: ReturnType<typeof setTimeout> | null = null;

const flushStoreSave = () => {
  if (storeSaveTimer !== null) {
    clearTimeout(storeSaveTimer);
    storeSaveTimer = null;
  }
  if (pendingStoreValue === null) return;
  const value = pendingStoreValue;
  pendingStoreValue = null;
  if (typeof window === 'undefined' || !window.orion?.saveStore) return;
  void window.orion.saveStore(value).then((saved) => {
    if (!saved) console.warn('Failed to persist orion-storage');
  });
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushStoreSave);
}

// Threads (full transcripts) are excluded from the persisted store above and
// live in their own file on a slower save cadence — see the saver below the
// store definition. State shared with it:
let threadsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistedThreads: Thread[] | null = null;
// The threads reference at clearStorage time: zustand clears storage without
// clearing in-memory state, so the savers must not write this exact snapshot
// back to disk. A later thread change (fresh reference) resumes persistence.
let clearedThreadsSnapshot: Thread[] | null = null;
// Set when the threads file exists but could not be read or parsed: the
// hydrated state then lacks the real transcripts, and any flush would
// overwrite the (possibly recoverable) file with that lesser snapshot. All
// thread persistence stays suppressed until an explicit clearStorage.
let threadsPersistenceBlocked = false;

const cancelQueuedThreadsSave = () => {
  if (threadsSaveTimer !== null) {
    clearTimeout(threadsSaveTimer);
    threadsSaveTimer = null;
  }
};

// Graft the separately-persisted threads back into the persisted state so the
// persist middleware — including its crash-recovery merge — sees one combined
// snapshot. With no threads file yet (pre-split builds), the store value's own
// embedded threads are used as-is; the first threads save migrates them out.
const withThreadsGrafted = async (value: string | null): Promise<string | null> => {
  const result = await window.orion.loadThreads?.();
  if (result && !result.ok) {
    // The file exists but couldn't be read/parsed — hydrating without it is
    // survivable, but persisting over it is not.
    threadsPersistenceBlocked = true;
    return value;
  }
  const threadsValue = result?.value;
  if (!threadsValue) return value;
  try {
    const threads = JSON.parse(threadsValue)?.threads;
    if (!Array.isArray(threads)) {
      threadsPersistenceBlocked = true;
      return value;
    }
    // A lost/corrupt store file must not take the transcripts with it.
    let parsed: { state: Record<string, unknown>; version?: number };
    try {
      const candidate = value === null ? null : JSON.parse(value);
      parsed =
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        candidate.state &&
        typeof candidate.state === 'object' &&
        !Array.isArray(candidate.state)
          ? candidate
          : { state: {}, version: 1 };
    } catch {
      // The settings envelope is expendable; the separately persisted
      // transcripts are not. Rebuild a minimal envelope rather than returning
      // the malformed value and letting hydration flush an empty thread list
      // over the valid threads file.
      parsed = { state: {}, version: 1 };
    }
    parsed.state = { ...parsed.state, threads };
    return JSON.stringify(parsed);
  } catch {
    threadsPersistenceBlocked = true;
    return value;
  }
};

const orionStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === 'undefined' || !window.orion?.loadStore) {
      return memoryStorage.get(name) ?? null;
    }

    const value = await withThreadsGrafted(await window.orion.loadStore());
    if (value !== null) {
      memoryStorage.set(name, value);
      return value;
    }

    const legacyValue = window.localStorage.getItem(name);
    if (legacyValue !== null) {
      memoryStorage.set(name, legacyValue);
      await window.orion.saveStore(legacyValue);
      return legacyValue;
    }

    return null;
  },
  setItem: async (name, value) => {
    memoryStorage.set(name, value);

    if (typeof window === 'undefined' || !window.orion?.saveStore) {
      return;
    }

    pendingStoreValue = value;
    if (storeSaveTimer === null) {
      storeSaveTimer = setTimeout(() => {
        storeSaveTimer = null;
        flushStoreSave();
      }, STORE_SAVE_DEBOUNCE_MS);
    }
  },
  removeItem: async (name) => {
    memoryStorage.delete(name);
    pendingStoreValue = null;
    if (storeSaveTimer !== null) {
      clearTimeout(storeSaveTimer);
      storeSaveTimer = null;
    }
    // A queued or future threads write after the clear would resurrect the
    // cleared transcripts (zustand leaves them in memory): drop the queued
    // timer and mark the current snapshot as not-to-be-rewritten, which the
    // throttled saver (via lastPersistedThreads) and the unload flush (via
    // clearedThreadsSnapshot) both honor.
    cancelQueuedThreadsSave();
    clearedThreadsSnapshot = useOrionStore.getState().threads;
    lastPersistedThreads = clearedThreadsSnapshot;
    // An explicit clear discards whatever unreadable file blocked
    // persistence — new activity may persist fresh snapshots again.
    threadsPersistenceBlocked = false;

    if (typeof window === 'undefined' || !window.orion?.clearStore) {
      return;
    }

    const cleared = await window.orion.clearStore();
    if (!cleared) {
      console.warn(`Failed to clear ${name}`);
    }
  },
};

export const useOrionStore = create<OrionState>()(
  persist(
    (set, get) => ({
      activeTab: 'agents',
      projects: [],
      threads: [],
      selectedProjectId: null,
      selectedThreadId: null,
      workspacePath: null,
      openFiles: [],
      activeFilePath: null,
      expandedProjects: [],
      providerSettings: defaultProviderSettings,
      orchestrationSettings: defaultOrchestrationSettings,
      notificationSettings: defaultNotificationSettings,

      setActiveTab: (tab) => set({ activeTab: tab }),
      setProviderEnabled: (id, enabled) =>
        set((state) => ({
          providerSettings: {
            ...defaultProviderSettings,
            ...state.providerSettings,
            [id]: { ...state.providerSettings[id], enabled },
          },
        })),
      setProviderOptions: (id, options) =>
        set((state) => {
          const current = state.providerSettings[id] ?? defaultProviderSettings[id];
          return {
            providerSettings: {
              ...defaultProviderSettings,
              ...state.providerSettings,
              [id]: {
                ...current,
                options: { ...current.options, ...options },
              },
            },
          };
        }),
      setOrchestrationRoleModel: (role, modelId) =>
        set((state) => ({
          orchestrationSettings: {
            ...defaultOrchestrationSettings,
            ...state.orchestrationSettings,
            models: {
              ...defaultOrchestrationSettings.models,
              ...state.orchestrationSettings?.models,
              [role]: modelId,
            },
          },
        })),
      setOrchestrationGeneralInstructions: (text) =>
        set((state) => ({
          orchestrationSettings: {
            ...defaultOrchestrationSettings,
            ...state.orchestrationSettings,
            models: {
              ...defaultOrchestrationSettings.models,
              ...state.orchestrationSettings?.models,
            },
            generalInstructions: text,
          },
        })),
      setNotificationSettings: (updates) =>
        set((state) => ({
          notificationSettings: {
            ...defaultNotificationSettings,
            ...state.notificationSettings,
            ...updates,
          },
        })),
      setThreadAgentSession: (threadId, providerId, sessionId) =>
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  agentSessionIds: { ...thread.agentSessionIds, [providerId]: sessionId },
                  // A branched thread's first turn forks the inherited session
                  // and reports the fork's id; from here on resume in place.
                  pendingForkProviders: thread.pendingForkProviders?.filter(
                    (p) => p !== providerId
                  ),
                }
              : thread
          ),
        })),

      addProject: (project) => {
        const newProject: Project = {
          ...project,
          id: crypto.randomUUID(),
        };
        // Newest project first — adding a project means the user wants to
        // work in it now, so it should lead the sidebar.
        set((state) => ({
          projects: [newProject, ...state.projects],
          expandedProjects: [...state.expandedProjects, newProject.id],
          selectedProjectId: newProject.id,
        }));
        // Auto-set as workspace if none
        if (!get().workspacePath) {
          set({ workspacePath: newProject.path });
        }
        return newProject.id;
      },

      removeProject: (id) => {
        set((state) => {
          const removedProject = state.projects.find((p) => p.id === id);
          const remainingProjects = state.projects.filter((p) => p.id !== id);
          const fallbackProject = remainingProjects[0] ?? null;
          const wasWorkspaceProject = removedProject?.path === state.workspacePath;

          return {
            projects: remainingProjects,
            threads: state.threads.filter((t) => t.projectId !== id),
            selectedProjectId:
              state.selectedProjectId === id ? fallbackProject?.id ?? null : state.selectedProjectId,
            selectedThreadId:
              state.threads.find((t) => t.id === state.selectedThreadId)?.projectId === id
                ? null
                : state.selectedThreadId,
            expandedProjects: state.expandedProjects.filter((pid) => pid !== id),
            workspacePath: wasWorkspaceProject ? fallbackProject?.path ?? null : state.workspacePath,
            openFiles: wasWorkspaceProject ? [] : state.openFiles,
            activeFilePath: wasWorkspaceProject ? null : state.activeFilePath,
          };
        });
      },

      renameProject: (id, name) =>
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p)),
        })),

      createThread: (projectId, title, options) => {
        // Inherit model + settings from the most recently used thread in the
        // same project so new top-level threads default to what the user last
        // picked. Hidden/background subagents must not become that default;
        // child threads inherit from their explicit parent instead.
        const threadActivityTime = (t: Thread) =>
          new Date(t.messages.at(-1)?.ts ?? t.createdAt).getTime();
        const projectThreads = get().threads.filter((t) => t.projectId === projectId);
        const parentThread = options?.parentThreadId
          ? projectThreads.find((t) => t.id === options.parentThreadId)
          : undefined;
        const lastProjectThread =
          parentThread ??
          projectThreads
            .filter((t) => !t.parentThreadId && !t.subagent)
            .sort((a, b) => threadActivityTime(b) - threadActivityTime(a))[0];

        // Claude Code CLI is a terminal-hosted pseudo-model; it must be picked
        // deliberately per thread, so new threads fall back to Claude Fable 5
        // instead of inheriting it.
        const inheritedModelId =
          lastProjectThread?.modelId === 'claude:claude-code-cli'
            ? 'claude:claude-fable-5'
            : lastProjectThread?.modelId;

        const newThread: Thread = {
          id: crypto.randomUUID(),
          projectId,
          title: title || `Thread ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          status: 'idle',
          modelId: options?.modelId ?? inheritedModelId ?? 'grok:grok-4.5',
          accessMode: options?.accessMode ?? lastProjectThread?.accessMode ?? 'full-access',
          codexReasoningEffort: lastProjectThread?.codexReasoningEffort,
          codexServiceTier: lastProjectThread?.codexServiceTier,
          claudeReasoningEffort: lastProjectThread?.claudeReasoningEffort,
          claudeContextWindow: lastProjectThread?.claudeContextWindow,
          createdAt: new Date().toISOString(),
          parentThreadId: options?.parentThreadId,
          spawnId: options?.spawnId,
          hiddenFromRecent: options?.hiddenFromRecent,
          subagent: options?.subagent,
          messages: [],
        };
        set((state) => ({
          threads: [newThread, ...state.threads],
          ...(options?.select === false
            ? {}
            : { selectedProjectId: projectId, selectedThreadId: newThread.id }),
        }));
        return newThread.id;
      },

      branchThread: (sourceThreadId) => {
        const source = get().threads.find((t) => t.id === sourceThreadId);
        if (!source) return null;

        const sessionIds = { ...source.agentSessionIds };
        const inheritedProviders = Object.keys(sessionIds) as ProviderId[];
        const newThread: Thread = {
          id: crypto.randomUUID(),
          projectId: source.projectId,
          title: `${source.title} (branch)`,
          status: 'idle',
          modelId: source.modelId,
          accessMode: source.accessMode,
          codexReasoningEffort: source.codexReasoningEffort,
          codexServiceTier: source.codexServiceTier,
          claudeReasoningEffort: source.claudeReasoningEffort,
          claudeContextWindow: source.claudeContextWindow,
          createdAt: new Date().toISOString(),
          // Copy the transcript for display; the agent's context comes from
          // forking the CLI-side session (pendingForkProviders), not from
          // replaying these messages.
          messages: source.messages.map((message) => ({
            ...message,
            status: message.status === 'running' ? 'stopped' : message.status,
            attachments: message.attachments?.map((a) => ({ ...a })),
            activities: message.activities?.map((a) => ({ ...a })),
            changedFiles: message.changedFiles?.map((f) => ({ ...f })),
          })),
          agentSessionIds: inheritedProviders.length ? sessionIds : undefined,
          pendingForkProviders: inheritedProviders.length ? inheritedProviders : undefined,
          branchedFromThreadId: source.id,
        };
        set((state) => ({
          threads: [newThread, ...state.threads],
          selectedProjectId: source.projectId,
          selectedThreadId: newThread.id,
        }));
        return newThread.id;
      },

      selectProject: (id) =>
        set((state) => {
          const selectedThread = state.threads.find((t) => t.id === state.selectedThreadId);

          return {
            selectedProjectId: id,
            selectedThreadId:
              selectedThread && selectedThread.projectId !== id ? null : state.selectedThreadId,
          };
        }),

      selectThread: (id) =>
        set((state) => {
          const thread = state.threads.find((t) => t.id === id);

          return {
            selectedThreadId: id,
            selectedProjectId: thread?.projectId ?? state.selectedProjectId,
          };
        }),

      updateThread: (id, updates) =>
        set((state) => ({
          threads: state.threads.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      deleteThread: (id) =>
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== id),
          selectedThreadId: state.selectedThreadId === id ? null : state.selectedThreadId,
        })),

      addMessageToThread: (threadId, message) => {
        const msg: Message = {
          ...message,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
        };
        set((state) => ({
          threads: state.threads.map((t) =>
            // New activity puts a thread back in Recent agents even if it was
            // removed — except subagent children, which render nested under
            // their parent and never as top-level Recent rows.
            t.id === threadId
              ? {
                  ...t,
                  messages: [...t.messages, msg],
                  hiddenFromRecent: t.parentThreadId ? t.hiddenFromRecent : false,
                }
              : t
          ),
        }));
        return msg.id;
      },

      appendToThreadMessage: (threadId, messageId, chunk) => {
        if (!chunk) return;
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: thread.messages.map((message) =>
                    message.id === messageId
                      ? { ...message, content: `${message.content}${chunk}` }
                      : message
                  ),
                }
              : thread
          ),
        }));
      },

      updateThreadMessage: (threadId, messageId, updates) =>
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: thread.messages.map((message) =>
                    message.id === messageId ? { ...message, ...updates } : message
                  ),
                }
              : thread
          ),
        })),

      addActivityToThreadMessage: (threadId, messageId, activity) =>
        set((state) => {
          const nextActivity: AgentActivity = {
            ...activity,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
          };

          return {
            threads: state.threads.map((thread) =>
              thread.id === threadId
                ? {
                    ...thread,
                    messages: thread.messages.map((message) => {
                      if (message.id !== messageId) return message;

                      const existingActivities = message.activities ?? [];
                      const existingIndex = activity.key
                        ? existingActivities.findIndex((existing) => existing.key === activity.key)
                        : -1;

                      if (existingIndex >= 0) {
                        return {
                          ...message,
                          activities: existingActivities.map((existing, index) =>
                            index === existingIndex
                              ? {
                                  ...existing,
                                  ...activity,
                                  ts: nextActivity.ts,
                                  contentOffset: existing.contentOffset,
                                }
                              : existing
                          ),
                        };
                      }

                      return {
                        ...message,
                        activities: [
                          ...existingActivities,
                          { ...nextActivity, contentOffset: message.content.length },
                        ],
                      };
                    }),
                  }
                : thread
            ),
          };
        }),

      queueMessageToThread: (threadId, message) => {
        const id = crypto.randomUUID();
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, queuedMessages: [...(t.queuedMessages ?? []), { ...message, id }] }
              : t
          ),
        }));
        return id;
      },

      removeQueuedThreadMessage: (threadId, messageId) =>
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  queuedMessages: (t.queuedMessages ?? []).filter((m) => m.id !== messageId),
                }
              : t
          ),
        })),

      addBtwExchange: (threadId, question) => {
        const thread = get().threads.find((t) => t.id === threadId);
        const anchorMessage = thread?.messages.at(-1);
        const afterMessageId = anchorMessage?.id;
        const exchange: BtwExchange = {
          id: crypto.randomUUID(),
          question,
          answer: '',
          status: 'running',
          createdAt: new Date().toISOString(),
          ...(afterMessageId ? { afterMessageId } : {}),
          ...(anchorMessage?.kind === 'agent-run'
            ? { contentOffset: anchorMessage.content.length }
            : {}),
        };
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, btwExchanges: [...(t.btwExchanges ?? []), exchange] }
              : t
          ),
        }));
        return exchange.id;
      },

      appendToBtwExchange: (threadId, exchangeId, chunk) => {
        if (!chunk) return;
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  btwExchanges: (t.btwExchanges ?? []).map((exchange) =>
                    exchange.id === exchangeId
                      ? { ...exchange, answer: `${exchange.answer}${chunk}` }
                      : exchange
                  ),
                }
              : t
          ),
        }));
      },

      updateBtwExchange: (threadId, exchangeId, updates) =>
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  btwExchanges: (t.btwExchanges ?? []).map((exchange) =>
                    exchange.id === exchangeId ? { ...exchange, ...updates } : exchange
                  ),
                }
              : t
          ),
        })),

      removeBtwExchange: (threadId, exchangeId) =>
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  btwExchanges: (t.btwExchanges ?? []).filter((e) => e.id !== exchangeId),
                }
              : t
          ),
        })),

      toggleProjectExpanded: (id) =>
        set((state) => ({
          expandedProjects: state.expandedProjects.includes(id)
            ? state.expandedProjects.filter((p) => p !== id)
            : [...state.expandedProjects, id],
        })),

      setWorkspacePath: (path) => set({ workspacePath: path }),

      openFile: (path, content) => {
        const existing = get().openFiles.find((f) => f.path === path);
        if (existing) {
          set({ activeFilePath: path });
          return;
        }
        set((state) => ({
          openFiles: [...state.openFiles, { path, content, isDirty: false }],
          activeFilePath: path,
        }));
      },

      closeFile: (path) => {
        set((state) => {
          const newFiles = state.openFiles.filter((f) => f.path !== path);
          let newActive = state.activeFilePath;
          if (state.activeFilePath === path) {
            newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null;
          }
          return { openFiles: newFiles, activeFilePath: newActive };
        });
      },

      setActiveFile: (path) => set({ activeFilePath: path }),

      updateOpenFileContent: (path, content) =>
        set((state) => {
          const file = state.openFiles.find((candidate) => candidate.path === path);
          if (!file || (file.isDirty && file.content === content)) return state;
          return {
            openFiles: state.openFiles.map((candidate) =>
              candidate.path === path
                ? { ...candidate, content, isDirty: true }
                : candidate
            ),
          };
        }),

      markFileSaved: (path, content) =>
        set((state) => {
          const file = state.openFiles.find((candidate) => candidate.path === path);
          if (!file) return state;
          const nextContent = content ?? file.content;
          if (!file.isDirty && file.content === nextContent) return state;
          return {
            openFiles: state.openFiles.map((candidate) =>
              candidate.path === path
                ? { ...candidate, content: nextContent, isDirty: false }
                : candidate
            ),
          };
        }),

      closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),
    }),
    {
      name: 'orion-storage',
      storage: createJSONStorage(() => orionStorage),
      version: 1,
      // `threads` is deliberately absent: the persist middleware stringifies
      // this partialized state on EVERY store update, and threads hold every
      // transcript (multi-MB after a while) — including them made each
      // streaming chunk an O(entire-history) serialize. They are persisted by
      // the throttled saver below instead, and grafted back in on hydration.
      partialize: (state) => ({
        activeTab: state.activeTab,
        projects: state.projects,
        selectedProjectId: state.selectedProjectId,
        selectedThreadId: state.selectedThreadId,
        workspacePath: state.workspacePath,
        expandedProjects: state.expandedProjects,
        providerSettings: {
          ...defaultProviderSettings,
          ...state.providerSettings,
        },
        orchestrationSettings: {
          ...defaultOrchestrationSettings,
          ...state.orchestrationSettings,
          models: {
            ...defaultOrchestrationSettings.models,
            ...state.orchestrationSettings?.models,
          },
        },
        notificationSettings: {
          ...defaultNotificationSettings,
          ...state.notificationSettings,
        },
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<OrionState>) };
        // Agent runs can't survive an app restart — the CLI processes die with
        // the app — so any thread or message rehydrated as 'running' is a
        // leftover from the previous session. Left alone it pins the run
        // status bar forever, because the run-event handler only flips
        // messages tracked by runs started in this session.
        const restartedAt = new Date().toISOString();
        // A Claude turn can finish while its background agents keep working:
        // the message persists as 'done' captioned "Waiting on N background
        // agents…" (the done handler in App.tsx) with the thread 'running'.
        // Those agents died with the app, so the wait can never settle —
        // rewrite the caption alongside the status flip. Only while the
        // thread is still 'running', though: every resolution path (a
        // background-settled event or the synthetic follow-up turn finishing)
        // flips the thread off 'running' but leaves the old caption behind as
        // history, and history must not be rebranded as a restart casualty.
        const waitingOnBackground = /^Waiting on \d+ background agents?…$/;
        merged.threads = merged.threads.map((thread) => {
          const waitUnresolved = thread.status === 'running';
          const stale =
            waitUnresolved || thread.messages.some((message) => message.status === 'running');
          if (!stale) return thread;
          // Only a currently live wait may be rebranded. Every resolution
          // path (a background-settled event or a synthetic follow-up turn)
          // appends a newer agent-run message after the waiting one, while a
          // resolved wait can keep its historical "Waiting on …" caption. So
          // the wait is live only when the thread's newest agent-run message
          // is the one carrying the caption; a captioned message behind a
          // newer turn — including the running foreground or synthetic turn
          // that made this thread 'running' — is history from a wait that
          // already resolved and must not be relabeled as a restart casualty.
          const lastAgentRun = waitUnresolved
            ? [...thread.messages].reverse().find((message) => message.kind === 'agent-run')
            : undefined;
          const liveWaitId =
            lastAgentRun &&
            lastAgentRun.status !== 'running' &&
            lastAgentRun.statusText != null &&
            waitingOnBackground.test(lastAgentRun.statusText)
              ? lastAgentRun.id
              : undefined;
          return {
            ...thread,
            status: waitUnresolved ? 'idle' : thread.status,
            messages: thread.messages.map((message) => {
              if (message.status === 'running') {
                return {
                  ...message,
                  status: 'stopped' as const,
                  completedAt: message.completedAt ?? restartedAt,
                  statusText: 'Interrupted by app restart.',
                };
              }
              if (message.id === liveWaitId) {
                return {
                  ...message,
                  statusText: 'Background agents interrupted by app restart.',
                };
              }
              return message;
            }),
          };
        });
        return merged;
      },
    }
  )
);

// The threads saver: serializes transcripts to their own file at most once
// per THREADS_SAVE_MS (a streaming run mutates threads many times a second),
// with a flush on unload. Reference equality is enough to detect changes —
// every store update replaces the threads array.
const THREADS_SAVE_MS = 5000;

const scheduleThreadsSave = () => {
  if (threadsSaveTimer !== null) return;
  threadsSaveTimer = setTimeout(() => {
    threadsSaveTimer = null;
    flushThreadsSave();
  }, THREADS_SAVE_MS);
};

const flushThreadsSave = () => {
  cancelQueuedThreadsSave();
  if (typeof window === 'undefined' || !window.orion?.saveThreads) return;
  if (threadsPersistenceBlocked) return;
  // Before hydration the store still holds the initial threads: [] — saving
  // now would replace the on-disk transcripts with an empty snapshot, which
  // outranks the legacy embedded threads on the next launch. (Safe on the
  // post-hydration flush: zustand flips hasHydrated before its
  // finish-hydration listeners run.)
  if (!useOrionStore.persist.hasHydrated()) return;
  const threads = useOrionStore.getState().threads;
  if (threads === lastPersistedThreads) return;
  // Claim the marker optimistically so overlapping flushes don't double-save,
  // but surrender it if the write fails: a snapshot only counts as persisted
  // on a successful acknowledgement, otherwise nothing would ever retry and
  // the unload flush would skip it by reference equality — during the split
  // migration that could orphan the only copy of the transcripts.
  lastPersistedThreads = threads;
  const failed = () => {
    console.warn('Failed to persist orion-threads; retrying');
    // A newer snapshot may have claimed the marker meanwhile — its own
    // save owns the retry then.
    if (lastPersistedThreads === threads) {
      lastPersistedThreads = null;
      scheduleThreadsSave();
    }
  };
  void window.orion
    .saveThreads(JSON.stringify({ version: 1, threads }))
    .then((saved) => {
      if (!saved) failed();
    })
    .catch(failed);
};

useOrionStore.subscribe((state) => {
  if (state.threads === lastPersistedThreads) return;
  scheduleThreadsSave();
});

// Materialize the threads file as soon as hydration lands rather than a
// throttle-window later: the store file stops embedding threads on its first
// post-hydration save, so until this flush runs the transcripts exist only in
// memory and a crash would lose them.
useOrionStore.persist.onFinishHydration(() => flushThreadsSave());
if (useOrionStore.persist.hasHydrated()) flushThreadsSave();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cancelQueuedThreadsSave();
    // Closing the window mid-hydration must preserve the on-disk snapshot —
    // the store still holds the initial threads: [] and flushing it would
    // erase the transcript history. Same when the threads file existed but
    // failed to load: never overwrite it with the lesser hydrated state.
    if (threadsPersistenceBlocked || !useOrionStore.persist.hasHydrated()) return;
    // An async IPC save started here races app teardown — Electron can exit
    // before the promise settles, dropping up to a throttle-window of
    // transcript. Block the unload on a synchronous write instead.
    // Unconditional (no lastPersistedThreads check): an optimistically
    // claimed in-flight async save may never commit once the process exits.
    if (window.orion?.saveThreadsSync) {
      const threads = useOrionStore.getState().threads;
      // Cleared storage must stay cleared — don't write the lingering
      // in-memory snapshot back.
      if (threads === clearedThreadsSnapshot) return;
      window.orion.saveThreadsSync(JSON.stringify({ version: 1, threads }));
      lastPersistedThreads = threads;
    } else {
      flushThreadsSave();
    }
  });
}
