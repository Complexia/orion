import { spawn } from 'node:child_process';

// Run in Orion's Node-capable Electron binary, outside the app's lifetime.
// The IPC channel is an ownership lease: even SIGKILL/app-update exit closes
// it. The supervisor then reaps the whole server process group, including the
// native Codex binary behind the JS launcher. Keep this program self-contained
// so it works from the packaged main bundle without an unpacked helper file.
const supervisorSource = String.raw`
const { spawn } = require('node:child_process');
const [command, args] = JSON.parse(process.argv[1]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(command, args, {
  env,
  stdio: [0, 1, 2],
  detached: process.platform !== 'win32',
});
let stopping = false;
let exitCode = 0;
let forceTimer;
let exitTimer;
let pollTimer;

const groupAlive = () => {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};
const signalGroup = (signal) => {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('error', () => { try { child.kill(signal); } catch {} });
    return;
  }
  try { process.kill(-child.pid, signal); } catch {}
};
const finish = () => {
  clearTimeout(forceTimer);
  clearTimeout(exitTimer);
  clearInterval(pollTimer);
  process.exit(exitCode);
};
const stop = () => {
  if (stopping) return;
  stopping = true;
  signalGroup('SIGTERM');
  // Finish before killAgentChild's two-second escalation can kill the
  // supervisor itself. A launcher exiting does not mean its children exited.
  forceTimer = setTimeout(() => signalGroup('SIGKILL'), 1500);
  exitTimer = setTimeout(finish, 1750);
  pollTimer = setInterval(() => { if (!groupAlive()) finish(); }, 25);
  if (!groupAlive()) finish();
};
process.on('disconnect', stop);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, stop);
child.on('error', (error) => {
  console.error(error.message);
  exitCode = 1;
  stop();
});
child.on('exit', (code, signal) => {
  if (!stopping) exitCode = code ?? (signal ? 1 : 0);
  stop();
});
// The owner may have exited before this program installed its listeners.
if (!process.connected) stop();
`;

export const spawnCodexServerProcess = (command, args, { cwd, env = process.env } = {}) =>
  spawn(process.execPath, ['-e', supervisorSource, JSON.stringify([command, args])], {
    cwd,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    // An owner process-group kill must leave the supervisor alive long
    // enough to observe IPC EOF and reap the separate Codex process group.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
