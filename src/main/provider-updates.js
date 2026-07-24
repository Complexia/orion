import path from 'node:path';
import { spawn } from 'node:child_process';
import { loginShell, resolveCommandPath, runShellCommand, shellQuote } from './shell-env.js';

export const providerUpdaterConfigs = [
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    packageName: '@openai/codex',
    updateCommands: [['update']],
    authCommands: [['login']],
    statusCommand: ['login', 'status'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    packageName: '@anthropic-ai/claude-code',
    updateCommands: [['update']],
    authCommands: [['auth', 'login']],
    statusCommand: ['auth', 'status'],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    updateCommands: [['update']],
    authCommands: [['login']],
    statusCommand: ['status', '--format', 'json'],
  },
  {
    id: 'grok',
    label: 'Grok',
    command: 'grok',
    updateCommands: [['update']],
    checkCommand: ['update', '--check', '--json'],
    authCommands: [['login', '--oauth']],
    statusCommand: ['models'],
  },
  {
    id: 'kimi',
    label: 'Kimi Code',
    command: 'kimi',
    latestVersionUrl: 'https://code.kimi.com/kimi-code/latest',
    updateCommands: [['upgrade']],
    manualInstallCommandPattern: /To update manually, run:\s*([^\r\n]+)/i,
    verifyAfterUpdate: true,
    authCommands: [['login']],
    statusCommand: ['provider', 'list'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    packageName: 'opencode-ai',
    updateCommands: [['update'], ['upgrade']],
    authCommands: [['auth', 'login'], ['login']],
  },
];

export const parseVersion = (value) => {
  const match = String(value || '').match(/\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/);
  return match ? match[0] : null;
};

export const compareVersionStrings = (left, right) => {
  const leftParts = String(left || '').match(/\d+/g)?.map(Number) ?? [];
  const rightParts = String(right || '').match(/\d+/g)?.map(Number) ?? [];
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
};

export const getProcessErrorMessage = (error) => {
  const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
  return output || error?.message || String(error);
};

export const readCliVersion = async (command) => {
  try {
    const { stdout, stderr } = await runShellCommand(`${shellQuote(command)} --version`, 8000);
    return parseVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    return parseVersion(getProcessErrorMessage(error));
  }
};

export const readNpmLatestVersion = async (packageName) => {
  try {
    const { stdout } = await runShellCommand(`npm view ${shellQuote(packageName)} version`, 20000);
    return parseVersion(stdout);
  } catch {
    return null;
  }
};

export const readRemoteLatestVersion = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    return parseVersion(await response.text());
  } catch {
    return null;
  }
};

export const parseJsonFromOutput = (output) => {
  const text = String(output || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const jsonLine = text
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith('{'));

  if (!jsonLine) return null;

  try {
    return JSON.parse(jsonLine);
  } catch {
    return null;
  }
};

export const getProviderAuthStatus = async (config) => {
  if (!(await resolveCommandPath(config.command))) {
    return {
      authenticated: false,
      status: 'missing',
      label: 'Not installed',
      detail: `${config.command} is not installed.`,
    };
  }

  if (!config.statusCommand) {
    return {
      authenticated: null,
      status: 'unknown',
      label: 'Unknown',
      detail: 'No status command is available.',
    };
  }

  try {
    const command = [config.command, ...config.statusCommand].map(shellQuote).join(' ');
    const { stdout, stderr } = await runShellCommand(command, 15000);
    const output = `${stdout}\n${stderr}`.trim();
    const parsed = parseJsonFromOutput(output);
    const lowerOutput = output.toLowerCase();

    if (config.id === 'codex') {
      const authenticated = /logged in/i.test(output) && !/not logged in/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output,
      };
    }

    if (config.id === 'claude') {
      const authenticated = parsed
        ? parsed.loggedIn === true
        : /logged in|authenticated/i.test(output) && !/not logged/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: parsed?.email || parsed?.authMethod || output,
      };
    }

    if (config.id === 'cursor') {
      const authenticated = parsed
        ? parsed.isAuthenticated === true || parsed.status === 'authenticated'
        : /authenticated|logged in/i.test(output) && !/not authenticated|not logged/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : 'unauthenticated',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: parsed?.message || parsed?.status || output,
      };
    }

    if (config.id === 'grok') {
      const authenticated =
        /logged in|available models|default model/i.test(output) &&
        !/not logged|unauthenticated|login required|sign in required/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : lowerOutput ? 'unauthenticated' : 'unknown',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output.split(/\r?\n/).find((line) => line.trim()) || output,
      };
    }

    if (config.id === 'kimi') {
      // `kimi provider list` prints the managed provider row (source=oauth)
      // and the default model when the CLI is configured and logged in.
      const authenticated =
        /source=oauth|default model/i.test(output) &&
        !/not logged|login required|unauthenticated|authentication required/i.test(output);
      return {
        authenticated,
        status: authenticated ? 'authenticated' : lowerOutput ? 'unauthenticated' : 'unknown',
        label: authenticated ? 'Authenticated' : 'Not authenticated',
        detail: output.split(/\r?\n/).find((line) => line.trim()) || output,
      };
    }

    const authenticated =
      /authenticated|logged in|signed in/i.test(output) &&
      !/not authenticated|not logged|signed out/i.test(output);
    return {
      authenticated,
      status: authenticated ? 'authenticated' : 'unknown',
      label: authenticated ? 'Authenticated' : 'Unknown',
      detail: output,
    };
  } catch (error) {
    const message = getProcessErrorMessage(error);
    const unauthenticated = /unauth|not logged|login required|sign in required/i.test(message);
    return {
      authenticated: unauthenticated ? false : null,
      status: unauthenticated ? 'unauthenticated' : 'error',
      label: unauthenticated ? 'Not authenticated' : 'Status unavailable',
      detail: message,
    };
  }
};

