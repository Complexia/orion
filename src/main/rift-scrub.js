import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileAsync } from './shell-env.js';

// Rifts are exact copy-on-write clones of the source checkout, ignored build
// output included (see riftCreate). Some of that output is actively harmful in
// a second location:
//
// - `.next/` carries Turbopack's persistent dev cache (often > 1 GB), the dev
//   server lock, and traces from the source checkout. A dev server started in
//   the rift loads that cache for a tree it never built, which has pinned all
//   cores and exhausted memory on real machines.
// - `package-lock.json` next to a `bun.lock` makes Next.js guess a workspace
//   root and warn about it on every start; Orion projects use bun, so the npm
//   lockfile only ever exists as a stale artifact.
//
// Every new rift is scrubbed of both before an agent can touch it. Directories
// are removed wherever they occur in the tree (a monorepo has one per app);
// `.git`, `node_modules`, and Rift's own `.rift` metadata are never entered.
export const RIFT_SCRUB_DIRECTORY_NAMES = Object.freeze(['.next']);
export const RIFT_SCRUB_FILE_NAMES = Object.freeze(['package-lock.json']);
const SKIP_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.rift']);

const collectScrubTargets = async (rootPath) => {
  const directories = [];
  const files = [];
  const walk = async (directoryPath) => {
    let entries;
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        // Never follow links: a symlink named `.next` is removed as a link
        // and its target is left alone.
        if (RIFT_SCRUB_DIRECTORY_NAMES.includes(entry.name)) directories.push(entryPath);
        else if (RIFT_SCRUB_FILE_NAMES.includes(entry.name)) files.push(entryPath);
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
        if (RIFT_SCRUB_DIRECTORY_NAMES.includes(entry.name)) {
          directories.push(entryPath);
          continue;
        }
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && RIFT_SCRUB_FILE_NAMES.includes(entry.name)) files.push(entryPath);
    }
  };
  await walk(rootPath);
  return { directories, files };
};

// Paths git tracks under `rootPath`, as repository-relative POSIX paths.
const readTrackedPaths = async (rootPath) => {
  const { stdout } = await execFileAsync('git', ['-C', rootPath, 'ls-files', '-z'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(stdout.split('\0').filter(Boolean));
};

const toRepositoryPath = (rootPath, filePath) => path.relative(rootPath, filePath).split(path.sep).join('/');

// Removes build artifacts and stray lockfiles from a freshly created rift at
// `rootPath` (a git repository root). Untracked matches are simply deleted.
// A tracked `package-lock.json` is deleted too, then flagged skip-worktree so
// git treats it as present and unchanged: it never shows in `git status`,
// `git add -A` does not stage a deletion, `reset --hard` does not restore it,
// and commits keep the file exactly as the source branch has it.
//
// Call this after the rift's branch is checked out; git refuses to switch
// branches when a skip-worktree file differs between them, and the creation
// flows switch branches only before this step.
export const scrubRiftWorkspace = async (rootPath) => {
  const { directories, files } = await collectScrubTargets(rootPath);
  const tracked = files.length > 0 ? await readTrackedPaths(rootPath) : new Set();

  for (const directoryPath of directories) {
    await fs.rm(directoryPath, { recursive: true, force: true });
  }

  const skipWorktree = [];
  for (const filePath of files) {
    await fs.rm(filePath, { force: true });
    const repositoryPath = toRepositoryPath(rootPath, filePath);
    if (tracked.has(repositoryPath)) skipWorktree.push(repositoryPath);
  }
  if (skipWorktree.length > 0) {
    await execFileAsync('git', ['-C', rootPath, 'update-index', '--skip-worktree', '--', ...skipWorktree]);
  }

  return {
    removedDirectories: directories,
    removedFiles: files,
    skipWorktreeFiles: skipWorktree,
  };
};
