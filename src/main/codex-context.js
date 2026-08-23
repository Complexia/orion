import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CODEX_AUTO_COMPACT_CONTEXT_RATIO = 0.6;
export const CODEX_ROLLOUT_TAIL_BYTES = 2 * 1024 * 1024;

const rolloutPathCache = new Map();

export const codexContextUsageFromRolloutEvent = (value) => {
  const info = value?.type === 'event_msg' && value?.payload?.type === 'token_count'
    ? value.payload.info
    : null;
  const last = info?.last_token_usage;
  const inputTokens = Number(last?.input_tokens);
  const modelContextWindow = Number(info?.model_context_window);
  if (
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0 ||
    !Number.isFinite(modelContextWindow) ||
    modelContextWindow <= 0
  ) {
    return null;
  }
  return { inputTokens, modelContextWindow };
};

export const shouldAutoCompactCodexContext = (
  usage,
  threshold = CODEX_AUTO_COMPACT_CONTEXT_RATIO
) => {
  const inputTokens = Number(usage?.inputTokens);
  const modelContextWindow = Number(usage?.modelContextWindow);
  return (
    Number.isFinite(inputTokens) &&
    inputTokens > 0 &&
    Number.isFinite(modelContextWindow) &&
    modelContextWindow > 0 &&
    inputTokens / modelContextWindow >= threshold
  );
};

const configuredCodexHome = (override) =>
  override || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

const findCodexRolloutPath = async (sessionId, codexHome) => {
  const cacheKey = `${codexHome}\0${sessionId}`;
  const cached = rolloutPathCache.get(cacheKey);
  if (cached) {
    const exists = await fs.stat(cached).then((stat) => stat.isFile()).catch(() => false);
    if (exists) return cached;
    rolloutPathCache.delete(cacheKey);
  }

  const suffix = `-${sessionId}.jsonl`;
  for (const directory of ['sessions', 'archived_sessions']) {
    const root = path.join(codexHome, directory);
    let entries;
    try {
      entries = await fs.readdir(root, { recursive: true });
    } catch {
      continue;
    }
    const relativePath = entries.find((entry) => entry.endsWith(suffix));
    if (!relativePath) continue;
    const resolved = path.join(root, relativePath);
    rolloutPathCache.set(cacheKey, resolved);
    return resolved;
  }
  return null;
};

export const readLatestCodexContextUsage = async (sessionId, options = {}) => {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const codexHome = configuredCodexHome(options.codexHome);
  const rolloutPath = await findCodexRolloutPath(sessionId, codexHome);
  if (!rolloutPath) return null;

  let handle;
  try {
    handle = await fs.open(rolloutPath, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, options.tailBytes ?? CODEX_ROLLOUT_TAIL_BYTES);
    if (length <= 0) return null;
    const offset = stat.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    // The tail can begin inside a JSON line. Drop that fragment before parsing.
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) return null;
      text = text.slice(firstNewline + 1);
    }
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line || !line.includes('"token_count"')) continue;
      try {
        const usage = codexContextUsageFromRolloutEvent(JSON.parse(line));
        if (usage) return usage;
      } catch {}
    }
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
  return null;
};

