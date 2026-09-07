// Integration test against the installed Codex runtime. Uses an empty,
// temporary CODEX_HOME and a local Responses stub: no account or model calls.
// Run with: node scripts/run-electron-test.mjs scripts/test-codex-resume-live.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { app } from 'electron';
import { createCodexAppServerManager } from '../src/main/codex-app-server-manager.js';
import { spawnCodexServerProcess } from '../src/main/codex-server-process.js';
import { createCodexAppServerDriver } from '../src/main/codex-driver.js';
import { loginShell } from '../src/main/shell-env.js';

const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-codex-resume-'));
const servers = [];
const managers = [];
const clients = [];
const modelRequests = [];
const responseServer = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (request.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
    if (request.headers['content-encoding'] === 'zstd') body = zstdDecompressSync(body);
    modelRequests.push(JSON.parse(body.toString()));
    const message = { id: 'msg_test', type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'Synthetic response for the Orion resume regression test.' }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { id: 'resp_test' } },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [message],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
    ]) response.write('data: ' + JSON.stringify(event) + '\n\n');
    response.end();
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
responseServer.listen(0, '127.0.0.1');
await once(responseServer, 'listening');
const makeManager = () => {
  const manager = createCodexAppServerManager({
    spawnServer: () => {
      const child = spawnCodexServerProcess(loginShell, ['-lc', 'codex app-server --listen ws://127.0.0.1:0'], {
        cwd: codexHome,
        env: { ...process.env, CODEX_HOME: codexHome },
      });
      servers.push(child);
      return child;
    },
    idleTimeoutMs: 60_000,
  });
  managers.push(manager);
  return manager;
};
const connect = async (manager) => {
  const lease = await manager.acquire();
  assert.equal(lease.persistent, true, 'the actual installed Codex server must start');
  clients.push(lease);
  let nextId = 0;
  const pending = new Map();
  const completed = [];
  let buffer = '';
  const handleData = (data) => {
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.id !== undefined && !message.method) pending.get(message.id)?.(message);
      if (message.method === 'turn/completed') completed.push(message.params.turn);
    }
  };
  lease.child.stdout.on('data', handleData);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20_000);
    pending.set(id, (value) => { clearTimeout(timer); pending.delete(id); resolve(value); });
    lease.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const turn = async (threadId, text) => {
    const result = await request('turn/start', { threadId, input: [{ type: 'text', text }] });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    const deadline = Date.now() + 20_000;
    while (!completed.some((entry) => entry.id === result.result.turn.id)) {
      assert.ok(Date.now() < deadline, 'synthetic turn must complete');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(completed.find((entry) => entry.id === result.result.turn.id).status, 'completed');
  };
  return { lease, request, turn, detach: () => lease.child.stdout.removeListener('data', handleData) };
};
const initialize = async (client) => {
  const response = await client.request('initialize', {
    clientInfo: { name: 'orion-resume-test', version: '1.0.0' },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
};
const threadParams = {
  cwd: codexHome,
  model: 'gpt-6-astra',
  approvalPolicy: 'never',
  sandbox: 'read-only',
  config: {
    model_provider: 'orion_test',
    'model_providers.orion_test': {
      name: 'Orion local regression test',
      base_url: `http://127.0.0.1:${responseServer.address().port}/v1`,
      wire_api: 'responses', requires_openai_auth: false, supports_websockets: false,
    },
  },
};
const marker = 'ORION_RESUME_TEST_HISTORY_749a54: the friction was Invalid token in CLI PR listing.';

try {
  const owner = makeManager();
  let client = await connect(owner);
  await initialize(client);
  const created = await client.request('thread/start', threadParams);
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const threadId = created.result.thread.id;
  await client.turn(threadId, marker);
  assert.ok(JSON.stringify(modelRequests.at(-1)).includes(marker));

  // Reproduce the exact cross-process writer conflict using the real driver.
  const competitor = makeManager();
  const conflicting = await connect(competitor);
  conflicting.detach();
  const failures = [];
  const reportedIds = [];
  const wire = [];
  const write = conflicting.lease.child.stdin.write;
  conflicting.lease.child.stdin.write = (line) => { wire.push(JSON.parse(line)); return write(line); };
  const driver = createCodexAppServerDriver({
    child: conflicting.lease.child, cwd: codexHome,
    model: { providerId: 'codex', id: 'codex:gpt-6-astra', slug: 'gpt-6-astra' },
    input: { prompt: 'fix that friction', providerOptions: { browserUse: 'off' } },
    resumeSessionId: threadId, accessMode: 'read-only',
    callbacks: {
      onFatal: (message) => failures.push(message),
      onSessionId: (id) => reportedIds.push(id),
      onActivity: () => {},
      onResumeFallback: () => assert.fail('must preserve the conversation on writer conflict'),
    },
  });
  conflicting.lease.child.stdout.on('data', (data) => {
    for (const line of String(data).trim().split('\n')) driver.handleMessage(JSON.parse(line));
  });
  await driver.start();
  assert.equal(failures.length, 1);
  assert.match(failures[0], /already has an active writer/);
  assert.deepEqual(reportedIds, []);
  assert.equal(wire.some((message) => ['thread/start', 'turn/start'].includes(message.method)), false);
  await driver.dispose();
  conflicting.lease.release();
  await competitor.shutdown();
  console.log('Real writer conflict preserved the original session and surfaced its cause.');

  for (const mode of ['recycle', 'owner-loss']) {
    const server = servers.findLast((entry) => entry.exitCode === null && entry.signalCode === null);
    client.lease.release();
    if (mode === 'recycle') await owner.recycle();
    else {
      const exited = once(server, 'exit');
      server.disconnect();
      await exited;
    }
    client = await connect(owner);
    await initialize(client);
    const resumed = await client.request('thread/resume', { threadId, ...threadParams });
    assert.equal(resumed.error, undefined, JSON.stringify(resumed.error));
    assert.equal(resumed.result.thread.id, threadId);
    const read = await client.request('thread/read', { threadId, includeTurns: true });
    assert.equal(read.error, undefined, JSON.stringify(read.error));
    assert.ok(JSON.stringify(read.result).includes(marker), 'the prior conversation must survive ' + mode);
    await client.turn(threadId, 'What was the friction?');
    assert.ok(JSON.stringify(modelRequests.at(-1)).includes(marker),
      'Codex must send the prior context with the follow-up after ' + mode);
    console.log('Real Codex resumed the same session with its history after ' + mode + '.');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) client.release();
  await Promise.all(managers.map((manager) => manager.shutdown()));
  await fs.rm(codexHome, { recursive: true, force: true });
  responseServer.closeAllConnections();
  await new Promise((resolve) => responseServer.close(resolve));
  app.exit(process.exitCode ?? 0);
}
