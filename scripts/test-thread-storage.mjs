import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-thread-storage-'));
app.setPath('userData', testDataDir);

try {
  const { getThreadsDirectoryPath, getThreadsFilePath } = await import('../src/main/paths.js');
  const {
    readAllThreads,
    readThreadById,
    readThreadsIndex,
    writeThreadsPatch,
    writeThreadsPatchSync,
  } = await import('../src/main/thread-storage.js');

  const first = {
    id: 'thread-first',
    projectId: 'project-1',
    title: 'First',
    status: 'idle',
    modelId: 'codex:test',
    createdAt: '2026-08-04T00:00:00.000Z',
    messages: [{ role: 'user', content: 'one', ts: '2026-08-04T00:00:01.000Z' }],
  };
  const second = {
    id: 'thread-second',
    projectId: 'project-1',
    title: 'Second',
    status: 'idle',
    modelId: 'codex:test',
    createdAt: '2026-08-04T00:00:00.000Z',
    messages: [{ role: 'agent', content: 'two', ts: '2026-08-04T00:00:02.000Z' }],
  };

  await fs.writeFile(
    getThreadsFilePath(),
    JSON.stringify({ version: 1, threads: [first, second] }),
    'utf8'
  );

  assert.deepEqual(await readAllThreads(), [first, second], 'legacy snapshot should migrate without loss');
  await assert.rejects(fs.access(getThreadsFilePath()), 'legacy source should be archived after migration');
  await fs.access(path.join(testDataDir, 'orion-threads.v1-backup.json'));

  const index = await readThreadsIndex();
  assert.equal(index.version, 2);
  assert.deepEqual(index.entries.map((entry) => entry.id), [first.id, second.id]);
  assert.equal(index.entries[1].messageCount, 1);

  const secondPath = path.join(
    getThreadsDirectoryPath(),
    `${Buffer.from(second.id).toString('base64url')}.${index.entries[1].hash}.json`
  );
  const secondBefore = await fs.readFile(secondPath, 'utf8');
  const secondStatBefore = await fs.stat(secondPath);
  await new Promise((resolve) => setTimeout(resolve, 20));

  first.messages.push({ role: 'agent', content: 'changed', ts: '2026-08-04T00:00:03.000Z' });
  await writeThreadsPatch({ version: 2, upserts: [first], deletes: [], order: [first.id, second.id] });
  assert.deepEqual(await readThreadById(first.id), first);
  assert.equal(await fs.readFile(secondPath, 'utf8'), secondBefore, 'unchanged transcript bytes must be untouched');
  assert.equal(
    (await fs.stat(secondPath)).mtimeMs,
    secondStatBefore.mtimeMs,
    'unchanged transcript file must not be rewritten'
  );

  const third = { ...second, id: 'thread-third', title: 'Third' };
  writeThreadsPatchSync({
    version: 2,
    upserts: [third],
    deletes: [first.id],
    order: [second.id, third.id],
  });
  assert.deepEqual((await readThreadsIndex()).entries.map((entry) => entry.id), [second.id, third.id]);
  assert.equal(await readThreadById(first.id), null);
  assert.deepEqual(await readAllThreads(), [second, third]);

  const thirdEntry = (await readThreadsIndex()).entries.find((entry) => entry.id === third.id);
  const thirdPath = path.join(
    getThreadsDirectoryPath(),
    `${Buffer.from(third.id).toString('base64url')}.${thirdEntry.hash}.json`
  );
  await fs.writeFile(thirdPath, JSON.stringify({ ...third, title: 'silently corrupted' }), 'utf8');
  await assert.rejects(readThreadById(third.id), /failed its checksum/);
  await writeThreadsPatch({ version: 2, upserts: [third], deletes: [], order: [second.id, third.id] });
  assert.deepEqual(await readThreadById(third.id), third, 'a later valid patch should repair corrupt bytes');

  await fs.writeFile(path.join(getThreadsDirectoryPath(), 'manifest.json'), '{broken', 'utf8');
  await assert.rejects(readAllThreads(), 'a corrupt v2 manifest must fail closed instead of reviving stale v1 data');

  console.log('Thread storage migration and incremental persistence checks passed.');
} finally {
  await fs.rm(testDataDir, { recursive: true, force: true });
  app.quit();
}
