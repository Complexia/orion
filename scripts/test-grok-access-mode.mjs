import assert from 'node:assert/strict';
import { app } from 'electron';
import {
  grokPermissionModeForAccessMode,
  grokSessionModeForAccessMode,
} from '../src/main/grok-access-mode.js';

assert.equal(grokSessionModeForAccessMode('read-only'), 'default');
assert.equal(grokSessionModeForAccessMode('workspace-write'), 'default');
assert.equal(grokSessionModeForAccessMode('full-access'), null);
assert.equal(grokPermissionModeForAccessMode('read-only'), 'default');
assert.equal(grokPermissionModeForAccessMode('workspace-write'), 'acceptEdits');
assert.equal(grokPermissionModeForAccessMode('full-access'), null);

const { createGrokAcpDriver } = await import('../src/main/grok-driver.js');
const { commandForModel } = await import('../src/main/command-for-model.js');

const runDriver = async (accessMode) => {
  const requests = [];
  let driver;
  const child = {
    stdin: {
      write(raw) {
        const request = JSON.parse(raw);
        requests.push(request);
        queueMicrotask(() => {
          if (request.method === 'session/new') {
            driver.handleMessage({
              jsonrpc: '2.0',
              id: request.id,
              result: { sessionId: 'session-1' },
            });
            return;
          }
          if (request.method === 'session/prompt') {
            driver.handleMessage({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'done' },
                },
              },
            });
          }
          driver.handleMessage({ jsonrpc: '2.0', id: request.id, result: {} });
        });
      },
    },
  };
  let text = '';
  driver = createGrokAcpDriver({
    child,
    cwd: '/tmp/orion-grok-driver-test',
    promptText: 'Inspect only.',
    resumeSessionId: null,
    accessMode,
    callbacks: {
      onSessionId() {},
      onReasoning() {},
      onText(chunk) {
        text += chunk;
      },
      onActivity() {},
      onFatal(error) {
        throw new Error(error);
      },
      onTurnEnd() {},
    },
  });
  await driver.start();
  assert.equal(text, 'done');
  return requests;
};

const readOnlyRequests = await runDriver('read-only');
assert.deepEqual(
  readOnlyRequests.find((request) => request.method === 'session/set_mode')?.params,
  { sessionId: 'session-1', modeId: 'default' }
);
assert.equal(
  readOnlyRequests.some(
    (request) => request.method === 'session/set_mode' && request.params?.modeId === 'plan'
  ),
  false
);

const workspaceWriteRequests = await runDriver('workspace-write');
assert.equal(
  workspaceWriteRequests.find((request) => request.method === 'session/set_mode')?.params?.modeId,
  'default'
);

const fullAccessRequests = await runDriver('full-access');
assert.equal(
  fullAccessRequests.some((request) => request.method === 'session/set_mode'),
  false
);

const grokModel = { providerId: 'grok', slug: 'grok-4.6' };
const grokCommand = (accessMode) =>
  commandForModel(grokModel, {
    acp: true,
    accessMode,
    projectPath: '/tmp/orion-grok-driver-test',
    prompt: 'Inspect only.',
  });

assert.deepEqual(grokCommand('read-only').slice(0, 4), [
  'grok',
  '--permission-mode',
  'default',
  'agent',
]);
assert.deepEqual(grokCommand('workspace-write').slice(0, 4), [
  'grok',
  '--permission-mode',
  'acceptEdits',
  'agent',
]);
assert.deepEqual(grokCommand('full-access').slice(0, 3), ['grok', '--always-approve', 'agent']);

console.log('ok  Grok access modes keep read-only turns out of plan mode');
app.quit();
