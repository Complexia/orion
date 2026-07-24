import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { emitAgentEvent } from './events.js';
import { codexPlanActivity, extractActivitiesFromJsonEvent, stringifySummary } from './stream-adapters.js';

// ---------------------------------------------------------------------------
// Native provider subagents. Every provider CLI can spawn subagents (claude
// Agent/Task tool, codex collaboration.spawn_agent, cursor Task tool, grok
// spawn_subagent), and each one leaves a live transcript on disk:
//   claude — <tmp>/claude-<uid>/<cwd-slug>/<session>/tasks/<task_id>.output
//            (session-transcript JSONL; announced by system:task_started)
//   codex  — ~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread_id>.jsonl whose
//            session_meta.source.subagent.thread_spawn.parent_thread_id links
//            it to the parent (exec --json's collab items carry no ids)
//   cursor — ~/.cursor/projects/<cwd-slug>/agent-transcripts/<agentId>/…jsonl
//            (announced by the taskToolCall stream event)
//   grok   — ~/.grok/sessions/<encodeURIComponent(cwd)>/<child_session_id>/
//            updates.jsonl (raw session/update lines; announced by the
//            _x.ai subagent_spawned notification)
// A tracker per run tails those files and re-emits them as subagent-scoped
// turn events, so the renderer can show every subagent as a switchable live
// thread — uniformly across providers.

export const SUBAGENT_TAIL_POLL_MS = 300;
export const SUBAGENT_FILE_WAIT_MS = 30000;

// Poll-tail a JSONL file: wait for it to exist (resolveFile), then stream
// appended lines. fs.watch is unreliable across the tmp/home dirs involved,
// and a 300ms poll is imperceptible next to model latency.
export const createJsonlTailer = ({ resolveFile, onLine }) => {
  let stopped = false;
  let filePath = null;
  let offset = 0;
  let carry = '';
  let waitedMs = 0;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      if (!filePath) {
        try {
          filePath = await resolveFile();
        } catch {
          filePath = null;
        }
        if (!filePath) {
          waitedMs += SUBAGENT_TAIL_POLL_MS;
          if (waitedMs >= SUBAGENT_FILE_WAIT_MS) stop();
          return;
        }
      }
      let handle;
      try {
        handle = await fs.open(filePath, 'r');
      } catch {
        return;
      }
      try {
        const { size } = await handle.stat();
        if (size <= offset) return;
        const length = size - offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        offset = size;
        const text = `${carry}${buffer.toString('utf8')}`;
        const lines = text.split(/\r?\n/);
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }
          try {
            onLine(parsed);
          } catch {}
        }
      } finally {
        await handle.close();
      }
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), SUBAGENT_TAIL_POLL_MS);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  return {
    stop,
    // One last read before stopping — catches lines flushed to disk just
    // before the provider announced the subagent finished.
    finish: async () => {
      await poll();
      stop();
    },
  };
};

export const SUBAGENT_REASONING_EMIT_MS = 200;

