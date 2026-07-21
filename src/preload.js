// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('orion', {
  // App persistence
  loadStore: () => ipcRenderer.invoke('storage:load'),
  saveStore: (value) => ipcRenderer.invoke('storage:save', value),
  clearStore: () => ipcRenderer.invoke('storage:clear'),

  // Dialog
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // File system
  readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (filePath, content = '') => ipcRenderer.invoke('fs:createFile', filePath, content),
  createDirectory: (dirPath) => ipcRenderer.invoke('fs:createDirectory', dirPath),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:deletePath', targetPath),
  renamePath: (oldPath, newPath) => ipcRenderer.invoke('fs:renamePath', oldPath, newPath),
  showFileTreeMenu: (input) => ipcRenderer.invoke('fileTree:showContextMenu', input),
  confirmDeletePath: (input) => ipcRenderer.invoke('fileTree:confirmDelete', input),
  saveImageAttachment: (input) => ipcRenderer.invoke('attachment:saveImage', input),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Git
  getGitState: (projectPath) => ipcRenderer.invoke('git:getState', projectPath),
  checkoutGitBranch: (input) => ipcRenderer.invoke('git:checkoutBranch', input),
  commitAndPush: (projectPath) => ipcRenderer.invoke('git:commitAndPush', projectPath),

  // Agent runtime
  listAgentModels: () => ipcRenderer.invoke('agent:listModels'),
  runAgentTurn: (input) => ipcRenderer.invoke('agent:runTurn', input),
  stopAgentTurn: (runId, options) => ipcRenderer.invoke('agent:stopTurn', runId, options),
  // Codex goal ops (pause/clear/status) for threads with no live goal run.
  codexGoalCommand: (input) => ipcRenderer.invoke('agent:codexGoal', input),
  disposeAgentThread: (threadId) => ipcRenderer.invoke('agent:disposeThread', threadId),
  generateThreadTitle: (input) => ipcRenderer.invoke('agent:generateTitle', input),
  getProviderStatus: () => ipcRenderer.invoke('providers:getStatus'),

  // Claude Code CLI embedded terminal (one PTY per thread, lives in main)
  terminalEnsure: (input) => ipcRenderer.invoke('terminal:ensure', input),
  terminalInput: (input) => ipcRenderer.invoke('terminal:input', input),
  terminalResize: (input) => ipcRenderer.invoke('terminal:resize', input),
  terminalSendPrompt: (input) => ipcRenderer.invoke('terminal:sendPrompt', input),
  terminalKill: (threadId) => ipcRenderer.invoke('terminal:kill', threadId),
  onTerminalData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },
  onTerminalActivity: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:activity', listener);
    return () => ipcRenderer.removeListener('terminal:activity', listener);
  },
  onTerminalSession: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:session', listener);
    return () => ipcRenderer.removeListener('terminal:session', listener);
  },
  checkProviderUpdates: (input) => ipcRenderer.invoke('providers:checkUpdates', input),
  updateProviders: (input) => ipcRenderer.invoke('providers:updateAll', input),
  authenticateProvider: (providerId) => ipcRenderer.invoke('providers:authenticate', providerId),

  // Orion account
  getAccountSession: () => ipcRenderer.invoke('account:getSession'),
  startAccountAuth: () => ipcRenderer.invoke('account:startAuth'),
  signOutAccount: () => ipcRenderer.invoke('account:signOut'),

  // Orion Cloud repositories
  getCloudState: (projectPath) => ipcRenderer.invoke('cloud:getState', projectPath),
  publishToCloud: (input) => ipcRenderer.invoke('cloud:publish', input),
  pushToCloud: (projectPath) => ipcRenderer.invoke('cloud:push', projectPath),
  pullFromCloud: (projectPath) => ipcRenderer.invoke('cloud:pull', projectPath),
  openCloudRepoInBrowser: (projectPath) => ipcRenderer.invoke('cloud:openInBrowser', projectPath),
  openExternalUrl: (url) => ipcRenderer.invoke('app:openExternalUrl', url),

  // Orion board tasks (kanban on the web app)
  listBoardTasks: () => ipcRenderer.invoke('tasks:list'),
  linkBoardTask: (input) => ipcRenderer.invoke('tasks:link', input),
  unlinkBoardTask: (input) => ipcRenderer.invoke('tasks:unlink', input),
  updateBoardTaskThreadStatus: (input) => ipcRenderer.invoke('tasks:threadStatus', input),

  // Orchestration (Orion pseudo-model subagent spawns)
  reportSubagentResult: (payload) => ipcRenderer.invoke('orchestration:subagentResult', payload),
  onSubagentSpawnRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('orchestration:spawnRequest', listener);
    return () => ipcRenderer.removeListener('orchestration:spawnRequest', listener);
  },
  reportSubagentStopResult: (payload) =>
    ipcRenderer.invoke('orchestration:subagentStopResult', payload),
  onSubagentStopRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('orchestration:stopRequest', listener);
    return () => ipcRenderer.removeListener('orchestration:stopRequest', listener);
  },

  // Computer use permissions (macOS TCC)
  getComputerUsePermissions: () => ipcRenderer.invoke('computerUse:getPermissions'),
  requestComputerUsePermission: (kind) => ipcRenderer.invoke('computerUse:requestPermission', kind),
  openChromeDebugSetup: () => ipcRenderer.invoke('computerUse:openChromeDebugSetup'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  focusWindow: () => ipcRenderer.invoke('app:focusWindow'),

  // App updates
  getAppUpdateState: () => ipcRenderer.invoke('appUpdate:getState'),
  checkForAppUpdate: () => ipcRenderer.invoke('appUpdate:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('appUpdate:download'),
  restartToUpdate: () => ipcRenderer.invoke('appUpdate:restart'),

  // Project assets
  findProjectIcon: (projectPath) => ipcRenderer.invoke('project:findIcon', projectPath),

  // Open project in external apps
  listOpenWithApps: () => ipcRenderer.invoke('openWith:listApps'),
  openProjectWith: (input) => ipcRenderer.invoke('openWith:open', input),

  // Path utils
  basename: (p) => ipcRenderer.invoke('path:basename', p),
  dirname: (p) => ipcRenderer.invoke('path:dirname', p),
  join: (...parts) => ipcRenderer.invoke('path:join', ...parts),

  onAgentTurnEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agent:turnEvent', listener);
    return () => ipcRenderer.removeListener('agent:turnEvent', listener);
  },

  // Listen for file changes if needed (future)
  onFileChange: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('fs:fileChanged', listener);
    return () => ipcRenderer.removeListener('fs:fileChanged', listener);
  },

  onAppUpdateState: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('appUpdate:state', listener);
    return () => ipcRenderer.removeListener('appUpdate:state', listener);
  },

  onAccountChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('account:changed', listener);
    return () => ipcRenderer.removeListener('account:changed', listener);
  },
});
