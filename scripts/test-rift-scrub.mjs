import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  RIFT_SCRUB_DIRECTORY_NAMES,
  RIFT_SCRUB_FILE_NAMES,
  scrubRiftWorkspace,
} from '../src/main/rift-scrub.js';

const execFileAsync = promisify(execFile);
const git = async (cwd, ...args) => (await execFileAsync('git', ['-C', cwd, ...args])).stdout;
const exists = async (target) => Boolean(await fs.lstat(target).catch(() => null));

const writeFile = async (filePath, content = '') => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const makeRepository = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-rift-scrub-'));
  await git(root, 'init', '-q', '-b', 'main', '.');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Orion Test');
  await git(root, 'config', 'commit.gpgsign', 'false');
  return root;
};

const test = async (name, run) => {
  const root = await makeRepository();
  try {
    await run(root);
    console.log(`ok - ${name}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

assert.deepEqual([...RIFT_SCRUB_DIRECTORY_NAMES], ['.next']);
assert.deepEqual([...RIFT_SCRUB_FILE_NAMES], ['package-lock.json']);

await test('removes .next anywhere except inside .git, node_modules, and .rift', async (root) => {
  await writeFile(path.join(root, 'app', 'page.tsx'), 'export default () => null;\n');
  await writeFile(path.join(root, 'apps', 'web', 'src', 'index.ts'), 'export {};\n');
  await writeFile(path.join(root, '.gitignore'), '.next/\nnode_modules/\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'init');
  await writeFile(path.join(root, '.next', 'dev', 'cache', 'turbopack', 'a.sst'), 'cache');
  await writeFile(path.join(root, 'apps', 'web', '.next', 'BUILD_ID'), 'x');
  await writeFile(path.join(root, 'node_modules', 'pkg', '.next', 'keep'), 'x');
  await writeFile(path.join(root, '.rift', '.next', 'keep'), 'x');
  await writeFile(path.join(root, '.git', 'something', '.next', 'keep'), 'x');

  const result = await scrubRiftWorkspace(root);

  assert.equal(await exists(path.join(root, '.next')), false);
  assert.equal(await exists(path.join(root, 'apps', 'web', '.next')), false);
  assert.equal(await exists(path.join(root, 'node_modules', 'pkg', '.next', 'keep')), true);
  assert.equal(await exists(path.join(root, '.rift', '.next', 'keep')), true);
  assert.equal(await exists(path.join(root, '.git', 'something', '.next', 'keep')), true);
  assert.equal(await exists(path.join(root, 'apps', 'web', 'src', 'index.ts')), true);
  assert.deepEqual(result.removedDirectories.sort(), [path.join(root, '.next'), path.join(root, 'apps', 'web', '.next')]);
  assert.deepEqual(result.removedFiles, []);
  assert.equal((await git(root, 'status', '--porcelain')).trim(), '');
});

await test('deletes untracked package-lock.json files without touching git state', async (root) => {
  await writeFile(path.join(root, 'README.md'), '# repo\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'init');
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await writeFile(path.join(root, 'packages', 'cli', 'package-lock.json'), '{}');

  const result = await scrubRiftWorkspace(root);

  assert.equal(await exists(path.join(root, 'package-lock.json')), false);
  assert.equal(await exists(path.join(root, 'packages', 'cli', 'package-lock.json')), false);
  assert.deepEqual(result.skipWorktreeFiles, []);
  assert.equal((await git(root, 'status', '--porcelain')).trim(), '');
});

await test('deletes a tracked package-lock.json and hides the deletion from git', async (root) => {
  await writeFile(path.join(root, 'orion-next', 'package-lock.json'), '{"lockfileVersion":3}');
  await writeFile(path.join(root, 'orion-next', 'bun.lock'), '{}');
  await writeFile(path.join(root, 'orion-next', 'app', 'page.tsx'), 'export default () => null;\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'init');
  await git(root, 'checkout', '-q', '-b', 'orion/feature-abc');

  const result = await scrubRiftWorkspace(root);

  assert.equal(await exists(path.join(root, 'orion-next', 'package-lock.json')), false);
  assert.deepEqual(result.skipWorktreeFiles, ['orion-next/package-lock.json']);
  assert.equal((await git(root, 'status', '--porcelain')).trim(), '', 'status must stay clean');

  // The agent's usual flow: edit, `git add -A`, commit. The lockfile must
  // survive in the tree unchanged and never appear as a deletion.
  await writeFile(path.join(root, 'orion-next', 'app', 'page.tsx'), 'export default () => "changed";\n');
  await git(root, 'add', '-A');
  assert.equal((await git(root, 'diff', '--cached', '--name-status')).trim(), 'M\torion-next/app/page.tsx');
  await git(root, 'commit', '-qm', 'change');
  assert.equal((await git(root, 'ls-tree', '-r', '--name-only', 'HEAD')).includes('orion-next/package-lock.json'), true);
  assert.equal(
    (await git(root, 'show', 'HEAD:orion-next/package-lock.json')).trim(),
    '{"lockfileVersion":3}'
  );

  // reset --hard and clean must not resurrect it or dirty the tree.
  await git(root, 'reset', '-q', '--hard', 'HEAD');
  await git(root, 'clean', '-ffdq');
  assert.equal(await exists(path.join(root, 'orion-next', 'package-lock.json')), false);
  assert.equal((await git(root, 'status', '--porcelain')).trim(), '');

  // Running the scrub again on an already-scrubbed rift is a no-op.
  const again = await scrubRiftWorkspace(root);
  assert.deepEqual(again, { removedDirectories: [], removedFiles: [], skipWorktreeFiles: [] });
});

await test('removes a symlinked .next without following it', async (root) => {
  await writeFile(path.join(root, 'README.md'), '# repo\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'init');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-rift-scrub-target-'));
  try {
    await writeFile(path.join(outside, 'precious'), 'keep me');
    await fs.symlink(outside, path.join(root, '.next'));

    await scrubRiftWorkspace(root);

    assert.equal(await exists(path.join(root, '.next')), false);
    assert.equal(await exists(path.join(outside, 'precious')), true);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

console.log('rift scrub tests passed');
