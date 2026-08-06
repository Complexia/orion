import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sourceUrl = new URL('../src/main/dev-servers.js', import.meta.url);
const source = (await fs.readFile(sourceUrl, 'utf8')).replace(
  "import { execFileAsync } from './shell-env.js';",
  'const execFileAsync = (...args) => globalThis.__testExecFileAsync(...args);'
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

globalThis.__testExecFileAsync = async () => ({ stdout: '' });
const {
  devServerUrlForPort,
  killDevServers,
  listDevServers,
  runTool,
  uniqueSessionThreadsByCwd,
} = await import(moduleUrl);

assert.equal(devServerUrlForPort(3000), 'http://localhost:3000');
assert.throws(() => devServerUrlForPort('https://example.com'), /Invalid dev server port/);
assert.throws(() => devServerUrlForPort(65536), /Invalid dev server port/);

assert.deepEqual(
  [...uniqueSessionThreadsByCwd([
    { cwd: '/private/tmp/project', threadId: 'thread-a' },
    { cwd: '/tmp/project/', threadId: 'thread-b' },
    { cwd: '/tmp/other', threadId: 'thread-c' },
  ])],
  [['/tmp/other', 'thread-c']],
  'a cwd shared by different live sessions must remain ambiguous'
);
assert.deepEqual(
  [...uniqueSessionThreadsByCwd([
    { cwd: '/tmp/project', threadId: 'thread-a' },
    { cwd: '/tmp/project/', threadId: 'thread-a' },
  ])],
  [['/tmp/project', 'thread-a']],
  'duplicate records for the same thread remain attributable'
);

const expectedLsofExit = Object.assign(new Error('no matches'), { code: 1, stdout: '' });
globalThis.__testExecFileAsync = async () => {
  throw expectedLsofExit;
};
assert.equal(
  await runTool('lsof', [], { acceptedExitCodes: [1] }),
  '',
  'lsof exit 1 may represent a valid empty result'
);

for (const failure of [
  Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT', stdout: '' }),
  Object.assign(new Error('timed out'), { code: null, killed: true, signal: 'SIGTERM', stdout: '' }),
  Object.assign(new Error('unexpected exit'), { code: 2, stdout: 'partial' }),
]) {
  globalThis.__testExecFileAsync = async () => {
    throw failure;
  };
  await assert.rejects(runTool('lsof', [], { acceptedExitCodes: [1] }), (error) => error === failure);
}

const psFailure = Object.assign(new Error('ps failed'), { code: 1, stdout: '' });
globalThis.__testExecFileAsync = async (file, args) => {
  if (file === 'lsof' && args.includes('-iTCP')) {
    return { stdout: 'p4242\ncnode\nn*:3000\n' };
  }
  if (file === 'lsof' && args.includes('cwd')) {
    return { stdout: 'p4242\nn/tmp/project\n' };
  }
  if (file === 'ps') throw psFailure;
  return { stdout: '' };
};
const failedScan = await listDevServers({ roots: ['/tmp/project'] });
assert.equal(failedScan.ok, false);
assert.match(failedScan.error, /ps failed/);
assert.deepEqual(failedScan.servers, [], 'a failed process inspection must not masquerade as an empty scan');

const failedKillInspection = await killDevServers({ targets: [{ pid: 4242, port: 3000 }] });
assert.equal(failedKillInspection.ok, false);
assert.match(failedKillInspection.error, /ps failed/);
assert.deepEqual(
  failedKillInspection.results,
  [],
  'a kill request must stop before signalling when protected-process ancestry is unavailable'
);

console.log('Dev server regression tests passed.');
