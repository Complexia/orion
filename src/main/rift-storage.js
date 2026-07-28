import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

// Rifts are `--copy-all` clones of a whole repository, so each one carries its
// own node_modules, build output and .git. Nothing in Orion used to measure or
// reclaim them, and settling an epic only writes a timestamp — this module is
// the measurement and sweep half of that story.

const execFileAsync = promisify(execFile);

export const RIFTS_DIRECTORY_NAME = '.rifts';
export const RIFT_TRASH_DIRECTORY_NAME = '.trash';
// Current builds use 24 hex characters, while early Rift builds used a short
// four-character suffix. Removal still requires Rift's own marker (or the
// main-owned partial-creation journal), so accepting the serialized legacy
// shape here does not make arbitrary `.rifts` children removable.
export const RIFT_NAME_PATTERN = /-[0-9a-f]{4,24}$/;

const sizeCachePath = () => path.join(app.getPath('userData'), 'rift-storage.json');

// `<parent-of-repo>/.rifts/<repo-name>` — the same construction `epic:createRift`
// uses to pick a destination, kept here so scanning and creation cannot drift.
export const riftRootForGitRoot = (gitRoot) => {
  const resolved = path.resolve(gitRoot);
  return path.join(path.dirname(resolved), RIFTS_DIRECTORY_NAME, path.basename(resolved));
};

// A rift path is only ever eligible for removal when it looks exactly like
// something Orion created: `<...>/.rifts/<repo>/<slug>-<legacy-or-current hex>`, a real
// directory, and not a symlink pointing somewhere else entirely.
export const isRiftDirectoryPath = (candidate) => {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = path.resolve(candidate);
  const riftsDirectory = path.dirname(path.dirname(resolved));
  if (path.basename(riftsDirectory) !== RIFTS_DIRECTORY_NAME) return false;
  if (!RIFT_NAME_PATTERN.test(path.basename(resolved))) return false;
  try {
    const stat = lstatSync(resolved);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};

// --- Sizing ------------------------------------------------------------------

// `du -sk` is a C implementation walking the same tree we would, an order of
// magnitude faster than an fs walk over a 150k-file node_modules. It counts
// allocated blocks per inode, so on APFS/btrfs a freshly cloned rift still
// reports its full size even though it shares every block with the source —
// callers must present the result as an upper bound, not reclaimable bytes.
const measureWithDu = async (target, { signal } = {}) => {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', '--', target], {
      signal,
      maxBuffer: 1024 * 1024,
    });
    const kilobytes = Number.parseInt(String(stdout).trim().split(/\s+/)[0], 10);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // Unreadable subdirectories make du exit non-zero after still printing a
    // usable total on stdout.
    const kilobytes = Number.parseInt(String(error?.stdout ?? '').trim().split(/\s+/)[0], 10);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
  }
};

// Windows has no du. Walking with lstat gives the same block accounting, and
// deduping by device+inode keeps hardlinked files from being counted twice.
const measureWithWalk = async (target, { signal } = {}) => {
  const seenInodes = new Set();
  let total = 0;
  const stack = [target];
  while (stack.length > 0) {
    if (signal?.aborted) throw new Error('Rift storage scan was cancelled.');
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      try {
        const stat = await fs.lstat(entryPath);
        const inodeKey = `${stat.dev}:${stat.ino}`;
        if (stat.nlink > 1) {
          if (seenInodes.has(inodeKey)) continue;
          seenInodes.add(inodeKey);
        }
        total += stat.blocks != null ? stat.blocks * 512 : stat.size;
      } catch {}
    }
  }
  return total;
};

export const measurePathSize = async (target, { signal } = {}) => {
  if (process.platform === 'win32') return measureWithWalk(target, { signal });
  const duBytes = await measureWithDu(target, { signal });
  return duBytes ?? measureWithWalk(target, { signal });
};

// --- Size cache --------------------------------------------------------------

// Measuring 18 rifts takes seconds, so results are cached across launches and
// only recomputed on an explicit rescan or after a sweep.
export const loadSizeCache = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(sizeCachePath(), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

let sizeCacheQueue = Promise.resolve();
export const saveSizeCache = (cache) => {
  sizeCacheQueue = sizeCacheQueue
    .catch(() => {})
    .then(async () => {
      const target = sizeCachePath();
      const tempPath = `${target}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(cache), 'utf-8');
      await fs.rename(tempPath, target);
    });
  return sizeCacheQueue;
};

// --- Scanning ----------------------------------------------------------------

// Every rift-shaped child of one `.rifts/<repo>` root, plus the Rift-owned
// trash directory if `rift remove` has ever put anything there.
export const listRiftRootEntries = async (riftRoot) => {
  const rifts = [];
  let trashPath = null;
  let entries;
  try {
    entries = await fs.readdir(riftRoot, { withFileTypes: true });
  } catch {
    return { rifts, trashPath };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(riftRoot, entry.name);
    if (entry.name === RIFT_TRASH_DIRECTORY_NAME) {
      trashPath = entryPath;
      continue;
    }
    if (!RIFT_NAME_PATTERN.test(entry.name)) continue;
    rifts.push(entryPath);
  }
  return { rifts, trashPath };
};

export const riftHasMarker = async (riftPath) => {
  try {
    await fs.access(path.join(riftPath, '.rift'));
    return true;
  } catch {
    return false;
  }
};
