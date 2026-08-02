import fs from 'node:fs/promises';
import { getStorageFilePath, getThreadsFilePath } from './paths.js';

// The read_thread MCP tool: lets an agent browse another Orion thread's
// transcript on demand. @thread mentions inject only metadata into the
// prompt; this is where the actual content comes from, one page at a time.

export const READ_THREAD_DEFAULT_LIMIT = 30;
export const READ_THREAD_MAX_LIMIT = 200;
// Per-message and whole-reply caps so one giant transcript page can't blow
// out the calling model's context. Dropped content is always announced.
const MAX_MESSAGE_CHARS = 6000;
const MAX_OUTPUT_CHARS = 48_000;
const MAX_ACTIVITIES_SHOWN = 12;
const MAX_ACTIVITY_INPUT_CHARS = 2000;
const MAX_ACTIVITY_OUTPUT_CHARS = 4000;

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
};

const normalizeId = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Resolve the thread_id argument leniently: exact id first, then id prefix,
// then the 8-character fragment that ends an @thread mention token (the model
// may pass the whole token back).
const matchThreads = (threads, rawId) => {
  const exact = threads.filter((thread) => thread?.id === rawId);
  if (exact.length > 0) return exact;
  const withoutPrefix = /^thread:/i.test(rawId) ? rawId.slice('thread:'.length) : rawId;
  const norm = normalizeId(withoutPrefix);
  if (!norm) return [];
  return threads.filter((thread) => {
    const id = normalizeId(thread?.id);
    if (!id) return false;
    return id.startsWith(norm) || (norm.length >= 8 && norm.endsWith(id.slice(0, 8)));
  });
};

const truncate = (value, max) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const truncateBlock = (value, max, label) => {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[${label} truncated]`;
};

const indentBlock = (value) => value.split('\n').map((line) => `    ${line}`).join('\n');

const formatMessage = (message, index, total) => {
  const role = message.role === 'user' ? 'User' : message.role === 'agent' ? 'Agent' : 'System';
  const status =
    typeof message.status === 'string' && message.status !== 'done' ? ` [${message.status}]` : '';
  const lines = [`### Message ${index + 1}/${total} — ${role}${message.ts ? ` (${message.ts})` : ''}${status}`];
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content) {
    lines.push(
      content.length > MAX_MESSAGE_CHARS
        ? `${content.slice(0, MAX_MESSAGE_CHARS)}\n…[message truncated]`
        : content
    );
  }
  const linkedTasks = Array.isArray(message.linkedTasks) ? message.linkedTasks : [];
  if (linkedTasks.length > 0) {
    lines.push(`Linked board ${linkedTasks.length === 1 ? 'task' : `tasks (${linkedTasks.length})`}:`);
    for (const task of linkedTasks) {
      lines.push(`- ${truncate(task?.title || '(untitled task)', 500)}`);
      const description = truncateBlock(task?.description, 4000, 'task description');
      if (description) lines.push(indentBlock(description));
    }
  }
  const activities = Array.isArray(message.activities) ? message.activities : [];
  if (activities.length > 0) {
    lines.push(`Tool activity (${activities.length} steps):`);
    for (const activity of activities.slice(0, MAX_ACTIVITIES_SHOWN)) {
      const detail = activity?.detail ? `: ${truncate(activity.detail, 200)}` : '';
      lines.push(`- ${truncate(activity?.title ?? '', 200)}${detail}`);
      if (activity?.input) {
        lines.push(
          '  Input:',
          indentBlock(truncateBlock(activity.input, MAX_ACTIVITY_INPUT_CHARS, 'activity input'))
        );
      }
      if (activity?.output) {
        lines.push(
          '  Output:',
          indentBlock(truncateBlock(activity.output, MAX_ACTIVITY_OUTPUT_CHARS, 'activity output'))
        );
      }
    }
    if (activities.length > MAX_ACTIVITIES_SHOWN) {
      lines.push(`- …${activities.length - MAX_ACTIVITIES_SHOWN} more steps omitted`);
    }
  }
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length > 0) {
    lines.push(
      `Attachments: ${attachments.map((a) => `${a?.name ?? 'file'} (${a?.path ?? 'no path'})`).join(', ')}`
    );
  }
  const changedFiles = Array.isArray(message.changedFiles) ? message.changedFiles : [];
  if (changedFiles.length > 0) {
    lines.push(`Changed files: ${changedFiles.map((f) => `${f?.path} (${f?.status})`).join(', ')}`);
  }
  if (lines.length === 1) lines.push('(empty message)');
  return lines.join('\n');
};

