import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useOrionStore } from '../store';
import { CodeEditorPane, type CodeEditorPaneHandle } from './CodeEditorPane';
import { type FileTreeItem, FileTreeNode } from './fileTree';
import { SidebarFooter, type SidebarFooterProps } from './SidebarFooter';

type CodeWorkspaceProps = {
  runningAgentCount: number;
  turnRefreshTick: number;
  sidebarFooterProps: SidebarFooterProps;
};

const isPathWithin = (candidate: string, ancestor: string) =>
  candidate === ancestor || candidate.startsWith(`${ancestor}/`) || candidate.startsWith(`${ancestor}\\`);

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
      closeAllFiles: state.closeAllFiles,
    }))
  );
  const openFileShellSignatures = useOrionStore(
    useShallow((state) => state.openFiles.map((file) => `${file.path}\u0000${file.isDirty ? '1' : '0'}`))
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
      const content = await window.orion.readFile(filePath);
      openFile(filePath, content);
    },
    [openFile]
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
      <div className="sidebar">
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
      </div>

      <div className="panel">
        {openFiles.length > 0 && (
          <div className="editor-tabs" role="tablist" aria-label="Open files">
            {openFiles.map((file) => {
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
