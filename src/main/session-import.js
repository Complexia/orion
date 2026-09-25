import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  activityFromCandidate,
  clampToolText,
  codexPlanActivity,
  formatToolInput,
  formatToolOutput,
  stringifySummary,
  summarizeToolInput,
} from './stream-adapters.js';

// Imports conversations the user had directly in Claude Code or Codex into
// Orion threads. The thread keeps the provider's session id, so the next turn
// resumes the original conversation instead of starting over.
//
// Only sessions the user drove interactively are offered. Orion's own runs
// (Claude Agent SDK / `claude -p`, codex app-server with originator "orion"),
// `codex exec` one-shots, and provider subagents all write to the same stores
// and would otherwise come back as duplicate or meaningless threads.

const SCAN_HEAD_BYTES = 256 * 1024;
const SCAN_TAIL_BYTES = 64 * 1024;
const TITLE_MAX_CHARS = 80;
// Imports can bring in hundreds of transcripts at once, and Orion keeps every
// thread in memory, so tool rows keep less text than a live run's 4000.
const IMPORT_TOOL_TEXT_LIMIT = 1500;

const claudeProjectsRoot = (home) =>
  path.join(path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')), 'projects');
const codexHome = (home) => path.resolve(process.env.CODEX_HOME || path.join(home, '.codex'));
const codexSessionsRoot = (home) => path.join(codexHome(home), 'sessions');
const codexSessionIndexPath = (home) => path.join(codexHome(home), 'session_index.jsonl');

const parseJsonLines = (text) => {
  const values = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // A partial trailing line (session still being written, or a head/tail
      // slice cut mid-record) is expected; skip it.
    }
  }
  return values;
};

const readSlice = async (filePath, start, length) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

