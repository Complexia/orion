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
            updateAuthenticated: boolean;
            updateBlockedReason?: string;
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
            updateAuthenticated: boolean;
            updateBlockedReason?: string;
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
              updateAuthenticated: boolean;
              updateBlockedReason?: string;
            };
            error?: string;
          }>;
        };
      }>;
      authenticateProvider: (providerId: string) => Promise<{
        ok: boolean;
        error?: string;
      }>;
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
        codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
        codexServiceTier?: 'default' | 'priority';
        claudeReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode' | 'ultrathink';
        claudeContextWindow?: '200k' | '1m';
      }) => Promise<{ ok: boolean; runId?: string; error?: string }>;
      stopAgentTurn: (runId: string) => Promise<boolean>;
      generateThreadTitle: (input: {
        prompt: string;
        modelId: string;
        projectPath?: string;
      }) => Promise<string>;
      findProjectIcon: (projectPath: string) => Promise<string | null>;
      basename: (p: string) => Promise<string>;
      dirname: (p: string) => Promise<string>;
      join: (...parts: string[]) => Promise<string>;
      onAgentTurnEvent?: (cb: (event: {
        runId: string;
        threadId: string;
        type: 'started' | 'chunk' | 'activity' | 'error' | 'done';
        chunk?: string;
        exitCode?: number | null;
        error?: string;
        command?: string;
        changedFiles?: Array<{
          path: string;
          status: 'added' | 'copied' | 'conflicted' | 'deleted' | 'modified' | 'renamed' | 'untracked';
          additions: number;
          deletions: number;
        }>;
        activity?: {
          key?: string;
          type: 'thought' | 'command' | 'tool' | 'result' | 'error';
          title: string;
          detail?: string;
          status?: 'running' | 'done' | 'error';
        };
      }) => void) => () => void;
      onFileChange?: (cb: (data: any) => void) => () => void;
      onAppUpdateState?: (cb: (state: AppUpdateState) => void) => () => void;
    };
  }
}
