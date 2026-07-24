import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { useOrionStore } from '../store';
import { getLanguageFromPath } from './language';

// Keep both @monaco-editor/react and Monaco itself out of the startup graph.
// MonacoEditor configures the bundled Electron-safe loader when the Code
// editor is first rendered.
export const MonacoEditor = React.lazy(() => import('../MonacoEditor'));
/**
 * Keeps Monaco's per-keystroke updates inside the code pane. The shell only
 * observes tab metadata (path/dirty state), so editing no longer re-renders
 * the sidebar, transcript, settings, or composer.
 */
export const CodeEditorPane = React.memo(function CodeEditorPane() {
  const { activeFilePath, activeFile, closeFile, updateOpenFileContent, markFileSaved } =
    useOrionStore(
      useShallow((state) => ({
        activeFilePath: state.activeFilePath,
        activeFile: state.openFiles.find((file) => file.path === state.activeFilePath),
        closeFile: state.closeFile,
        updateOpenFileContent: state.updateOpenFileContent,
        markFileSaved: state.markFileSaved,
      }))
    );
  const openFilePaths = useOrionStore(
    useShallow((state) => state.openFiles.map((file) => file.path))
  );
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const buffersRef = useRef(new Map<string, string>());
  const dirtyPathsRef = useRef(new Set<string>());
  const savedContentsRef = useRef(new Map<string, string>());
  const previousActiveFilePathRef = useRef(activeFilePath);
  const [editorBottomPadding, setEditorBottomPadding] = useState(280);

  if (activeFilePath && activeFile && !buffersRef.current.has(activeFilePath)) {
    buffersRef.current.set(activeFilePath, activeFile.content);
    if (activeFile.isDirty) {
      dirtyPathsRef.current.add(activeFilePath);
    } else {
      savedContentsRef.current.set(activeFilePath, activeFile.content);
    }
  }

  const flushFileBuffer = useCallback(
    (path: string) => {
      if (!dirtyPathsRef.current.has(path)) return;
      const content = buffersRef.current.get(path);
      if (content === undefined) return;
      const sharedFile = useOrionStore.getState().openFiles.find((file) => file.path === path);
      if (!sharedFile || (sharedFile.isDirty && sharedFile.content === content)) return;
      updateOpenFileContent(path, content);
    },
    [updateOpenFileContent]
  );

  useEffect(() => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return undefined;

    const updatePadding = () => {
      const nextPadding = Math.round(editorContainer.clientHeight * 0.5);
      if (nextPadding > 0) setEditorBottomPadding(nextPadding);
    };

    updatePadding();
    const resizeObserver = new ResizeObserver(updatePadding);
    resizeObserver.observe(editorContainer);
    return () => resizeObserver.disconnect();
  }, []);

  // Monaco owns the live model while a tab is active. Commit its final buffer
  // to shared state only when the active editor tab changes.
  useLayoutEffect(() => {
    const previousPath = previousActiveFilePathRef.current;
    if (previousPath && previousPath !== activeFilePath) {
      flushFileBuffer(previousPath);
    }
    previousActiveFilePathRef.current = activeFilePath;
  }, [activeFilePath, flushFileBuffer]);

  // Leaving Code unmounts this pane, so flush dirty buffers once before the
  // localized cache disappears. This preserves every unsaved editor tab.
  useEffect(
    () => () => {
      for (const path of dirtyPathsRef.current) flushFileBuffer(path);
    },
    [flushFileBuffer]
  );

  // Closed tabs must not leave a stale unsaved buffer that could be revived if
  // the same path is opened again later in this Code session.
  useEffect(() => {
    const openPaths = new Set(openFilePaths);
    for (const path of buffersRef.current.keys()) {
      if (openPaths.has(path)) continue;
      buffersRef.current.delete(path);
      dirtyPathsRef.current.delete(path);
      savedContentsRef.current.delete(path);
    }
  }, [openFilePaths]);

  const saveActiveFile = useCallback(async () => {
    const path = useOrionStore.getState().activeFilePath;
    if (!path || !window.orion) return;
    const currentFile = useOrionStore.getState().openFiles.find((file) => file.path === path);
    const content = buffersRef.current.get(path) ?? currentFile?.content;
    if (content === undefined) return;

    const success = await window.orion.writeFile(path, content);
    if (success) {
      savedContentsRef.current.set(path, content);
      const latestContent = buffersRef.current.get(path) ?? content;
      if (latestContent === content) {
        dirtyPathsRef.current.delete(path);
        markFileSaved(path, content);
      } else {
        // Edits made while the write was in flight remain dirty against the
        // content that actually reached disk.
        dirtyPathsRef.current.add(path);
        updateOpenFileContent(path, latestContent);
      }
    } else {
      toast.error('Failed to save file');
    }
  }, [markFileSaved, updateOpenFileContent]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || !activeFilePath) return;
      buffersRef.current.set(activeFilePath, value);

      const wasDirty = dirtyPathsRef.current.has(activeFilePath);
      const hasSavedContent = savedContentsRef.current.has(activeFilePath);
      const isDirty =
        !hasSavedContent || value !== savedContentsRef.current.get(activeFilePath);
      if (isDirty === wasDirty) return;

      if (isDirty) {
        dirtyPathsRef.current.add(activeFilePath);
        updateOpenFileContent(activeFilePath, value);
      } else {
        dirtyPathsRef.current.delete(activeFilePath);
        markFileSaved(activeFilePath, value);
      }
    },
    [activeFilePath, markFileSaved, updateOpenFileContent]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (activeFilePath) void saveActiveFile();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w' && activeFilePath) {
        event.preventDefault();
        closeFile(activeFilePath);
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [activeFilePath, closeFile, saveActiveFile]);

  const currentLanguage = activeFilePath ? getLanguageFromPath(activeFilePath) : 'plaintext';
  const activeBuffer =
    activeFilePath && activeFile
      ? (buffersRef.current.get(activeFilePath) ?? activeFile.content)
      : undefined;

  return (
    <div className="editor-container" ref={editorContainerRef}>
      {activeFilePath && activeFile ? (
        <React.Suspense fallback={<div className="editor-loading" />}>
          <MonacoEditor
            height="100%"
            language={currentLanguage}
            value={activeBuffer}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              fontSize: 13,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              padding: { bottom: editorBottomPadding },
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        </React.Suspense>
      ) : (
        <div className="empty-state">
          <FileText size={42} className="opacity-30" />
          <div>Open a file from the explorer</div>
          <div className="text-xs mt-1 text-[#555]">VSCode-powered editor (Monaco)</div>
        </div>
      )}
    </div>
  );
});
