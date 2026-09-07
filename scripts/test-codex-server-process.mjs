import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { spawnCodexServerProcess } from '../src/main/codex-server-process.js';
import { killAgentChild } from '../src/main/run-registry.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitUntil = async (predicate, label) => {
  const deadline = Date.now() + 7000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label);
    await delay(25);
  }
};
const nativeSource = `
  process.on('SIGTERM', () => {});
  console.log(JSON.stringify({ native: process.pid, launcher: process.ppid,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }));
  setInterval(() => {}, 1000);
`;
const launcherSource = `
  const { spawn } = require('node:child_process');
  spawn(process.execPath, ['-e', ${JSON.stringify(nativeSource)}], { stdio: ['ignore', 1, 2] });
  process.stdin.on('data', () => process.exit(0));
  setInterval(() => {}, 1000);
`;
const readReady = (child) => new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error('Fixture did not start: ' + output)), 7000);
  child.stderr.on('data', (data) => { output += data; });
  child.stdout.on('data', (data) => {
    output += data;
    const line = output.split('\n').find((entry) => entry.startsWith('{'));
    if (!line) return;
    try { const pids = JSON.parse(line); clearTimeout(timer); resolve(pids); } catch {}
  });
  child.on('error', reject);
});
const assertReaped = async (pids) => {
  await waitUntil(() => !alive(pids.native) && !alive(pids.launcher),
    'both the launcher and its SIGTERM-resistant native server must exit');
};

// The production helper must preserve protocol stdio and strip the Electron
// flag before executing provider launchers. A launcher exiting early must not
// let its native child outlive Orion's ownership lease.
for (const mode of ['shutdown', 'launcher-exit', 'owner-disconnect']) {
  const child = spawnCodexServerProcess(process.execPath, ['-e', launcherSource]);
  const exited = once(child, 'exit');
  let pids;
  try {
    pids = await readReady(child);
    assert.equal(pids.electronRunAsNode, null);
    if (mode === 'shutdown') await killAgentChild(child);
    if (mode === 'launcher-exit') child.stdin.write('exit\n');
    if (mode === 'owner-disconnect') child.disconnect();
    await exited;
    await assertReaped(pids);
  } finally {
    await killAgentChild(child);
    if (pids && alive(pids.native)) process.kill(pids.native, 'SIGKILL');
  }
}

// Simulate Orion being killed, without running any app teardown handler.
// Only the IPC ownership pipe can notify the supervisor in this case.
{
  const moduleUrl = new URL('../src/main/codex-server-process.js', import.meta.url).href;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawnCodexServerProcess } from ${JSON.stringify(moduleUrl)};
    const child = spawnCodexServerProcess(process.execPath, ['-e', ${JSON.stringify(launcherSource)}]);
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    console.log(JSON.stringify({ supervisor: child.pid }));
  `], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let supervisor;
  let pids;
  let ownerOutput = '';
  let ownerErrors = '';
  owner.stderr.on('data', (data) => { ownerErrors += data; });
  let readyTimeout;
  const ready = new Promise((resolve) => owner.stdout.on('data', (data) => {
    ownerOutput += data;
    for (const line of ownerOutput.split('\n')) {
      try {
        const value = JSON.parse(line);
        supervisor ??= value.supervisor;
        if (value.native) resolve(value);
      } catch {}
    }
  }));
  try {
    pids = await Promise.race([ready, new Promise((_, reject) => {
      readyTimeout = setTimeout(() => reject(new Error('Owner fixture did not start: ' + ownerOutput + ownerErrors)), 7000);
    })]);
    clearTimeout(readyTimeout);
    assert.ok(supervisor, 'the supervisor pid must be captured');
    if (process.platform === 'win32') owner.kill('SIGKILL');
    else process.kill(-owner.pid, 'SIGKILL');
    await assertReaped(pids);
    await waitUntil(() => !alive(supervisor), 'supervisor must exit after reaping the orphaned server');
  } finally {
    clearTimeout(readyTimeout);
    owner.kill('SIGKILL');
    if (supervisor && alive(supervisor)) process.kill(supervisor, 'SIGTERM');
    if (pids && alive(pids.native)) process.kill(pids.native, 'SIGKILL');
  }
}

console.log('Codex server process ownership tests passed.');