// Finish the record crossing the head budget. Image attachments can make a
// single user message larger than that budget; discarding it would hide the
// session. Decode only after joining bytes so split UTF-8 characters survive.
const readHead = async (filePath, size) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const chunks = [];
    let position = 0;
    while (position < size) {
      const buffer = Buffer.alloc(Math.min(position === 0 ? SCAN_HEAD_BYTES : SCAN_TAIL_BYTES, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      // The first chunk ends at the budget; later chunks finish its record.
      const end = position === 0 ? (chunk.at(-1) === 10 ? chunk.length - 1 : -1) : chunk.indexOf(10);
      chunks.push(end >= 0 ? chunk.subarray(0, end + 1) : chunk);
      position += bytesRead;
      if (end >= 0) break;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await handle.close();
  }
};

// Head and tail normally avoid reading the full transcript during the scan.
const readHeadAndTail = async (filePath, size) => {
  if (size <= SCAN_HEAD_BYTES + SCAN_TAIL_BYTES) {
    const text = await fs.readFile(filePath, 'utf8');
    return { head: text, tail: '' };
  }
  const [head, tail] = await Promise.all([
    readHead(filePath, size),
    readSlice(filePath, size - SCAN_TAIL_BYTES, SCAN_TAIL_BYTES),
  ]);
  // The head ends at a record boundary; drop only the tail's partial record.
  return {
    head,
    tail: tail.slice(tail.indexOf('\n') + 1),
  };
};

const pathExists = async (value) => {
  if (typeof value !== 'string' || !value) return false;
  try {
    return (await fs.stat(value)).isDirectory();
  } catch {
    return false;
  }
};

// Bare slash commands ("/model", "/clear") make poor titles.
const titleFromPrompts = (prompts) =>
  titleFromText(prompts.find((text) => text && !/^\/\S+$/.test(text.trim())) ?? prompts[0]);

const titleFromText = (text) => {
  const line = String(text ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : line;
};

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

// Agent SDK and `claude -p` sessions (entrypoint sdk-ts / sdk-cli) are
// Orion's own runs or scripts; only interactive sessions are importable.
const isInteractiveClaudeEntrypoint = (entrypoint) =>
  typeof entrypoint !== 'string' || !entrypoint.startsWith('sdk');

const CLAUDE_COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const CLAUDE_COMMAND_ARGS = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/;
const CLAUDE_BASH_INPUT = /<bash-input>\s*([\s\S]*?)\s*<\/bash-input>/;
// Harness-injected user-role text that the user never typed.
const CLAUDE_INJECTED_PREFIXES = [
  '<system-reminder>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<local-command-caveat>',
  '<bash-stdout>',
  '<bash-stderr>',
  '<task-notification>',
  '<user-prompt-submit-hook>',
  'Caveat: The messages below were generated by the user while running local commands',
];

const claudeUserText = (content) => {
  const texts =
    typeof content === 'string'
      ? [content]
      : Array.isArray(content)
        ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text)
        : [];
  const kept = [];
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    const command = text.match(CLAUDE_COMMAND_NAME);
    if (command) {
      const args = text.match(CLAUDE_COMMAND_ARGS)?.[1]?.trim();
      kept.push(args ? `${command[1]} ${args}` : command[1]);
      continue;
    }
    const bash = text.match(CLAUDE_BASH_INPUT);
    if (bash) {
      kept.push(`! ${bash[1]}`);
      continue;
    }
    if (CLAUDE_INJECTED_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
    if (/^\[Request interrupted by user/.test(text)) continue;
    kept.push(text);
  }
  return kept.join('\n\n');
};

const isClaudeTranscriptLine = (value) =>
  (value?.type === 'user' || value?.type === 'assistant') && !value.isSidechain;

const isClaudeUserPrompt = (value) =>
  value?.type === 'user' &&
  !value.isSidechain &&
  !value.isMeta &&
  !value.isCompactSummary &&
  Boolean(claudeUserText(value.message?.content));

const claudeTitleFrom = (values) => {
  let custom = '';
  let ai = '';
  let summary = '';
  for (const value of values) {
    if (value?.type === 'custom-title' && typeof value.customTitle === 'string') custom = value.customTitle;
    else if (value?.type === 'ai-title' && typeof value.aiTitle === 'string') ai = value.aiTitle;
    else if (value?.type === 'summary' && typeof value.summary === 'string') summary = value.summary;
  }
  return (custom || ai || summary).trim();
};

const scanClaudeSession = async (filePath, stats) => {
  const { head, tail } = await readHeadAndTail(filePath, stats.size);
  const headValues = parseJsonLines(head);
  const tailValues = tail ? parseJsonLines(tail) : [];
  const first = headValues.find((value) => isClaudeTranscriptLine(value) && value.sessionId);
  if (!first) return null;
  if (!isInteractiveClaudeEntrypoint(first.entrypoint)) return null;
  const prompts = headValues.filter(isClaudeUserPrompt);
  const firstPrompt = prompts[0];
  // A session that never got past a local command (/model, /clear) has
  // nothing to continue.
  if (!firstPrompt || !headValues.some((value) => value?.type === 'assistant' && !value.isSidechain)) {
    if (stats.size <= SCAN_HEAD_BYTES + SCAN_TAIL_BYTES) return null;
  }
  if (!firstPrompt) return null;
  const lastTimestamp = [...tailValues, ...headValues]
    .map((value) => value?.timestamp)
    .filter((value) => typeof value === 'string')
    .sort()
    .at(-1);
  return {
    providerId: 'claude',
    sessionId: first.sessionId,
    filePath,
    cwd: first.cwd ?? firstPrompt.cwd ?? null,
    title:
      claudeTitleFrom([...headValues, ...tailValues]) ||
      titleFromPrompts(prompts.map((value) => claudeUserText(value.message?.content))),
    createdAt: first.timestamp ?? new Date(stats.birthtimeMs || stats.mtimeMs).toISOString(),
    updatedAt: lastTimestamp ?? new Date(stats.mtimeMs).toISOString(),
  };
};

const listClaudeSessionFiles = async (home) => {
  const root = claudeProjectsRoot(home);
  let projectDirs;
  try {
    projectDirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    // Top-level <session>.jsonl only; <session>/subagents/*.jsonl are
    // sidechain transcripts of a parent session.
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dirPath, entry.name));
    }
  }
  return files;
};

