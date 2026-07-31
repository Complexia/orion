import type { Epic } from '../store';
import type { RiftStorageEntry } from '../types';

export type EpicPrStatus = 'open' | 'merged' | 'closed';

export type NewEpicRiftBranches = {
  projectId: string;
  currentBranch: string | null;
  branches: string[];
};

export type EpicCommitDialogState = {
  epic: Epic;
  message: string;
};

export type EpicPrBaseDialogState = {
  instanceId: number;
  epic: Epic;
  branches: string[];
  branchesLoading: boolean;
  branchesError: string;
  defaultBranch: string;
  sourceBranch: string;
  baseBranch: string;
  message: string;
};

export type EpicSettleDialogState = {
  epic: Epic;
  warnings: string[];
  canReleaseRift: boolean;
  releaseRift: boolean;
};

export type RiftSweepDialogState = {
  entries: RiftStorageEntry[];
  runGc: boolean;
  /** Unpublished-work overrides this confirmation is allowed to grant. */
  forcePaths: string[];
  /** Scan-listed paths the user selected individually, regardless of lifecycle or marker status. */
  manualPaths?: string[];
  /** Successful Storage scan whose rows this dialog displayed. */
  manualScanId?: string;
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
  hasUpstream: boolean;
};

export type GitRepoState = {
  ok: boolean;
  root?: string;
  currentBranch?: string | null;
  detachedHead?: string | null;
  branches: GitBranchInfo[];
  hasUncommittedChanges: boolean;
  ahead?: number;
  behind?: number;
  error?: string;
};

export type ProviderUpdateItem = {
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
};

export type ProviderUpdateState = {
  checkedAt: string;
  updatesAvailable: number;
  providers: ProviderUpdateItem[];
};

export type AppUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'not-available' | 'error';
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

export type OrionAccountState = {
  authenticated: boolean;
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    imageUrl?: string | null;
  } | null;
  expiresAt: string | null;
};

/**
 * Workspace sync engine status pushed from main (sync:state). Null until the
 * first status arrives; the engine is inert while the setting is off.
 */
export type WorkspaceSyncStatus = {
  enabled: boolean;
  authenticated: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  backfillDone: boolean;
  counts: {
    projects: number;
    epics: number;
    threads: number;
    transcriptsUploaded: number;
    codePushes: number;
  } | null;
};

export type SettingsTab =
  | 'account'
  | 'cloud-sync'
  | 'general'
  | 'providers'
  | 'orchestration'
  | 'split-view'
  | 'computer-use'
  | 'storage'
  | 'cosmetics'
  | 'experimental';
