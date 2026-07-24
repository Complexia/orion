import { shell } from 'electron';
import path from 'node:path';

// Pull the harness's session/thread id out of its stream so follow-up turns
// can resume the same conversation.
export const extractSessionIdFromJsonEvent = (providerId, value) => {
  if (!value || typeof value !== 'object') return null;
  if (providerId === 'codex') {
    return value.type === 'thread.started' && typeof value.thread_id === 'string'
      ? value.thread_id
      : null;
  }
  if (providerId === 'grok') {
    return typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : null;
  }
  // claude / cursor stream-json events carry session_id (init event onwards)
  return typeof value.session_id === 'string' && value.session_id ? value.session_id : null;
};

export const extractTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  const direct = [];

  if (value.type === 'thought') return '';
  if (value.type === 'text' && typeof value.data === 'string') direct.push(value.data);
  if (value.type === 'error' && typeof value.data === 'string') direct.push(value.data);
  if (typeof value.text === 'string') direct.push(value.text);
  if (typeof value.delta === 'string') direct.push(value.delta);
  if (typeof value.content === 'string') direct.push(value.content);
  if (typeof value.result === 'string') direct.push(value.result);
  if (typeof value.response === 'string') direct.push(value.response);

  const message = value.message;
  if (message && typeof message === 'object') {
    if (typeof message.content === 'string') direct.push(message.content);
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          direct.push(part.text);
        }
      }
    }
  }

  const delta = value.delta;
  if (delta && typeof delta === 'object') {
    if (typeof delta.text === 'string') direct.push(delta.text);
    if (typeof delta.content === 'string') direct.push(delta.content);
  }

  return direct.join('');
};

// Claude Code stream-json emits the same text three ways: incremental
// stream_event deltas, a complete 'assistant' message per turn, and the final
// 'result' event. Render only the deltas so text isn't repeated; keep the
// 'result' payload only when it carries an error that was never streamed.
// Text blocks separated by tool use are distinct paragraphs, so a new text
// block after earlier text gets a blank line instead of gluing onto it.
export const extractClaudeTextFromJsonEvent = (value, context = {}) => {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'stream_event') {
    if (value.parent_tool_use_id) return '';
    const streamEvent = value.event;
    if (
      streamEvent?.type === 'content_block_start' &&
      streamEvent.content_block?.type === 'text' &&
      context.textSeen
    ) {
      context.pendingTextBreak = true;
      return '';
    }
    const delta = streamEvent?.delta;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      const prefix = context.pendingTextBreak ? '\n\n' : '';
      context.pendingTextBreak = false;
      return `${prefix}${delta.text}`;
    }
    return '';
  }
  if (value.type === 'result' && value.is_error && typeof value.result === 'string') {
    return value.result;
  }
  return '';
};

export const claudeStreamEventDelta = (value) =>
  value?.type === 'stream_event' && !value.parent_tool_use_id ? value.event?.delta : null;

// Claude thinking arrives as incremental thinking_delta stream events. Older
// CLIs without partial messages only include complete thinking blocks on each
// assistant message, so fall back to those until the first delta is seen.
export const extractClaudeReasoningFromJsonEvent = (value, context = {}) => {
  const delta = claudeStreamEventDelta(value);
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    context.thinkingDeltaSeen = true;
    return delta.thinking;
  }

  if (
    !context.thinkingDeltaSeen &&
    value?.type === 'assistant' &&
    !value.parent_tool_use_id &&
    Array.isArray(value.message?.content)
  ) {
    return value.message.content
      .filter((part) => part?.type === 'thinking' && typeof part.thinking === 'string')
      .map((part) => `${part.thinking}\n\n`)
      .join('');
  }

  return '';
};

// cursor-agent stream-json mirrors Claude Code's: assistant events carry the
// streamed text and a final 'result' event repeats the whole response.
export const extractCursorTextFromJsonEvent = (value, context = {}) => {
  if (!value || typeof value !== 'object') return '';

  if (value.type === 'assistant') {
    const parts = Array.isArray(value.message?.content) ? value.message.content : [];
    const text = parts
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
    if (!text) return '';

    // A new assistant message (id changed) after earlier text is a separate
    // paragraph — insert a blank line and stop prefix-matching against the
    // previous message's text.
    const messageId = typeof value.message?.id === 'string' ? value.message.id : null;
    const isNewMessage =
      messageId && context.lastAssistantMessageId && messageId !== context.lastAssistantMessageId;
    if (messageId) context.lastAssistantMessageId = messageId;
    if (isNewMessage) context.lastAssistantText = '';
    const prefix = isNewMessage && context.textSeen ? '\n\n' : '';

    // --stream-partial-output may resend a message's text cumulatively;
    // append only the new suffix. Genuine deltas fail the prefix test and
    // are appended whole.
    const previous = context.lastAssistantText ?? '';
    context.lastAssistantText = text;
    if (previous && text.startsWith(previous)) return `${prefix}${text.slice(previous.length)}`;
    return `${prefix}${text}`;
  }

  // Only use the final aggregate when nothing streamed, so the response
  // isn't duplicated at the end of the message.
  if (value.type === 'result' && !context.textSeen && typeof value.result === 'string') {
    return value.result;
  }

  return '';
};

