export {};

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

declare global {
type OrionCloudSyncStatus = 'synced' | 'ahead' | 'behind' | 'diverged' | 'unknown';

type OrionCloudState = {
  ok: boolean;
  authenticated?: boolean;
  linked?: boolean;
  stale?: boolean;
  repoId?: string;
  repoName?: string;
  repo?: { id: string; name: string; defaultBranch: string; generation: number };
  refs?: Array<{ name: string; oid: string }>;
  currentBranch?: string | null;
  sync?: OrionCloudSyncStatus;
  webUrl?: string | null;
  error?: string;
};

type OrionCloudPushResult = {
  ok: boolean;
  alreadyLinked?: boolean;
  upToDate?: boolean;
  conflict?: boolean;
  needsAuth?: boolean;
  pushed?: string[];
  skipped?: Array<{ branch: string; reason: string }>;
  repo?: { id: string; name: string };
  webUrl?: string | null;
  app?: { slug: string; url: string; status: string; error: string | null } | null;
  error?: string;
};

type OrionCloudPullResult = {
  ok: boolean;
  needsAuth?: boolean;
  branches?: Array<{ branch: string; oid?: string; status: string }>;
  merge?: {
    status:
      | 'none'
      | 'up-to-date'
      | 'checked-out'
      | 'fast-forwarded'
      | 'ff-failed'
      | 'local-ahead'
      | 'diverged'
      | 'unborn-dirty';
    to?: string;
    error?: string;
    hint?: string;
  };
  downloadedPacks?: number;
  downloadedLoose?: number;
  error?: string;
};
}

type OrionBoardColumn = {
  id: string;
  name: string;
  role: 'todo' | 'in_progress' | 'review' | 'done' | null;
  position: number;
};

