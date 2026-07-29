import React from 'react';
import {
  Archive,
  ChevronRight,
  Ellipsis,
  EyeOff,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Pin,
  PinOff,
  Plus,
  Search,
  SquareKanban,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { Epic, Project, Thread } from '../store';
import { ProjectIcon } from './ProjectIcon';
import { InlineRenameInput } from './fileTree';
import { ThreadSearchResults } from './threadSearch';
import { formatShortTime, getThreadActivityTime } from './time';
import { SidebarFooter, type SidebarFooterProps } from './SidebarFooter';
import type { EpicPrStatus } from './appTypes';

const THREADS_VISIBLE_LIMIT = 5;

export type AgentsSidebarModel = {
  projects: Project[];
  selectThread: (id: string | null) => void;
  setActiveTab: (tab: 'agents' | 'code') => void;
  selectedThreadId: string | null;
  updateThread: (id: string, updates: Partial<Thread>) => void;
  branchThread: (sourceThreadId: string) => string | null;
  selectedEpicId: string | null;
  renameEpic: (id: string, name: string) => void;
  selectEpic: (id: string | null) => void;
  renameProject: (id: string, name: string) => void;
  selectProject: (id: string | null) => void;
  threadSearchOpen: boolean;
  setThreadSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  threadSearchQuery: string;
  setThreadSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  projectMenuOpenId: string | null;
  setProjectMenuOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  threadItemMenuKey: string | null;
  setThreadItemMenuKey: React.Dispatch<React.SetStateAction<string | null>>;
  threadRenameKey: string | null;
  setThreadRenameKey: React.Dispatch<React.SetStateAction<string | null>>;
  projectRenameId: string | null;
  setProjectRenameId: React.Dispatch<React.SetStateAction<string | null>>;
  threadListLimits: Record<string, number>;
  setThreadListLimits: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  collapsedProjects: Record<string, boolean>;
  setCollapsedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setRecentAgentsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  recentAgentsOpen: boolean;
  setRecentAgentsShowAll: React.Dispatch<React.SetStateAction<boolean>>;
  recentAgentsShowAll: boolean;
  setPinnedAgentsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedAgentsOpen: boolean;
  setPinnedAgentsShowAll: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedAgentsShowAll: boolean;
  setEpicsSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  epicsSectionOpen: boolean;
  collapsedEpics: Record<string, boolean>;
  setCollapsedEpics: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  epicMenuOpenId: string | null;
  setEpicMenuOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  epicRenameId: string | null;
  setEpicRenameId: React.Dispatch<React.SetStateAction<string | null>>;
  threadSearchRef: React.RefObject<HTMLDivElement | null>;
  projectMenuRef: React.RefObject<HTMLDivElement | null>;
  threadItemMenuRef: React.RefObject<HTMLDivElement | null>;
  epicMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedProject: Project | null;
  sortedProjects: Project[];
  recentAgentsTargetProject: Project;
  pinnedThreads: Thread[];
  recentThreads: Thread[];
  pinThread: (threadId: string) => void;
  unpinThread: (threadId: string) => void;
  runningAgentCount: number;
  projectThreadsByProject: Map<string, Thread[]>;
  epicsEnabled: boolean;
  activeEpics: Epic[];
  threadsByEpic: Map<string, Thread[]>;
  runningAgentEpicIds: Set<string>;
  projectForGitRoot: (gitRoot: string | undefined, preferredProjectId?: string) => Project | null;
  deleteThreadWithRuntime: (threadId: string) => Promise<void>;
  removeProjectWithRuntimes: (projectId: string) => Promise<void>;
  handleAddProject: (options?: {
    createInitialThread?: boolean;
    expectedGitRoot?: string;
  }) => Promise<string | undefined>;
  handleNewAgent: () => void;
  handleCreateThread: (projectId: string) => string;
  openCreateEpicModal: () => void;
  handleCreateThreadForEpic: (epic: Epic) => Promise<string | undefined>;
  handleRemoveThreadFromEpic: (threadId: string) => Promise<void>;
  handleDeleteEpic: (epic: Epic) => Promise<void>;
  handleSettleEpic: (epic: Epic) => Promise<void>;
  renderThreadCliBadge: (thread: Thread) => React.JSX.Element | null;
  renderThreadStatusDot: (thread: Thread) => React.JSX.Element | null;
  sidebarFooterProps: SidebarFooterProps;
  epicPrStatus: (epic: Pick<Epic, 'prUrl' | 'prState'> | null | undefined) => EpicPrStatus | null;
};

const ThreadItemSelect = ({
  isRenaming,
  onActivate,
  children,
}: {
  isRenaming: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) => {
  const className = `thread-item-select ${isRenaming ? 'renaming' : ''}`;
  if (isRenaming) return <div className={className}>{children}</div>;
  return (
    <button type="button" className={className} onClick={onActivate}>
      {children}
    </button>
  );
};

export const AgentsSidebar = React.memo(function AgentsSidebar(props: AgentsSidebarModel) {
  const {
    projects,
    selectThread,
    setActiveTab,
    selectedThreadId,
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
    handleNewAgent,
    handleCreateThread,
    openCreateEpicModal,
    handleCreateThreadForEpic,
    handleRemoveThreadFromEpic,
    handleDeleteEpic,
    handleSettleEpic,
    renderThreadCliBadge,
    renderThreadStatusDot,
    sidebarFooterProps,
    epicPrStatus,
  } = props;

  return (
    <div className="sidebar agents-sidebar">
      <div className="sidebar-content agents-sidebar-content">
        {projects.length === 0 && (
          <div className="empty-state p-8 text-center">
            <div className="empty-state-icon">
              <FolderOpen size={28} />
            </div>
            <div className="empty-state-title">No projects yet</div>
            <div className="text-xs text-[#6b6b74]">Add a folder to start agent threads</div>
            <button onClick={() => void handleAddProject()} className="btn mt-3">
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
              <ChevronRight size={12} className={`sidebar-section-chevron ${pinnedAgentsOpen ? 'open' : ''}`} />
              <span>Pinned</span>
            </button>
            {pinnedAgentsOpen && (
              <>
                <div className="threads-list recent-agents-list">
                  {(pinnedAgentsShowAll ? pinnedThreads : pinnedThreads.slice(0, THREADS_VISIBLE_LIMIT)).map(
                    (thread) => (
                      <div
                        key={thread.id}
                        className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                      >
                        <ThreadItemSelect
                          isRenaming={threadRenameKey === `pinned:${thread.id}`}
                          onActivate={() => selectThread(thread.id)}
                        >
                          {renderThreadStatusDot(thread)}
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
                            {formatShortTime(getThreadActivityTime(thread))}
                          </span>
                        </ThreadItemSelect>
                        <div
                          className="thread-menu-wrap"
                          ref={threadItemMenuKey === `pinned:${thread.id}` ? threadItemMenuRef : undefined}
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
                    )
                  )}
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

        {epicsEnabled && projects.length > 0 && (
          <div className="recent-agents-section epics-section">
            <div className="epics-section-header">
              <button
                type="button"
                className="sidebar-section-toggle"
                onClick={() => setEpicsSectionOpen((open) => !open)}
                aria-expanded={epicsSectionOpen}
              >
                <ChevronRight size={15} className={`sidebar-section-chevron ${epicsSectionOpen ? 'open' : ''}`} />
                <span>Epics</span>
              </button>
              <button type="button" className="sidebar-section-action" title="New epic" onClick={openCreateEpicModal}>
                <Plus size={15} />
              </button>
            </div>
            {epicsSectionOpen && (
              <>
                {activeEpics.map((epic) => {
                  const epicThreads = threadsByEpic.get(epic.id) ?? [];
                  // The project label sits on the epic row instead of
                  // repeating on every thread under it — but only while
                  // those threads agree on one project, so a mixed epic
                  // keeps its per-thread tags.
                  const epicProjectNames = new Set(
                    epicThreads
                      .map((thread) => projects.find((p) => p.id === thread.projectId)?.name)
                      .filter((name): name is string => Boolean(name))
                  );
                  const explicitlyBoundEpicProject = epic.gitRoot
                    ? projectForGitRoot(epic.gitRoot, epic.repositoryProjectId)
                    : epic.repositoryProjectId
                      ? projects.find((project) => project.id === epic.repositoryProjectId)
                      : undefined;
                  const epicProjectName =
                    epicThreads.length === 0
                      ? explicitlyBoundEpicProject?.name
                      : epicProjectNames.size === 1
                        ? [...epicProjectNames][0]
                        : undefined;
                  const isEpicCollapsed = collapsedEpics[epic.id] ?? false;
                  const isEpicSelected = selectedEpicId === epic.id && !selectedThreadId;
                  const prStatus = epicPrStatus(epic);

                  return (
                    <div key={epic.id} className="project-section epic-section">
                      <div className="project-section-header-row">
                        <button
                          type="button"
                          className="project-collapse-toggle"
                          title={isEpicCollapsed ? 'Expand threads' : 'Collapse threads'}
                          aria-expanded={!isEpicCollapsed}
                          onClick={() =>
                            setCollapsedEpics((prev) => ({
                              ...prev,
                              [epic.id]: !isEpicCollapsed,
                            }))
                          }
                        >
                          <ChevronRight
                            size={12}
                            className={`sidebar-section-chevron ${isEpicCollapsed ? '' : 'open'}`}
                          />
                        </button>
                        {epicRenameId === epic.id ? (
                          <div className="project-section-header project-section-header-renaming">
                            <SquareKanban
                              size={13}
                              className={`epic-icon ${prStatus ? `epic-icon--${prStatus}` : ''}`}
                            />
                            <InlineRenameInput
                              className="thread-rename-input"
                              initialValue={epic.name}
                              onSubmit={(name) => {
                                renameEpic(epic.id, name);
                                setEpicRenameId(null);
                              }}
                              onCancel={() => setEpicRenameId(null)}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={`project-section-header epic-section-header ${isEpicSelected ? 'epic-section-header-selected' : ''}`}
                            onClick={() => {
                              selectEpic(epic.id);
                              setActiveTab('agents');
                            }}
                            title={prStatus ? `${epic.name} — PR ${prStatus}` : epic.name}
                          >
                            <SquareKanban
                              size={13}
                              className={`epic-icon ${prStatus ? `epic-icon--${prStatus}` : ''}`}
                            />
                            {epicProjectName && <span className="epic-project-tag">{epicProjectName}</span>}
                            <span className="truncate">{epic.name}</span>
                            {isEpicCollapsed && epicThreads.length > 0 && (
                              <span className="sidebar-section-count">{epicThreads.length}</span>
                            )}
                          </button>
                        )}
                        <div className="project-menu-wrap" ref={epicMenuOpenId === epic.id ? epicMenuRef : undefined}>
                          <button
                            type="button"
                            className="project-options-trigger"
                            title="Epic options"
                            aria-label={`Options for ${epic.name}`}
                            aria-haspopup="menu"
                            aria-expanded={epicMenuOpenId === epic.id}
                            onClick={() => setEpicMenuOpenId((open) => (open === epic.id ? null : epic.id))}
                          >
                            <Ellipsis size={13} />
                          </button>
                          {epicMenuOpenId === epic.id && (
                            <div className="thread-menu project-menu" role="menu">
                              <button
                                type="button"
                                className="project-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setEpicMenuOpenId(null);
                                  setEpicRenameId(epic.id);
                                }}
                              >
                                <SquarePen size={13} /> Rename
                              </button>
                              <button
                                type="button"
                                className="project-menu-item"
                                role="menuitem"
                                disabled={runningAgentEpicIds.has(epic.id)}
                                title={
                                  runningAgentEpicIds.has(epic.id)
                                    ? 'Agents are still running in this epic — wait for them to finish before settling it'
                                    : undefined
                                }
                                onClick={() => {
                                  setEpicMenuOpenId(null);
                                  void handleSettleEpic(epic);
                                }}
                              >
                                <Archive size={13} /> Settle
                              </button>
                              <button
                                type="button"
                                className="project-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  setEpicMenuOpenId(null);
                                  handleDeleteEpic(epic);
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
                          title={`New thread in ${epic.name}`}
                          onClick={() => handleCreateThreadForEpic(epic)}
                        >
                          <SquarePen size={13} />
                        </button>
                      </div>

                      {!isEpicCollapsed && (
                        <div className="threads-list">
                          {epicThreads.length === 0 ? (
                            <button
                              type="button"
                              className="thread-item thread-item-empty"
                              onClick={() => handleCreateThreadForEpic(epic)}
                            >
                              <span className="thread-title">New thread</span>
                            </button>
                          ) : (
                            epicThreads.map((thread) => (
                              <div
                                key={thread.id}
                                className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                              >
                                <ThreadItemSelect
                                  isRenaming={threadRenameKey === `epic:${thread.id}`}
                                  onActivate={() => selectThread(thread.id)}
                                >
                                  {renderThreadStatusDot(thread)}
                                  {threadRenameKey === `epic:${thread.id}` ? (
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
                                  {!epicProjectName && (
                                    <span className="thread-project-tag thread-meta">
                                      {projects.find((p) => p.id === thread.projectId)?.name}
                                    </span>
                                  )}
                                  <span className="thread-time thread-meta">
                                    {formatShortTime(getThreadActivityTime(thread))}
                                  </span>
                                </ThreadItemSelect>
                                <div
                                  className="thread-menu-wrap"
                                  ref={threadItemMenuKey === `epic:${thread.id}` ? threadItemMenuRef : undefined}
                                >
                                  <button
                                    type="button"
                                    className="thread-options-trigger"
                                    title="Thread options"
                                    aria-label={`Options for ${thread.title}`}
                                    aria-haspopup="menu"
                                    aria-expanded={threadItemMenuKey === `epic:${thread.id}`}
                                    onClick={() =>
                                      setThreadItemMenuKey((open) =>
                                        open === `epic:${thread.id}` ? null : `epic:${thread.id}`
                                      )
                                    }
                                  >
                                    <Ellipsis size={13} />
                                  </button>
                                  {threadItemMenuKey === `epic:${thread.id}` && (
                                    <div className="thread-menu thread-item-menu" role="menu">
                                      <button
                                        type="button"
                                        className="project-menu-item"
                                        role="menuitem"
                                        onClick={() => {
                                          setThreadItemMenuKey(null);
                                          setThreadRenameKey(`epic:${thread.id}`);
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
                                          void handleRemoveThreadFromEpic(thread.id);
                                        }}
                                      >
                                        <EyeOff size={13} /> Remove from epic
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
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {projects.length > 0 && (
          <div className="recent-agents-section">
            <div className="recent-agents-header-row">
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
                <ChevronRight size={12} className={`sidebar-section-chevron ${recentAgentsOpen ? 'open' : ''}`} />
                <span>Recent agents</span>
              </button>
              {recentAgentsTargetProject && (
                <button
                  type="button"
                  className="project-new-thread"
                  title={`New thread in ${recentAgentsTargetProject.name}`}
                  aria-label={`New thread in ${recentAgentsTargetProject.name}`}
                  onClick={() => {
                    // The new thread lands at the top of this list, so
                    // make sure the list is showing.
                    setRecentAgentsOpen(true);
                    handleCreateThread(recentAgentsTargetProject.id);
                  }}
                >
                  <SquarePen size={13} />
                </button>
              )}
              {runningAgentCount > 0 && <span className="sidebar-section-count">{runningAgentCount}</span>}
            </div>
            {recentAgentsOpen && (
              <>
                <div className="threads-list recent-agents-list">
                  {recentThreads.length === 0 ? (
                    <div className="recent-agents-empty">No recent agents</div>
                  ) : (
                    (recentAgentsShowAll ? recentThreads : recentThreads.slice(0, THREADS_VISIBLE_LIMIT)).map(
                      (thread) => (
                        <div
                          key={thread.id}
                          className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                        >
                          <ThreadItemSelect
                            isRenaming={threadRenameKey === `recent:${thread.id}`}
                            onActivate={() => selectThread(thread.id)}
                          >
                            {renderThreadStatusDot(thread)}
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
                              {formatShortTime(getThreadActivityTime(thread))}
                            </span>
                          </ThreadItemSelect>
                          <div
                            className="thread-menu-wrap"
                            ref={threadItemMenuKey === `recent:${thread.id}` ? threadItemMenuRef : undefined}
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
                                    updateThread(thread.id, {
                                      hiddenFromRecent: true,
                                    });
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
                      )
                    )
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
          const isListExpanded = visibleLimit > THREADS_VISIBLE_LIMIT && projectThreads.length > THREADS_VISIBLE_LIMIT;

          return (
            <div key={project.id} className={`project-section ${isActiveProject ? 'project-section-active' : ''}`}>
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
                  <ChevronRight size={12} className={`sidebar-section-chevron ${isCollapsed ? '' : 'open'}`} />
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
                <div className="project-menu-wrap" ref={projectMenuOpenId === project.id ? projectMenuRef : undefined}>
                  <button
                    type="button"
                    className="project-options-trigger"
                    title="Project options"
                    aria-label={`Options for ${project.name}`}
                    aria-haspopup="menu"
                    aria-expanded={projectMenuOpenId === project.id}
                    onClick={() => setProjectMenuOpenId((open) => (open === project.id ? null : project.id))}
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
                          if (confirm(`Remove "${project.name}" and its threads? Files on disk are not affected.`)) {
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
                        >
                          <ThreadItemSelect
                            isRenaming={threadRenameKey === `project:${thread.id}`}
                            onActivate={() => selectThread(thread.id)}
                          >
                            {renderThreadStatusDot(thread)}
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
                              {formatShortTime(getThreadActivityTime(thread))}
                            </span>
                          </ThreadItemSelect>
                          <div
                            className="thread-menu-wrap"
                            ref={threadItemMenuKey === `project:${thread.id}` ? threadItemMenuRef : undefined}
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
                            return {
                              ...prev,
                              [project.id]: projectThreads.length,
                            };
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
      <SidebarFooter {...sidebarFooterProps} />
    </div>
  );
});
