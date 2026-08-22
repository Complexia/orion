import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useOrionStore } from '../store';
import { CodeEditorPane, type CodeEditorPaneHandle } from './CodeEditorPane';
import { isPdfFilePath } from './codeFiles';
import {
  CODE_SIDEBAR_MAX_WIDTH,
  CODE_SIDEBAR_MIN_WIDTH,
  clampCodeSidebarWidth,
} from './codeSidebarResize';
import { type FileTreeItem, FileTreeNode } from './fileTree';
import { SidebarFooter, type SidebarFooterProps } from './SidebarFooter';

type CodeWorkspaceProps = {
  runningAgentCount: number;
  turnRefreshTick: number;
  sidebarFooterProps: SidebarFooterProps;
};

const isPathWithin = (candidate: string, ancestor: string) =>
  candidate === ancestor || candidate.startsWith(`${ancestor}/`) || candidate.startsWith(`${ancestor}\\`);

const CODE_SIDEBAR_DEFAULT_WIDTH = 280;
const CODE_SIDEBAR_STORAGE_KEY = 'orion.codeSidebarWidth';

/**
 * Owns the Code tab's filesystem state so explorer reads and refreshes do not
 * re-render the much larger Agents shell. Store subscriptions intentionally
 * observe only file-tab metadata; Monaco keeps live file contents local.
 */