export const extractGrokTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text' && typeof value.data === 'string') return value.data;
  if (value.type === 'error' && typeof value.data === 'string') return value.data;
  return '';
};

// codex exec --json emits JSONL: thread.started, turn.started/completed/failed,
// and item.started/updated/completed for items typed agent_message, reasoning,
// command_execution, file_change, mcp_tool_call, web_search, todo_list, error.
export const extractCodexTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';
  if (
    value.type === 'item.completed' &&
    value.item?.type === 'agent_message' &&
    typeof value.item.text === 'string'
  ) {
    return `${value.item.text}\n\n`;
  }
  if (value.type === 'turn.failed' && typeof value.error?.message === 'string') {
    return `${value.error.message}\n`;
  }
  return '';
};

export const extractCodexReasoningFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object' || value.type !== 'item.completed') return '';
  if (value.item?.type !== 'reasoning') return '';
  const text = value.item.text ?? value.item.summary;
  return typeof text === 'string' && text ? `${text}\n\n` : '';
};

// Normalize codex's plan surfaces onto the same activity shape used by grok
// and kimi. `codex exec --json` currently flattens update_plan statuses to
// `{ text, completed }`; app-server and rollout records can retain explicit
// pending/in-progress/completed statuses. When the stream only has booleans,
// the first unfinished step is the best available active-step signal.
export const codexPlanActivity = (items) => {
  const plan = (Array.isArray(items) ? items : [])
    .map((item) => {
      const content = String(item?.text ?? item?.step ?? item?.content ?? '').trim();
      const rawStatus = item?.status;
      const completed = item?.completed === true || rawStatus === 'completed';
      const inProgress =
        rawStatus === 'in_progress' || rawStatus === 'inProgress' || rawStatus === 'active';
      return {
        content,
        status: completed ? 'completed' : inProgress ? 'in_progress' : 'pending',
      };
    })
    .filter((item) => item.content);
  if (plan.length === 0) return null;

  if (!plan.some((item) => item.status === 'in_progress')) {
    const firstPending = plan.find((item) => item.status === 'pending');
    if (firstPending) firstPending.status = 'in_progress';
  }

  const completed = plan.filter((item) => item.status === 'completed').length;
  return {
    key: 'plan',
    type: 'plan',
    kind: 'plan',
    title: `Plan - ${completed}/${plan.length} done`,
    status: completed === plan.length ? 'done' : 'running',
    plan,
  };
};

export const codexActivityFromItem = (item, eventType) => {
  if (!item || typeof item !== 'object') return null;

  const failed =
    item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
  const status = failed
    ? 'error'
    : eventType === 'item.completed' || item.status === 'completed'
      ? 'done'
      : 'running';
  const base = { key: typeof item.id === 'string' ? item.id : undefined, status };

  if (item.type === 'command_execution') {
    return {
      ...base,
      type: 'command',
      title: `Command - ${stringifySummary(item.command, 80)}`,
      detail: stringifySummary(item.command),
    };
  }
  if (item.type === 'file_change') {
    const paths = Array.isArray(item.changes)
      ? item.changes.map((change) => change?.path).filter(Boolean)
      : [];
    return {
      ...base,
      type: 'tool',
      title: `File changes (${paths.length})`,
      detail: stringifySummary(paths.join(', ')),
    };
  }
  if (item.type === 'mcp_tool_call') {
    const name = [item.server, item.tool].filter(Boolean).join('.');
    return {
      ...base,
      type: 'tool',
      title: `Tool - ${name || 'MCP'}`,
      detail: stringifySummary(item.arguments ?? ''),
    };
  }
  if (item.type === 'web_search') {
    return {
      ...base,
      type: 'tool',
      title: 'Web search',
      detail: stringifySummary(item.query ?? ''),
    };
  }
  if (item.type === 'todo_list') {
    return codexPlanActivity(item.items);
  }
  if (item.type === 'collab_tool_call') {
    // Multi-agent collaboration calls (spawn_agent/wait/send_message). The
    // items carry no receiver thread ids on current codex, so the actual
    // subagents are detected from their rollout files; this row just shows
    // the parent's collaboration step.
    const tool = String(item.tool ?? 'collaboration');
    const titles = {
      spawn_agent: 'Spawning subagent',
      wait: 'Waiting for subagents',
      send_message: 'Messaging subagent',
      interrupt_agent: 'Interrupting subagent',
      close_agent: 'Closing subagent',
    };
    return {
      ...base,
      type: 'tool',
      kind: 'task',
      title: titles[tool] ?? `Subagents - ${tool}`,
      detail: stringifySummary(item.prompt ?? '', 160),
    };
  }
  if (item.type === 'error') {
    // Codex emits its experimental-feature warning ("Under-development features
    // enabled: ...") as an error item on every turn; it is noise, not a failure.
    if (/under-development features/i.test(String(item.message ?? ''))) return null;
    return {
      ...base,
      type: 'error',
      title: 'Codex notice',
      detail: stringifySummary(item.message, 300),
      status: 'error',
    };
  }

  return null;
};

