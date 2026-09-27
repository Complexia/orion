import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asyncAnswerText, type CodexQuestionRequest } from '../src/app/CodexQuestions';
import { createThreadSteeringCoordinator } from '../src/app/thread-steering.js';
import { createCompletedCodexQuestions } from '../src/main/codex-questions.js';

const request = (question: string): CodexQuestionRequest => ({
  runId: 'run', requestId: question, threadId: 'thread', async: true,
  questions: [{ id: '0', header: 'Question', question }],
});

// Identical answers to separate outstanding cards must stay distinguishable.
assert.equal(asyncAnswerText(request('Update the dependency?'), { 0: ['Yes'] }), 'Update the dependency?\nYes');
assert.equal(asyncAnswerText(request('Publish the release?'), { 0: ['Yes'] }), 'Publish the release?\nYes');
const multiple = request('Which design?');
multiple.questions.push({ id: '1', header: 'Scope', question: 'Which platforms?' });
assert.equal(asyncAnswerText(multiple, { 0: ['B'], 1: ['Mac', 'Linux'] }), 'Which design?\nB\n\nWhich platforms?\nMac, Linux');

// Execute the renderer's shared recording path with a live run, then with a
// run that completed before acknowledgement. Neither case may resend input.
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const recordSource = appSource.slice(appSource.indexOf('  const recordSteeredMessage = ('), appSource.indexOf('  const performSteerWithContent = async ('));
const recordCode = new Bun.Transpiler({ loader: 'tsx' }).transformSync(recordSource);
for (const running of [true, false]) {
  const thread: any = { id: 'thread', messages: [{ id: 'agent', role: 'agent', content: 'Working', status: running ? 'running' : 'done' }], linkedTasks: [] };
  const tracked = new Map(running ? [['run', { threadId: 'thread', messageId: 'agent' }]] : []);
  let nextId = 0;
  const record = new Function('pinThreadToBottom', 'flushChunkBuffers', 'runOutputMessages', 'useOrionStore', 'updateThreadMessage', 'updateThread', 'pushLinkedTaskStatus', 'addMessageToThread', `${recordCode}\nreturn recordSteeredMessage;`)(
    () => {}, () => {}, { current: tracked }, { getState: () => ({ threads: [thread] }) },
    (_threadId: string, id: string, patch: object) => Object.assign(thread.messages.find((message: any) => message.id === id), patch),
    (_threadId: string, patch: object) => Object.assign(thread, patch), () => {},
    (_threadId: string, message: object) => {
      const id = `new-${++nextId}`;
      thread.messages.push({ id, ...message });
      return id;
    },
  );
  record('thread', 'run', { userContent: 'Which design?\nB', tasksToInject: [], turnAttachments: [] });
  assert.equal(thread.messages.filter((message: any) => message.role === 'user').length, 1);
  assert.equal(thread.messages[1].content, 'Which design?\nB');
  assert.equal(thread.messages[0].status, 'done');
  assert.equal(thread.messages.length, running ? 3 : 2);
  if (running) assert.equal(tracked.get('run')?.messageId, thread.messages[2].id, 'subsequent goal output follows the reply');
  else assert.equal(tracked.size, 0, 'a late acknowledgement cannot resurrect a finished run');
}

const answerStart = appSource.indexOf('  const answerAsyncQuestion = (');
const answerEnd = appSource.indexOf('  // Composer ⚡ / ⌘⏎', answerStart);
assert.ok(answerStart >= 0 && answerEnd > answerStart);
const answerCode = new Bun.Transpiler({ loader: 'tsx' }).transformSync(appSource.slice(answerStart, answerEnd));
const makeAnswer = (coordinator: any, send: (...args: any[]) => any, record: (...args: any[]) => any, followUp: (...args: any[]) => any) =>
  new Function('steeringCoordinatorRef', 'window', 'asyncAnswerText', 'recordSteeredMessage', 'performSteerWithContent', `${answerCode}\nreturn answerAsyncQuestion;`)(
    { current: coordinator }, { orion: { answerCodexQuestions: send } }, asyncAnswerText, record, followUp,
  );

for (const stop of [false, true]) {
  for (const delivered of [false, true]) {
    const coordinator = createThreadSteeringCoordinator();
    const completed = createCompletedCodexQuestions();
    const question = request('Which design?');
    const effects: string[] = [];
    let settle!: (value: boolean) => void;
    const nativeReply = new Promise<boolean>((resolve) => { settle = resolve; });
    const answer = makeAnswer(coordinator,
      (runId, requestId, answers, text) => completed.deliver(runId, requestId, answers, text, { answerAsyncUserInput: () => nativeReply }),
      () => effects.push('record'),
      async (_threadId, _text, _attachments, cancelled) => { if (!cancelled()) effects.push('follow-up'); },
    );
    const submission = answer(question, { 0: ['B'] });
    await Promise.resolve(); // Native submission is now in flight.
    completed.retain('run', [question]); // The run finishes before its RPC reply.
    if (stop) coordinator.cancel(['thread']);
    settle(delivered); // Disposal rejects, or a native acknowledgement arrives late.
    assert.equal(await submission, !stop);
    assert.deepEqual(effects, stop ? [] : [delivered ? 'record' : 'follow-up'], 'Stop must suppress both fallback delivery and late transcript updates');
  }
}

// Cancellation must also survive asynchronous preparation of a follow-up.
{
  const coordinator = createThreadSteeringCoordinator();
  let finishPreparation!: () => void;
  let beganPreparation!: () => void;
  const preparing = new Promise<void>((resolve) => { beganPreparation = resolve; });
  const prepared = new Promise<void>((resolve) => { finishPreparation = resolve; });
  let sent = false;
  const answer = makeAnswer(coordinator, async () => true, () => assert.fail('not delivered'),
    async (_threadId, _text, _attachments, cancelled) => {
      beganPreparation();
      await prepared;
      if (!cancelled()) sent = true;
    });
  const submission = answer(request('Which design?'), { 0: ['B'] });
  await preparing;
  coordinator.cancel(['thread']);
  finishPreparation();
  assert.equal(await submission, false);
  assert.equal(sent, false, 'fallback preparation must keep the original cancellation check');
}

// A queued answer cancelled before its turn must never reach IPC.
{
  const coordinator = createThreadSteeringCoordinator();
  let release!: () => void;
  const first = coordinator.enqueue('thread', () => new Promise<void>((resolve) => { release = resolve; }));
  await Promise.resolve();
  const answer = makeAnswer(coordinator, () => assert.fail('cancelled answer reached IPC'), () => {}, () => {});
  const submission = answer(request('Which design?'), { 0: ['B'] });
  coordinator.cancel(['thread']);
  release();
  await first;
  assert.equal(await submission, false);
}
console.log('Codex async answer context, transcript, and cancellation checks passed.');
