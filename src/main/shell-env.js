import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);
export const loginShell = process.env.SHELL || '/bin/zsh';
export let shellPathSyncPromise = Promise.resolve();
export const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// Finder-launched apps inherit launchd's minimal PATH, and most CLI
// installers (nvm, bun, grok, ...) export PATH from ~/.zshrc, which only
// interactive shells source. Capture the interactive login shell's PATH once
// at startup so provider detection and agent runs can find the CLIs.
export const syncPathFromUserShell = async () => {
  if (process.platform === 'win32') return;
  try {
    const marker = '__ORION_PATH__';
    const { stdout } = await execFileAsync(
      loginShell,
      ['-ilc', `printf "${marker}%s${marker}" "$PATH"`],
      { timeout: 8000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } }
    );
    const match = stdout.match(/__ORION_PATH__([\s\S]*)__ORION_PATH__/);
    const shellPath = match?.[1]?.trim();
    if (!shellPath) return;
    const merged = [
      ...new Set([...shellPath.split(':'), ...String(process.env.PATH || '').split(':')]),
    ]
      .filter(Boolean)
      .join(':');
    process.env.PATH = merged;
  } catch {
    // Keep the inherited PATH; provider checks will report what they can see.
  }
};

export const runShellCommand = async (command, timeout = 30000) => {
  const { stdout, stderr } = await execFileAsync(loginShell, ['-lc', command], {
    timeout,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stdout: stdout || '', stderr: stderr || '' };
};

export const COMMAND_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
export const COMMAND_PATH_MISS_CACHE_TTL_MS = 5 * 1000;
export const commandPathCache = new Map();
export const commandPathPromises = new Map();
export const parseCommandPath = (stdout) => {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (path.isAbsolute(lines[index])) return lines[index];
  }
  return null;
};

export const resolveCommandPath = (command) => {
  const cached = commandPathCache.get(command);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.path);
  if (cached) commandPathCache.delete(command);

  const existing = commandPathPromises.get(command);
  if (existing) return existing;

  const lookup = shellPathSyncPromise
    .then(() => runShellCommand(`command -v ${shellQuote(command)}`, 4000))
    .then(({ stdout }) => parseCommandPath(stdout))
    .catch(() => null);
  const sharedLookup = lookup
    .then((path) => {
      commandPathCache.set(command, {
        path,
        expiresAt:
          Date.now() +
          (path ? COMMAND_PATH_CACHE_TTL_MS : COMMAND_PATH_MISS_CACHE_TTL_MS),
      });
      return path;
    })
    .finally(() => {
      if (commandPathPromises.get(command) === sharedLookup) {
        commandPathPromises.delete(command);
      }
    });
  commandPathPromises.set(command, sharedLookup);
  return sharedLookup;
};

export const checkCommandAvailable = async (command) => Boolean(await resolveCommandPath(command));

export const startShellPathSync = () => {
  shellPathSyncPromise = syncPathFromUserShell();
  return shellPathSyncPromise;
};