// Claude transcripts are a tree (rewinds and edits fork it). Walk back from
// the newest line to recover the branch the conversation actually ended on;
// compaction boundaries reconnect through logicalParentUuid.
const claudeActiveBranch = (values) => {
  const byUuid = new Map();
  let leaf = null;
  values.forEach((value, index) => {
    if (typeof value?.uuid !== 'string' || value.isSidechain) return;
    byUuid.set(value.uuid, { value, index });
    if (value.type === 'user' || value.type === 'assistant') leaf = value;
  });
  if (!leaf) return [];
  const branch = [];
  const seen = new Set();
  let cursor = byUuid.get(leaf.uuid);
  let brokenChain = false;
  while (cursor && !seen.has(cursor.value.uuid)) {
    seen.add(cursor.value.uuid);
    branch.push(cursor);
    const parentId = cursor.value.parentUuid ?? cursor.value.logicalParentUuid;
    cursor = typeof parentId === 'string' ? byUuid.get(parentId) : undefined;
    if (typeof parentId === 'string' && !cursor) brokenChain = true;
  }
  // A parent that isn't in the file means the tree can't be trusted; showing
  // every line in file order beats silently dropping the conversation's start.
  if (brokenChain) return values.filter((value) => !value?.isSidechain);
  return branch.sort((a, b) => a.index - b.index).map((entry) => entry.value);
};

const newMessageId = () => crypto.randomUUID();

// Accumulates provider transcript records into Orion's message shape: one
// user message per prompt and one completed agent-run message per turn, with
// tool activity interleaved at the text offset it happened at.
const clampImportedActivity = (activity) => {
  const next = { ...activity };
  if (next.input) next.input = clampToolText(next.input, 'head', IMPORT_TOOL_TEXT_LIMIT);
  if (next.output) next.output = clampToolText(next.output, 'both', IMPORT_TOOL_TEXT_LIMIT);
  if (next.detail && next.type === 'thought') next.detail = clampToolText(next.detail, 'head', IMPORT_TOOL_TEXT_LIMIT);
  for (const field of ['input', 'output', 'detail']) if (next[field] === undefined) delete next[field];
  return next;
};

const createTranscriptBuilder = (providerId) => {
  const messages = [];
  let turn = null;
  const activitiesByCall = new Map();

  const closeTurn = () => {
    if (!turn) return;
    if (turn.content.trim() || turn.activities.length > 0) {
      messages.push({
        id: turn.id,
        role: 'agent',
        kind: 'agent-run',
        status: 'done',
        content: turn.content.trim(),
        activities: turn.activities.map(clampImportedActivity),
        ts: turn.startedAt,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        ...(turn.modelId ? { modelId: turn.modelId } : {}),
      });
    }
    turn = null;
    activitiesByCall.clear();
  };

  const ensureTurn = (ts) => {
    if (!turn) {
      turn = { id: newMessageId(), content: '', activities: [], startedAt: ts, completedAt: ts, modelId: null };
    }
    if (ts) turn.completedAt = ts;
    return turn;
  };

  return {
    userPrompt(text, ts) {
      closeTurn();
      messages.push({ id: newMessageId(), role: 'user', content: text, ts });
    },
    userPrompts() {
      return messages.filter((message) => message.role === 'user').map((message) => message.content);
    },
    rollbackUserTurns(count) {
      // Include the buffered reply and its tools in the removal. A user
      // prompt without a reply still counts as a turn for Codex rewinds.
      closeTurn();
      let start = messages.length;
      for (let index = messages.length - 1; index >= 0 && count > 0; index -= 1) {
        if (messages[index].role !== 'user') continue;
        start = index;
        count -= 1;
      }
      messages.splice(count > 0 ? 0 : start);
      return messages.findLast((message) => message.role === 'agent' && message.modelId)?.modelId ?? null;
    },
    agentText(text, ts, model) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) return;
      const current = ensureTurn(ts);
      if (model) current.modelId = `${providerId}:${model}`;
      current.content = current.content ? `${current.content}\n\n${trimmed}` : trimmed;
    },
    activity(activity, ts, callId, model) {
      if (!activity) return;
      const current = ensureTurn(ts);
      if (model) current.modelId = `${providerId}:${model}`;
      const { updateForKey: _ignored, key: _key, ...rest } = activity;
      const entry = {
        status: 'done',
        ...rest,
        id: newMessageId(),
        ts: ts ?? current.completedAt,
        contentOffset: current.content.length,
      };
      if (entry.status === 'running' || entry.status === 'waiting') entry.status = 'done';
      current.activities.push(entry);
      if (callId) activitiesByCall.set(callId, entry);
    },
    toolResult(callId, output, { isError = false, exitCode } = {}) {
      const entry = activitiesByCall.get(callId);
      if (!entry) return;
      const text = formatToolOutput(output);
      if (text) entry.output = text;
      if (typeof exitCode === 'number') entry.exitCode = exitCode;
      if (isError || (typeof exitCode === 'number' && exitCode !== 0)) entry.status = 'error';
    },
    finish() {
      closeTurn();
      // Local slash commands (/model, /clear, /cost) never reach the model;
      // alone they are UI noise with no reply under them.
      return messages.filter(
        (message, index) =>
          message.role !== 'user' ||
          !/^\/\S+$/.test(message.content.trim()) ||
          messages[index + 1]?.role === 'agent'
      );
    },
  };
};