export const extractCodexActivitiesFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'turn.failed' && typeof value.error?.message === 'string') {
    return [
      {
        type: 'error',
        title: 'Turn failed',
        detail: stringifySummary(value.error.message, 300),
        status: 'error',
      },
    ];
  }
  if (!String(value.type || '').startsWith('item.')) return [];
  const activity = codexActivityFromItem(value.item, value.type);
  return activity ? [activity] : [];
};

export const stringifySummary = (value, maxLength = 180) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);

  try {
    return JSON.stringify(value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  } catch {
    return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }
};

export const extractReasoningText = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return '';

  const data = candidate.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    if (typeof data.text === 'string') return data.text;
    if (typeof data.thinking === 'string') return data.thinking;
    if (typeof data.content === 'string') return data.content;
  }

  if (typeof candidate.thinking === 'string') return candidate.thinking;
  if (typeof candidate.reasoning === 'string') return candidate.reasoning;
  if (typeof candidate.summary === 'string') return candidate.summary;
  if (typeof candidate.text === 'string') return candidate.text;
  if (typeof candidate.content === 'string') return candidate.content;
  if (typeof candidate.delta === 'string') return candidate.delta;

  const delta = candidate.delta;
  if (delta && typeof delta === 'object') {
    if (typeof delta.thinking === 'string') return delta.thinking;
    if (typeof delta.reasoning === 'string') return delta.reasoning;
    if (typeof delta.text === 'string') return delta.text;
    if (typeof delta.content === 'string') return delta.content;
  }

  return '';
};

export const extractReasoningFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return '';

  const thoughts = [];
  const visit = (candidate, depth = 0) => {
    if (!candidate || typeof candidate !== 'object' || depth > 3) return;

    const rawType = String(candidate.type || candidate.kind || candidate.event || '').toLowerCase();
    if (
      rawType.includes('thought') ||
      rawType.includes('thinking') ||
      rawType.includes('reasoning')
    ) {
      const text = extractReasoningText(candidate);
      if (text) thoughts.push(text);
    }

    if (Array.isArray(candidate.content)) {
      for (const part of candidate.content) visit(part, depth + 1);
    }
    if (Array.isArray(candidate.message?.content)) {
      for (const part of candidate.message.content) visit(part, depth + 1);
    }
    if (candidate.message && typeof candidate.message === 'object') visit(candidate.message, depth + 1);
    if (candidate.delta && typeof candidate.delta === 'object') visit(candidate.delta, depth + 1);
  };

  visit(value);
  return thoughts.join('');
};

export const summarizeToolInput = (input) => {
  if (!input || typeof input !== 'object') return stringifySummary(input);

  const command = input.command || input.cmd || input.shell_command;
  if (typeof command === 'string') return command;

  const pathLike =
    input.file_path ||
    input.filePath ||
    input.path ||
    input.cwd ||
    input.pattern ||
    input.glob ||
    input.query;
  if (typeof pathLike === 'string') return pathLike;

  return stringifySummary(input);
};

