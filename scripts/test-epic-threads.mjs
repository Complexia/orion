import assert from 'node:assert/strict';
import { epicThreadRows } from '../src/app/epicThreads.ts';

const thread = (id, options = {}) => ({
  id,
  projectId: 'project',
  title: id,
  status: 'idle',
  modelId: 'codex:test',
  accessMode: 'full-access',
  createdAt: options.createdAt ?? '2026-08-01T00:00:00.000Z',
  messages: options.activityAt
    ? [{ id: `${id}-message`, role: 'user', content: id, ts: options.activityAt }]
    : [],
  ...(options.parentThreadId ? { parentThreadId: options.parentThreadId } : {}),
  ...('epicId' in options ? { epicId: options.epicId } : {}),
});

{
  const rows = epicThreadRows(
    [
      thread('older-root', { epicId: 'epic', activityAt: '2026-08-01T01:00:00.000Z' }),
      thread('newer-root', { epicId: 'epic', activityAt: '2026-08-01T04:00:00.000Z' }),
      thread('older-child', {
        epicId: 'epic',
        parentThreadId: 'older-root',
        activityAt: '2026-08-01T02:00:00.000Z',
      }),
      thread('newer-child', {
        epicId: 'epic',
        parentThreadId: 'older-root',
        activityAt: '2026-08-01T03:00:00.000Z',
      }),
      thread('legacy-grandchild', {
        parentThreadId: 'newer-child',
        activityAt: '2026-08-01T03:30:00.000Z',
      }),
      thread('other-epic-child', {
        epicId: 'other',
        parentThreadId: 'older-root',
        activityAt: '2026-08-01T05:00:00.000Z',
      }),
    ],
    'epic'
  );

  assert.deepEqual(
    rows.map(({ thread: rowThread, depth }) => [rowThread.id, depth]),
    [
      ['newer-root', 0],
      ['older-root', 0],
      ['newer-child', 1],
      ['legacy-grandchild', 2],
      ['older-child', 1],
    ]
  );
}

{
  const rows = epicThreadRows(
    [
      thread('cycle-a', { epicId: 'epic', parentThreadId: 'cycle-b' }),
      thread('cycle-b', { epicId: 'epic', parentThreadId: 'cycle-a' }),
      thread('orphan', { epicId: 'epic', parentThreadId: 'missing' }),
    ],
    'epic'
  );
  assert.deepEqual(
    rows.map(({ thread: rowThread }) => rowThread.id).sort(),
    ['cycle-a', 'cycle-b', 'orphan']
  );
}

console.log('Epic thread hierarchy tests passed');
