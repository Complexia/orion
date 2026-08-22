import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPdfFilePath } from '../src/app/codeFiles.ts';
import { getMimeTypeForMediaPath, mediaPreviewExtensions } from '../src/main/media.js';

const [workspaceSource, paneSource, storeSource, mainSource, preloadSource] = await Promise.all([
  readFile(new URL('../src/app/CodeWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/CodeEditorPane.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/preload.js', import.meta.url), 'utf8'),
]);

assert.equal(isPdfFilePath('/tmp/Report.PDF'), true);
assert.equal(isPdfFilePath('/tmp/report.pdf.txt'), false);
assert.equal(isPdfFilePath(null), false);
assert.equal(getMimeTypeForMediaPath('/tmp/report.pdf'), 'application/pdf');
assert.equal(mediaPreviewExtensions.has('.pdf'), true);

assert.match(
  mainSource,
  /ipcMain\.handle\('fs:setWatchedFiles'[\s\S]*watchFile\(filePath, \{ persistent: false, interval: 350 \}/,
  'the main process must watch every currently open file'
);
assert.match(
  mainSource,
  /current\.ino === previous\.ino[\s\S]*webContents\.send\('fs:fileChanged'/,
  'atomic file replacement must trigger a renderer refresh'
);
assert.doesNotMatch(
  mainSource,
  /openFileWatchersByRenderer[\s\S]*webContents\.once\('did-start-loading', dispose\)/,
  'child-frame PDF loads must not dispose open-file watchers'
);
assert.match(
  mainSource,
  /did-start-navigation[\s\S]*isMainFrame[\s\S]*if \(isMainFrame && !isInPlace\) dispose\(\)/,
  'top-level renderer navigation must still dispose open-file watchers'
);
assert.match(
  preloadSource,
  /readFileResult:[\s\S]*fs:readFileResult[\s\S]*setWatchedFiles:[\s\S]*fs:setWatchedFiles[\s\S]*onFileChange:/,
  'the preload must expose both sides of the file-change bridge'
);
assert.match(
  workspaceSource,
  /openFile\.isDirty\)[\s\S]*pendingDiskRefreshPathsRef\.current\.add\(filePath\)[\s\S]*readFileResult\(filePath\)[\s\S]*latestFile\.isDirty\)[\s\S]*pendingDiskRefreshPathsRef\.current\.add\(filePath\)/,
  'disk refreshes must preserve dirty buffers and re-check after the asynchronous read'
);
assert.match(
  mainSource,
  /ipcMain\.handle\('fs:readFileResult'[\s\S]*ok: true, content:[\s\S]*ok: false, error:/,
  'watcher reads must distinguish empty content from read failures'
);
assert.match(
  workspaceSource,
  /if \(!result\.ok\)[\s\S]*editor content was kept[\s\S]*refreshOpenFileFromDisk\(filePath, result\.content\)/,
  'failed watcher reads must leave the clean editor buffer unchanged'
);
assert.match(
  workspaceSource,
  /if \(!change\.exists\)[\s\S]*openFile\.isDirty[\s\S]*unsaved changes were kept[\s\S]*closeFile\(change\.path\)[\s\S]*tab was closed/,
  'external deletion must preserve dirty buffers and close clean tabs'
);
assert.match(
  workspaceSource,
  /If a disk change arrived while the user had unsaved edits[\s\S]*!openFile\?\.isDirty\) refreshOpenFilePathFromDisk\(filePath\)/,
  'a disk update skipped for a dirty tab must be applied once that tab is clean'
);
assert.match(
  storeSource,
  /refreshOpenFileFromDisk:[\s\S]*if \(!file \|\| file\.isDirty\) return state;/,
  'the store must refuse to overwrite unsaved editor content'
);
assert.match(
  paneSource,
  /savedContentsRef\.current\.get\(activeFilePath\) !== activeFile\.content[\s\S]*buffersRef\.current\.set\(activeFilePath, activeFile\.content\)/,
  'Monaco cached buffers must adopt refreshed clean content'
);
assert.match(
  workspaceSource,
  /isPdfFilePath\(filePath\) \? '' : await window\.orion\.readFile\(filePath\)/,
  'PDF tabs must bypass UTF-8 file reads'
);
assert.match(
  paneSource,
  /className="pdf-preview"[\s\S]*<iframe[\s\S]*src=\{pdfPreviewSrc\}/,
  'PDF tabs must render the local streamed preview instead of Monaco'
);
assert.match(
  mainSource,
  /path\.extname\(candidate\)\.toLowerCase\(\) === '\.pdf'[\s\S]*\? ''[\s\S]*fs\.readFile\(candidate, 'utf-8'\)/,
  'linked PDFs must also avoid conversion to raw text'
);
assert.match(
  mainSource,
  /webPreferences: \{[\s\S]*plugins: true/,
  'the BrowserWindow must enable Electron\'s built-in PDF viewer'
);

console.log('Code tab tests passed');