// Always resolves to readable text (never rejects) so every caller — the
// Claude SDK tool and the socket bridge — hands the model an outcome it can
// act on instead of a protocol error.
export const readThreadForAgent = async (args = {}) => {
  const rawId = typeof args.thread_id === 'string' ? args.thread_id.trim() : '';
  if (!rawId) return 'read_thread requires a `thread_id` string argument.';

  const parsed = await readJson(getThreadsFilePath());
  const threads = Array.isArray(parsed?.threads) ? parsed.threads : [];
  if (threads.length === 0) return 'No Orion threads are stored yet.';

  const matches = matchThreads(threads, rawId);
  if (matches.length === 0) {
    return `No Orion thread matches thread_id "${rawId}". Use the exact id from the [Thread mentions] block.`;
  }
  if (matches.length > 1) {
    const listing = matches
      .slice(0, 10)
      .map((thread) => `- ${thread.id} — "${thread.title}"`)
      .join('\n');
    return `thread_id "${rawId}" is ambiguous; it matches ${matches.length} threads. Call read_thread again with one exact id:\n${listing}`;
  }

  const thread = matches[0];
  const storeState = (await readJson(getStorageFilePath()))?.state;
  const project = Array.isArray(storeState?.projects)
    ? storeState.projects.find((candidate) => candidate?.id === thread.projectId)
    : undefined;

  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const total = messages.length;
  const limit = Math.min(
    READ_THREAD_MAX_LIMIT,
    Math.max(1, Number.isInteger(args.limit) ? args.limit : READ_THREAD_DEFAULT_LIMIT)
  );
  const startIndex = Number.isInteger(args.offset)
    ? Math.max(args.offset - 1, 0)
    : Math.max(0, total - limit);

  const header = [
    `# Orion thread "${thread.title}"`,
    `thread_id: ${thread.id}`,
    `status: ${thread.status}; model: ${thread.modelId}; created: ${thread.createdAt}`,
    ...(project ? [`project: ${project.name} (${project.path})`] : []),
    ...(thread.status === 'running'
      ? ['Note: this thread is currently running; its transcript may lag behind by a few seconds.']
      : []),
  ];

  if (total === 0) return [...header, '', 'This thread has no messages yet.'].join('\n');
  if (startIndex >= total) {
    return [
      ...header,
      '',
      `Requested offset ${args.offset} is past the end of this transcript (${total} messages). No messages returned.`,
    ].join('\n');
  }

  const page = messages.slice(startIndex, startIndex + limit);

  const formatted = page.map((message, index) => formatMessage(message, startIndex + index, total));
  // Trim oldest entries in the page if it still exceeds the reply budget.
  let dropped = 0;
  const buildReply = () => {
    const shownStart = startIndex + dropped;
    const rangeLines = [
      `Showing messages ${shownStart + 1}–${shownStart + formatted.length} of ${total} (oldest first).`,
      ...(dropped > 0
        ? [
            `${dropped} messages of this page were dropped to fit the reply budget; re-request the omitted range with offset=${startIndex + 1}, limit=${dropped}.`,
          ]
        : []),
      ...(shownStart > 0 && dropped === 0
        ? [`Earlier messages exist — call read_thread with offset (1-based message index) to read them, e.g. offset=${Math.max(1, shownStart + 1 - limit)}, limit=${limit}.`]
        : []),
      ...(shownStart + formatted.length < total
        ? [`Later messages exist — call read_thread with offset=${shownStart + formatted.length + 1} to continue.`]
        : []),
    ];
    return [...header, '', ...rangeLines, '', formatted.join('\n\n')].join('\n');
  };

  let reply = buildReply();
  while (formatted.length > 1 && reply.length > MAX_OUTPUT_CHARS) {
    formatted.shift();
    dropped += 1;
    reply = buildReply();
  }
  if (reply.length > MAX_OUTPUT_CHARS) {
    const notice = '\n…[message truncated to fit reply budget]';
    const excess = reply.length - MAX_OUTPUT_CHARS;
    const keep = Math.max(0, formatted[0].length - excess - notice.length);
    formatted[0] = `${formatted[0].slice(0, keep)}${notice}`;
    reply = buildReply();
  }
  // Defensive final cap for unexpectedly large thread metadata in the header.
  if (reply.length > MAX_OUTPUT_CHARS) {
    const notice = '\n…[reply truncated to fit reply budget]';
    return `${reply.slice(0, MAX_OUTPUT_CHARS - notice.length)}${notice}`;
  }
  return reply;
};