export const createSubagentTracker = ({ providerId, threadId, getSender, getRunId }) => {
  const subagents = new Map();

  const emit = (event) => {
    const sender = getSender();
    if (!sender || sender.isDestroyed()) return;
    emitAgentEvent(sender, { runId: getRunId(), threadId, ...event });
  };

  const emitMeta = (sub, patch = {}) => {
    Object.assign(sub.meta, patch);
    emit({ type: 'subagent', subagent: { ...sub.meta } });
  };

  const sendReasoning = (sub, status = 'running') => {
    const detail = sub.reasoningText.trim();
    if (!detail) return;
    emit({
      type: 'subagent-activity',
      subagentId: sub.meta.id,
      activity: { key: 'reasoning', type: 'thought', title: 'Reasoning', detail, status },
    });
  };

  const flushReasoning = (sub, status) => {
    if (sub.reasoningTimer) {
      clearTimeout(sub.reasoningTimer);
      sub.reasoningTimer = null;
    }
    sendReasoning(sub, status);
  };

  // The stream helpers each subagent's line handler writes through. Mirrors
  // the main-run pipeline: text chunks, throttled reasoning card, tool
  // activities resolved in place via key/updateForKey.
  const createApi = (sub) => ({
    text: (chunk) => {
      if (!chunk) return;
      emit({ type: 'subagent-chunk', subagentId: sub.meta.id, chunk });
    },
    reasoning: (delta) => {
      if (!delta) return;
      sub.reasoningText = `${sub.reasoningText}${delta}`;
      const elapsed = Date.now() - sub.lastReasoningAt;
      if (elapsed >= SUBAGENT_REASONING_EMIT_MS) {
        sub.lastReasoningAt = Date.now();
        sendReasoning(sub);
        return;
      }
      if (sub.reasoningTimer) return;
      sub.reasoningTimer = setTimeout(() => {
        sub.reasoningTimer = null;
        sub.lastReasoningAt = Date.now();
        sendReasoning(sub);
      }, SUBAGENT_REASONING_EMIT_MS - elapsed);
    },
    activity: ({ updateForKey, ...activity }) => {
      if (updateForKey) {
        const known = sub.knownToolActivities.get(updateForKey);
        if (known) {
          emit({
            type: 'subagent-activity',
            subagentId: sub.meta.id,
            activity: {
              ...known,
              key: updateForKey,
              status: activity.status === 'error' || activity.type === 'error' ? 'error' : 'done',
            },
          });
          return;
        }
      }
      if (activity.key) {
        const { key, status, ...rest } = activity;
        sub.knownToolActivities.set(key, rest);
      }
      emit({ type: 'subagent-activity', subagentId: sub.meta.id, activity });
    },
    stats: (stats) => {
      sub.meta.stats = { ...sub.meta.stats, ...stats };
    },
    prompt: (prompt) => {
      if (!sub.meta.prompt && prompt) emitMeta(sub, { prompt });
    },
    finish: (info) => finish(sub.meta.id, info),
  });

  const start = (meta, { resolveFile, handleLine }) => {
    if (!meta?.id || subagents.has(meta.id)) return;
    const sub = {
      meta: { providerId, status: 'running', startedAt: Date.now(), ...meta },
      knownToolActivities: new Map(),
      reasoningText: '',
      reasoningTimer: null,
      lastReasoningAt: 0,
      ctx: {},
      finished: false,
      finishTimer: null,
    };
    subagents.set(meta.id, sub);
    emitMeta(sub);
    const api = createApi(sub);
    sub.tailer = createJsonlTailer({
      resolveFile,
      onLine: (value) => handleLine(value, api, sub.ctx),
    });
  };

  const finish = (id, { status = 'done', stats, summary } = {}) => {
    const sub = subagents.get(id);
    if (!sub || sub.finished) return;
    sub.finished = true;
    if (sub.finishTimer) {
      clearTimeout(sub.finishTimer);
      sub.finishTimer = null;
    }
    void (async () => {
      // Some CLIs (cursor) flush the subagent transcript to disk only at
      // completion, so the "finished" signal can beat the file write. Give
      // the file a moment before the final read.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await sub.tailer?.finish();
      } catch {}
      flushReasoning(sub, 'done');
      emitMeta(sub, {
        status,
        completedAt: Date.now(),
        ...(stats ? { stats: { ...sub.meta.stats, ...stats } } : {}),
        ...(summary ? { summary } : {}),
      });
    })();
  };

  // Finish after a short delay unless a richer signal (one carrying stats or
  // a summary) lands first — e.g. claude's task_updated vs task_notification.
  const finishSoon = (id, info, delayMs = 2500) => {
    const sub = subagents.get(id);
    if (!sub || sub.finished || sub.finishTimer) return;
    sub.finishTimer = setTimeout(() => {
      sub.finishTimer = null;
      finish(id, info);
    }, delayMs);
  };

  const dispose = (status = 'done') => {
    for (const [id, sub] of subagents) {
      if (!sub.finished) finish(id, { status });
    }
  };

  return {
    start,
    finish,
    finishSoon,
    has: (id) => subagents.has(id),
    ids: () => [...subagents.keys()],
    dispose,
  };
};

// --- claude: the task output file is session-transcript JSONL ---------------

export const claudeTaskOutputCandidates = (projectPath, sessionId, taskId) => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const slug = String(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
  const bases = [];
  if (uid !== null) bases.push(path.join('/tmp', `claude-${uid}`));
  bases.push(path.join(os.tmpdir(), uid !== null ? `claude-${uid}` : 'claude'));
  return [...new Set(bases)].map((base) =>
    path.join(base, slug, sessionId, 'tasks', `${taskId}.output`)
  );
};

export const handleClaudeSubagentLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'assistant' && Array.isArray(value.message?.content)) {
    for (const part of value.message.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string' && part.text) {
        api.text(ctx.textSeen ? `\n\n${part.text}` : part.text);
        ctx.textSeen = true;
      } else if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking) {
        api.reasoning(`${part.thinking}\n\n`);
      }
    }
  }
  // tool_use blocks (assistant lines) and tool_result blocks (user lines).
  for (const activity of extractActivitiesFromJsonEvent(value)) api.activity(activity);
};

// --- cursor: agent-transcripts/<agentId>/<agentId>.jsonl --------------------