export const CodeWorkspace = React.memo(function CodeWorkspace({
  runningAgentCount,
  turnRefreshTick,
  sidebarFooterProps,
}: CodeWorkspaceProps) {
  const {
    projects,
    selectedProjectId,
    workspacePath,
    setWorkspacePath,
    activeFilePath,
    openFile,
    closeFile,
    setActiveFile,
    updateOpenFileContent,
    refreshOpenFileFromDisk,
    closeAllFiles,
  } = useOrionStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      workspacePath: state.workspacePath,
      setWorkspacePath: state.setWorkspacePath,
      activeFilePath: state.activeFilePath,
      openFile: state.openFile,
      closeFile: state.closeFile,
      setActiveFile: state.setActiveFile,
      updateOpenFileContent: state.updateOpenFileContent,
      refreshOpenFileFromDisk: state.refreshOpenFileFromDisk,
      closeAllFiles: state.closeAllFiles,
    }))
  );
  const openFileShellSignatures = useOrionStore(
    useShallow((state) => state.openFiles.map((file) => `${file.path}\u0000${file.isDirty ? '1' : '0'}`))
  );
  const openFilePaths = useOrionStore(
    useShallow((state) => state.openFiles.map((file) => file.path))
  );
  const openFiles = React.useMemo(() => useOrionStore.getState().openFiles, [openFileShellSignatures]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [treeItems, setTreeItems] = useState<FileTreeItem[]>([]);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const treeRootRef = useRef<string | null>(null);
  const loadRootSeqRef = useRef(0);
  const previousRunningAgentCountRef = useRef(runningAgentCount);
  const previousTurnRefreshTickRef = useRef(turnRefreshTick);
  const treeRefreshTimerRef = useRef<number | null>(null);
  const codeEditorPaneRef = useRef<CodeEditorPaneHandle>(null);
  const pendingDiskRefreshPathsRef = useRef(new Set<string>());
  const diskRefreshSequenceByPathRef = useRef(new Map<string, number>());
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarResizeHandleRef = useRef<HTMLButtonElement>(null);
  const sidebarWidthRef = useRef(CODE_SIDEBAR_DEFAULT_WIDTH);
  const preferredSidebarWidthRef = useRef(CODE_SIDEBAR_DEFAULT_WIDTH);
  const resizePointerIdRef = useRef<number | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(CODE_SIDEBAR_DEFAULT_WIDTH);

  const applySidebarWidth = useCallback((requestedWidth: number, remember = false) => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const appContainer = sidebar.closest<HTMLElement>('.app-container');
    const availableWidth = sidebar.parentElement?.clientWidth ?? window.innerWidth;
    const preferredWidth = Math.min(
      CODE_SIDEBAR_MAX_WIDTH,
      Math.max(CODE_SIDEBAR_MIN_WIDTH, Math.round(requestedWidth))
    );
    const nextWidth = clampCodeSidebarWidth(preferredWidth, availableWidth);
    const maximumWidth = clampCodeSidebarWidth(CODE_SIDEBAR_MAX_WIDTH, availableWidth);
    if (remember) preferredSidebarWidthRef.current = preferredWidth;
    sidebarWidthRef.current = nextWidth;
    appContainer?.style.setProperty('--sidebar-width', `${nextWidth}px`);
    sidebarResizeHandleRef.current?.setAttribute('aria-valuenow', String(nextWidth));
    sidebarResizeHandleRef.current?.setAttribute('aria-valuemax', String(maximumWidth));
  }, []);

  const persistSidebarWidth = useCallback(() => {
    try {
      window.localStorage.setItem(CODE_SIDEBAR_STORAGE_KEY, String(preferredSidebarWidthRef.current));
    } catch {
      // A blocked storage backend should not prevent resizing for this session.
    }
  }, []);

  useLayoutEffect(() => {
    try {
      const storedWidth = Number(window.localStorage.getItem(CODE_SIDEBAR_STORAGE_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        preferredSidebarWidthRef.current = storedWidth;
      }
    } catch {
      // Use the default width when local storage is unavailable.
    }

    applySidebarWidth(preferredSidebarWidthRef.current);
    const handleWindowResize = () => applySidebarWidth(preferredSidebarWidthRef.current);
    window.addEventListener('resize', handleWindowResize);

    const appContainer = sidebarRef.current?.closest<HTMLElement>('.app-container');
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      appContainer?.classList.remove('code-sidebar-resizing');
      appContainer?.style.removeProperty('--sidebar-width');
    };
  }, [applySidebarWidth]);

  const handleSidebarResizePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    resizePointerIdRef.current = event.pointerId;
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sidebarWidthRef.current;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarRef.current?.closest('.app-container')?.classList.add('code-sidebar-resizing');
    event.preventDefault();
  }, []);

  const handleSidebarResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (resizePointerIdRef.current !== event.pointerId) return;
      applySidebarWidth(resizeStartWidthRef.current + event.clientX - resizeStartXRef.current, true);
    },
    [applySidebarWidth]
  );

  const finishSidebarResize = useCallback(
    (pointerId: number) => {
      if (resizePointerIdRef.current !== pointerId) return;
      resizePointerIdRef.current = null;
      sidebarRef.current?.closest('.app-container')?.classList.remove('code-sidebar-resizing');
      persistSidebarWidth();
    },
    [persistSidebarWidth]
  );

  const handleSidebarResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const availableWidth = sidebarRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      const maximumWidth = clampCodeSidebarWidth(CODE_SIDEBAR_MAX_WIDTH, availableWidth);
      const step = event.shiftKey ? 32 : 10;
      let nextWidth: number | null = null;
      if (event.key === 'ArrowLeft') nextWidth = sidebarWidthRef.current - step;
      if (event.key === 'ArrowRight') nextWidth = sidebarWidthRef.current + step;
      if (event.key === 'Home') nextWidth = CODE_SIDEBAR_MIN_WIDTH;
      if (event.key === 'End') nextWidth = maximumWidth;
      if (nextWidth === null) return;
      event.preventDefault();
      applySidebarWidth(nextWidth, true);
      persistSidebarWidth();
    },
    [applySidebarWidth, persistSidebarWidth]
  );

  useEffect(() => {
    treeRootRef.current = workspacePath;
    setTreeRoot(workspacePath);
  }, [workspacePath]);

  const loadRoot = useCallback(async (root: string) => {
    if (!root || !window.orion) return;
    const seq = ++loadRootSeqRef.current;
    const items = await window.orion.readDirectory(root);
    if (treeRootRef.current !== root || loadRootSeqRef.current !== seq) return;
    setTreeItems(items);
  }, []);

  useEffect(() => {
    if (treeRoot) {
      void loadRoot(treeRoot);
    } else {
      setTreeItems([]);
    }
  }, [treeRoot, loadRoot]);

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      if (!window.orion) return;
      const content = isPdfFilePath(filePath) ? '' : await window.orion.readFile(filePath);
      openFile(filePath, content);
    },
    [openFile]
  );

  useEffect(() => {
    if (!window.orion?.setWatchedFiles) return;
    void window.orion.setWatchedFiles(openFilePaths);
  }, [openFilePaths]);

  const refreshOpenFilePathFromDisk = useCallback(
    (filePath: string) => {
      const openFile = useOrionStore.getState().openFiles.find((file) => file.path === filePath);
      if (!openFile) {
        pendingDiskRefreshPathsRef.current.delete(filePath);
        return;
      }
      if (openFile.isDirty) {
        pendingDiskRefreshPathsRef.current.add(filePath);
        return;
      }

      pendingDiskRefreshPathsRef.current.delete(filePath);
      const sequence = (diskRefreshSequenceByPathRef.current.get(filePath) ?? 0) + 1;
      diskRefreshSequenceByPathRef.current.set(filePath, sequence);
      if (isPdfFilePath(filePath)) {
        refreshOpenFileFromDisk(filePath);
        return;
      }

      void window.orion.readFileResult(filePath)
        .then((result) => {
          if (diskRefreshSequenceByPathRef.current.get(filePath) !== sequence) return;
          const latestFile = useOrionStore.getState().openFiles.find((file) => file.path === filePath);
          if (!latestFile) return;
          if (latestFile.isDirty) {
            pendingDiskRefreshPathsRef.current.add(filePath);
            return;
          }
          if (!result.ok) {
            toast.error('Could not refresh the externally changed file; the editor content was kept.');
            return;
          }
          refreshOpenFileFromDisk(filePath, result.content);
        })
        .catch(() => {
          toast.error('Could not refresh the externally changed file; the editor content was kept.');
        });
    },
    [refreshOpenFileFromDisk]
  );

  useEffect(() => {
    if (!window.orion?.onFileChange) return undefined;
    const unsubscribe = window.orion.onFileChange((change) => {
      if (!change.exists) {
        pendingDiskRefreshPathsRef.current.delete(change.path);
        diskRefreshSequenceByPathRef.current.set(
          change.path,
          (diskRefreshSequenceByPathRef.current.get(change.path) ?? 0) + 1
        );
        const openFile = useOrionStore.getState().openFiles.find((file) => file.path === change.path);
        if (!openFile) return;
        const fileName = change.path.split(/[\\/]/).pop() || 'The file';
        if (openFile.isDirty) {
          toast.warning(`${fileName} was deleted externally. Your unsaved changes were kept.`);
          return;
        }
        closeFile(change.path);
        toast.warning(`${fileName} was deleted externally, so its tab was closed.`);
        return;
      }
      refreshOpenFilePathFromDisk(change.path);
    });
    return unsubscribe;
  }, [closeFile, refreshOpenFilePathFromDisk]);

  // If a disk change arrived while the user had unsaved edits, keep their
  // buffer. As soon as the tab becomes clean again, adopt the latest disk
  // version instead of leaving the skipped change stale forever.
  useEffect(() => {
    const openPaths = new Set(openFilePaths);
    for (const filePath of pendingDiskRefreshPathsRef.current) {
      if (!openPaths.has(filePath)) {
        pendingDiskRefreshPathsRef.current.delete(filePath);
        continue;
      }
      const openFile = useOrionStore.getState().openFiles.find((file) => file.path === filePath);
      if (!openFile?.isDirty) refreshOpenFilePathFromDisk(filePath);
    }
  }, [openFilePaths, openFileShellSignatures, refreshOpenFilePathFromDisk]);

  useEffect(
    () => () => {
      void window.orion?.setWatchedFiles([]);
    },
    []
  );

  const loadChildren = useCallback(async (dirPath: string): Promise<FileTreeItem[]> => {
    if (!window.orion) return [];
    return window.orion.readDirectory(dirPath);
  }, []);

  const refreshTree = useCallback(() => {
    if (treeRoot) void loadRoot(treeRoot);
    setTreeRefreshToken((value) => value + 1);
  }, [treeRoot, loadRoot]);

  useEffect(() => {
    const turnCompleted =
      runningAgentCount < previousRunningAgentCountRef.current ||
      turnRefreshTick !== previousTurnRefreshTickRef.current;
    previousRunningAgentCountRef.current = runningAgentCount;
    previousTurnRefreshTickRef.current = turnRefreshTick;
    if (!turnCompleted) return;
    if (treeRefreshTimerRef.current !== null) window.clearTimeout(treeRefreshTimerRef.current);
    treeRefreshTimerRef.current = window.setTimeout(() => {
      treeRefreshTimerRef.current = null;
      refreshTree();
    }, 300);
  }, [runningAgentCount, turnRefreshTick, refreshTree]);

  useEffect(
    () => () => {
      if (treeRefreshTimerRef.current !== null) window.clearTimeout(treeRefreshTimerRef.current);
    },
    []
  );

  const handleDeleteTreeItem = useCallback(
    async (item: FileTreeItem) => {
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
      for (const file of useOrionStore.getState().openFiles) {
        if (isPathWithin(file.path, item.path)) closeFile(file.path);
      }
      toast.success(`Deleted ${item.name}`);
      refreshTree();
    },
    [closeFile, refreshTree]
  );

  const handleTreeItemRenamed = useCallback(
    async (oldPath: string, newPath: string, _isDirectory: boolean) => {
      codeEditorPaneRef.current?.flushBuffers();
      const currentOpenFiles = useOrionStore.getState().openFiles;
      const activePathBeforeRename = useOrionStore.getState().activeFilePath;
      const renamedOpenFiles = currentOpenFiles
        .filter((file) => isPathWithin(file.path, oldPath))
        .map((file) => ({
          file,
          newPath: `${newPath}${file.path.slice(oldPath.length)}`,
        }));

      for (const { file } of renamedOpenFiles) {
        closeFile(file.path);
      }
      for (const { file, newPath: renamedPath } of renamedOpenFiles) {
        if (file.isDirty) {
          openFile(renamedPath, file.content);
          updateOpenFileContent(renamedPath, file.content);
        } else {
          await handleOpenFile(renamedPath);
        }
      }

      if (activePathBeforeRename) {
        const renamedActivePath =
          renamedOpenFiles.find(({ file }) => file.path === activePathBeforeRename)?.newPath ?? activePathBeforeRename;
        if (useOrionStore.getState().openFiles.some((file) => file.path === renamedActivePath)) {
          setActiveFile(renamedActivePath);
        }
      }
      refreshTree();
    },
    [closeFile, handleOpenFile, openFile, refreshTree, setActiveFile, updateOpenFileContent]
  );

  const handleOpenFolderForCode = useCallback(async () => {
    if (!window.orion) return;
    const dir = await window.orion.openDirectory();
    if (!dir) return;
    setWorkspacePath(dir);
    closeAllFiles();
    toast.success('Workspace opened');
  }, [closeAllFiles, setWorkspacePath]);

  return (
    <>
      <div className="sidebar code-sidebar" ref={sidebarRef}>
        <div className="sidebar-header">
          <span>Explorer</span>
          <div className="flex gap-1">
            <button onClick={handleOpenFolderForCode} className="btn secondary small" title="Open folder">
              <FolderOpen size={13} />
            </button>
            <button
              onClick={() => {
                if (selectedProject) {
                  setWorkspacePath(selectedProject.path);
                  closeAllFiles();
                  toast.info(`Opened ${selectedProject.name}`);
                } else {
                  void handleOpenFolderForCode();
                }
              }}
              className="btn secondary small"
              title="Use selected project as workspace"
            >
              <Folder size={13} />
            </button>
            <button
              onClick={() => {
                refreshTree();
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
                <div className="mt-4 text-[11px] text-[#777]">Or select a project in Agents tab</div>
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
        <SidebarFooter {...sidebarFooterProps} />
        <button
          type="button"
          ref={sidebarResizeHandleRef}
          className="code-sidebar-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize Explorer"
          aria-orientation="vertical"
          aria-valuemin={CODE_SIDEBAR_MIN_WIDTH}
          aria-valuemax={CODE_SIDEBAR_MAX_WIDTH}
          aria-valuenow={CODE_SIDEBAR_DEFAULT_WIDTH}
          title="Drag to resize Explorer"
          onPointerDown={handleSidebarResizePointerDown}
          onPointerMove={handleSidebarResizePointerMove}
          onPointerUp={(event) => finishSidebarResize(event.pointerId)}
          onPointerCancel={(event) => finishSidebarResize(event.pointerId)}
          onLostPointerCapture={(event) => finishSidebarResize(event.pointerId)}
          onKeyDown={handleSidebarResizeKeyDown}
        />
      </div>

      <div className="panel">
        {openFiles.length > 0 && (
          <div className="editor-tabs" role="tablist" aria-label="Open files">
            {openFiles.map((file) => {
              if (!file?.path) return null;
              const fileName = file.path.split(/[\\/]/).pop() || file.path;
              const isActive = file.path === activeFilePath;
              return (
                <div
                  key={file.path}
                  className={`editor-tab ${isActive ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="editor-tab-select"
                    role="tab"
                    tabIndex={0}
                    aria-selected={isActive}
                    title={file.path}
                    onClick={() => setActiveFile(file.path)}
                  >
                    <span className="truncate">{fileName}</span>
                    {file.isDirty && <span className="text-[#f4a261]">●</span>}
                  </button>
                  <button
                    type="button"
                    className="close"
                    aria-label={`Close ${fileName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeFile(file.path);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <CodeEditorPane ref={codeEditorPaneRef} />
      </div>
    </>
  );
});
