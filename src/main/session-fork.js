import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Branched threads inherit the parent's session id but must never resume it
// in place — codex and cursor append resumed turns to the parent's own
// on-disk record. claude exposes --fork-session for this; for codex, cursor,
// and grok (whose ACP agent mode has no fork flag) the session is forked by
// copying that record under a new uuid.
export const forkCodexSessionFile = async (sessionId) => {
  const sessionsRoot = path.join(app.getPath('home'), '.codex', 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  const entries = await fs.readdir(sessionsRoot, { recursive: true });
  const relativePath = entries.find((entry) => entry.endsWith(suffix));
  if (!relativePath) return null;

  const sourcePath = path.join(sessionsRoot, relativePath);
  const newId = crypto.randomUUID();
  const lines = (await fs.readFile(sourcePath, 'utf8')).split('\n');
  // Line 1 is session_meta; codex matches resume ids against both the
  // filename and this embedded id.
  const meta = JSON.parse(lines[0]);
  meta.payload.id = newId;
  lines[0] = JSON.stringify(meta);
  await fs.writeFile(sourcePath.replace(suffix, `-${newId}.jsonl`), lines.join('\n'));
  return newId;
};

export const forkCursorChatDir = async (sessionId) => {
  // Chats live at ~/.cursor/chats/<workspace-hash>/<chatId>/; resume resolves
  // the chat by directory name.
  const chatsRoot = path.join(app.getPath('home'), '.cursor', 'chats');
  for (const workspaceHash of await fs.readdir(chatsRoot)) {
    const sourceDir = path.join(chatsRoot, workspaceHash, sessionId);
    const isChatDir = await fs
      .stat(sourceDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!isChatDir) continue;

    const newId = crypto.randomUUID();
    await fs.cp(sourceDir, path.join(chatsRoot, workspaceHash, newId), { recursive: true });
    return newId;
  }
  return null;
};

// Grok sessions live at ~/.grok/sessions/<urlencoded-cwd>/<sessionId>/ as a
// directory of jsonl/json files; `session/load` accepts a copied directory
// under a fresh uuid (verified live on grok 0.2.93).
export const forkGrokSessionDir = async (sessionId) => {
  const sessionsRoot = path.join(app.getPath('home'), '.grok', 'sessions');
  for (const encodedCwd of await fs.readdir(sessionsRoot)) {
    const sourceDir = path.join(sessionsRoot, encodedCwd, sessionId);
    const isSessionDir = await fs
      .stat(sourceDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!isSessionDir) continue;

    const newId = crypto.randomUUID();
    await fs.cp(sourceDir, path.join(sessionsRoot, encodedCwd, newId), { recursive: true });
    return newId;
  }
  return null;
};

// Kimi sessions live at ~/.kimi-code/sessions/<wd-hash>/<sessionId>/ and are
// located through ~/.kimi-code/session_index.jsonl (append-only; last entry
// for an id wins). `session/load` accepts a copied directory registered under
// a fresh id (verified live on kimi-code 0.26.0).
export const kimiHomeDir = () =>
  process.env.KIMI_CODE_HOME || path.join(app.getPath('home'), '.kimi-code');

export const findKimiSessionIndexEntry = async (sessionId) => {
  const indexPath = path.join(kimiHomeDir(), 'session_index.jsonl');
  let content;
  try {
    content = await fs.readFile(indexPath, 'utf8');
  } catch {
    return null;
  }
  let entry = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.sessionId === sessionId) entry = parsed;
    } catch {}
  }
  return entry;
};

export const forkKimiSessionDir = async (sessionId) => {
  const entry = await findKimiSessionIndexEntry(sessionId);
  if (!entry?.sessionDir) return null;
  const isSessionDir = await fs
    .stat(entry.sessionDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!isSessionDir) return null;

  const newId = `session_${crypto.randomUUID()}`;
  const newDir = path.join(path.dirname(entry.sessionDir), newId);
  await fs.cp(entry.sessionDir, newDir, { recursive: true });
  // state.json embeds absolute per-agent homedirs under the old session dir;
  // repoint them at the copy so nothing in the fork references the parent.
  const statePath = path.join(newDir, 'state.json');
  try {
    const state = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, state.split(sessionId).join(newId));
  } catch {}
  await fs.appendFile(
    path.join(kimiHomeDir(), 'session_index.jsonl'),
    `${JSON.stringify({ ...entry, sessionId: newId, sessionDir: newDir })}\n`
  );
  return newId;
};

export const forkSessionOnDisk = async (providerId, sessionId) => {
  try {
    if (providerId === 'codex') return await forkCodexSessionFile(sessionId);
    if (providerId === 'cursor') return await forkCursorChatDir(sessionId);
    if (providerId === 'grok') return await forkGrokSessionDir(sessionId);
    if (providerId === 'kimi') return await forkKimiSessionDir(sessionId);
  } catch (error) {
    console.error(`Failed to fork ${providerId} session ${sessionId}`, error);
  }
  return null;
};