const convertClaudeSession = async (filePath) => {
  const values = parseJsonLines(await fs.readFile(filePath, 'utf8'));
  const first = values.find((value) => isClaudeTranscriptLine(value) && value.sessionId);
  if (!first || !isInteractiveClaudeEntrypoint(first.entrypoint)) return null;

  const builder = createTranscriptBuilder('claude');
  let model = null;
  for (const value of claudeActiveBranch(values)) {
    const ts = typeof value.timestamp === 'string' ? value.timestamp : undefined;
    const content = value.message?.content;
    if (value.type === 'user') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue;
          builder.toolResult(block.tool_use_id, block.content, { isError: block.is_error === true });
        }
      }
      if (isClaudeUserPrompt(value)) builder.userPrompt(claudeUserText(content), ts);
      continue;
    }
    if (value.type !== 'assistant' || !Array.isArray(content)) continue;
    if (typeof value.message?.model === 'string' && !value.message.model.startsWith('<')) {
      model = value.message.model;
    }
    for (const block of content) {
      if (block?.type === 'text') {
        builder.agentText(block.text, ts, model);
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
        builder.activity({ type: 'thought', title: 'Reasoning', detail: block.thinking.trim() }, ts, null, model);
      } else if (block?.type === 'tool_use') {
        builder.activity(activityFromCandidate(block), ts, block.id, model);
      }
    }
  }
  const messages = builder.finish();
  if (!messages.some((message) => message.role === 'agent')) return null;
  return {
    providerId: 'claude',
    sessionId: first.sessionId,
    cwd: first.cwd ?? null,
    title: claudeTitleFrom(values) || titleFromPrompts(builder.userPrompts()),
    createdAt: first.timestamp ?? messages[0]?.ts,
    model,
    messages,
  };
};

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

// Interactive Codex clients (CLI/TUI, desktop app, IDE extension) all report a
// codex* originator. codex_exec is non-interactive; "orion" is Orion itself.
const isInteractiveCodexMeta = (meta) =>
  typeof meta?.originator === 'string' &&
  /^codex/i.test(meta.originator) &&
  meta.originator !== 'codex_exec' &&
  typeof meta.source !== 'object' &&
  meta.thread_source !== 'subagent' &&
  !meta.parent_thread_id;

// Context Codex injects as user-role messages. Only consulted for old
// rollouts that lack the user_message events carrying the typed prompt.
const CODEX_INJECTED_USER_PREFIXES = [
  '<environment_context>',
  '<user_instructions>',
  '<recommended_plugins>',
  '<permissions',
  '<app-context>',
  '<turn_aborted>',
  '<user_shell_command>',
  '<INSTRUCTIONS>',
  '# AGENTS.md instructions',
];

const codexContentText = (content) =>
  Array.isArray(content)
    ? content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
    : typeof content === 'string'
      ? content
      : '';

// A prompt can consist solely of images. Keep a visible placeholder and a
// user-turn boundary even when there is no text to render or use as a title.
const codexUserContentText = (content) => {
  const text = codexContentText(content).trim();
  if (text) return text;
  const hasImage = Array.isArray(content) && content.some((part) =>
    ['input_image', 'image', 'local_image'].includes(part?.type)
  );
  return hasImage ? 'Attached image' : '';
};