export const cursorAgentTranscriptFile = async (projectPath, agentId) => {
  const projectsDir = path.join(os.homedir(), '.cursor', 'projects');
  const slug = String(projectPath).replace(/^\//, '').replace(/\//g, '-');
  const direct = path.join(projectsDir, slug, 'agent-transcripts', agentId, `${agentId}.jsonl`);
  if (existsSync(direct)) return direct;
  // Slug rules vary across cursor versions; the agentId is globally unique,
  // so scan the project dirs for it.
  try {
    const entries = await fs.readdir(projectsDir);
    for (const entry of entries) {
      const candidate = path.join(
        projectsDir,
        entry,
        'agent-transcripts',
        agentId,
        `${agentId}.jsonl`
      );
      if (existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
};

export const handleCursorSubagentLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'turn_ended') {
    api.finish({ status: !value.status || value.status === 'success' ? 'done' : 'error' });
    return;
  }
  if (value.role === 'assistant' && Array.isArray(value.message?.content)) {
    const text = value.message.content
      .map((part) =>
        part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
          ? part.text
          : ''
      )
      .join('')
      // cursor redacts tool-call payloads inside transcript text blocks.
      .replace(/\n?\[REDACTED\]/g, '')
      .trim();
    if (text) {
      api.text(ctx.textSeen ? `\n\n${text}` : text);
      ctx.textSeen = true;
    }
  }
  for (const activity of extractActivitiesFromJsonEvent(value)) api.activity(activity);
};

// --- codex: subagent rollout files under ~/.codex/sessions ------------------

export const codexSessionDayDirs = () => {
  const dirs = [];
  const now = Date.now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(now - dayOffset * 86400000);
    dirs.push(
      path.join(
        os.homedir(),
        '.codex',
        'sessions',
        String(day.getFullYear()),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0')
      )
    );
  }
  return dirs;
};

export const readFirstJsonLine = async (filePath) => {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    // A rollout's session_meta line embeds the full harness instructions and
    // can run well past any fixed small buffer — read chunks until the first
    // newline (capped so a corrupt file can't balloon memory).
    const CHUNK = 65536;
    const MAX = 4 * 1024 * 1024;
    let collected = Buffer.alloc(0);
    let offset = 0;
    while (collected.length < MAX) {
      const buffer = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, offset);
      if (bytesRead <= 0) return null;
      collected = Buffer.concat([collected, buffer.subarray(0, bytesRead)]);
      const newline = collected.indexOf(0x0a);
      if (newline >= 0) return JSON.parse(collected.toString('utf8', 0, newline));
      if (bytesRead < CHUNK) return null;
      offset += bytesRead;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
};

// exec --json's collab items never carry receiver thread ids (experimental
// serialization gap, verified on codex 0.144.5), so spawns are detected from
// the filesystem: a new rollout whose session_meta names this thread as its
// spawn parent is a subagent of this run.
export const watchCodexSubagentSpawns = ({ parentThreadId, onSpawn }) => {
  const seen = new Set();
  // Baseline every rollout that already exists before this run starts. A
  // resumed parent keeps the same thread id across turns, so a time-window
  // lookback would rediscover the previous turn's recent subagents and tail
  // their transcripts again from offset zero.
  for (const dir of codexSessionDayDirs()) {
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('rollout-') && name.endsWith('.jsonl')) seen.add(name);
      }
    } catch {
      // Missing day directory; the poller will pick it up if it appears.
    }
  }
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      for (const dir of codexSessionDayDirs()) {
        let entries;
        try {
          entries = await fs.readdir(dir);
        } catch {
          continue;
        }
        for (const name of entries) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl') || seen.has(name)) continue;
          const filePath = path.join(dir, name);
          const head = await readFirstJsonLine(filePath);
          // First line not flushed yet — leave it for the next poll.
          if (!head) continue;
          seen.add(name);
          const spawn = head?.payload?.source?.subagent?.thread_spawn;
          const childThreadId = head?.payload?.id;
          if (!spawn || !childThreadId || spawn.parent_thread_id !== parentThreadId) continue;
          onSpawn({
            threadId: childThreadId,
            nickname: typeof spawn.agent_nickname === 'string' ? spawn.agent_nickname : undefined,
            role: typeof spawn.agent_role === 'string' ? spawn.agent_role : undefined,
            filePath,
          });
        }
      }
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => void poll(), 1000);
  void poll();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};

export const codexRolloutCommandSummary = (raw) => {
  const command = Array.isArray(raw) ? raw.join(' ') : raw;
  return stringifySummary(command, 80);
};

