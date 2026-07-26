import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Load the tracker as a plain Node module while replacing its two
// Electron/Vite-only imports with the small seams these regressions need.
const sourceUrl = new URL('../src/main/subagent-trackers.js', import.meta.url);
const source = (await fs.readFile(sourceUrl, 'utf8'))
  .replace(
    "import { emitAgentEvent } from './events.js';",
    'const emitAgentEvent = globalThis.__testEmitAgentEvent;'
  )
  .replace(
    "import { codexPlanActivity, extractActivitiesFromJsonEvent, stringifySummary } from './stream-adapters.js';",
    `const codexPlanActivity = () => null;
const extractActivitiesFromJsonEvent = () => [];
const stringifySummary = (value, limit = 120) => String(value ?? '').slice(0, limit);`
  );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

const emitted = [];
globalThis.__testEmitAgentEvent = (_sender, event) => emitted.push(event);

const {
  codexSubagentTitle,
  createSubagentTracker,
  handleCodexRolloutLine,
} = await import(moduleUrl);

const createRolloutHarness = () => {
  const events = [];
  return {
    events,
    api: {
      text: (text) => events.push(['text', text]),
      reasoning: () => {},
      activity: () => {},
      stats: () => {},
      prompt: () => {},
      finish: (info) => events.push(['finish', info]),
    },
    ctx: {},
  };
};

const legacy = createRolloutHarness();
handleCodexRolloutLine(
  {
    type: 'session_meta',
    payload: {
      id: '019f6ad8-4b45-7a11-ac07-3ed377575987',
      source: {
        subagent: {
          thread_spawn: {
            agent_path: '/root/ok_probe',
            parent_thread_id: '019f6ad8-05ae-72c2-afde-5c73ad4a8df8',
          },
        },
      },
    },
  },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: '019f6ad8-05f0-7000-8000-000000000000',
    },
  },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'replayed 0.144 parent output' },
  },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: '019f6ad8-05f0-7000-8000-000000000000',
    },
  },
  legacy.api,
  legacy.ctx
);
assert.deepEqual(
  legacy.events,
  [],
  'a one-meta 0.144 agent_path rollout must suppress replayed parent history'
);

handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: '019f6ad8-4b92-7ae2-9346-f665993520e3',
    },
  },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  { type: 'inter_agent_communication_metadata', payload: { receiver: 'ok_probe' } },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: { type: 'agent_message', message: '0.144 child output' },
  },
  legacy.api,
  legacy.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: '019f6ad8-4b92-7ae2-9346-f665993520e3',
    },
  },
  legacy.api,
  legacy.ctx
);
assert.deepEqual(legacy.events, [
  ['text', '0.144 child output'],
  ['finish', { status: 'done' }],
]);

const fork = createRolloutHarness();
handleCodexRolloutLine(
  {
    type: 'session_meta',
    timestamp: '2026-07-26T01:00:00.000Z',
    payload: { id: '019f98de-6914-7000-8000-000000000000' },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'session_meta',
    timestamp: '2026-07-25T23:00:00.000Z',
    payload: { id: '019f98c6-0f29-7000-8000-000000000000' },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      // The parent began in the same coarse timestamp second as the fork.
      // Its older UUIDv7 id still unambiguously places it before the child.
      turn_id: '019f98de-68f0-7000-8000-000000000000',
      started_at: Date.parse('2026-07-26T01:00:00.000Z') / 1000,
    },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  { type: 'inter_agent_communication_metadata', payload: { receiver: 'task-name-parent' } },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'replayed parent output' },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: '019f98de-68f0-7000-8000-000000000000',
    },
  },
  fork.api,
  fork.ctx
);
assert.deepEqual(
  fork.events,
  [],
  'a nested fork must ignore its task_name parent handoff and transcript replay'
);

handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: '019f98de-699f-7000-8000-000000000000',
      started_at: Date.parse('2026-07-26T01:00:00.000Z') / 1000,
    },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'child output' },
  },
  fork.api,
  fork.ctx
);
handleCodexRolloutLine(
  {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: '019f98de-699f-7000-8000-000000000000',
    },
  },
  fork.api,
  fork.ctx
);
assert.deepEqual(fork.events, [
  ['text', 'child output'],
  ['finish', { status: 'done' }],
]);

assert.equal(
  codexSubagentTitle({
    agentPath: '/root/review_findings',
    nickname: 'Newton',
  }),
  'review_findings',
  'task_name spawns must prefer their task name over a random nickname'
);
assert.equal(
  codexSubagentTitle({ nickname: 'Newton' }),
  'Newton',
  'fork_context spawns should retain their nickname'
);

const stepUpdates = [];
const trackerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-tracker-'));
const trackerFile = path.join(trackerDir, 'events.jsonl');
await fs.writeFile(trackerFile, `${JSON.stringify({ type: 'line' })}\n`);
const tracker = createSubagentTracker({
  providerId: 'codex',
  threadId: 'parent-thread',
  getSender: () => ({ isDestroyed: () => false }),
  getRunId: () => 'run-id',
  onMeta: (meta) => stepUpdates.push(meta),
});
tracker.start(
  { id: 'short-task', title: 'Short task' },
  {
    resolveFile: async () => trackerFile,
    handleLine: (_value, trackerApi) => {
      trackerApi.text('native child output');
      trackerApi.activity({
        key: 'tool-1',
        type: 'tool',
        title: 'Native child tool',
        status: 'running',
      });
    },
  }
);
await new Promise((resolve) => setTimeout(resolve, 400));
for (const type of ['subagent', 'subagent-chunk', 'subagent-activity']) {
  assert.equal(
    emitted.find((event) => event.type === type)?.providerId,
    'codex',
    `${type} events must carry the configured tracker provider`
  );
}
tracker.finish('short-task');
assert.equal(
  stepUpdates.at(-1)?.status,
  'done',
  'completion metadata must be emitted synchronously before parent teardown'
);
await fs.rm(trackerDir, { recursive: true, force: true });

console.log('subagent tracker regressions passed');