// Codex appends memory citations as inline markup its own UI hides.
const stripCodexCitations = (text) => text.replace(/\s*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, '');

const codexEventUserText = (payload) => {
  if (payload?.type === 'user_message' && typeof payload.message === 'string') {
    const text = payload.message.trim();
    const hasImage = [payload.images, payload.local_images].some((images) => Array.isArray(images) && images.length > 0);
    return text || (hasImage ? 'Attached image' : '');
  }
  if (payload?.type === 'item_completed' && payload.item?.type === 'UserMessage') {
    return codexUserContentText(payload.item.content);
  }
  return null;
};

const codexResponseUserText = (payload) => {
  if (payload?.type !== 'message' || payload.role !== 'user') return null;
  const text = codexUserContentText(payload.content);
  if (CODEX_INJECTED_USER_PREFIXES.some((prefix) => text.startsWith(prefix))) return null;
  return text;
};

const readCodexSessionNames = async (home) => {
  const names = new Map();
  try {
    for (const entry of parseJsonLines(await fs.readFile(codexSessionIndexPath(home), 'utf8'))) {
      if (typeof entry?.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim()) {
        names.set(entry.id, entry.thread_name.trim());
      }
    }
  } catch {}
  return names;
};

const scanCodexSession = async (filePath, stats, names) => {
  const { head, tail } = await readHeadAndTail(filePath, stats.size);
  const headValues = parseJsonLines(head);
  const meta = headValues[0]?.type === 'session_meta' ? headValues[0].payload : null;
  if (!meta || typeof meta.id !== 'string' || !isInteractiveCodexMeta(meta)) return null;
  const firstPrompt =
    headValues.map((value) => (value?.type === 'event_msg' ? codexEventUserText(value.payload) : null)).find((text) => text !== null) ??
    headValues.map((value) => (value?.type === 'response_item' ? codexResponseUserText(value.payload) : null)).find((text) => text !== null);
  // Large sessions can push the first prompt past the scanned head; they
  // still get imported and titled from the full transcript.
  if (firstPrompt == null && stats.size <= SCAN_HEAD_BYTES + SCAN_TAIL_BYTES) return null;
  const lastTimestamp = [...parseJsonLines(tail), ...headValues]
    .map((value) => value?.timestamp)
    .filter((value) => typeof value === 'string')
    .sort()
    .at(-1);
  return {
    providerId: 'codex',
    sessionId: meta.id,
    filePath,
    cwd: meta.cwd ?? null,
    title: names.get(meta.id) || titleFromText(firstPrompt) || 'Codex conversation',
    createdAt: meta.timestamp ?? headValues[0].timestamp,
    updatedAt: lastTimestamp ?? new Date(stats.mtimeMs).toISOString(),
  };
};

const listCodexSessionFiles = async (home) => {
  try {
    const entries = await fs.readdir(codexSessionsRoot(home), { recursive: true });
    return entries
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => path.join(codexSessionsRoot(home), entry));
  } catch {
    return [];
  }
};

const parseJsonMaybe = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const codexShellCommand = (args) => {
  const command = args?.command ?? args?.cmd;
  if (Array.isArray(command)) {
    // ["bash", "-lc", "<script>"] reads best as just the script.
    if (command.length === 3 && /(^|\/)(ba|z)?sh$/.test(command[0]) && command[1].startsWith('-')) {
      return command[2];
    }
    return command.join(' ');
  }
  return typeof command === 'string' ? command : null;
};