export const normalizeEnabledProviderIds = (input) => {
  if (!input || !Array.isArray(input.enabledProviderIds)) return null;
  return new Set(input.enabledProviderIds.map(String));
};

export const checkProviderUpdate = async (config, enabledProviderIds = null) => {
  const commandPath = await resolveCommandPath(config.command);
  const enabled = !enabledProviderIds || enabledProviderIds.has(config.id);
  const auth = await getProviderAuthStatus(config);
  const base = {
    id: config.id,
    label: config.label,
    command: config.command,
    enabled,
    installed: Boolean(commandPath),
    path: commandPath,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    status: commandPath ? 'unknown' : 'missing',
    auth,
  };

  if (!commandPath) return base;

  const currentVersion = await readCliVersion(config.command);
  const withCurrentVersion = { ...base, currentVersion };

  if (config.checkCommand) {
    try {
      const command = [config.command, ...config.checkCommand].map(shellQuote).join(' ');
      const { stdout, stderr } = await runShellCommand(command, 30000);
      const payload = `${stdout}\n${stderr}`.trim();
      const jsonLine = payload
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('{'));
      const parsed = jsonLine ? JSON.parse(jsonLine) : JSON.parse(payload);
      const latestVersion = parseVersion(parsed.latestVersion);
      const reportedCurrentVersion = parseVersion(parsed.currentVersion) ?? currentVersion;
      const updateAvailable =
        enabled && (parsed.updateAvailable === true ||
        (reportedCurrentVersion && latestVersion
          ? compareVersionStrings(reportedCurrentVersion, latestVersion) < 0
          : false));

      return {
        ...withCurrentVersion,
        currentVersion: reportedCurrentVersion,
        latestVersion,
        updateAvailable,
        status: updateAvailable ? 'available' : 'current',
      };
    } catch (error) {
      return {
        ...withCurrentVersion,
        status: 'error',
        error: getProcessErrorMessage(error),
      };
    }
  }

  if (config.packageName) {
    const latestVersion = await readNpmLatestVersion(config.packageName);
    const updateAvailable =
      enabled && currentVersion && latestVersion
        ? compareVersionStrings(currentVersion, latestVersion) < 0
        : false;

    return {
      ...withCurrentVersion,
      latestVersion,
      updateAvailable,
      status: latestVersion ? (updateAvailable ? 'available' : 'current') : 'unknown',
    };
  }

  if (config.latestVersionUrl) {
    const latestVersion = await readRemoteLatestVersion(config.latestVersionUrl);
    const updateAvailable =
      enabled && currentVersion && latestVersion
        ? compareVersionStrings(currentVersion, latestVersion) < 0
        : false;

    return {
      ...withCurrentVersion,
      latestVersion,
      updateAvailable,
      status: latestVersion ? (updateAvailable ? 'available' : 'current') : 'unknown',
    };
  }

  return withCurrentVersion;
};

export const runProviderUpdateCheck = async (input = {}) => {
  const enabledProviderIds = normalizeEnabledProviderIds(input);
  const providers = await Promise.all(
    providerUpdaterConfigs.map((config) => checkProviderUpdate(config, enabledProviderIds))
  );
  return {
    checkedAt: new Date().toISOString(),
    updatesAvailable: providers.filter((provider) => provider.updateAvailable).length,
    providers,
  };
};

export const providerUpdateCheckPromises = new Map();
export const checkProviderUpdates = (input = {}) => {
  const enabledProviderIds = normalizeEnabledProviderIds(input);
  const key = enabledProviderIds ? [...enabledProviderIds].sort().join(',') : '*';
  const existing = providerUpdateCheckPromises.get(key);
  if (existing) return existing;

  const check = runProviderUpdateCheck(input);
  const sharedCheck = check.finally(() => {
    if (providerUpdateCheckPromises.get(key) === sharedCheck) {
      providerUpdateCheckPromises.delete(key);
    }
  });
  providerUpdateCheckPromises.set(key, sharedCheck);
  return sharedCheck;
};

export const getProviderStatuses = async () => checkProviderUpdates();

export const resolveProviderUpdateCommand = async (config) => {
  for (const args of config.updateCommands) {
    try {
      await runShellCommand([config.command, ...args, '--help'].map(shellQuote).join(' '), 8000);
      return args;
    } catch (error) {
      const output = getProcessErrorMessage(error);
      if (!/unknown command|invalid command|unrecognized subcommand|not found/i.test(output)) {
        return args;
      }
    }
  }

  return config.updateCommands[0] ?? null;
};

