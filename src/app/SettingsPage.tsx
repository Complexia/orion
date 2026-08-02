import React from 'react';
import {
  ChevronDown,
  Cloud,
  Columns2,
  FlaskConical,
  GitPullRequest,
  HardDrive,
  LogIn,
  LogOut,
  MousePointerClick,
  Palette,
  Play,
  Plug,
  RefreshCw,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
  SquareKanban,
  Trash2,
  UserRound,
  Workflow,
} from 'lucide-react';
import {
  defaultEpicsSettings,
  defaultRiftsSettings,
  defaultSplitViewSettings,
  MAX_THREAD_PANES,
  type Epic,
  type EpicsSettings,
  type NotificationSettings,
  type OrchestrationRoleId,
  type OrchestrationSettings,
  type ProviderId,
  type ProviderRuntimeOptions,
  type ProviderSettings,
  type RiftsSettings,
  type SavedView,
  type SplitViewSettings,
  type TextGenerationSettings,
  type WorkspaceSyncSettings,
} from '../store';
import {
  agentProviders,
  providerOptionDefs,
  type AgentModel,
  type AgentProvider,
  type AgentProviderId,
} from '../agentCatalog';
import type { RiftStorageEntry, RiftStorageState } from '../types';
import { ModelPickerPopover } from './ModelPickerPopover';
import { SelectMenu } from './SelectMenu';
import SkillsSettings from './SkillsSettings';
import { orchestrationRoleMeta } from './promptContext';
import { formatShortTime } from './time';
import type {
  AppUpdateState,
  EpicPrStatus,
  OrionAccountState,
  ProviderUpdateItem,
  ProviderUpdateState,
  RiftSweepDialogState,
  SettingsTab,
  WorkspaceSyncStatus,
} from './appTypes';

// Settings remains controlled by App because its asynchronous account, update,
// and Rift operations are shared with the shell. Keeping that integration in a
// single view model avoids creating a second set of store subscriptions here.
export type SettingsPageProps = {
  notificationSettings: NotificationSettings;
  setNotificationSettings: (updates: Partial<NotificationSettings>) => void;
  setTextGenerationSettings: (updates: Partial<TextGenerationSettings>) => void;
  setEpicsSettings: (updates: Partial<EpicsSettings>) => void;
  epicsSettings: EpicsSettings;
  splitViewSettings: SplitViewSettings;
  setSplitViewSettings: (updates: Partial<SplitViewSettings>) => void;
  savedViews: SavedView[];
  deleteSavedView: (id: string) => void;
  providerSettings: ProviderSettings;
  setProviderEnabled: (id: ProviderId, enabled: boolean) => void;
  setProviderOptions: (id: ProviderId, options: Partial<ProviderRuntimeOptions>) => void;
  setOrchestrationRoleModel: (role: OrchestrationRoleId, modelId: string) => void;
  setOrchestrationGeneralInstructions: (text: string) => void;
  riftsSettings: RiftsSettings;
  setRiftsSettings: (updates: Partial<RiftsSettings>) => void;
  workspaceSyncSettings: WorkspaceSyncSettings;
  setWorkspaceSyncSettings: (updates: Partial<WorkspaceSyncSettings>) => void;
  workspaceSyncStatus: WorkspaceSyncStatus | null;
  handleWorkspaceSyncNow: () => void;
  setUtilityModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  utilityModelPickerOpen: boolean;
  setUtilityModelSearch: React.Dispatch<React.SetStateAction<string>>;
  utilityModelSearch: string;
  setUtilityModelTab: React.Dispatch<React.SetStateAction<AgentProviderId>>;
  utilityModelTab: AgentProviderId;
  riftStatus: {
    available: boolean;
    version?: string | null;
    pendingEpicIds?: string[];
    pendingRemovalEpicIds?: string[];
    readyRifts?: Array<{
      epicId: string;
      projectId?: string;
      projectPath: string;
      riftPath: string;
      riftWorkingDir: string;
      gitRoot?: string;
      branch?: string;
    }>;
  } | null;
  riftStorageState: RiftStorageState | null;
  riftStorageBusy: boolean;
  riftStorageForced: Record<string, boolean>;
  setRiftStorageForced: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setRiftSweepDialog: React.Dispatch<React.SetStateAction<RiftSweepDialogState | null>>;
  riftStorageEntries: RiftStorageEntry[];
  riftStorageSummary: {
    total: number;
    active: number;
    settled: number;
    orphan: number;
    trash: number;
  };
  riftSweepSelection: RiftStorageEntry[];
  providerUpdateState: ProviderUpdateState | null;
  providerUpdatesChecking: boolean;
  providerUpdatesRunning: boolean;
  appUpdateState: AppUpdateState | null;
  appUpdateBusy: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsTab: SettingsTab;
  setSettingsTab: React.Dispatch<React.SetStateAction<SettingsTab>>;
  /** Opens a skill's folder in the Code tab with its SKILL.md active. */
  handleOpenSkillInEditor: (skill: { path: string; skillFile?: string; name: string }) => void;
  authenticatingProviderId: string | null;
  accountState: OrionAccountState;
  accountLoading: boolean;
  accountBusy: boolean;
  computerUsePerms: OrionComputerUsePermissions | null;
  computerUseBusyKind: OrionComputerUsePermissionKind | null;
  revealedProviderEmails: Record<string, boolean>;
  setRevealedProviderEmails: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setRevealedAccountIdentity: React.Dispatch<React.SetStateAction<string | null>>;
  expandedProviderOptions: Record<string, boolean>;
  setExpandedProviderOptions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  utilityModelPickerRef: React.RefObject<HTMLDivElement | null>;
  normalizedProviderSettings: ProviderSettings;
  normalizedOrchestrationSettings: OrchestrationSettings;
  orchestrationModelGroups: Array<{ provider: AgentProvider; models: AgentModel[] }>;
  providerStatusById: Map<string, ProviderUpdateItem>;
  accountName: string;
  accountEmail: string | null;
  accountIdentity: string | null;
  accountEmailRevealed: boolean;
  accountInitials: string;
  epicsEnabled: boolean;
  epicPromptGitMessages: boolean;
  archivedEpics: Epic[];
  utilityCandidateModels: AgentModel[];
  utilityProviders: AgentProvider[];
  resolvedUtilityModelId: string | null;
  resolvedUtilityModel: AgentModel | null;
  utilityModelProviderId: AgentProviderId | null;
  utilityReasoningOptions: Array<{ value: string; label: string }>;
  resolvedUtilityReasoningEffort: string | null;
  refreshProviderUpdates: () => Promise<void>;
  handleAppUpdateClick: () => Promise<void>;
  handleRequestComputerUsePermission: (kind: OrionComputerUsePermissionKind) => Promise<void>;
  handleOpenChromeDebugSetup: () => Promise<void>;
  handleStartAccountAuth: () => Promise<void>;
  handleSignOutAccount: () => Promise<void>;
  handleAuthenticateProvider: (providerId: string) => Promise<void>;
  openEpicPrUrl: (prUrl: string) => void;
  handleDeleteEpic: (epic: Epic) => Promise<void>;
  handleRestoreEpic: (epic: Epic) => void;
  formatCheckedTime: (iso: string) => string;
  formatBytes: (bytes: number | null | undefined) => string;
  epicPrStatus: (epic: Pick<Epic, 'prUrl' | 'prState'> | null | undefined) => EpicPrStatus | null;
};