type OrionBoardTask = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  position: number;
  linked: {
    threadId: string;
    threadTitle: string | null;
    projectName: string | null;
    status: string;
    linkedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type OrionBoardResult = {
  ok: boolean;
  error?: string;
  needsAuth?: boolean;
  columns?: OrionBoardColumn[];
  tasks?: OrionBoardTask[];
};

type OrionTaskActionResult = {
  ok: boolean;
  error?: string;
  needsAuth?: boolean;
  /** The task was unlinked or relinked on the web — drop the local link. */
  stale?: boolean;
  task?: OrionBoardTask;
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

declare global {
type OrionComputerUsePermissionKind = 'accessibility' | 'screen-recording' | 'automation';

type OrionComputerUsePermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'unsupported';

type OrionComputerUsePermissions = {
  supported: boolean;
  accessibility: OrionComputerUsePermissionStatus;
  screenRecording: OrionComputerUsePermissionStatus;
  automation: OrionComputerUsePermissionStatus;
};

  interface Window {
    orion: {
      loadStore: () => Promise<string | null>;
      saveStore: (value: string) => Promise<boolean>;
      clearStore: () => Promise<boolean>;
      openDirectory: () => Promise<string | null>;
      readDirectory: (dirPath: string) => Promise<Array<{
        name: string;
        path: string;
        isDirectory: boolean;
        size: number;
        gitStatus: 'added' | 'copied' | 'conflicted' | 'deleted' | 'modified' | 'renamed' | 'untracked' | null;
        gitStatusLabel: string | null;
        hasChildGitStatus: boolean;
      }>>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      createFile: (filePath: string, content?: string) => Promise<boolean>;
      createDirectory: (dirPath: string) => Promise<boolean>;
      deletePath: (targetPath: string) => Promise<boolean>;
      renamePath: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
      showFileTreeMenu: (input: {
        path: string;
        isDirectory: boolean;
        rootPath?: string | null;
      }) => Promise<'new-file' | 'new-folder' | 'rename' | 'delete' | null>;
      confirmDeletePath: (input: { path: string; isDirectory: boolean }) => Promise<boolean>;
      getGitState: (projectPath: string) => Promise<{
        ok: boolean;
        root?: string;
        currentBranch?: string;
        branches: Array<{
          name: string;
          current: boolean;
          hasUpstream: boolean;
        }>;
        hasUncommittedChanges: boolean;
        ahead?: number;
        behind?: number;
        error?: string;
      }>;
      checkoutGitBranch: (input: {
        projectPath: string;
        branchName: string;
        create?: boolean;
      }) => Promise<{
        ok: boolean;
        error?: string;
        state?: {
          ok: boolean;
          root?: string;
          currentBranch?: string;
          branches: Array<{
            name: string;
            current: boolean;
            hasUpstream: boolean;
          }>;
          hasUncommittedChanges: boolean;
          ahead?: number;
          behind?: number;
          error?: string;
        };
      }>;
      commitAndPush: (projectPath: string) => Promise<{
        ok: boolean;
        branch?: string;
        message?: string;
        error?: string;
        state?: {
          ok: boolean;
          root?: string;
          currentBranch?: string;
          branches: Array<{
            name: string;
            current: boolean;
            hasUpstream: boolean;
          }>;
          hasUncommittedChanges: boolean;
          ahead?: number;
          behind?: number;
          error?: string;
        };
      }>;
      getPathForFile?: (file: File) => string;
      saveImageAttachment: (input: {
        name: string;
        mimeType: string;
        data: ArrayBuffer;
      }) => Promise<{
        ok: boolean;
        attachment?: {
          id: string;
          name: string;
          path: string;
          mimeType: string;
          size: number;
        };
        error?: string;
      }>;
      listAgentModels: () => Promise<Array<{
        id: string;
        providerId: 'grok' | 'codex' | 'claude' | 'cursor' | 'opencode';
        providerLabel: string;
        label: string;
        slug: string;
        shortcut?: string;
        favorite?: boolean;
        available: boolean;
        unavailableReason?: string;
      }>>;
      getProviderStatus: () => Promise<{
        checkedAt: string;
        updatesAvailable: number;
        providers: Array<{
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
        }>;
      }>;
      checkProviderUpdates: (input?: { enabledProviderIds?: string[] }) => Promise<{
        checkedAt: string;
        updatesAvailable: number;
        providers: Array<{
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
        }>;
      }>;
      updateProviders: (input?: { enabledProviderIds?: string[] }) => Promise<{
        ok: boolean;
        error?: string;
        results: Array<{
          id: string;
          label: string;
          command: string;
          ok: boolean;
          skipped?: boolean;
          message?: string;
          output?: string;
          error?: string;
        }>;
        state: {
          checkedAt: string;
          updatesAvailable: number;
          providers: Array<{
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
          }>;
        };
      }>;
      authenticateProvider: (providerId: string) => Promise<{
        ok: boolean;
        error?: string;
      }>;
      getAccountSession: () => Promise<OrionAccountState>;
      startAccountAuth: () => Promise<{
        ok: boolean;
        url?: string;
        error?: string;
      }>;
      signOutAccount: () => Promise<OrionAccountState>;
      getCloudState: (projectPath: string) => Promise<OrionCloudState>;
      publishToCloud: (input: { projectPath: string; name?: string }) => Promise<OrionCloudPushResult>;
      pushToCloud: (projectPath: string) => Promise<OrionCloudPushResult>;
      pullFromCloud: (projectPath: string) => Promise<OrionCloudPullResult>;
      openCloudRepoInBrowser: (projectPath: string) => Promise<{ ok: boolean; error?: string }>;
      listBoardTasks: () => Promise<OrionBoardResult>;
      linkBoardTask: (input: {
        taskId: string;
        threadId: string;
        threadTitle?: string;
        projectName?: string;
      }) => Promise<OrionTaskActionResult>;
      unlinkBoardTask: (input: { taskId: string; threadId: string }) => Promise<OrionTaskActionResult>;
      updateBoardTaskThreadStatus: (input: {
        taskId: string;
        threadId: string;
        status: 'running' | 'finished' | 'done' | 'error';
      }) => Promise<OrionTaskActionResult>;
      getComputerUsePermissions: () => Promise<OrionComputerUsePermissions>;
      requestComputerUsePermission: (kind: OrionComputerUsePermissionKind) => Promise<{
        ok: boolean;
        error?: string;
        state?: OrionComputerUsePermissions;
      }>;
      openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
      relaunchApp: () => Promise<boolean>;
      getAppUpdateState: () => Promise<AppUpdateState>;
      checkForAppUpdate: () => Promise<AppUpdateState>;
      downloadAppUpdate: () => Promise<AppUpdateState>;
      restartToUpdate: () => Promise<boolean>;
      runAgentTurn: (input: {
        runId?: string;
        threadId: string;
        projectPath: string;
        prompt: string;
        modelId: string;
        accessMode: 'read-only' | 'workspace-write' | 'full-access';
        codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'ultra';
        codexServiceTier?: 'default' | 'priority';
        claudeReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode' | 'ultrathink';
        claudeContextWindow?: '200k' | '1m';
        grokReasoningEffort?: 'low' | 'medium' | 'high';
        resumeSessionId?: string;
        /** Fork resumeSessionId into a new session instead of resuming it in place (branched threads). */
        forkSession?: boolean;
        providerOptions?: {
          allowedTools?: string;
          networkAccess?: boolean;
          webSearch?: boolean;
          experimentalMemory?: boolean;
          extraArgs?: string;
        };
      }) => Promise<{ ok: boolean; runId?: string; error?: string }>;
      stopAgentTurn: (runId: string) => Promise<boolean>;
      generateThreadTitle: (input: {
        prompt: string;
        modelId: string;
        projectPath?: string;
      }) => Promise<string>;
      findProjectIcon: (projectPath: string) => Promise<string | null>;
      listOpenWithApps: () => Promise<Array<{ id: string; name: string; icon: string | null }>>;
      openProjectWith: (input: { appId: string; projectPath: string }) => Promise<{ ok: boolean; error?: string }>;
      basename: (p: string) => Promise<string>;
      dirname: (p: string) => Promise<string>;
      join: (...parts: string[]) => Promise<string>;
      onAgentTurnEvent?: (cb: (event: {
        runId: string;
        threadId: string;
        type: 'started' | 'chunk' | 'activity' | 'session' | 'error' | 'done';
        chunk?: string;
        exitCode?: number | null;
        error?: string;
        command?: string;
        providerId?: string;
        sessionId?: string;
        changedFiles?: Array<{
          path: string;
          status: 'added' | 'copied' | 'conflicted' | 'deleted' | 'modified' | 'renamed' | 'untracked';
          additions: number;
          deletions: number;
        }>;
        stats?: {
          totalTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
          cachedReadTokens?: number;
          reasoningTokens?: number;
          modelId?: string;
        };
        activity?: {
          key?: string;
          type: 'thought' | 'command' | 'tool' | 'result' | 'error' | 'plan';
          kind?: string;
          title: string;
          detail?: string;
          output?: string;
          exitCode?: number;
          diff?: { path: string; additions: number; deletions: number };
          sources?: Array<{ url: string; title?: string }>;
          plan?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
          status?: 'running' | 'done' | 'error' | 'waiting';
        };
      }) => void) => () => void;
      onFileChange?: (cb: (data: any) => void) => () => void;
      onAppUpdateState?: (cb: (state: AppUpdateState) => void) => () => void;
      onAccountChanged?: (cb: (state: OrionAccountState) => void) => () => void;
    };
  }
}
