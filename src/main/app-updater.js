import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

export let appUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  checkedAt: null,
  availableVersion: null,
  progress: null,
  error: null,
};
export let appUpdaterInitializationPromise = null;
export let appUpdateCheckTimer = null;
export let appUpdateDownloadedVersion = null;
export let appUpdateCheckPromise = null;
export let lastAppUpdateCheckAt = 0;
export let appUpdateRetryTimer = null;
export const APP_UPDATE_CHECK_DEDUP_MS = 60 * 1000;
export const APP_UPDATE_RETRY_MS = 30 * 1000;
export const getAppIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(app.getAppPath(), 'assets', 'icon.png');
};

export const getAppUpdateFeedUrl = () => {
  const baseUrl = process.env.ORION_UPDATE_FEED_URL || 'https://orioncode.xyz/api/update/macos';
  const arch = process.arch === 'x64' ? 'x64' : 'arm64';
  return `${baseUrl.replace(/\/$/, '')}/${arch}/`;
};

export const publishAppUpdateState = (patch) => {
  appUpdateState = {
    ...appUpdateState,
    ...patch,
    currentVersion: app.getVersion(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('appUpdate:state', appUpdateState);
  }

  return appUpdateState;
};

export const initializeAppUpdaterOnce = async () => {
  const { autoUpdater } = await import('electron-updater');

  // electron-forge does not generate the app-update.yml that electron-builder
  // ships in Resources, and electron-updater insists on reading one when
  // downloading (it holds the cache-dir config). Write an equivalent file to
  // user data and point the updater at it.
  try {
    const updateConfigPath = path.join(app.getPath('userData'), 'app-update.yml');
    await fs.writeFile(
      updateConfigPath,
      ['provider: generic', `url: ${getAppUpdateFeedUrl()}`, 'updaterCacheDirName: orion-updater', ''].join('\n')
    );
    autoUpdater.updateConfigPath = updateConfigPath;
  } catch {
    // Checking still works via setFeedURL below; download will surface errors.
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Differential download fetches blockmaps and many byte ranges against the
  // feed's signed URL; any of those requests landing after the signature
  // expires 403s the whole update. One plain GET keeps the window small.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: getAppUpdateFeedUrl(),
  });

  autoUpdater.on('checking-for-update', () => {
    // Background re-checks (the startup timer, the 2h interval) must not hide
    // the update button while a download is in flight or already staged.
    if (appUpdateState.status === 'downloading' || appUpdateState.status === 'downloaded') return;
    publishAppUpdateState({
      status: 'checking',
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    const availableVersion = info?.version ?? null;

    // This fires on every check, including background re-checks that race a
    // just-finished download. If this exact version is already staged, keep
    // the 'downloaded' state so "Restart to update" doesn't revert to
    // "Install update" and prompt a second download of the same bytes.
    if (availableVersion && availableVersion === appUpdateDownloadedVersion) {
      publishAppUpdateState({
        status: 'downloaded',
        availableVersion,
        checkedAt: new Date().toISOString(),
        progress: null,
        error: null,
      });
      return;
    }
    if (appUpdateState.status === 'downloading' && availableVersion === appUpdateState.availableVersion) {
      return;
    }

    publishAppUpdateState({
      status: 'available',
      availableVersion,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });

    // With autoInstallOnAppQuit, a previously downloaded update stays staged
    // and would install on quit even after newer releases ship. Re-download
    // so the staged update is always the latest one.
    if (appUpdateDownloadedVersion && availableVersion && appUpdateDownloadedVersion !== availableVersion) {
      void autoUpdater.downloadUpdate().catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', () => {
    publishAppUpdateState({
      status: 'not-available',
      availableVersion: null,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    publishAppUpdateState({
      status: 'downloading',
      progress: {
        percent: Number.isFinite(progress?.percent) ? progress.percent : 0,
        transferred: progress?.transferred ?? 0,
        total: progress?.total ?? 0,
        bytesPerSecond: progress?.bytesPerSecond ?? 0,
      },
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    appUpdateDownloadedVersion = info?.version ?? appUpdateState.availableVersion;
    publishAppUpdateState({
      status: 'downloaded',
      availableVersion: info?.version ?? appUpdateState.availableVersion,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('error', (error) => {
    publishAppUpdateState({
      status: 'error',
      progress: null,
      error: error?.message ?? 'Update failed',
    });
  });

  return autoUpdater;
};

export const initializeAppUpdater = () => {
  if (!appUpdaterInitializationPromise) {
    const initialization = initializeAppUpdaterOnce();
    const sharedInitialization = initialization.catch((error) => {
      if (appUpdaterInitializationPromise === sharedInitialization) {
        appUpdaterInitializationPromise = null;
      }
      throw error;
    });
    appUpdaterInitializationPromise = sharedInitialization;
  }
  return appUpdaterInitializationPromise;
};

export const runAppUpdateCheck = async () => {
  if (!app.isPackaged) {
    return publishAppUpdateState({
      status: 'not-available',
      checkedAt: new Date().toISOString(),
      error: null,
    });
  }

  const autoUpdater = await initializeAppUpdater();
  await autoUpdater.checkForUpdates();
  return appUpdateState;
};

export const checkForAppUpdate = ({ force = false } = {}) => {
  if (appUpdateCheckPromise) return appUpdateCheckPromise;
  if (!force && Date.now() - lastAppUpdateCheckAt < APP_UPDATE_CHECK_DEDUP_MS) {
    return Promise.resolve(appUpdateState);
  }

  const check = runAppUpdateCheck().then((state) => {
    lastAppUpdateCheckAt = Date.now();
    if (appUpdateRetryTimer) {
      clearTimeout(appUpdateRetryTimer);
      appUpdateRetryTimer = null;
    }
    return state;
  });
  const sharedCheck = check.finally(() => {
    if (appUpdateCheckPromise === sharedCheck) {
      appUpdateCheckPromise = null;
    }
  });
  appUpdateCheckPromise = sharedCheck;
  return sharedCheck;
};

export const publishAppUpdateCheckError = (error) => {
  publishAppUpdateState({
    status: 'error',
    checkedAt: new Date().toISOString(),
    error: error?.message ?? 'Could not check for updates',
  });
};

export const runScheduledAppUpdateCheck = () => {
  void checkForAppUpdate().catch((error) => {
    publishAppUpdateCheckError(error);
    if (appUpdateRetryTimer) return;
    appUpdateRetryTimer = setTimeout(() => {
      appUpdateRetryTimer = null;
      // One forced retry: it cannot rejoin or be suppressed by the failed
      // primary check. A second failure falls back to the normal interval.
      void checkForAppUpdate({ force: true }).catch(publishAppUpdateCheckError);
    }, APP_UPDATE_RETRY_MS);
  });
};

export const scheduleAppUpdateChecks = () => {
  if (!app.isPackaged) return;

  setTimeout(runScheduledAppUpdateCheck, 10000);

  if (appUpdateCheckTimer) clearInterval(appUpdateCheckTimer);
  appUpdateCheckTimer = setInterval(runScheduledAppUpdateCheck, 2 * 60 * 60 * 1000);
};