const SettingsPage = React.memo(function SettingsPage(props: SettingsPageProps) {
  const {
    notificationSettings,
    setNotificationSettings,
    setTextGenerationSettings,
    setEpicsSettings,
    epicsSettings,
    splitViewSettings,
    setSplitViewSettings,
    savedViews,
    deleteSavedView,
    providerSettings,
    setProviderEnabled,
    setProviderOptions,
    setOrchestrationRoleModel,
    setOrchestrationGeneralInstructions,
    riftsSettings,
    setRiftsSettings,
    workspaceSyncSettings,
    setWorkspaceSyncSettings,
    workspaceSyncStatus,
    handleWorkspaceSyncNow,
    setUtilityModelPickerOpen,
    utilityModelPickerOpen,
    setUtilityModelSearch,
    utilityModelSearch,
    setUtilityModelTab,
    utilityModelTab,
    riftStatus,
    riftStorageState,
    riftStorageBusy,
    riftStorageForced,
    setRiftStorageForced,
    setRiftSweepDialog,
    riftStorageEntries,
    riftStorageSummary,
    riftSweepSelection,
    providerUpdateState,
    providerUpdatesChecking,
    providerUpdatesRunning,
    appUpdateState,
    appUpdateBusy,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    handleOpenSkillInEditor,
    authenticatingProviderId,
    accountState,
    accountLoading,
    accountBusy,
    computerUsePerms,
    computerUseBusyKind,
    revealedProviderEmails,
    setRevealedProviderEmails,
    setRevealedAccountIdentity,
    expandedProviderOptions,
    setExpandedProviderOptions,
    utilityModelPickerRef,
    normalizedProviderSettings,
    normalizedOrchestrationSettings,
    orchestrationModelGroups,
    providerStatusById,
    accountName,
    accountEmail,
    accountIdentity,
    accountEmailRevealed,
    accountInitials,
    epicsEnabled,
    epicPromptGitMessages,
    archivedEpics,
    utilityCandidateModels,
    utilityProviders,
    resolvedUtilityModelId,
    resolvedUtilityModel,
    utilityModelProviderId,
    utilityReasoningOptions,
    resolvedUtilityReasoningEffort,
    refreshProviderUpdates,
    handleAppUpdateClick,
    handleRequestComputerUsePermission,
    handleOpenChromeDebugSetup,
    handleStartAccountAuth,
    handleSignOutAccount,
    handleAuthenticateProvider,
    openEpicPrUrl,
    handleDeleteEpic,
    handleRestoreEpic,
    formatCheckedTime,
    formatBytes,
    epicPrStatus,
  } = props;
  const appUpdatePercent = Math.max(0, Math.min(100, Math.round(appUpdateState?.progress?.percent ?? 0)));
  const appUpdateStatus =
    appUpdateState?.status === 'checking'
      ? 'Checking for updates...'
      : appUpdateState?.status === 'available'
        ? `Orion v${appUpdateState.availableVersion ?? 'next'} is available.`
        : appUpdateState?.status === 'downloading'
          ? `Downloading Orion v${appUpdateState.availableVersion ?? 'next'} — ${appUpdatePercent}%`
          : appUpdateState?.status === 'downloaded'
            ? `Orion v${appUpdateState.availableVersion ?? 'next'} is ready to install.`
            : appUpdateState?.status === 'restarting'
              ? 'Restarting Orion to install the update...'
              : appUpdateState?.status === 'not-available'
                ? `Orion is up to date.${
                    appUpdateState.checkedAt ? ` Checked ${formatCheckedTime(appUpdateState.checkedAt)}.` : ''
                  }`
                : appUpdateState?.status === 'error'
                  ? (appUpdateState.error ?? 'Could not check for updates.')
                  : 'Check for a newer version of Orion.';
  const appUpdateActionLabel =
    appUpdateState?.status === 'checking'
      ? 'Checking...'
      : appUpdateState?.status === 'available'
        ? appUpdateState.availableVersion
          ? `Update to v${appUpdateState.availableVersion}`
          : 'Update Orion'
        : appUpdateState?.status === 'downloading'
          ? `Downloading ${appUpdatePercent}%`
          : appUpdateState?.status === 'downloaded'
            ? 'Restart to update'
            : appUpdateState?.status === 'restarting'
              ? 'Restarting...'
              : appUpdateState?.status === 'error'
                ? 'Try again'
                : 'Check for updates';
  const appUpdateActionDisabled =
    !appUpdateState ||
    appUpdateBusy ||
    appUpdateState.status === 'checking' ||
    appUpdateState.status === 'downloading' ||
    appUpdateState.status === 'restarting';

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        <div className="settings-sidebar-header">
          <Settings size={16} />
          <span>Settings</span>
        </div>
        <div className="settings-nav">
          {[
            { id: 'account', label: 'Account', Icon: UserRound },
            { id: 'cloud-sync', label: 'Cloud Sync', Icon: Cloud },
            { id: 'general', label: 'General', Icon: Settings },
            { id: 'providers', label: 'Providers', Icon: Plug },
            { id: 'orchestration', label: 'Orchestration', Icon: Workflow },
            { id: 'skills', label: 'Skills', Icon: Sparkles },
            { id: 'split-view', label: 'Split View', Icon: Columns2 },
            {
              id: 'computer-use',
              label: 'Computer Use',
              Icon: MousePointerClick,
            },
            { id: 'storage', label: 'Storage', Icon: HardDrive },
            { id: 'cosmetics', label: 'Cosmetics', Icon: Palette },
            { id: 'experimental', label: 'Experimental', Icon: FlaskConical },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`settings-nav-item ${settingsTab === id ? 'active' : ''}`}
              onClick={() => setSettingsTab(id as SettingsTab)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="settings-sidebar-footer">
          <button type="button" className="settings-back-button" onClick={() => setSettingsOpen(false)}>
            ← Back
          </button>
        </div>
      </div>

      <div className="settings-content">
        <div className="settings-content-header">
          {settingsTab === 'account' && 'ACCOUNT'}
          {settingsTab === 'cloud-sync' && 'CLOUD SYNC'}
          {settingsTab === 'general' && 'GENERAL'}
          {settingsTab === 'providers' && 'PROVIDERS'}
          {settingsTab === 'orchestration' && 'ORCHESTRATION'}
          {settingsTab === 'skills' && 'SKILLS'}
          {settingsTab === 'split-view' && 'SPLIT VIEW'}
          {settingsTab === 'computer-use' && 'COMPUTER USE'}
          {settingsTab === 'storage' && 'STORAGE'}
          {settingsTab === 'cosmetics' && 'COSMETICS'}
          {settingsTab === 'experimental' && 'EXPERIMENTAL'}
        </div>

        <div
          className={`settings-panel${settingsTab === 'general' || settingsTab === 'experimental' || settingsTab === 'storage' || settingsTab === 'skills' ? ' settings-panel-grouped' : ''}`}
        >
          {settingsTab === 'account' && (
            <>
              <div className="account-row">
                <div className="account-card-main">
                  {accountState.user?.imageUrl ? (
                    <img className="account-avatar" src={accountState.user.imageUrl} alt="" aria-hidden />
                  ) : (
                    <div className="account-avatar account-avatar-fallback">{accountInitials || 'O'}</div>
                  )}
                  <div className="account-card-text">
                    <div className="account-card-title">{accountName}</div>
                    <div className="account-card-subtitle">
                      {accountLoading ? (
                        'Checking Orion account...'
                      ) : accountState.authenticated ? (
                        accountEmail ? (
                          <button
                            type="button"
                            className={`account-email-toggle${accountEmailRevealed ? ' revealed' : ''}`}
                            onClick={() =>
                              setRevealedAccountIdentity((current) =>
                                current === accountIdentity ? null : accountIdentity
                              )
                            }
                            title={accountEmailRevealed ? 'Click to hide email' : 'Click to reveal email'}
                            aria-label={accountEmailRevealed ? 'Hide email address' : 'Reveal email address'}
                          >
                            {accountEmail}
                          </button>
                        ) : (
                          'Signed in to Orion Web'
                        )
                      ) : (
                        'Sign in through Orion Web to authorize this desktop app.'
                      )}
                    </div>
                  </div>
                </div>
                <span className={`account-status-chip ${accountState.authenticated ? 'signed-in' : ''}`}>
                  {accountLoading ? 'Checking' : accountState.authenticated ? 'Signed in' : 'Signed out'}
                </span>
              </div>

              {accountState.authenticated && (
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Desktop session</div>
                    <div className="setting-label-desc">
                      Authorized by Orion Web
                      {accountState.expiresAt ? ` until ${formatCheckedTime(accountState.expiresAt)}` : ''}.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="provider-auth-button"
                    onClick={handleSignOutAccount}
                    disabled={accountBusy}
                  >
                    <LogOut size={13} />
                    Sign out
                  </button>
                </div>
              )}

              {!accountState.authenticated && (
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Authorize Orion Desktop</div>
                    <div className="setting-label-desc">
                      Opens Orion Web in your browser and returns here after approval.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="provider-auth-button account-primary-button"
                    onClick={handleStartAccountAuth}
                    disabled={accountBusy || accountLoading}
                  >
                    <LogIn size={13} />
                    {accountBusy ? 'Opening...' : 'Sign in'}
                  </button>
                </div>
              )}
            </>
          )}

          {settingsTab === 'cloud-sync' && (
            <>
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-title">Sync workspace to Orion Web</div>
                  <div className="setting-label-desc">
                    Off by default. When enabled, your projects, epics, threads (full transcripts
                    including every agent step and tool call), and token usage sync to your Orion
                    account so you can browse them at Orion Web → Usage. The first enable backfills
                    everything in the background.
                    {!accountState.authenticated &&
                      (workspaceSyncSettings.enabled
                        ? ' Sync is paused while signed out. You can turn it off now or sign in to resume.'
                        : ' Sign in on the Account tab to enable.')}
                  </div>
                </div>
                <label
                  className="provider-toggle"
                  title={
                    accountState.authenticated
                      ? 'Sync projects, threads, and usage to Orion Web'
                      : workspaceSyncSettings.enabled
                        ? 'Turn off workspace sync'
                        : 'Sign in to your Orion account first'
                  }
                >
                  <input
                    type="checkbox"
                    checked={workspaceSyncSettings.enabled}
                    disabled={!accountState.authenticated && !workspaceSyncSettings.enabled}
                    onChange={(e) => setWorkspaceSyncSettings({ enabled: e.target.checked })}
                  />
                  <span />
                </label>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-title">Sync code</div>
                  <div className="setting-label-desc">
                    Publish each git project as a private Orion Cloud repo and push new commits
                    automatically, keeping the full history and diffs.
                  </div>
                </div>
                <label className="provider-toggle" title="Auto-publish and push git projects">
                  <input
                    type="checkbox"
                    checked={workspaceSyncSettings.syncCode}
                    disabled={!accountState.authenticated || !workspaceSyncSettings.enabled}
                    onChange={(e) => setWorkspaceSyncSettings({ syncCode: e.target.checked })}
                  />
                  <span />
                </label>
              </div>

              {workspaceSyncSettings.enabled && accountState.authenticated && (
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Status</div>
                    <div className="setting-label-desc">
                      {workspaceSyncStatus?.lastError
                        ? `Last sync failed: ${workspaceSyncStatus.lastError}`
                        : workspaceSyncStatus?.syncing
                          ? workspaceSyncStatus.backfillDone
                            ? 'Syncing…'
                            : 'Backfilling existing projects and threads…'
                          : workspaceSyncStatus?.lastSyncAt
                            ? `Synced ${formatCheckedTime(workspaceSyncStatus.lastSyncAt)}${
                                workspaceSyncStatus.counts
                                  ? ` — ${workspaceSyncStatus.counts.threads} threads, ${workspaceSyncStatus.counts.projects} projects`
                                  : ''
                              }`
                            : 'Waiting for first sync.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="provider-auth-button"
                    onClick={handleWorkspaceSyncNow}
                    disabled={Boolean(workspaceSyncStatus?.syncing)}
                  >
                    <RefreshCw size={13} />
                    {workspaceSyncStatus?.syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                </div>
              )}
            </>
          )}

          {settingsTab === 'general' && (
            <>
              <div className="settings-group-label">Appearance</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Theme</div>
                    <div className="setting-label-desc">Choose how Orion looks across the app. Coming soon.</div>
                  </div>
                  <select className="setting-select" defaultValue="system" disabled>
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Time format</div>
                    <div className="setting-label-desc">
                      System default follows your browser or OS clock preference. Coming soon.
                    </div>
                  </div>
                  <select className="setting-select" defaultValue="system" disabled>
                    <option value="system">System default</option>
                    <option value="12h">12-hour</option>
                    <option value="24h">24-hour</option>
                  </select>
                </div>
              </div>

              <div className="settings-group-label">Content</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Word wrap</div>
                    <div className="setting-label-desc">
                      Wrap long lines in code blocks, tables, diffs, and file previews by default. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Word wrap">
                    <input type="checkbox" defaultChecked disabled />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Hide whitespace changes</div>
                    <div className="setting-label-desc">
                      Set whether the diff panel ignores whitespace-only edits by default. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Hide whitespace">
                    <input type="checkbox" defaultChecked disabled />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Assistant output</div>
                    <div className="setting-label-desc">
                      Show token-by-token output while a response is in progress. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Assistant output">
                    <input type="checkbox" disabled />
                    <span />
                  </label>
                </div>
              </div>

              <div className="settings-group-label">Notifications</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Thread notifications</div>
                    <div className="setting-label-desc">
                      Show a desktop notification when an agent thread finishes while you're looking elsewhere.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Thread notifications">
                    <input
                      type="checkbox"
                      checked={notificationSettings?.enabled ?? true}
                      onChange={(e) => setNotificationSettings({ enabled: e.target.checked })}
                    />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Notification sound</div>
                    <div className="setting-label-desc">Play the system sound with thread-finished notifications.</div>
                  </div>
                  <label className="provider-toggle" title="Notification sound">
                    <input
                      type="checkbox"
                      checked={notificationSettings?.sound ?? true}
                      disabled={!(notificationSettings?.enabled ?? true)}
                      onChange={(e) => setNotificationSettings({ sound: e.target.checked })}
                    />
                    <span />
                  </label>
                </div>
              </div>

              <div className="settings-group-label">Threads</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">New threads</div>
                    <div className="setting-label-desc">
                      Pick the default workspace mode for newly created draft threads. Coming soon.
                    </div>
                  </div>
                  <select className="setting-select" defaultValue="local" disabled>
                    <option value="local">Local</option>
                    <option value="remote">Remote</option>
                  </select>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Archive confirmation</div>
                    <div className="setting-label-desc">
                      Require a second click on the inline archive action before a thread is archived. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Archive confirmation">
                    <input type="checkbox" disabled />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Delete confirmation</div>
                    <div className="setting-label-desc">
                      Ask before deleting a thread and its chat history. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Delete confirmation">
                    <input type="checkbox" defaultChecked disabled />
                    <span />
                  </label>
                </div>
              </div>

              <div className="settings-group-label">Providers</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Provider update checks</div>
                    <div className="setting-label-desc">
                      Check installed provider CLIs for newer available versions. Coming soon.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Provider update checks">
                    <input type="checkbox" defaultChecked disabled />
                    <span />
                  </label>
                </div>
              </div>

              <div className="settings-group-label">Text generation</div>
              <div className="settings-group settings-group-overflowing">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Model</div>
                    <div className="setting-label-desc">
                      Writes Orion's short generated text: thread titles, epic commit messages from staged changes, and
                      PR descriptions from branch changes. Defaults to the fastest model on the providers you have
                      installed.
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="model-picker-anchor" ref={utilityModelPickerRef}>
                      <button
                        className="model-trigger"
                        onClick={() => {
                          setUtilityModelPickerOpen((open) => {
                            if (!open) {
                              setUtilityModelSearch('');
                              // Open on the resolved model's provider, or the
                              // first one with rows if nothing resolved.
                              setUtilityModelTab(utilityModelProviderId ?? utilityProviders[0]?.id ?? 'codex');
                            }
                            return !open;
                          });
                        }}
                      >
                        {resolvedUtilityModel &&
                          (() => {
                            const ProviderIcon =
                              agentProviders.find((provider) => provider.id === resolvedUtilityModel.providerId)
                                ?.icon ?? Play;
                            return <ProviderIcon size={15} />;
                          })()}
                        <span>{resolvedUtilityModel?.label ?? 'No model available'}</span>
                        <ChevronDown
                          size={14}
                          className={`model-trigger-chevron ${utilityModelPickerOpen ? 'open' : ''}`}
                        />
                      </button>

                      {utilityModelPickerOpen && (
                        <ModelPickerPopover
                          placement="below"
                          className="compact"
                          providers={utilityProviders}
                          models={utilityCandidateModels}
                          activeProviderId={utilityModelTab}
                          onActiveProviderChange={setUtilityModelTab}
                          search={utilityModelSearch}
                          onSearchChange={setUtilityModelSearch}
                          selectedModelId={resolvedUtilityModelId}
                          onSelect={(model) => {
                            setTextGenerationSettings({ modelId: model.id });
                            setUtilityModelPickerOpen(false);
                            setUtilityModelSearch('');
                          }}
                        />
                      )}
                    </div>

                    {utilityReasoningOptions.length > 0 && (
                      <SelectMenu
                        label="Reasoning effort"
                        value={resolvedUtilityReasoningEffort}
                        options={utilityReasoningOptions}
                        onChange={(value) => setTextGenerationSettings({ reasoningEffort: value })}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="settings-group-label">Epics</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Epics section</div>
                    <div className="setting-label-desc">
                      Show Epics in the sidebar — big-ticket tasks that group threads and can commit, push, and open PRs
                      for the work as a whole.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Epics section">
                    <input
                      type="checkbox"
                      checked={epicsEnabled}
                      onChange={(e) => setEpicsSettings({ enabled: e.target.checked })}
                    />
                    <span />
                  </label>
                </div>

                {epicsEnabled && (
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Settle confirmation</div>
                      <div className="setting-label-desc">
                        Ask before every settlement. Orion still warns when work may be archived without a commit, push,
                        or pull request.
                      </div>
                    </div>
                    <label className="provider-toggle" title="Settle confirmation">
                      <input
                        type="checkbox"
                        checked={epicsSettings?.confirmSettle ?? defaultEpicsSettings.confirmSettle}
                        onChange={(e) => setEpicsSettings({ confirmSettle: e.target.checked })}
                      />
                      <span />
                    </label>
                  </div>
                )}

                {epicsEnabled && archivedEpics.length > 0 && (
                  <div className="setting-row setting-row-stacked">
                    <div className="setting-label">
                      <div className="setting-label-title">Archived epics</div>
                      <div className="setting-label-desc">
                        Settled epics land here. Restore one to bring it back to the sidebar.
                      </div>
                    </div>
                    <div className="archived-epics-list">
                      {archivedEpics.map((epic) => {
                        const prStatus = epicPrStatus(epic);
                        return (
                          <div key={epic.id} className="archived-epic-row">
                            <SquareKanban
                              size={13}
                              className={`epic-icon ${prStatus ? `epic-icon--${prStatus}` : ''}`}
                            />
                            <span className="archived-epic-name truncate" title={epic.name}>
                              {epic.name}
                            </span>
                            <span className="archived-epic-date">
                              Settled {formatShortTime(new Date(epic.settledAt ?? epic.createdAt))}
                            </span>
                            {epic.riftReleased && (
                              <span
                                className="provider-status-chip"
                                title="Its rift was freed to reclaim disk. Restoring recreates it on the same branch."
                              >
                                Rift freed
                              </span>
                            )}
                            {epic.prUrl && (
                              <button
                                type="button"
                                className="archived-epic-action"
                                title="Open the pull request"
                                onClick={() => openEpicPrUrl(epic.prUrl as string)}
                              >
                                <GitPullRequest size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="archived-epic-action"
                              title={
                                epic.riftReleased
                                  ? 'Restore to the sidebar and recreate its rift'
                                  : 'Restore to the sidebar'
                              }
                              onClick={() => handleRestoreEpic(epic)}
                            >
                              <RefreshCw size={13} />
                            </button>
                            <button
                              type="button"
                              className="archived-epic-action danger"
                              title="Delete epic"
                              onClick={() => handleDeleteEpic(epic)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-group-label">About</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Orion v{appUpdateState?.currentVersion ?? '—'}</div>
                    <div
                      className={`setting-label-desc${
                        appUpdateState?.status === 'error' ? ' setting-update-error' : ''
                      }`}
                      role={appUpdateState?.status === 'error' ? 'alert' : 'status'}
                    >
                      {appUpdateStatus}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="provider-auth-button settings-update-button"
                    onClick={() => {
                      void handleAppUpdateClick();
                    }}
                    disabled={appUpdateActionDisabled}
                    aria-busy={
                      appUpdateState?.status === 'checking' ||
                      appUpdateState?.status === 'downloading' ||
                      appUpdateState?.status === 'restarting'
                    }
                  >
                    <RefreshCw
                      size={13}
                      className={
                        appUpdateState?.status === 'checking' || appUpdateState?.status === 'restarting'
                          ? 'spinning'
                          : ''
                      }
                    />
                    {appUpdateActionLabel}
                  </button>
                </div>
              </div>
            </>
          )}

          {settingsTab === 'providers' && (
            <>
              <div className="providers-toolbar">
                <div className="providers-toolbar-actions">
                  {providerUpdateState?.checkedAt && (
                    <span className="providers-checked">
                      Checked {formatCheckedTime(providerUpdateState.checkedAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="providers-action-btn"
                    title="Check installed provider CLIs for updates"
                    onClick={() => {
                      void refreshProviderUpdates();
                    }}
                    disabled={providerUpdatesChecking || providerUpdatesRunning}
                    aria-busy={providerUpdatesChecking}
                  >
                    <RefreshCw size={13} className={providerUpdatesChecking ? 'spinning' : ''} />
                    <span>{providerUpdatesChecking ? 'Checking...' : 'Check for updates'}</span>
                  </button>
                </div>
              </div>
              {agentProviders
                // Orion is a pseudo-provider (the orchestrator), not an
                // installable CLI — no row in Providers.
                .filter((provider) => provider.id !== 'orion')
                .map((provider) => {
                  const Icon = provider.icon;
                  const status = providerStatusById.get(provider.id);
                  const providerEnabled = normalizedProviderSettings[provider.id as ProviderId]?.enabled !== false;
                  const authenticated = status?.auth?.authenticated === true;
                  const canAuthenticate = status?.installed !== false && status?.auth?.status !== 'missing';
                  const version = status?.currentVersion ? status.currentVersion.replace(/^v/i, '') : null;
                  const hasUpdate = !!status?.updateAvailable;

                  // Determine subtitle
                  let subtitle = '';
                  if (!providerEnabled) {
                    subtitle = `Disabled – ${provider.label} is disabled in settings.`;
                  } else if (status?.installed === false) {
                    const cmd = status?.command || provider.id;
                    subtitle = `Not found – ${provider.label} CLI (${cmd}) is not installed or not on PATH.`;
                  } else if (authenticated) {
                    const raw = status?.auth?.detail || 'Authenticated';
                    subtitle = /authenticated/i.test(raw) ? raw : `Authenticated as ${raw}`;
                  } else if (status?.auth?.authenticated === false) {
                    subtitle = 'Available – Installed and ready, but authentication could not be verified.';
                  } else if (status?.installed) {
                    subtitle = 'Available – Installed and ready.';
                  } else {
                    subtitle = status?.auth?.label || 'Unknown';
                  }

                  const revealed = !!revealedProviderEmails[provider.id];
                  const displaySubtitle = subtitle.replace(
                    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
                    (email) => (revealed ? email : email.replace(/^(.{1,2}).*?(@.*)$/, '$1••••$2'))
                  );
                  const hasEmailInSubtitle = /\S+@\S+/.test(subtitle);

                  const statusColor = !providerEnabled ? 'yellow' : status?.installed === false ? 'red' : 'green';

                  const optionDefs = providerOptionDefs[provider.id] ?? [];
                  const optionsExpanded = !!expandedProviderOptions[provider.id];
                  const optionValues = providerSettings[provider.id as ProviderId]?.options ?? {};

                  return (
                    <div key={provider.id} className="provider-row-wrap">
                      <div className="provider-row">
                        <div className="provider-left">
                          <span className={`provider-status-dot ${statusColor}`} />
                          <span className="provider-icon-wrap">
                            <Icon size={18} />
                          </span>
                          <div className="provider-meta">
                            <div className="provider-head">
                              <span className="provider-name">{provider.label}</span>
                              {version && <span className="provider-version">v{version}</span>}
                              {hasUpdate && (
                                <span className="provider-update-arrow" title="Update available">
                                  ↑
                                </span>
                              )}
                            </div>
                            <div
                              className="provider-subtitle"
                              onClick={() => {
                                if (hasEmailInSubtitle) {
                                  setRevealedProviderEmails((prev) => ({
                                    ...prev,
                                    [provider.id]: !prev[provider.id],
                                  }));
                                }
                              }}
                              title={hasEmailInSubtitle && !revealed ? 'Click to reveal email' : undefined}
                            >
                              {displaySubtitle}
                            </div>
                          </div>
                        </div>

                        <div className="provider-right">
                          <button
                            type="button"
                            className={`provider-menu-btn ${optionsExpanded ? 'open' : ''}`}
                            title={optionsExpanded ? 'Hide options' : 'Provider options'}
                            onClick={() => {
                              setExpandedProviderOptions((prev) => ({
                                ...prev,
                                [provider.id]: !prev[provider.id],
                              }));
                            }}
                          >
                            <ChevronDown size={14} />
                          </button>

                          {canAuthenticate && (
                            <button
                              type="button"
                              className="provider-auth-button compact"
                              onClick={() => handleAuthenticateProvider(provider.id)}
                              disabled={authenticatingProviderId === provider.id}
                            >
                              {authenticated ? 'Re-authenticate' : 'Authenticate'}
                            </button>
                          )}

                          <label className="provider-toggle" title={providerEnabled ? 'Enabled' : 'Disabled'}>
                            <input
                              type="checkbox"
                              checked={providerEnabled}
                              onChange={(event) => {
                                setProviderEnabled(provider.id as ProviderId, event.target.checked);
                              }}
                            />
                            <span />
                          </label>
                        </div>
                      </div>

                      {optionsExpanded && optionDefs.length > 0 && (
                        <div className="provider-options">
                          {optionDefs.map((option) => {
                            if (option.type === 'boolean') {
                              const checked = optionValues[option.key] === true;
                              return (
                                <div key={option.key} className="provider-option">
                                  <span className="provider-option-text">
                                    <span className="provider-option-label">{option.label}</span>
                                    <span className="provider-option-description">{option.description}</span>
                                  </span>
                                  <label className="provider-toggle">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) => {
                                        setProviderOptions(
                                          provider.id as ProviderId,
                                          {
                                            [option.key]: event.target.checked,
                                          } as Partial<ProviderRuntimeOptions>
                                        );
                                      }}
                                    />
                                    <span />
                                  </label>
                                </div>
                              );
                            }

                            const value = optionValues[option.key];
                            if (option.type === 'select') {
                              return (
                                <div key={option.key} className="provider-option">
                                  <span className="provider-option-text">
                                    <span className="provider-option-label">{option.label}</span>
                                    <span className="provider-option-description">{option.description}</span>
                                  </span>
                                  <SelectMenu
                                    label={option.label}
                                    value={typeof value === 'string' ? value : 'inherit'}
                                    options={option.options ?? []}
                                    onChange={(nextValue) => {
                                      setProviderOptions(
                                        provider.id as ProviderId,
                                        {
                                          [option.key]: nextValue,
                                        } as Partial<ProviderRuntimeOptions>
                                      );
                                    }}
                                  />
                                </div>
                              );
                            }

                            if (option.type === 'textarea') {
                              return (
                                <div key={option.key} className="provider-option column">
                                  <span className="provider-option-text">
                                    <span className="provider-option-label">{option.label}</span>
                                    <span className="provider-option-description">{option.description}</span>
                                  </span>
                                  <textarea
                                    className="provider-option-input provider-option-textarea"
                                    placeholder={option.placeholder}
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={(event) => {
                                      setProviderOptions(
                                        provider.id as ProviderId,
                                        {
                                          [option.key]: event.target.value,
                                        } as Partial<ProviderRuntimeOptions>
                                      );
                                    }}
                                  />
                                </div>
                              );
                            }

                            return (
                              <div key={option.key} className="provider-option column">
                                <span className="provider-option-text">
                                  <span className="provider-option-label">{option.label}</span>
                                  <span className="provider-option-description">{option.description}</span>
                                </span>
                                <input
                                  type="text"
                                  className="provider-option-input"
                                  placeholder={option.placeholder}
                                  value={typeof value === 'string' ? value : ''}
                                  onChange={(event) => {
                                    setProviderOptions(
                                      provider.id as ProviderId,
                                      {
                                        [option.key]: event.target.value,
                                      } as Partial<ProviderRuntimeOptions>
                                    );
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}

          {settingsTab === 'orchestration' && (
            <>
              <div className="setting-row">
                <div className="setting-label">
                  <div className="settings-panel-title">Orchestration</div>
                  <div className="settings-muted">
                    Pick “Orion” as a thread’s model and Fable-style orchestration kicks in: the main driver model
                    coordinates the work, talks to you, and delegates to the role models below via subagents.
                  </div>
                </div>
              </div>

              {orchestrationRoleMeta.map((role) => (
                <div className="setting-row" key={role.id}>
                  <div className="setting-label">
                    <div className="setting-label-title">{role.label}</div>
                    <div className="setting-label-desc">{role.desc}</div>
                  </div>
                  <select
                    className="setting-select"
                    value={normalizedOrchestrationSettings.models[role.id]}
                    onChange={(e) => setOrchestrationRoleModel(role.id, e.target.value)}
                  >
                    {orchestrationModelGroups.map((group) => (
                      <optgroup key={group.provider.id} label={group.provider.label}>
                        {group.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}

              <div className="setting-row setting-row-stacked">
                <div className="setting-label">
                  <div className="setting-label-title">General instructions</div>
                  <div className="setting-label-desc">
                    Free-form guidance included in the orchestrator's instructions
                  </div>
                </div>
                <textarea
                  className="setting-textarea"
                  rows={6}
                  value={normalizedOrchestrationSettings.generalInstructions}
                  onChange={(e) => setOrchestrationGeneralInstructions(e.target.value)}
                  placeholder="e.g. Always run the test suite before reporting a task as done."
                />
              </div>
            </>
          )}

          {settingsTab === 'skills' && (
            <SkillsSettings formatBytes={formatBytes} onOpenInEditor={handleOpenSkillInEditor} />
          )}

          {settingsTab === 'split-view' && (
            <>
              <div className="setting-row">
                <div className="setting-label">
                  <div className="settings-panel-title">Split view</div>
                  <div className="settings-muted">
                    Drag a thread from the sidebar into the main view to open it beside the one already
                    there — up to {MAX_THREAD_PANES} at once. Panes are windows onto the threads
                    themselves; nothing is ever copied.
                  </div>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-title">Auto-save split views</div>
                  <div className="setting-label-desc">
                    Keep every split you open in the sidebar's Saved views section, so you can come back
                    to it in one click. Off means splits are never recorded — close one and it's gone.
                  </div>
                </div>
                <label className="provider-toggle" title="Auto-save split views">
                  <input
                    type="checkbox"
                    checked={splitViewSettings?.autoSave ?? defaultSplitViewSettings.autoSave}
                    onChange={(e) => setSplitViewSettings({ autoSave: e.target.checked })}
                  />
                  <span />
                </label>
              </div>

              {savedViews.length > 0 && (
                <div className="setting-row setting-row-stacked">
                  <div className="setting-label">
                    <div className="setting-label-title">Saved views</div>
                    <div className="setting-label-desc">
                      Delete one here or from the sidebar. Its threads are untouched either way.
                    </div>
                  </div>
                  <div className="archived-epics-list">
                    {savedViews.map((view) => (
                      <div key={view.id} className="archived-epic-row">
                        <Columns2 size={13} />
                        <span className="archived-epic-name truncate" title={view.name}>
                          {view.name}
                        </span>
                        <span className="archived-epic-date">{view.threadIds.length} threads</span>
                        <button
                          type="button"
                          className="archived-epic-action"
                          onClick={() => deleteSavedView(view.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {settingsTab === 'computer-use' &&
            (computerUsePerms && !computerUsePerms.supported ? (
              <div className="settings-empty-panel">
                <div className="settings-panel-title">Computer use</div>
                <div className="settings-muted">
                  Computer use permissions only apply on macOS. Nothing to configure on this platform.
                </div>
              </div>
            ) : (
              <>
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">macOS permissions</div>
                    <div className="setting-label-desc">
                      Agents that control the mouse, keyboard, and screen (Codex computer use and similar) need Orion to
                      hold these macOS permissions. macOS attributes every CLI Orion launches — codex, claude, grok,
                      cursor — back to Orion, so granting them here covers all providers.
                    </div>
                  </div>
                </div>

                {(
                  [
                    {
                      kind: 'accessibility',
                      title: 'Accessibility',
                      desc: 'Lets agents read app windows and send clicks and keystrokes. After requesting, enable Orion in the Accessibility list.',
                      status: computerUsePerms?.accessibility ?? 'not-determined',
                    },
                    {
                      kind: 'screen-recording',
                      title: 'Screen Recording',
                      desc: 'Lets agent screenshots include other apps’ window contents. Without it, captures show only the wallpaper.',
                      status: computerUsePerms?.screenRecording ?? 'not-determined',
                    },
                    {
                      kind: 'automation',
                      title: 'Automation (Apple Events)',
                      desc: 'Lets agents drive apps through AppleScript and System Events. macOS asks once per app an agent controls; the status here reflects the System Events grant.',
                      status: computerUsePerms?.automation ?? 'not-determined',
                    },
                  ] as Array<{
                    kind: OrionComputerUsePermissionKind;
                    title: string;
                    desc: string;
                    status: OrionComputerUsePermissionStatus;
                  }>
                ).map((row) => {
                  const granted = row.status === 'granted';
                  const chip =
                    row.status === 'granted'
                      ? { className: 'authenticated', label: 'Granted' }
                      : row.status === 'denied' || row.status === 'restricted'
                        ? { className: 'unauthenticated', label: 'Not granted' }
                        : row.status === 'not-determined'
                          ? { className: '', label: 'Not requested' }
                          : null;
                  return (
                    <div className="setting-row" key={row.kind}>
                      <div className="setting-label">
                        <div className="setting-label-title">{row.title}</div>
                        <div className="setting-label-desc">{row.desc}</div>
                      </div>
                      <div className="setting-row-actions">
                        {chip && <span className={`provider-status-chip ${chip.className}`}>{chip.label}</span>}
                        <button
                          type="button"
                          className="provider-auth-button"
                          onClick={() => {
                            void handleRequestComputerUsePermission(row.kind);
                          }}
                          disabled={computerUseBusyKind !== null}
                        >
                          <SquareArrowOutUpRight size={13} />
                          {computerUseBusyKind === row.kind
                            ? 'Requesting...'
                            : granted
                              ? 'System Settings'
                              : row.kind === 'automation'
                                ? 'Request access'
                                : 'Grant access'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Apply new grants</div>
                    <div className="setting-label-desc">
                      macOS applies Screen Recording (and sometimes Accessibility) to an already-running app only after
                      it relaunches. Restart Orion once you’ve granted access.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="provider-auth-button"
                    onClick={() => {
                      void window.orion?.relaunchApp?.();
                    }}
                  >
                    <RefreshCw size={13} />
                    Relaunch Orion
                  </button>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Browser control</div>
                    <div className="setting-label-desc">
                      Codex’s built-in ChatGPT-extension browser only works inside the ChatGPT desktop app, so Orion
                      gives each provider its own browser tooling instead. These mirror the same options under Settings
                      → Providers.
                    </div>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Codex · Browser control</div>
                    <div className="setting-label-desc">
                      Full browser control through chrome-devtools-mcp: navigate, click, read pages, screenshot.
                      Launches a dedicated Chrome with a persistent profile — sign in to sites once there and logins
                      stick across runs.
                    </div>
                  </div>
                  <div className="setting-row-actions">
                    <label className="provider-toggle">
                      <input
                        type="checkbox"
                        checked={providerSettings.codex?.options?.browserControl === true}
                        onChange={(event) => {
                          setProviderOptions('codex', {
                            browserControl: event.target.checked,
                          });
                        }}
                      />
                      <span />
                    </label>
                  </div>
                </div>

                {(() => {
                  const browserControlOn = providerSettings.codex?.options?.browserControl === true;
                  const autoConnectOn = providerSettings.codex?.options?.browserAutoConnect === true;
                  const debugStatus = computerUsePerms?.chromeDebug?.status ?? 'disabled';
                  const chip =
                    debugStatus === 'enabled'
                      ? { className: 'authenticated', label: 'Ready' }
                      : debugStatus === 'stale'
                        ? { className: '', label: 'Restart Chrome' }
                        : autoConnectOn
                          ? {
                              className: 'unauthenticated',
                              label: 'Setup needed',
                            }
                          : { className: '', label: 'Not set up' };
                  return (
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Codex · Use your signed-in Chrome</div>
                        <div className="setting-label-desc">
                          Attach browser control to your real Chrome profile — existing tabs, logins, and cookies —
                          instead of the dedicated one. Requires Browser control above.
                          {autoConnectOn && debugStatus !== 'enabled' && (
                            <>
                              <br />
                              One-time setup: 1. Click “Set up in Chrome” (the link is also copied to your clipboard —
                              paste it in Chrome’s address bar if no tab opens). 2. On that page, turn on “Enable remote
                              debugging” (Chrome 144+). 3. Quit Chrome fully (⌘Q) and reopen it — the server only starts
                              on launch. The status here flips to Ready automatically.
                            </>
                          )}
                          {autoConnectOn && !browserControlOn && (
                            <>
                              <br />
                              Turn on Browser control above for this to take effect.
                            </>
                          )}
                        </div>
                      </div>
                      <div className="setting-row-actions">
                        <span className={`provider-status-chip ${chip.className}`}>{chip.label}</span>
                        <button
                          type="button"
                          className="provider-auth-button"
                          onClick={() => {
                            void handleOpenChromeDebugSetup();
                          }}
                        >
                          <SquareArrowOutUpRight size={13} />
                          Set up in Chrome
                        </button>
                        <label className="provider-toggle">
                          <input
                            type="checkbox"
                            checked={autoConnectOn}
                            onChange={(event) => {
                              setProviderOptions('codex', {
                                browserAutoConnect: event.target.checked,
                              });
                            }}
                          />
                          <span />
                        </label>
                      </div>
                    </div>
                  );
                })()}

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Claude · Claude in Chrome</div>
                    <div className="setting-label-desc">
                      Browser control through the Claude Chrome extension (--chrome): drives your real signed-in Chrome.
                      Requires the extension to be installed in Chrome.
                    </div>
                  </div>
                  <div className="setting-row-actions">
                    <label className="provider-toggle">
                      <input
                        type="checkbox"
                        checked={providerSettings.claude?.options?.chrome === true}
                        onChange={(event) => {
                          setProviderOptions('claude', {
                            chrome: event.target.checked,
                          });
                        }}
                      />
                      <span />
                    </label>
                  </div>
                </div>
              </>
            ))}

          {settingsTab === 'storage' && (
            <>
              <div className="settings-group-label">Rift workspaces</div>
              <div className="settings-group">
                <div className="storage-summary">
                  <div className="storage-summary-main">
                    <div className="storage-summary-total">{formatBytes(riftStorageSummary.total)}</div>
                    <div className="storage-summary-caption">
                      Across {riftStorageEntries.length} rift
                      {riftStorageEntries.length === 1 ? '' : 's'}. Rifts share unchanged files with their source
                      repository, so freeing them usually reclaims less than this.
                    </div>
                  </div>
                  <div className="storage-summary-actions">
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={riftStorageState?.scanning || riftStorageBusy}
                      onClick={() =>
                        void window.orion?.scanRiftStorage?.({
                          remeasure: true,
                        })
                      }
                    >
                      <RefreshCw size={13} />
                      {riftStorageState?.scanning ? 'Measuring...' : 'Rescan'}
                    </button>
                    <button
                      type="button"
                      className="btn danger small"
                      disabled={
                        riftStorageBusy ||
                        riftStorageState?.scanning ||
                        (riftSweepSelection.length === 0 && riftStorageSummary.trash <= 0)
                      }
                      onClick={() =>
                        setRiftSweepDialog({
                          entries: riftSweepSelection,
                          runGc: true,
                          forcePaths: riftSweepSelection
                            .filter((entry) => entry.hasUncommittedChanges || entry.hasUnpushedCommits)
                            .map((entry) => entry.riftPath),
                        })
                      }
                    >
                      <Trash2 size={13} />
                      {riftStorageBusy
                        ? 'Freeing...'
                        : riftSweepSelection.length === 0
                          ? `Empty ${formatBytes(riftStorageSummary.trash)} trash`
                          : `Free up ${formatBytes(
                              riftSweepSelection.reduce((total, entry) => total + (entry.bytes ?? 0), 0)
                            )}`}
                    </button>
                  </div>
                </div>

                <div className="storage-breakdown">
                  {[
                    { label: 'Active epics', bytes: riftStorageSummary.active },
                    {
                      label: 'Settled epics',
                      bytes: riftStorageSummary.settled,
                    },
                    { label: 'No epic', bytes: riftStorageSummary.orphan },
                    { label: 'Rift trash', bytes: riftStorageSummary.trash },
                  ].map(({ label, bytes }) => (
                    <div key={label} className="storage-breakdown-item">
                      <span className="storage-breakdown-label">{label}</span>
                      <span className="storage-breakdown-value">{formatBytes(bytes)}</span>
                    </div>
                  ))}
                </div>

                {riftStorageState?.error && (
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-desc">{riftStorageState.error}</div>
                    </div>
                  </div>
                )}

                {riftStorageEntries.length === 0 && !riftStorageState?.scanning && (
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-desc">
                        No rift workspaces found. Rifts appear here once epics start creating them.
                      </div>
                    </div>
                  </div>
                )}

                {riftStorageEntries.length > 0 && (
                  <div className="setting-row setting-row-stacked">
                    <div className="storage-rift-list">
                      {riftStorageEntries.map((entry) => {
                        const blocked = entry.hasUncommittedChanges || entry.hasUnpushedCommits;
                        const forced = Boolean(riftStorageForced[entry.riftPath]);
                        return (
                          <div key={entry.riftPath} className="storage-rift-row">
                            <div className="storage-rift-main">
                              <span className="storage-rift-name truncate" title={entry.riftPath}>
                                {entry.epicName || entry.name}
                              </span>
                              <span className="storage-rift-meta truncate">
                                {entry.repoName}
                                {entry.gitBranch ? ` · ${entry.gitBranch}` : ''}
                                {entry.settledAt ? ` · settled ${formatShortTime(new Date(entry.settledAt))}` : ''}
                              </span>
                            </div>
                            {entry.status === 'active' && <span className="provider-status-chip">Active</span>}
                            {entry.status === 'orphan' && <span className="provider-status-chip">No epic</span>}
                            {entry.status === 'cleanupPending' && (
                              <span className="provider-status-chip">Incomplete</span>
                            )}
                            {blocked && (
                              <button
                                type="button"
                                className={`storage-rift-flag${forced ? ' active' : ''}`}
                                title={
                                  forced
                                    ? 'This rift will be freed even though it has unpushed work'
                                    : 'Has uncommitted or unpushed work — click to free it anyway'
                                }
                                onClick={() =>
                                  setRiftStorageForced((current) => ({
                                    ...current,
                                    [entry.riftPath]: !current[entry.riftPath],
                                  }))
                                }
                              >
                                {forced ? 'Freeing anyway' : 'Unpushed work'}
                              </button>
                            )}
                            <span className="storage-rift-size">{formatBytes(entry.bytes)}</span>
                            <button
                              type="button"
                              className="archived-epic-action danger"
                              title="Free this rift"
                              disabled={riftStorageBusy}
                              onClick={() =>
                                setRiftSweepDialog({
                                  entries: [entry],
                                  runGc: true,
                                  // For an individual row, the destructive modal
                                  // itself is the one-time unpublished-work approval.
                                  forcePaths: blocked ? [entry.riftPath] : [],
                                  // The row action is an explicit request to free
                                  // this exact scan-listed Rift in any state.
                                  manualPaths: [entry.riftPath],
                                  manualScanId: riftStorageState?.scanId ?? undefined,
                                })
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-group-label">Automatic cleanup</div>
              <div className="settings-group settings-group-overflowing">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Free the rift when settling</div>
                    <div className="setting-label-desc">
                      Settling an epic also frees its rift workspace. The epic keeps its branch and pull request, and
                      restoring it recreates the rift. Rifts with uncommitted or unpushed work are never freed
                      automatically.
                    </div>
                  </div>
                  <label className="provider-toggle" title="Free the rift when settling">
                    <input
                      type="checkbox"
                      checked={riftsSettings.releaseOnSettle ?? defaultRiftsSettings.releaseOnSettle}
                      onChange={(e) => setRiftsSettings({ releaseOnSettle: e.target.checked })}
                    />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Free settled rifts after</div>
                    <div className="setting-label-desc">
                      Checked once at startup. Freed rifts stay recoverable in Rift's trash until you empty it from this
                      page.
                    </div>
                  </div>
                  <SelectMenu
                    label="Free settled rifts after"
                    value={String(riftsSettings.retentionDays ?? defaultRiftsSettings.retentionDays ?? '')}
                    options={[
                      { value: '', label: 'Never' },
                      { value: '7', label: '7 days' },
                      { value: '14', label: '14 days' },
                      { value: '30', label: '30 days' },
                    ]}
                    onChange={(value) =>
                      setRiftsSettings({
                        retentionDays: value ? Number(value) : null,
                      })
                    }
                  />
                </div>
              </div>
            </>
          )}

          {settingsTab === 'cosmetics' && (
            <div className="settings-empty-panel">
              <div className="settings-panel-title">Cosmetics</div>
              <div className="settings-muted">Coming soon.</div>
            </div>
          )}
          {settingsTab === 'experimental' && (
            <>
              {epicsEnabled && (
                <>
                  <div className="settings-group-label">Epics</div>
                  <div className="settings-group">
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Commit &amp; PR message prompts</div>
                        <div className="setting-label-desc">
                          Ask before an epic commits or opens a PR, so you can write the message yourself (leave it
                          empty and the epic message model still writes it) and pick the PR's base branch. Turn off to
                          skip both dialogs: messages are always generated, and PRs target your project's current branch
                          on origin.
                        </div>
                      </div>
                      <label className="provider-toggle" title="Commit & PR message prompts">
                        <input
                          type="checkbox"
                          checked={epicPromptGitMessages}
                          onChange={(e) =>
                            setEpicsSettings({
                              promptGitMessages: e.target.checked,
                            })
                          }
                        />
                        <span />
                      </label>
                    </div>
                  </div>
                </>
              )}

              <div className="settings-group-label">Rifts</div>
              <div className="settings-group">
                <div className="setting-row">
                  <div className="setting-label">
                    <div className="setting-label-title">Enable Rifts</div>
                    <div className="setting-label-desc">
                      Give each epic an instant copy-on-write clone of its repository (github.com/anomalyco/rift). Epic
                      threads, commits, pushes, and PRs all happen inside the rift, so unrelated local changes never mix
                      in.
                      {riftStatus?.available === false
                        ? ' Unavailable: the bundled rift binary does not support this platform.'
                        : riftStatus?.version
                          ? ` Bundled rift v${riftStatus.version} — update with "bun run update-rifts".`
                          : ''}
                    </div>
                  </div>
                  <label className="provider-toggle" title="Enable Rifts">
                    <input
                      type="checkbox"
                      checked={riftsSettings.enabled}
                      disabled={riftStatus?.available === false}
                      onChange={(e) => setRiftsSettings({ enabled: e.target.checked })}
                    />
                    <span />
                  </label>
                </div>

                {riftsSettings.enabled && (
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Create a rift per epic</div>
                      <div className="setting-label-desc">
                        New epics get a rift and a dedicated branch (named by the epic message model) automatically. You
                        can still opt out per epic in the create dialog.
                      </div>
                    </div>
                    <label className="provider-toggle" title="Create a rift per epic">
                      <input
                        type="checkbox"
                        checked={riftsSettings.autoCreateForEpics}
                        onChange={(e) =>
                          setRiftsSettings({
                            autoCreateForEpics: e.target.checked,
                          })
                        }
                      />
                      <span />
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default SettingsPage;