const codexToolActivity = (name, rawArgs) => {
  const args = parseJsonMaybe(rawArgs);
  const command = ['shell', 'shell_command', 'exec_command', 'local_shell'].includes(name)
    ? codexShellCommand(args)
    : null;
  if (command) {
    return {
      type: 'command',
      kind: 'execute',
      title: `Command - ${stringifySummary(command, 80)}`,
      detail: stringifySummary(command),
      input: formatToolInput(command),
    };
  }
  // Code-mode Codex runs tools from a JS cell; its first shell command is
  // the best one-line summary of what the cell did.
  if (name === 'exec' && typeof args === 'string') {
    const firstCommand = args.match(/\bcmd\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
    const summary = firstCommand ? String(parseJsonMaybe(firstCommand)) : args;
    return {
      type: 'command',
      kind: 'execute',
      title: `Command - ${stringifySummary(summary, 80)}`,
      detail: stringifySummary(summary),
      input: formatToolInput(args),
    };
  }
  if (name === 'update_plan' && Array.isArray(args?.plan)) {
    const plan = codexPlanActivity(args.plan);
    if (plan) {
      const { key: _key, ...rest } = plan;
      return { ...rest, status: 'done' };
    }
  }
  if (name === 'apply_patch') {
    const patch = typeof args === 'string' ? args : args?.input ?? args?.patch;
    const files = [...String(patch ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(
      (match) => match[1]
    );
    return {
      type: 'tool',
      kind: 'edit',
      title: files.length === 1 ? `Edit ${path.basename(files[0])}` : `File changes (${files.length})`,
      detail: stringifySummary(files.join(', ')),
      input: formatToolInput(patch),
    };
  }
  return {
    type: 'tool',
    title: `Tool - ${name || 'tool'}`,
    detail: summarizeToolInput(args),
    input: formatToolInput(rawArgs),
  };
};

// function_call_output bodies are sometimes a JSON envelope
// ({"output": "...", "metadata": {"exit_code": 0}}) rather than plain text.
const codexToolOutput = (raw) => {
  const parsed = parseJsonMaybe(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'output' in parsed) {
    return { output: parsed.output, exitCode: parsed.metadata?.exit_code };
  }
  return { output: raw };
};

const convertCodexSession = async (filePath, names) => {
  const values = parseJsonLines(await fs.readFile(filePath, 'utf8'));
  const meta = values[0]?.type === 'session_meta' ? values[0].payload : null;
  if (!meta || typeof meta.id !== 'string' || !isInteractiveCodexMeta(meta)) return null;

  // Rollouts record the user's typed prompt as an event; the matching
  // response_item also exists but alongside injected context. Prefer events
  // and fall back to filtered response items for old rollouts without them.
  const hasUserEvents = values.some((value) => value?.type === 'event_msg' && codexEventUserText(value.payload) !== null);
  const builder = createTranscriptBuilder('codex');
  let model = null;
  for (const value of values) {
    const ts = typeof value?.timestamp === 'string' ? value.timestamp : undefined;
    const payload = value?.payload;
    if (value?.type === 'turn_context' && typeof payload?.model === 'string') {
      model = payload.model;
      continue;
    }
    if (value?.type === 'event_msg') {
      if (payload?.type === 'thread_rolled_back') {
        if (Number.isSafeInteger(payload.num_turns) && payload.num_turns > 0) {
          const modelId = builder.rollbackUserTurns(payload.num_turns);
          // A context record from a discarded turn must not choose the
          // imported model or label a subsequent replacement reply.
          model = modelId?.slice('codex:'.length) ?? null;
        }
        continue;
      }
      const text = hasUserEvents ? codexEventUserText(payload) : null;
      if (text !== null) builder.userPrompt(text.trim(), ts);
      continue;
    }
    if (value?.type !== 'response_item' || !payload) continue;
    switch (payload.type) {
      case 'message': {
        if (payload.role === 'user') {
          const text = hasUserEvents ? null : codexResponseUserText(payload);
          if (text !== null) builder.userPrompt(text, ts);
        } else if (payload.role === 'assistant') {
          builder.agentText(stripCodexCitations(codexContentText(payload.content)), ts, model);
        }
        break;
      }
      case 'reasoning': {
        const summary = (Array.isArray(payload.summary) ? payload.summary : [])
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('\n\n')
          .trim();
        if (summary) builder.activity({ type: 'thought', title: 'Reasoning', detail: summary }, ts, null, model);
        break;
      }
      case 'function_call':
        builder.activity(codexToolActivity(payload.name, payload.arguments), ts, payload.call_id, model);
        break;
      case 'custom_tool_call':
        builder.activity(codexToolActivity(payload.name, payload.input), ts, payload.call_id, model);
        break;
      case 'local_shell_call':
        builder.activity(
          codexToolActivity('local_shell', payload.action),
          ts,
          payload.call_id ?? payload.id,
          model
        );
        break;
      case 'web_search_call': {
        const query = payload.action?.query ?? payload.action?.queries?.join(', ') ?? '';
        builder.activity(
          { type: 'tool', kind: 'search', title: 'Web search', detail: stringifySummary(query), input: formatToolInput(query) },
          ts,
          null,
          model
        );
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output': {
        const { output, exitCode } = codexToolOutput(payload.output);
        builder.toolResult(payload.call_id, output, { exitCode });
        break;
      }
      default:
        break;
    }
  }
  const messages = builder.finish();
  if (!messages.some((message) => message.role === 'agent')) return null;
  return {
    providerId: 'codex',
    sessionId: meta.id,
    cwd: meta.cwd ?? null,
    title: names.get(meta.id) || titleFromPrompts(builder.userPrompts()) || 'Codex conversation',
    createdAt: meta.timestamp ?? messages[0]?.ts,
    model,
    messages,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List importable Claude Code and Codex sessions, newest first. Sessions whose
 * id is in excludeSessionIds (already linked to an Orion thread) are skipped,
 * as are sessions whose working directory no longer exists.
 */
export const scanImportableSessions = async ({ excludeSessionIds = [], home = os.homedir() } = {}) => {
  const excluded = new Set(excludeSessionIds);
  const sessions = [];
  let missingDirectory = 0;
  const consider = async (session) => {
    if (!session || excluded.has(session.sessionId)) return;
    excluded.add(session.sessionId);
    if (!(await pathExists(session.cwd))) {
      missingDirectory += 1;
      return;
    }
    sessions.push(session);
  };

  for (const filePath of await listClaudeSessionFiles(home)) {
    // The filename is the session id; skip known ones before any read.
    if (excluded.has(path.basename(filePath, '.jsonl'))) continue;
    try {
      const stats = await fs.stat(filePath);
      await consider(await scanClaudeSession(filePath, stats));
    } catch (error) {
      console.warn('session-import: could not scan Claude session', filePath, error);
    }
  }

  const names = await readCodexSessionNames(home);
  let scanned = 0;
  for (const filePath of await listCodexSessionFiles(home)) {
    // rollout-<timestamp>-<uuid>.jsonl
    const idFromName = path.basename(filePath, '.jsonl').slice(-36);
    if (excluded.has(idFromName)) continue;
    try {
      const stats = await fs.stat(filePath);
      await consider(await scanCodexSession(filePath, stats, names));
    } catch (error) {
      console.warn('session-import: could not scan Codex session', filePath, error);
    }
    if (++scanned % 50 === 0) await yieldToEventLoop();
  }

  sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { sessions, missingDirectory };
};

/**
 * Convert scanned sessions into Orion transcripts. Returns one entry per
 * input; null where the file vanished or held no user prompt.
 */
export const readImportableSessions = async ({ sessions = [], home = os.homedir() } = {}) => {
  const names = sessions.some((session) => session?.providerId === 'codex')
    ? await readCodexSessionNames(home)
    : new Map();
  const results = [];
  for (const session of sessions) {
    try {
      const allowedRoot =
        session?.providerId === 'claude'
          ? claudeProjectsRoot(home)
          : session?.providerId === 'codex'
            ? codexSessionsRoot(home)
            : null;
      // The renderer echoes back paths from the scan; never read outside the
      // provider session stores.
      const resolved = typeof session?.filePath === 'string' ? path.resolve(session.filePath) : '';
      if (!allowedRoot || !resolved.startsWith(`${allowedRoot}${path.sep}`) || !resolved.endsWith('.jsonl')) {
        results.push(null);
        continue;
      }
      results.push(
        session.providerId === 'claude'
          ? await convertClaudeSession(resolved)
          : await convertCodexSession(resolved, names)
      );
    } catch (error) {
      console.warn('session-import: could not read session', session?.filePath, error);
      results.push(null);
    }
    await yieldToEventLoop();
  }
  return results;
};
