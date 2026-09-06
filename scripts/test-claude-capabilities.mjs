import assert from 'node:assert/strict';
import { app } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeNoticeActivity, claudeUserContent, createClaudeInputRequests } from '../src/main/claude-input.js';
import { createClaudeSdkSession, supportsClaudeSdkRuntime, claudeSdkOptionsForInput, steerClaudeSdkRun, claudeSdkSessions } from '../src/main/claude-driver.js';
import { claudeModelArgForContextWindow } from '../src/main/models.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-claude-test-'));
try {
  const image = path.join(dir, 'screen.png');
  const pdf = path.join(dir, 'source.pdf');
  await fs.writeFile(image, Buffer.from([137, 80, 78, 71]));
  await fs.writeFile(pdf, '%PDF-1.7');
  const content = await claudeUserContent('Inspect these', [
    { path: image, mimeType: 'image/png' }, { path: pdf, mimeType: 'application/pdf' },
    { path: image, mimeType: 'image/png' }, { path: '/not-read.txt', mimeType: 'text/plain' },
    { path: 'relative.png', mimeType: 'image/png' },
  ]);
  assert.deepEqual(content.map((part) => part.type), ['text', 'image', 'document']);
  assert.equal(content[1].source.data, Buffer.from([137, 80, 78, 71]).toString('base64'));
  await assert.rejects(claudeUserContent('missing', [{ path: path.join(dir, 'missing.png'), mimeType: 'image/png' }]));

  const events = [];
  const sender = { isDestroyed: () => false, send: (_channel, event) => events.push(event) };
  const session = { sender, threadId: 'thread', activeTurns: [{ runId: 'run' }] };
  const requests = createClaudeInputRequests(session);
  const controller = new AbortController();
  const input = { questions: [
    { question: 'Choose sections', header: 'Sections', multiSelect: true, options: [{ label: 'Intro' }, { label: 'Results' }] },
    { question: 'Any requirements?', header: 'Details', options: [] },
  ] };
  const result = requests.canUseTool('AskUserQuestion', input, { signal: controller.signal });
  const ask = requests.list()[0];
  assert.equal(ask.providerId, 'claude');
  assert.equal(ask.questions[0].multiSelect, true);
  assert.equal(requests.answer('other-run', ask.requestId, { 0: ['Intro'], 1: ['Keep links'] }), false);
  assert.equal(requests.answer('run', ask.requestId, { 0: [], 1: ['Keep links'] }), false);
  assert.equal(requests.answer('run', ask.requestId, { 0: ['Intro', 'Results'], 1: ['Keep links'] }), true);
  assert.deepEqual((await result).updatedInput.answers, { 'Choose sections': 'Intro, Results', 'Any requirements?': 'Keep links' });
  assert.equal(requests.answer('run', ask.requestId, {}), false);
  assert.deepEqual(requests.list(), []);

  const cancelled = requests.canUseTool('AskUserQuestion', input, { signal: controller.signal });
  controller.abort();
  assert.equal((await cancelled).behavior, 'deny');
  assert.deepEqual(requests.list(), []);
  const permission = requests.canUseTool('Bash', { command: 'echo test' }, { title: 'Run this command?' });
  const approval = requests.list()[0];
  assert.match(approval.detail, /echo test/);
  assert.equal(approval.questions[0].allowCustom, false);
  assert.equal(requests.answer('run', approval.requestId, { permission: ['invented approval'] }), false);
  assert.equal(requests.answer('run', approval.requestId, { permission: ['Allow once'] }), true);
  assert.deepEqual(await permission, { behavior: 'allow', updatedInput: { command: 'echo test' } });
  const denied = requests.canUseTool('Bash', { command: 'echo second' });
  assert.equal(requests.answer('run', requests.list()[0].requestId, { permission: ['Deny'] }), true);
  assert.equal((await denied).behavior, 'deny');
  const stopped = requests.canUseTool('AskUserQuestion', input);
  requests.cancelAll();
  assert.equal((await stopped).behavior, 'deny');
  session.sender = { isDestroyed: () => false, send: () => { throw new Error('window closed'); } };
  const windowRace = requests.canUseTool('AskUserQuestion', input);
  const stillPending = requests.list()[0];
  assert.equal(requests.answer('run', stillPending.requestId, { 0: ['Intro'], 1: ['Keep links'] }), true);
  assert.equal((await windowRace).behavior, 'allow', 'window closure cannot strand a native SDK response');
  session.sender = sender;
  session.disposed = true;
  assert.equal((await requests.canUseTool('AskUserQuestion', input)).behavior, 'deny');
  assert.ok(events.every((event) => event.threadId === 'thread' && event.runId === 'run' && event.type === 'user-input'));

  const model = { providerId: 'claude', slug: 'claude-fable-5-1' };
  const sdkSession = createClaudeSdkSession({ sender, threadId: 'native', projectPath: dir, model, input: {} });
  sdkSession.pushUserMessage('Inspect these', { content });
  assert.deepEqual((await sdkSession.inputQueue.stream().next()).value.message.content, content);
  assert.deepEqual(sdkSession.firstContent, content, 'resume fallback retains the exact native input');
  sdkSession.query = {};
  sdkSession.backgroundRunId = 'steer-run';
  claudeSdkSessions.set('native', sdkSession);
  assert.equal(await steerClaudeSdkRun('steer-run', 'Inspect these', [{ path: image, mimeType: 'image/png' }, { path: pdf, mimeType: 'application/pdf' }]), true);
  assert.deepEqual((await sdkSession.inputQueue.stream().next()).value.message.content, content, 'steering sends native attachments through the live input queue');
  sdkSession.dispose();
  claudeSdkSessions.delete('native');
  const appSource = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /\['kimi', 'claude', 'codex'\]\.includes\(model\.providerId\)[\s\S]{0,100}attachments: turnAttachments/, 'ordinary composer turns must forward attachment metadata to native providers');
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(claudeSdkOptionsForInput(model, { claudeReasoningEffort: effort }).effort, effort);
  }
  assert.equal(claudeSdkOptionsForInput(model, {}).effort, 'high');
  assert.equal(claudeModelArgForContextWindow(model.slug, '1m'), 'claude-fable-5-1[1m]');
  assert.equal(claudeModelArgForContextWindow(model.slug, '200k'), model.slug);
  assert.equal(supportsClaudeSdkRuntime('2.1.254 (Claude Code)'), false);
  assert.equal(supportsClaudeSdkRuntime('2.1.261 (Claude Code)'), true);
  assert.equal(supportsClaudeSdkRuntime('2.2.0 (Claude Code)'), true);
  assert.equal(supportsClaudeSdkRuntime('invalid'), false);
  assert.equal(claudeNoticeActivity({ type: 'system', subtype: 'model_refusal_fallback', content: 'Continuing on Opus', uuid: 'f' }).detail, 'Continuing on Opus');
  assert.equal(claudeNoticeActivity({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3, retry_delay_ms: 2000 }).title, 'Claude is retrying');
  assert.equal(claudeNoticeActivity({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), null);
  assert.equal(claudeNoticeActivity({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }).title, 'Claude usage limit reached');
  console.log('Claude capabilities tests passed');
} finally { await fs.rm(dir, { recursive: true, force: true }); app.quit(); }
