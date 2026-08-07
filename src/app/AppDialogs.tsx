import React from 'react';
import { Archive, Check, ChevronDown, GitCommit, GitPullRequest, LoaderCircle, Trash2 } from 'lucide-react';
import type { Epic, Project } from '../store';
import type { RiftStorageEntry } from '../types';
import type {
  EpicCommitDialogState,
  EpicPrBaseDialogState,
  EpicSettleDialogState,
  NewEpicRiftBranches,
  RiftSweepDialogState,
} from './appTypes';
import { ProjectIcon } from './ProjectIcon';

export type AppDialogsModel = {
  projects: Project[];
  createEpicOpen: boolean;
  newEpicName: string;
  setNewEpicName: React.Dispatch<React.SetStateAction<string>>;
  newEpicDescription: string;
  setNewEpicDescription: React.Dispatch<React.SetStateAction<string>>;
  newEpicProjectId: string | null;
  setNewEpicProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateEpicProjectPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createEpicProjectPickerOpen: boolean;
  setCreateEpicRiftBranchPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createEpicRiftBranchPickerOpen: boolean;
  newEpicCreateRift: boolean;
  setNewEpicCreateRift: React.Dispatch<React.SetStateAction<boolean>>;
  newEpicRiftBaseBranch: string | null;
  setNewEpicRiftBaseBranch: React.Dispatch<React.SetStateAction<string | null>>;
  newEpicRiftBranches: NewEpicRiftBranches | null;
  createEpicTitleRef: React.RefObject<HTMLInputElement | null>;
  createEpicProjectPickerRef: React.RefObject<HTMLDivElement | null>;
  createEpicRiftBranchPickerRef: React.RefObject<HTMLDivElement | null>;
  riftsActive: boolean;
  closeCreateEpicModal: () => void;
  handleCreateEpic: () => void;
  epicCommitDialog: EpicCommitDialogState | null;
  setEpicCommitDialog: React.Dispatch<React.SetStateAction<EpicCommitDialogState | null>>;
  handleEpicCommitAndPush: (epic: Epic, message?: string) => Promise<void>;
  epicPrBaseDialog: EpicPrBaseDialogState | null;
  setEpicPrBaseDialog: React.Dispatch<React.SetStateAction<EpicPrBaseDialogState | null>>;
  setEpicPrBaseBranchPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  epicPrBaseBranchPickerOpen: boolean;
  epicPrBaseBranchPickerRef: React.RefObject<HTMLDivElement | null>;
  handleEpicCreatePr: (epic: Epic, baseBranch: string, message?: string) => Promise<void>;
  epicSettleDialog: EpicSettleDialogState | null;
  setEpicSettleDialog: React.Dispatch<React.SetStateAction<EpicSettleDialogState | null>>;
  confirmEpicSettlement: (epic: Epic, releaseRift?: boolean) => void;
  riftSweepDialog: RiftSweepDialogState | null;
  setRiftSweepDialog: React.Dispatch<React.SetStateAction<RiftSweepDialogState | null>>;
  dismissRiftSweepDialog: () => void;
  releaseRiftStorage: (
    entries: Array<Pick<RiftStorageEntry, 'riftPath'>>,
    options?: {
      runGc?: boolean;
      forcePaths?: string[];
      manualPaths?: string[];
      manualScanId?: string;
      queueIfBusy?: boolean;
    }
  ) => Promise<void>;
  formatBytes: (bytes: number | null | undefined) => string;
};

