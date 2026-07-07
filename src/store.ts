import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type Project = {
  id: string;
  name: string;
  path: string;
};

export type AgentActivity = {
  id: string;
  key?: string;
  type: 'thought' | 'command' | 'tool' | 'result' | 'error';
  title: string;
  detail?: string;
  status?: 'running' | 'done' | 'error';
  ts: string;
  /**
   * Length of the message content when this activity was added — lets the
   * transcript interleave activities with the streamed text in order.
   * Activities updated in place (by key) keep their original offset.
   */
  contentOffset?: number;
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
  changedFiles?: ChangedFileSummary[];
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
};

// A kanban card from the Orion web board linked to this thread. Title and
// description are snapshotted at link time (refreshed just before injection)
// and fed to the agent as context on the first linked turn.
export type LinkedBoardTask = {
  id: string;
  title: string;
  description: string;
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
  codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  codexServiceTier?: 'default' | 'priority';
  claudeReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode' | 'ultrathink';
  claudeContextWindow?: '200k' | '1m';
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
  /** Follow-ups submitted while a run was in flight; dispatched in order when the run ends. */
  queuedMessages?: QueuedMessage[];
  /** `/btw` asides answered by session forks; rendered alongside the transcript, never part of it. */
  btwExchanges?: BtwExchange[];
  /** Kanban card on the Orion web board driving/driven by this thread. */
  linkedTask?: LinkedBoardTask;
};

export type OpenFile = {
  path: string;
  content: string;
  isDirty: boolean;
};

export type ProviderId = 'grok' | 'codex' | 'claude' | 'cursor' | 'opencode';

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
  opencode: { enabled: true },
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

  // Actions
  setActiveTab: (tab: 'agents' | 'code') => void;
  setProviderEnabled: (id: ProviderId, enabled: boolean) => void;
  setProviderOptions: (id: ProviderId, options: Partial<ProviderRuntimeOptions>) => void;
  setThreadAgentSession: (threadId: string, providerId: ProviderId, sessionId: string) => void;

  addProject: (project: Omit<Project, 'id'>) => string; // returns new project id
  removeProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  createThread: (projectId: string, title?: string) => string; // returns new thread id
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
  markFileSaved: (path: string) => void;
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

const orionStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === 'undefined' || !window.orion?.loadStore) {
      return memoryStorage.get(name) ?? null;
    }

    const value = await window.orion.loadStore();
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

      createThread: (projectId, title) => {
        // Inherit model + settings from the most recently used thread in the
        // same project so new threads default to what the user last picked.
        const threadActivityTime = (t: Thread) =>
          new Date(t.messages.at(-1)?.ts ?? t.createdAt).getTime();
        const lastProjectThread = get()
          .threads.filter((t) => t.projectId === projectId)
          .sort((a, b) => threadActivityTime(b) - threadActivityTime(a))[0];

        const newThread: Thread = {
          id: crypto.randomUUID(),
          projectId,
          title: title || `Thread ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          status: 'idle',
          modelId: lastProjectThread?.modelId ?? 'grok:grok-build',
          accessMode: lastProjectThread?.accessMode ?? 'full-access',
          codexReasoningEffort: lastProjectThread?.codexReasoningEffort,
          codexServiceTier: lastProjectThread?.codexServiceTier,
          claudeReasoningEffort: lastProjectThread?.claudeReasoningEffort,
          claudeContextWindow: lastProjectThread?.claudeContextWindow,
          createdAt: new Date().toISOString(),
          messages: [],
        };
        set((state) => ({
          threads: [newThread, ...state.threads],
          selectedProjectId: projectId,
          selectedThreadId: newThread.id,
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
            // New activity puts a thread back in Recent agents even if it was removed.
            t.id === threadId ? { ...t, messages: [...t.messages, msg], hiddenFromRecent: false } : t
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
        const exchange: BtwExchange = {
          id: crypto.randomUUID(),
          question,
          answer: '',
          status: 'running',
          createdAt: new Date().toISOString(),
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
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path ? { ...f, content, isDirty: true } : f
          ),
        })),

      markFileSaved: (path) =>
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path ? { ...f, isDirty: false } : f
          ),
        })),

      closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),
    }),
    {
      name: 'orion-storage',
      storage: createJSONStorage(() => orionStorage),
      version: 1,
      partialize: (state) => ({
        activeTab: state.activeTab,
        projects: state.projects,
        threads: state.threads,
        selectedProjectId: state.selectedProjectId,
        selectedThreadId: state.selectedThreadId,
        workspacePath: state.workspacePath,
        expandedProjects: state.expandedProjects,
        providerSettings: {
          ...defaultProviderSettings,
          ...state.providerSettings,
        },
      }),
    }
  )
);
