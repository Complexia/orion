import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Rift (github.com/anomalyco/rift) ships prebuilt CLI binaries inside the
// rift-snapshot npm package. The Bun/Node FFI bindings need runtimes Electron
// doesn't provide (Bun, or Node >= 26.1 experimental FFI), so Orion spawns the
// CLI binary directly. The dependency is pinned to an exact version in
// package.json; `bun run update-rifts` is the only update path.

const platformDir = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
const archDir = { arm64: 'arm64', x64: 'x64' }[process.arch];

const riftPackageRoots = () => {
  const appPath = app.getAppPath();
  const roots = [appPath];
  // Packaged builds ship rift-snapshot unpacked next to the asar so the
  // binary can be spawned (same arrangement as node-pty's spawn-helper).
  if (appPath.endsWith('.asar')) roots.unshift(`${appPath}.unpacked`);
  return roots.map((root) => path.join(root, 'node_modules', 'rift-snapshot'));
};

export const riftBinaryPath = () => {
  if (!platformDir || !archDir) return null;
  const binaryName = platformDir === 'windows' ? 'rift.exe' : 'rift';
  for (const packageRoot of riftPackageRoots()) {
    const binary = path.join(packageRoot, 'prebuilds', `${platformDir}-${archDir}`, binaryName);
    if (existsSync(binary)) return binary;
  }
  return null;
};

export const riftPackageVersion = () => {
  for (const packageRoot of riftPackageRoots()) {
    try {
      const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))?.version;
      if (version) return version;
    } catch {}
  }
  return null;
};

const RIFT_KILL_GRACE_MS = 2_000;

const runRift = (args, { timeout = 120_000, signal } = {}) =>
  new Promise((resolve, reject) => {
    const binary = riftBinaryPath();
    if (!binary) {
      reject(new Error('The Rift binary is not available for this platform.'));
      return;
    }
    if (signal?.aborted) {
      reject(new Error(`rift ${args[0]} was cancelled.`));
      return;
    }

    const child = spawn(binary, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let interruptionError = null;
    let forceKillTimer = null;
    let timeoutTimer = null;
    let settled = false;
    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const interrupt = (error) => {
      if (interruptionError || settled) return;
      if (child.exitCode !== null || child.signalCode !== null) return;
      interruptionError = error;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, RIFT_KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const abort = () => interrupt(new Error(`rift ${args[0]} was cancelled.`));

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(() => reject(interruptionError ?? error)));
    child.on('close', (code) => {
      if (interruptionError) {
        finish(() => reject(interruptionError));
        return;
      }
      if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
      } else {
        finish(() => reject(new Error(stderr.trim() || `rift ${args[0]} exited with code ${code}`)));
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timeoutTimer = setTimeout(
      () => interrupt(new Error(`rift ${args[0]} timed out after ${Math.ceil(timeout / 1_000)} seconds.`)),
      timeout
    );
    timeoutTimer.unref?.();
  });

// Registers `workspacePath` with Rift. Idempotent — an already-registered
// workspace reports "Already initialized". On macOS/reflink filesystems this
// only records metadata; on plain-btrfs Linux the first call converts the
// directory into a subvolume, which can take a moment on large repos.
export const riftInit = async (workspacePath, { signal } = {}) => {
  await runRift(['init', workspacePath, '--here'], { timeout: 600_000, signal });
};

// Creates a copy-on-write workspace from `workspacePath` under the caller-
// chosen `into` directory and returns the path reported by Rift. Supplying the
// parent and name up front lets the caller retain the final path even when a
// creation is cancelled before Rift can print stdout. The bundled
// rift-snapshot@0.0.10 binary cannot create filtered copies reliably on macOS
// arm64, so Orion always uses the working exact-copy path. This also keeps
// dependencies and other ignored build artifacts immediately available.
// Orion sanitizes the copied Git worktree after creation, so repository
// postcreate hooks must not run before that reset/clean step: their output
// would be discarded, and a cancelled long-running hook could outlive Rift.
export const riftCreate = async (workspacePath, { name, into, signal } = {}) => {
  const args = ['create', workspacePath];
  if (name) args.push('--name', name);
  if (into) args.push('--into', into);
  args.push('--copy-all', '--no-hooks');
  const { stdout } = await runRift(args, { timeout: 600_000, signal });
  const created = stdout.trim().split('\n').pop()?.trim();
  if (!created) throw new Error('rift create did not report the new workspace path.');
  return created;
};

// Moves a created rift into Rift-owned trash (recoverable until `rift gc`).
// Never passes --force, so a source workspace root can never be unregistered
// through this path — rift itself refuses that without -f.
export const riftRemove = async (riftPath) => {
  await runRift(['remove', riftPath]);
};

export const riftSlug = (name) => {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'epic';
};