const AppDialogs = React.memo(function AppDialogs({ model }: { model: AppDialogsModel }) {
  const {
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
    riftSweepDialog,
    setRiftSweepDialog,
    dismissRiftSweepDialog,
    releaseRiftStorage,
    formatBytes,
  } = model;

  return (
    <>
      {epicCommitDialog && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEpicCommitDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="epic-commit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="epic-commit-title" className="modal-title">
              {epicCommitDialog.epic.commitWithoutPush ? 'Commit' : 'Commit & push'}
            </h2>
            <p className="modal-subtitle">
              Stages everything in {epicCommitDialog.epic.riftPath ? 'this epic’s rift' : 'the repository'}, then
              {epicCommitDialog.epic.commitWithoutPush ? ' commits without pushing.' : ' pushes.'}
            </p>
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const dialog = epicCommitDialog;
                setEpicCommitDialog(null);
                void handleEpicCommitAndPush(dialog.epic, dialog.message);
              }}
            >
              <label className="modal-field">
                <span className="modal-field-label">
                  Commit message <span className="modal-optional">optional</span>
                </span>
                <textarea
                  className="modal-textarea"
                  value={epicCommitDialog.message}
                  onChange={(e) =>
                    setEpicCommitDialog((current) => (current ? { ...current, message: e.target.value } : current))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Leave empty and Orion writes one from the staged changes"
                  rows={5}
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setEpicCommitDialog(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn">
                  <GitCommit size={14} />
                  {epicCommitDialog.epic.commitWithoutPush ? 'Commit' : 'Commit & push'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {epicPrBaseDialog && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEpicPrBaseDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="epic-pr-base-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="epic-pr-base-title" className="modal-title">
              Create pull request
            </h2>
            <p className="modal-subtitle">
              Choose the branch the pull request merges into, and optionally write it yourself.
            </p>
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const dialog = epicPrBaseDialog;
                if (dialog.branchesLoading || !dialog.baseBranch || !dialog.branches.includes(dialog.baseBranch)) {
                  return;
                }
                setEpicPrBaseDialog(null);
                void handleEpicCreatePr(dialog.epic, dialog.baseBranch, dialog.message);
              }}
            >
              <div className="modal-field">
                <span className="modal-field-label">Base branch</span>
                <div className="relative" ref={epicPrBaseBranchPickerRef}>
                  <button
                    type="button"
                    className="modal-input flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                    onClick={() => setEpicPrBaseBranchPickerOpen((open) => !open)}
                    aria-haspopup="listbox"
                    aria-expanded={epicPrBaseBranchPickerOpen}
                  >
                    <span className="truncate">
                      {!epicPrBaseDialog.baseBranch
                        ? epicPrBaseDialog.branchesLoading
                          ? 'Finding the base branch…'
                          : 'No base branch found'
                        : epicPrBaseDialog.baseBranch === epicPrBaseDialog.sourceBranch
                          ? `${epicPrBaseDialog.baseBranch} (your current branch)`
                          : epicPrBaseDialog.baseBranch === epicPrBaseDialog.defaultBranch
                            ? `${epicPrBaseDialog.baseBranch} (default)`
                            : epicPrBaseDialog.baseBranch}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`shrink-0 text-[var(--text-muted)] transition-transform ${
                        epicPrBaseBranchPickerOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {epicPrBaseBranchPickerOpen && (
                    <div
                      role="listbox"
                      aria-label="Base branch"
                      className="absolute left-0 right-0 top-[calc(100%+4px)] z-[100] max-h-60 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
                    >
                      {/* Origin is still being asked; the picker fills itself
                                without the user having to close and reopen it. */}
                      {epicPrBaseDialog.branchesLoading && (
                        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-[var(--text-muted)]">
                          <LoaderCircle size={13} className="spinning shrink-0" />
                          Loading branches on origin…
                        </div>
                      )}
                      {!epicPrBaseDialog.branchesLoading && epicPrBaseDialog.branches.length === 0 && (
                        <div className="px-2.5 py-1.5 text-[13px] text-[var(--text-muted)]">
                          {epicPrBaseDialog.branchesError || 'No branches found on origin'}
                        </div>
                      )}
                      {epicPrBaseDialog.branches.map((name) => {
                        const selected = name === epicPrBaseDialog.baseBranch;
                        const label =
                          name === epicPrBaseDialog.sourceBranch
                            ? `${name} (your current branch)`
                            : name === epicPrBaseDialog.defaultBranch
                              ? `${name} (default)`
                              : name;
                        return (
                          <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                              selected
                                ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                            }`}
                            onClick={() => {
                              setEpicPrBaseDialog((current) => (current ? { ...current, baseBranch: name } : current));
                              setEpicPrBaseBranchPickerOpen(false);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {selected && <Check size={13} className="shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* A provisional local base is never submitted. Origin must
                          confirm the branch before the PR action is enabled. */}
                {epicPrBaseDialog.branchesError && (
                  <span className="text-[12px] text-[var(--text-muted)]">{epicPrBaseDialog.branchesError}</span>
                )}
              </div>
              <label className="modal-field">
                <span className="modal-field-label">
                  Title and description <span className="modal-optional">optional</span>
                </span>
                <textarea
                  className="modal-textarea"
                  value={epicPrBaseDialog.message}
                  onChange={(e) =>
                    setEpicPrBaseDialog((current) => (current ? { ...current, message: e.target.value } : current))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Leave empty and Orion writes them from the branch changes. Otherwise: first line is the title, the rest is the description."
                  rows={6}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setEpicPrBaseDialog(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={
                    epicPrBaseDialog.branchesLoading ||
                    !epicPrBaseDialog.baseBranch ||
                    !epicPrBaseDialog.branches.includes(epicPrBaseDialog.baseBranch)
                  }
                >
                  <GitPullRequest size={14} />
                  Create PR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {epicSettleDialog && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEpicSettleDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="epic-settle-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="epic-settle-title" className="modal-title">
              Settle “{epicSettleDialog.epic.name}”?
            </h2>
            <p className="modal-subtitle">
              The epic moves to the archive. Its threads stay in Recent agents and their projects.
            </p>
            {epicSettleDialog.warnings.length > 0 && (
              <div className="epic-settle-warnings">
                {epicSettleDialog.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {epicSettleDialog.canReleaseRift && (
              <label className="storage-sweep-option">
                <input
                  type="checkbox"
                  checked={epicSettleDialog.releaseRift}
                  onChange={(e) =>
                    setEpicSettleDialog((current) =>
                      current ? { ...current, releaseRift: e.target.checked } : current
                    )
                  }
                />
                <span>
                  Also free its rift workspace to reclaim disk. The branch and pull request are kept, and restoring the
                  epic recreates the rift.
                </span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setEpicSettleDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => confirmEpicSettlement(epicSettleDialog.epic, epicSettleDialog.releaseRift)}
              >
                <Archive size={14} />
                Settle epic
              </button>
            </div>
          </div>
        </div>
      )}

      {riftSweepDialog && (
        <div className="modal-backdrop" role="presentation" onClick={dismissRiftSweepDialog}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rift-sweep-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="rift-sweep-title" className="modal-title">
              {riftSweepDialog.entries.length === 0
                ? "Empty Rift's trash?"
                : riftSweepDialog.entries.length === 1
                  ? `Free “${riftSweepDialog.entries[0].epicName || riftSweepDialog.entries[0].name}”?`
                  : `Free ${riftSweepDialog.entries.length} rift workspaces?`}
            </h2>
            <p className="modal-subtitle">
              {riftSweepDialog.entries.length === 0
                ? "This permanently empties Rift's trash across every repository on this machine."
                : 'This removes the workspace. Epics keep their branches, commits, and pull requests, and restoring an epic recreates its rift from the source repository.'}
            </p>
            {riftSweepDialog.entries.length > 0 && (
              <div className="storage-sweep-list">
                {riftSweepDialog.entries.map((entry) => (
                  <div key={entry.riftPath} className="storage-sweep-item">
                    <span className="truncate" title={entry.riftPath}>
                      {entry.epicName || entry.name}
                    </span>
                    <span className="storage-rift-size">{formatBytes(entry.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
            {riftSweepDialog.entries.some((entry) => entry.hasUncommittedChanges || entry.hasUnpushedCommits) && (
              <div className="epic-settle-warnings">
                <p>
                  {riftSweepDialog.entries.length === 1
                    ? 'This rift contains uncommitted or unpushed work. Confirming will delete that unpublished work without creating a commit or pull request.'
                    : 'Some of these rifts contain uncommitted or unpushed work. Confirming will delete that unpublished work without creating commits or pull requests.'}
                </p>
              </div>
            )}
            {riftSweepDialog.entries.some((entry) => entry.status === 'active') && (
              <div className="epic-settle-warnings">
                <p>
                  This includes an active epic’s rift. Its agents must be stopped first, and the epic cannot run agents
                  again until it is settled and restored to recreate the workspace.
                </p>
              </div>
            )}
            {riftSweepDialog.entries.some((entry) => !entry.hasMarker) && (
              <div className="epic-settle-warnings">
                <p>
                  This includes an incomplete workspace without Rift metadata. It will move to the system Trash rather
                  than Rift’s trash.
                </p>
              </div>
            )}
            {riftSweepDialog.entries.length > 0 && (
              <label className="storage-sweep-option">
                <input
                  type="checkbox"
                  checked={riftSweepDialog.runGc}
                  onChange={(e) =>
                    setRiftSweepDialog((current) => (current ? { ...current, runGc: e.target.checked } : current))
                  }
                />
                <span>
                  Empty Rift's trash afterwards. Without this the space is not actually reclaimed — but emptying it is
                  permanent and covers every repository on this machine, not just Orion's.
                </span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={dismissRiftSweepDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const { entries, runGc, forcePaths, manualPaths, manualScanId } = riftSweepDialog;
                  dismissRiftSweepDialog();
                  void releaseRiftStorage(entries, { runGc, forcePaths, manualPaths, manualScanId });
                }}
              >
                <Trash2 size={14} />
                {riftSweepDialog.entries.length === 0
                  ? 'Empty trash'
                  : `Free ${riftSweepDialog.entries.length === 1 ? 'rift' : 'rifts'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {createEpicOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeCreateEpicModal}>
          <div
            className="modal create-epic-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-epic-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-epic-title" className="modal-title">
              New epic
            </h2>
            <p className="modal-subtitle">Group threads around a big-ticket task.</p>
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateEpic();
              }}
            >
              <label className="modal-field">
                <span className="modal-field-label">
                  Title <span className="modal-required">*</span>
                </span>
                <input
                  ref={createEpicTitleRef}
                  type="text"
                  className="modal-input"
                  value={newEpicName}
                  onChange={(e) => setNewEpicName(e.target.value)}
                  placeholder="e.g. Optimize memory usage"
                  autoComplete="off"
                />
              </label>
              <label className="modal-field">
                <span className="modal-field-label">
                  Description <span className="modal-optional">optional</span>
                </span>
                <textarea
                  className="modal-textarea"
                  value={newEpicDescription}
                  onChange={(e) => setNewEpicDescription(e.target.value)}
                  placeholder="What does this epic cover?"
                  rows={4}
                />
              </label>
              {projects.length > 0 && (
                <div className="modal-field">
                  <span className="modal-field-label">Project</span>
                  <div className="relative" ref={createEpicProjectPickerRef}>
                    {(() => {
                      const selectedProject = projects.find((project) => project.id === newEpicProjectId) ?? null;
                      return (
                        <button
                          type="button"
                          className="modal-input flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                          onClick={() => {
                            setCreateEpicRiftBranchPickerOpen(false);
                            setCreateEpicProjectPickerOpen((open) => !open);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={createEpicProjectPickerOpen}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {selectedProject ? (
                              <>
                                <ProjectIcon projectPath={selectedProject.path} size={13} />
                                <span className="truncate">{selectedProject.name}</span>
                              </>
                            ) : (
                              <span className="truncate text-[var(--text-muted)]">No project</span>
                            )}
                          </span>
                          <ChevronDown
                            size={14}
                            className={`shrink-0 text-[var(--text-muted)] transition-transform ${
                              createEpicProjectPickerOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      );
                    })()}
                    {createEpicProjectPickerOpen && (
                      <div
                        role="listbox"
                        aria-label="Project"
                        className="absolute left-0 right-0 top-[calc(100%+4px)] z-[100] max-h-60 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={!newEpicProjectId}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                            !newEpicProjectId
                              ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                              : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                          }`}
                          onClick={() => {
                            setNewEpicProjectId(null);
                            setCreateEpicProjectPickerOpen(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">No project</span>
                          {!newEpicProjectId && <Check size={13} className="shrink-0" />}
                        </button>
                        {projects.map((project) => {
                          const selected = project.id === newEpicProjectId;
                          return (
                            <button
                              key={project.id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              title={project.path}
                              className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                                selected
                                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                  : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                              }`}
                              onClick={() => {
                                setNewEpicProjectId(project.id);
                                setCreateEpicProjectPickerOpen(false);
                              }}
                            >
                              <ProjectIcon projectPath={project.path} size={13} />
                              <span className="min-w-0 flex-1 truncate">{project.name}</span>
                              {selected && <Check size={13} className="shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {riftsActive && (
                <label className="modal-field modal-field-checkbox">
                  <span className="modal-field-label">Rift</span>
                  <span className="modal-checkbox-row">
                    <input
                      type="checkbox"
                      checked={newEpicCreateRift}
                      onChange={(e) => setNewEpicCreateRift(e.target.checked)}
                    />
                    <span className="modal-checkbox-text">
                      Work in a rift — a copy-on-write clone of{' '}
                      {projects.find((project) => project.id === newEpicProjectId)?.name ?? 'the selected project'} on
                      its own branch
                    </span>
                  </span>
                </label>
              )}
              {riftsActive &&
                newEpicCreateRift &&
                newEpicRiftBranches &&
                newEpicRiftBranches.projectId === newEpicProjectId &&
                newEpicRiftBranches.branches.length > 0 && (
                  <div className="modal-field">
                    <span className="modal-field-label">Rift branch from</span>
                    <div className="relative" ref={createEpicRiftBranchPickerRef}>
                      <button
                        type="button"
                        className="modal-input flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                        onClick={() => {
                          setCreateEpicProjectPickerOpen(false);
                          setCreateEpicRiftBranchPickerOpen((open) => !open);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={createEpicRiftBranchPickerOpen}
                      >
                        <span className="truncate">
                          {(() => {
                            const selectedBranch = newEpicRiftBaseBranch ?? newEpicRiftBranches.currentBranch ?? '';
                            if (!selectedBranch) return 'Current commit (detached HEAD)';
                            return selectedBranch === newEpicRiftBranches.currentBranch
                              ? `${selectedBranch} (current)`
                              : selectedBranch;
                          })()}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`shrink-0 text-[var(--text-muted)] transition-transform ${
                            createEpicRiftBranchPickerOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {createEpicRiftBranchPickerOpen && (
                        <div
                          role="listbox"
                          aria-label="Rift branch from"
                          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[100] max-h-60 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
                        >
                          {newEpicRiftBranches.currentBranch === null && (
                            <button
                              type="button"
                              role="option"
                              aria-selected={!(newEpicRiftBaseBranch ?? newEpicRiftBranches.currentBranch)}
                              className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                                !(newEpicRiftBaseBranch ?? newEpicRiftBranches.currentBranch)
                                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                  : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                              }`}
                              onClick={() => {
                                setNewEpicRiftBaseBranch(null);
                                setCreateEpicRiftBranchPickerOpen(false);
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate">Current commit (detached HEAD)</span>
                              {!(newEpicRiftBaseBranch ?? newEpicRiftBranches.currentBranch) && (
                                <Check size={13} className="shrink-0" />
                              )}
                            </button>
                          )}
                          {newEpicRiftBranches.branches.map((name) => {
                            const selectedBranch = newEpicRiftBaseBranch ?? newEpicRiftBranches.currentBranch ?? '';
                            const selected = name === selectedBranch;
                            const label = name === newEpicRiftBranches.currentBranch ? `${name} (current)` : name;
                            return (
                              <button
                                key={name}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                                  selected
                                    ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                    : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                                }`}
                                onClick={() => {
                                  setNewEpicRiftBaseBranch(name === newEpicRiftBranches.currentBranch ? null : name);
                                  setCreateEpicRiftBranchPickerOpen(false);
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate">{label}</span>
                                {selected && <Check size={13} className="shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={closeCreateEpicModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={!newEpicName.trim() || (newEpicCreateRift && !newEpicProjectId)}
                >
                  Create epic
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
});

export default AppDialogs;