export const updateProviderTool = async (config, expectedLatestVersion = null) => {
  const commandPath = await resolveCommandPath(config.command);
  if (!commandPath) {
    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: true,
      skipped: true,
      message: `${config.command} is not installed.`,
    };
  }

  const args = await resolveProviderUpdateCommand(config);
  if (!args) {
    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: false,
      error: `No updater command is configured for ${config.command}.`,
    };
  }

  const updateCommand = [config.command, ...args].map(shellQuote).join(' ');

  try {
    const { stdout, stderr } = await runShellCommand(updateCommand, 180000);
    const outputParts = [`${stdout}\n${stderr}`.trim()].filter(Boolean);
    const manualInstallCommand = config.manualInstallCommandPattern
      ? outputParts[0]?.match(config.manualInstallCommandPattern)?.[1]?.trim()
      : null;

    // Some self-updaters only print a source-specific install command when
    // stdin is not a TTY. Run that command explicitly so the background
    // update path performs the install instead of reporting a no-op success.
    if (manualInstallCommand) {
      const manualResult = await runShellCommand(manualInstallCommand, 180000);
      const manualOutput = `${manualResult.stdout}\n${manualResult.stderr}`.trim();
      if (manualOutput) outputParts.push(manualOutput);
    }

    if (config.verifyAfterUpdate && expectedLatestVersion) {
      const installedVersion = await readCliVersion(config.command);
      if (
        !installedVersion ||
        compareVersionStrings(installedVersion, expectedLatestVersion) < 0
      ) {
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: false,
          error: installedVersion
            ? `${config.label} is still on ${installedVersion}; expected ${expectedLatestVersion}.`
            : `Could not verify the installed ${config.label} version after updating.`,
          output: outputParts.join('\n\n'),
        };
      }
    }

    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: true,
      output: outputParts.join('\n\n'),
    };
  } catch (error) {
    if (config.packageName) {
      try {
        const fallbackCommand = `npm install -g ${shellQuote(`${config.packageName}@latest`)}`;
        const { stdout, stderr } = await runShellCommand(fallbackCommand, 180000);
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: true,
          output: `${stdout}\n${stderr}`.trim(),
        };
      } catch (fallbackError) {
        return {
          id: config.id,
          label: config.label,
          command: config.command,
          ok: false,
          error: getProcessErrorMessage(fallbackError),
        };
      }
    }

    return {
      id: config.id,
      label: config.label,
      command: config.command,
      ok: false,
      error: getProcessErrorMessage(error),
    };
  }
};

export const authenticateProviderTool = async (providerId) => {
  const config = providerUpdaterConfigs.find((provider) => provider.id === providerId);
  if (!config) {
    return {
      result: { ok: false, error: `Unknown provider: ${providerId}` },
      completion: null,
    };
  }

  const commandPath = await resolveCommandPath(config.command);
  if (!commandPath) {
    return {
      result: { ok: false, error: `${config.command} is not installed.` },
      completion: null,
    };
  }

  for (const args of config.authCommands ?? []) {
    try {
      const command = [config.command, ...args].map(shellQuote).join(' ');
      const child = spawn(loginShell, ['-lc', command], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });
      const completion = new Promise((resolve) => {
        child.once('error', (error) => {
          resolve({ ok: false, error: getProcessErrorMessage(error) });
        });
        child.once('exit', (code, signal) => {
          resolve({
            ok: code === 0,
            code,
            signal,
            ...(code === 0 ? {} : { error: `Authentication exited with code ${code ?? signal}.` }),
          });
        });
      });
      child.unref();
      return { result: { ok: true }, completion };
    } catch (error) {
      return {
        result: { ok: false, error: getProcessErrorMessage(error) },
        completion: null,
      };
    }
  }

  return {
    result: {
      ok: false,
      error: `No authentication command is configured for ${config.command}.`,
    },
    completion: null,
  };
};

export const PROVIDER_AUTH_POLL_MS = 5000;
export const PROVIDER_AUTH_POLL_ATTEMPTS = 24;
export const providerAuthenticationGenerations = new Map();

export const waitForProviderAuthentication = async (providerId, completion) => {
  const config = providerUpdaterConfigs.find((provider) => provider.id === providerId);
  if (!config || !completion) return false;

  // The provider may already be authenticated while the user is switching
  // accounts. Waiting for this specific login process prevents the old
  // session from being mistaken for completion of the new authentication.
  const processResult = await completion;
  if (!processResult.ok) return false;

  // Providers without a machine-readable status command still get a refresh
  // once their successful login process exits.
  if (!config.statusCommand) return true;

  // Most CLIs publish credentials before exiting. Retry status briefly for
  // providers whose credential store settles just after the process does.
  for (let attempt = 0; attempt < PROVIDER_AUTH_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_AUTH_POLL_MS));
    }
    const auth = await getProviderAuthStatus(config);
    if (auth.authenticated === true) return true;
  }
  return false;
};