export const activityFromCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;

  const rawType = String(candidate.type || candidate.kind || candidate.event || '').toLowerCase();
  const rawName = String(
    candidate.name ||
      candidate.tool_name ||
      candidate.toolName ||
      candidate.function?.name ||
      candidate.command_name ||
      ''
  );
  const input = candidate.input || candidate.arguments || candidate.args || candidate.params;
  const output = candidate.output || candidate.result || candidate.content || candidate.data;
  const command = candidate.command || input?.command || input?.cmd;

  const looksLikeTool =
    rawType.includes('tool') ||
    rawType.includes('function') ||
    rawType.includes('command') ||
    rawType.includes('shell') ||
    Boolean(rawName && input);

  if (!looksLikeTool) return null;

  const isResult =
    rawType.includes('result') ||
    rawType.includes('output') ||
    rawType.includes('observation') ||
    candidate.is_error === true;
  const isCommand = rawType.includes('command') || rawType.includes('shell') || Boolean(command);
  const name = rawName || (isCommand ? 'Command' : 'Tool');
  const detail = summarizeToolInput(input) || stringifySummary(output);
  const title = isResult
    ? `${name} result`
    : isCommand
      ? `Command - ${stringifySummary(command || name, 80)}`
      : `Tool - ${name}`;

  const activity = {
    type: candidate.is_error === true ? 'error' : isResult ? 'result' : isCommand ? 'command' : 'tool',
    title,
    detail,
    status: candidate.is_error === true ? 'error' : isResult ? 'done' : 'running',
  };

  // Claude/cursor tool_use blocks carry an id and tool_result blocks point
  // back at it via tool_use_id — used to flip the original step to done.
  if (!isResult && typeof candidate.id === 'string' && candidate.id) {
    activity.key = candidate.id;
  }
  if (isResult && typeof candidate.tool_use_id === 'string' && candidate.tool_use_id) {
    activity.updateForKey = candidate.tool_use_id;
  }

  return activity;
};

export const extractActivitiesFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object') return [];

  const activities = [];
  const maybeAdd = (candidate) => {
    const activity = activityFromCandidate(candidate);
    if (activity) activities.push(activity);
  };

  maybeAdd(value);

  const message = value.message;
  if (message && typeof message === 'object') {
    maybeAdd(message);
    if (Array.isArray(message.content)) {
      for (const part of message.content) maybeAdd(part);
    }
  }

  if (Array.isArray(value.content)) {
    for (const part of value.content) maybeAdd(part);
  }

  if (value.delta && typeof value.delta === 'object') {
    maybeAdd(value.delta);
    if (Array.isArray(value.delta.content)) {
      for (const part of value.delta.content) maybeAdd(part);
    }
  }

  const seen = new Set();
  return activities.filter((activity) => {
    const key = `${activity.type}:${activity.title}:${activity.detail ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// kimi's prompt-mode stream-json emits whole chat messages per line:
// {"role":"assistant","content":...,"tool_calls":[...]}, {"role":"tool",...}
// and a trailing {"role":"meta","type":"session.resume_hint",...}. Only the
// assistant text is transcript-worthy. Unused in practice — every kimi turn,
// including title generation, now speaks ACP (prompt mode can't be
// sandboxed) — but kept so kimi stays covered if a stream-json path returns.
export const extractKimiTextFromJsonEvent = (value) => {
  if (!value || typeof value !== 'object' || value.role !== 'assistant') return '';
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
};

export const providerJsonAdapters = {
  claude: {
    text: extractClaudeTextFromJsonEvent,
    reasoning: extractClaudeReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  codex: {
    text: extractCodexTextFromJsonEvent,
    reasoning: extractCodexReasoningFromJsonEvent,
    activities: extractCodexActivitiesFromJsonEvent,
  },
  cursor: {
    text: extractCursorTextFromJsonEvent,
    reasoning: extractReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  grok: {
    text: extractGrokTextFromJsonEvent,
    reasoning: extractReasoningFromJsonEvent,
    activities: extractActivitiesFromJsonEvent,
  },
  kimi: {
    text: extractKimiTextFromJsonEvent,
    reasoning: () => '',
    activities: () => [],
  },
};

export const genericJsonAdapter = {
  text: extractTextFromJsonEvent,
  reasoning: extractReasoningFromJsonEvent,
  activities: extractActivitiesFromJsonEvent,
};

export const jsonAdapterForProvider = (providerId) => providerJsonAdapters[providerId] ?? genericJsonAdapter;

export const countDiffLines = (text) => {
  if (typeof text !== 'string' || !text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};

// grok's stream ends with an explicit {"type":"end","stopReason":...} event,
// but the process (or a background process it spawned that inherited its
// pipes) can outlive it — treat the event itself as the completion signal.
export const isTerminalJsonEvent = (providerId, value) =>
  providerId === 'grok' && value?.type === 'end';

export const sendsJsonEvents = (providerId) =>
  ['claude', 'codex', 'cursor', 'grok', 'kimi'].includes(providerId);