// Subagent rollouts come in two shapes. Fresh-context, role-based spawns hold
// only the subagent's own transcript (their thread_spawn has agent_role but no
// agent_path). Collaboration spawns carry an agent_path and replay the parent
// history before inter_agent_communication_metadata, where the NEW_TASK
// envelope starts the subagent's own work. Current Codex rollouts do not add a
// second session_meta before that replay, so the source metadata — not the
// number of session_meta lines — must decide whether the prefix is live.
export const handleCodexRolloutLine = (value, api, ctx) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'session_meta') {
    const spawn = value.payload?.source?.subagent?.thread_spawn;
    if (spawn && typeof spawn === 'object') {
      ctx.forked = typeof spawn.agent_path === 'string' && spawn.agent_path.length > 0;
      ctx.decided = true;
      ctx.live = !ctx.forked;
    }
    return;
  }
  if (!ctx.decided) {
    // Older/unknown rollout sources have no thread_spawn metadata. Preserve
    // the historical fresh-context behavior for those files.
    ctx.decided = true;
    ctx.live = true;
  }
  if (value.type === 'inter_agent_communication_metadata') {
    ctx.live = true;
    return;
  }
  if (!ctx.live) return;
  const payload = value.payload;
  if (!payload || typeof payload !== 'object') return;

  if (value.type === 'event_msg') {
    switch (payload.type) {
      case 'agent_message': {
        if (typeof payload.message === 'string' && payload.message) {
          api.text(ctx.textSeen ? `\n\n${payload.message}` : payload.message);
          ctx.textSeen = true;
        }
        return;
      }
      case 'agent_reasoning': {
        if (typeof payload.text === 'string' && payload.text) api.reasoning(`${payload.text}\n\n`);
        return;
      }
      case 'user_message': {
        // Fresh-context spawns deliver the spawn prompt as the first user
        // message of the subagent's own transcript.
        if (!ctx.promptSeen && typeof payload.message === 'string' && payload.message) {
          ctx.promptSeen = true;
          api.prompt(payload.message);
        }
        return;
      }
      case 'exec_command_begin': {
        api.activity({
          key: typeof payload.call_id === 'string' ? payload.call_id : undefined,
          type: 'command',
          title: `Command - ${codexRolloutCommandSummary(payload.command)}`,
          detail: codexRolloutCommandSummary(payload.command),
          status: 'running',
        });
        return;
      }
      case 'exec_command_end': {
        if (typeof payload.call_id === 'string') {
          api.activity({
            updateForKey: payload.call_id,
            type: 'result',
            title: 'Command finished',
            status:
              typeof payload.exit_code === 'number' && payload.exit_code !== 0
                ? 'error'
                : 'done',
          });
        }
        return;
      }
      case 'patch_apply_end': {
        api.activity({ type: 'tool', title: 'File changes applied', status: 'done' });
        return;
      }
      case 'token_count': {
        const total = payload.info?.total_token_usage?.total_tokens;
        if (typeof total === 'number') api.stats({ totalTokens: total });
        return;
      }
      case 'task_complete': {
        api.finish({ status: 'done' });
        return;
      }
      default:
        return;
    }
  }

  if (value.type === 'response_item') {
    if (payload.type === 'agent_message' && typeof payload.message === 'string') {
      // The NEW_TASK envelope repeats the spawn prompt — surface it as the
      // subagent's prompt, not as transcript text.
      if (!ctx.promptSeen && payload.message.startsWith('Message Type:')) {
        ctx.promptSeen = true;
        const idx = payload.message.indexOf('Payload:');
        if (idx >= 0) api.prompt(payload.message.slice(idx + 'Payload:'.length).trim());
      }
      return;
    }
    if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
      const input = typeof payload.input === 'string' ? payload.input : payload.arguments;
      if (payload.name === 'update_plan') {
        let args;
        try {
          args = typeof input === 'string' ? JSON.parse(input) : input;
        } catch {
          args = null;
        }
        const activity = codexPlanActivity(args?.plan);
        if (activity) api.activity(activity);
        if (typeof payload.call_id === 'string') {
          if (!ctx.planCallIds) ctx.planCallIds = new Set();
          ctx.planCallIds.add(payload.call_id);
        }
        return;
      }
      api.activity({
        key: typeof payload.call_id === 'string' ? payload.call_id : undefined,
        type: payload.name === 'exec' ? 'command' : 'tool',
        title:
          payload.name === 'exec'
            ? `Command - ${stringifySummary(input, 80)}`
            : `Tool - ${payload.name ?? 'call'}`,
        detail: stringifySummary(input),
        status: 'running',
      });
      return;
    }
    if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      if (
        typeof payload.call_id === 'string' &&
        ctx.planCallIds?.has(payload.call_id)
      ) {
        ctx.planCallIds.delete(payload.call_id);
        return;
      }
      if (typeof payload.call_id === 'string') {
        api.activity({
          updateForKey: payload.call_id,
          type: 'result',
          title: 'Tool result',
          status: 'done',
        });
      }
    }
  }
};
