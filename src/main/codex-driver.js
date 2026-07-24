import { app, protocol } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromeDevtoolsMcpPackage, codexReasoningEffortForModel, defaultCodexServiceTier } from './models.js';
import { killAgentChild } from './run-registry.js';
import { loginShell } from './shell-env.js';
import { stringifySummary } from './stream-adapters.js';

// ---------------------------------------------------------------------------
// Codex app-server runs. Goals (/goal) live in the app-server's thread manager:
// the runtime auto-starts continuation turns while a goal is active, so
// `codex exec` cannot drive them. Inline reviews (/review) also belong here:
// review/start can resume the current thread, preserving the conversation
// context that `codex exec review` would discard.

// Mirrors the --config overrides the codex exec path builds in
// commandForModel; app-server takes them as a config map on thread/start.
export const codexAppServerConfig = (model, input) => {
  const options =
    input.providerOptions && typeof input.providerOptions === 'object' ? input.providerOptions : {};
  const config = {
    model_reasoning_effort: codexReasoningEffortForModel(model, input.codexReasoningEffort),
    // Same override as the exec paths: 5.6 models default summaries to none.
    model_reasoning_summary: 'detailed',
    service_tier: input.codexServiceTier || defaultCodexServiceTier,
  };
  if (options.networkAccess) config['sandbox_workspace_write.network_access'] = true;
  if (options.webSearch) config['tools.web_search'] = true;
  if (options.browserControl && input.accessMode !== 'read-only') {
    config['mcp_servers.chrome_devtools.command'] = 'npx';
    config['mcp_servers.chrome_devtools.args'] = options.browserAutoConnect
      ? ['-y', chromeDevtoolsMcpPackage, '--autoConnect']
      : ['-y', chromeDevtoolsMcpPackage];
    config['mcp_servers.chrome_devtools.startup_timeout_sec'] = 90;
  }
  // Orion's spawn_subagent bridge — same overrides as the exec path builds.
  if (input.orionMcp) {
    config['mcp_servers.orion.command'] = input.orionMcp.command;
    config['mcp_servers.orion.args'] = input.orionMcp.args;
    config['mcp_servers.orion.env'] = { ELECTRON_RUN_AS_NODE: '1' };
    config['mcp_servers.orion.startup_timeout_sec'] = 30;
    config['mcp_servers.orion.tool_timeout_sec'] = 7200;
    config['mcp_servers.orion.default_tools_approval_mode'] = 'approve';
  }
  return config;
};

// thread/tokenUsage/updated carries cumulative totals for the thread's loaded
// turns — map the total breakdown onto Orion's TurnTokenStats.
export const codexStatsFromTokenUsage = (tokenUsage, modelId) => {
  const total = tokenUsage?.total;
  if (!total || typeof total !== 'object') return null;
  const stats = { modelId };
  if (typeof total.totalTokens === 'number') stats.totalTokens = total.totalTokens;
  if (typeof total.inputTokens === 'number') stats.inputTokens = total.inputTokens;
  if (typeof total.outputTokens === 'number') stats.outputTokens = total.outputTokens;
  if (typeof total.cachedInputTokens === 'number') stats.cachedReadTokens = total.cachedInputTokens;
  if (typeof total.reasoningOutputTokens === 'number') stats.reasoningTokens = total.reasoningOutputTokens;
  return stats;
};

// Wire goal → the shape persisted on Thread.goal in the renderer store.
export const codexGoalForRenderer = (goal) => ({
  objective: String(goal.objective ?? ''),
  status: goal.status,
  tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
  tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : 0,
  timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : 0,
  updatedAt: typeof goal.updatedAt === 'number' ? goal.updatedAt : undefined,
});

// v2 app-server thread items are the camelCase cousins of the exec --json
// items codexActivityFromItem maps; completion carries aggregated output.
export const codexAppServerActivityFromItem = (item, completed) => {
  if (!item || typeof item !== 'object') return null;
  const failed =
    item.status === 'failed' ||
    item.status === 'declined' ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const status = failed ? 'error' : completed || item.status === 'completed' ? 'done' : 'running';
  const base = { key: typeof item.id === 'string' ? item.id : undefined, status };

  if (item.type === 'commandExecution') {
    const activity = {
      ...base,
      type: 'command',
      kind: 'execute',
      title: `Command - ${stringifySummary(item.command, 80)}`,
      detail: stringifySummary(item.command),
    };
    if (completed && typeof item.aggregatedOutput === 'string' && item.aggregatedOutput) {
      activity.output = item.aggregatedOutput.slice(-4000);
    }
    if (typeof item.exitCode === 'number') activity.exitCode = item.exitCode;
    return activity;
  }
  if (item.type === 'fileChange') {
    const paths = Array.isArray(item.changes)
      ? item.changes.map((change) => change?.path).filter(Boolean)
      : [];
    return {
      ...base,
      type: 'tool',
      kind: 'edit',
      title: `File changes (${paths.length})`,
      detail: stringifySummary(paths.join(', ')),
    };
  }
  if (item.type === 'mcpToolCall') {
    const name = [item.server, item.tool].filter(Boolean).join('.');
    return {
      ...base,
      type: 'tool',
      title: `Tool - ${name || 'MCP'}`,
      detail: stringifySummary(item.arguments ?? ''),
    };
  }
  if (item.type === 'webSearch') {
    return {
      ...base,
      type: 'tool',
      kind: 'search',
      title: `Web search - ${stringifySummary(item.query ?? '', 80)}`,
      detail: stringifySummary(item.query ?? ''),
    };
  }
  if (item.type === 'imageGeneration') {
    return { ...base, type: 'tool', title: 'Image generation' };
  }
  return null;
};

export const CODEX_GOAL_END_NOTES = {
  complete: '\n\n_Goal achieved._',
  paused: '\n\n_Goal paused — send `/goal resume` to continue._',
  blocked: '\n\n_Goal blocked — the agent can’t make progress without help. `/goal resume` to retry._',
  usageLimited: '\n\n_Goal hit usage limits — `/goal resume` once limits reset._',
  budgetLimited: '\n\n_Goal token budget exhausted — `/goal resume` to keep going._',
};

export const codexReviewTarget = (review) => {
  const threadContext =
    typeof review?.threadContext === 'string' ? review.threadContext.trim() : '';
  if (threadContext) {
    const scope =
      review?.mode === 'base' && review.base
        ? `Review the changes against the base branch ${review.base}.`
        : review?.mode === 'commit' && review.commit
          ? `Review the changes introduced by commit ${review.commit}.`
          : review?.mode === 'custom' && review.instructions
            ? String(review.instructions).trim()
            : 'Review all staged, unstaged, and untracked changes in the current repository.';
    return {
      type: 'custom',
      instructions: `${scope}\n\n${threadContext}`,
    };
  }
  if (review?.mode === 'base' && review.base) {
    return { type: 'baseBranch', branch: review.base };
  }
  if (review?.mode === 'commit' && review.commit) {
    return { type: 'commit', sha: review.commit };
  }
  if (review?.mode === 'custom') {
    return { type: 'custom', instructions: String(review.instructions ?? '').trim() };
  }
  return { type: 'uncommittedChanges' };
};

export const createCodexAppServerDriver = ({
  child,
  cwd,
  model,
  input,
  goal,
  review,
  resumeSessionId,
  accessMode,
  callbacks,
}) => {
  let nextRequestId = 1;
  const pendingRequests = new Map();
  let threadId = null;
  let textSeen = false;
  let pendingTextBreak = false;
  // Items whose text already streamed via deltas — their item.completed
  // payload must not be emitted a second time.
  const streamedTextItems = new Set();
  const streamedReasoningItems = new Set();
  let goalStatus = null;
  let turnActive = false;
  let activeTurnId = null;
  let continuationTimer = null;
  let ended = false;

  // The goal runtime decides whether to continue after each turn; give it
  // this long to start the next turn (or flip the goal status) before Orion
  // concludes the pursuit stalled and pauses it.
  const CONTINUATION_GRACE_MS = 90_000;

  const write = (message) => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {}
  };

  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextRequestId++;
      pendingRequests.set(id, resolve);
      write({ jsonrpc: '2.0', id, method, params });
    });

  const emitText = (text) => {
    if (!text) return;
    const prefix = pendingTextBreak && textSeen ? '\n\n' : '';
    pendingTextBreak = false;
    textSeen = true;
    callbacks.onText(`${prefix}${text}`);
  };

  const clearContinuationTimer = () => {
    if (continuationTimer) {
      clearTimeout(continuationTimer);
      continuationTimer = null;
    }
  };

  const endRun = (note) => {
    if (ended) return;
    ended = true;
    clearContinuationTimer();
    if (note) emitText(note);
    callbacks.onRunEnd();
  };

  const fail = (error) => {
    if (ended) return;
    ended = true;
    clearContinuationTimer();
    callbacks.onFatal(
      typeof error === 'string' ? error : error?.message ?? 'Codex app-server protocol error.'
    );
  };

  const armContinuationTimer = () => {
    clearContinuationTimer();
    continuationTimer = setTimeout(async () => {
      continuationTimer = null;
      if (ended || turnActive) return;
      // The runtime declined to keep going (idle work rejected, nothing left
      // to do, …) without flipping the goal status. Pause the stored goal so
      // it matches the fact that nothing is running, then end gracefully.
      if (goalStatus === 'active' && threadId) {
        try {
          await request('thread/goal/set', { threadId, status: 'paused' });
        } catch {}
      }
      endRun('\n\n_Goal run went idle — paused. Send `/goal resume` to continue._');
    }, CONTINUATION_GRACE_MS);
  };

  const handleGoalUpdated = (wireGoal) => {
    goalStatus = wireGoal.status;
    callbacks.onGoal(codexGoalForRenderer(wireGoal));
    if (wireGoal.status !== 'active') {
      clearContinuationTimer();
      if (!turnActive) endRun(CODEX_GOAL_END_NOTES[wireGoal.status] ?? '');
    }
  };

  const handleTurnCompleted = (params) => {
    turnActive = false;
    activeTurnId = null;
    const turn = params.turn ?? {};
    if (turn.status === 'failed') {
      const message = turn.error?.message ?? 'Codex turn failed.';
      callbacks.onActivity({
        type: 'error',
        title: 'Turn failed',
        detail: stringifySummary(message, 300),
        status: 'error',
      });
      if (review) {
        fail(message);
        return;
      }
      // The goal runtime skips continuation after turn errors — pause the
      // stored goal so its status matches reality, then end the run.
      void (async () => {
        if (goalStatus === 'active' && threadId) {
          try {
            const paused = await Promise.race([
              request('thread/goal/set', { threadId, status: 'paused' }),
              new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
            ]);
            // The adjacent goal-updated notification normally handles this,
            // but apply the response too in case process output was delayed.
            if (paused?.result?.goal) handleGoalUpdated(paused.result.goal);
          } catch {}
        }
        endRun('\n\n_Goal run stopped on an error — `/goal resume` to retry._');
      })();
      return;
    }
    if (ended) return;
    if (review) {
      endRun();
      return;
    }
    if (goalStatus && goalStatus !== 'active') {
      endRun(CODEX_GOAL_END_NOTES[goalStatus] ?? '');
      return;
    }
    // Goal still active: the runtime should start a continuation turn.
    armContinuationTimer();
  };

  const handleItem = (params, completed) => {
    const item = params.item;
    if (!item || typeof item !== 'object') return;
    if (item.type === 'agentMessage') {
      if (completed) {
        if (!streamedTextItems.has(item.id) && typeof item.text === 'string' && item.text) {
          emitText(item.text);
        }
        pendingTextBreak = true;
      }
      return;
    }
    if (item.type === 'reasoning') {
      if (completed && !streamedReasoningItems.has(item.id)) {
        const parts = [
          ...(Array.isArray(item.summary) ? item.summary : []),
          ...(Array.isArray(item.content) ? item.content : []),
        ].filter((part) => typeof part === 'string' && part);
        if (parts.length) callbacks.onReasoning(`${parts.join('\n\n')}\n\n`);
      }
      return;
    }
    const activity = codexAppServerActivityFromItem(item, completed);
    if (activity) {
      // Text resuming after tool activity is a new paragraph.
      if (textSeen) pendingTextBreak = true;
      callbacks.onActivity(activity);
    }
  };

  const handlePlanUpdate = (params) => {
    const list = Array.isArray(params.plan) ? params.plan : [];
    const total = list.length;
    const completedCount = list.filter((step) => step?.status === 'completed').length;
    const isActive = (step) => step?.status === 'inProgress' || step?.status === 'in_progress';
    const active = list.find(isActive);
    callbacks.onActivity({
      key: 'plan',
      type: 'plan',
      kind: 'plan',
      title: active
        ? `Tasks (${completedCount}/${total}) - ${stringifySummary(active.step, 60)}`
        : `Tasks (${completedCount}/${total})`,
      status: total > 0 && completedCount === total ? 'done' : 'running',
      plan: list.map((step) => ({
        content: String(step?.step ?? ''),
        status: step?.status === 'completed' ? 'completed' : isActive(step) ? 'in_progress' : 'pending',
      })),
    });
  };

  // approvalPolicy 'never' means these should not fire; answer defensively by
  // access-mode policy so a stray request can never deadlock the run.
  const answerServerRequest = (message) => {
    const method = message.method;
    const respond = (result) => write({ jsonrpc: '2.0', id: message.id, result });
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      return respond({ decision: accessMode === 'full-access' ? 'accept' : 'decline' });
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      return respond({ decision: accessMode === 'read-only' ? 'decline' : 'accept' });
    }
    if (method === 'item/permissions/requestApproval') {
      return respond({ decision: accessMode === 'full-access' ? 'accept' : 'decline' });
    }
    write({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not supported' },
    });
  };

  const start = async () => {
    const init = await request('initialize', {
      clientInfo: { name: 'orion', title: 'Orion', version: app.getVersion?.() ?? '0.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    if (init.error) return fail(init.error);
    write({ jsonrpc: '2.0', method: 'initialized', params: {} });

    const sandbox =
      accessMode === 'full-access'
        ? 'danger-full-access'
        : accessMode === 'read-only'
          ? 'read-only'
          : 'workspace-write';
    const threadParams = {
      cwd,
      model: model.slug,
      sandbox,
      approvalPolicy: 'never',
      config: codexAppServerConfig(model, input),
    };

    let resolvedThreadId = null;
    if (resumeSessionId) {
      const resumed = await request('thread/resume', { threadId: resumeSessionId, ...threadParams });
      if (resumed.error) callbacks.onResumeFallback?.();
      else resolvedThreadId = resumed.result?.thread?.id ?? resumeSessionId;
    }
    if (!resolvedThreadId) {
      const started = await request('thread/start', threadParams);
      resolvedThreadId = started.result?.thread?.id;
      if (started.error || typeof resolvedThreadId !== 'string') {
        return fail(started.error ?? 'Codex app-server did not return a thread id.');
      }
    }
    threadId = resolvedThreadId;
    callbacks.onSessionId(threadId);

    if (review) {
      const startedReview = await request('review/start', {
        threadId,
        delivery: 'inline',
        target: codexReviewTarget(review),
      });
      if (startedReview.error) return fail(startedReview.error);
      return;
    }

    // Goals require a persistent thread; setting one active immediately
    // starts the pursuit turn — no turn/start call needed.
    const setParams =
      goal.action === 'resume'
        ? { threadId, status: 'active' }
        : {
            threadId,
            objective: goal.objective,
            ...(typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0
              ? { tokenBudget: Math.round(goal.tokenBudget) }
              : {}),
          };
    const set = await request('thread/goal/set', setParams);
    if (set.error) return fail(set.error);
    if (set.result?.goal) handleGoalUpdated(set.result.goal);
    // If no turn starts (e.g. the runtime immediately declines idle work),
    // the continuation watchdog pauses the goal and ends the run.
    if (!turnActive) armContinuationTimer();
  };

  // User stop = pause: the goal stays resumable and its stored status
  // matches the fact that nothing is running anymore.
  const stopGoalRun = async () => {
    ended = true;
    clearContinuationTimer();
    if (!threadId) return;
    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
    try {
      const paused = await withTimeout(
        request('thread/goal/set', { threadId, status: 'paused' }),
        1500
      );
      // Do not depend solely on the adjacent notification: Stop may reap the
      // app-server before that notification is delivered to the renderer.
      if (paused?.result?.goal) handleGoalUpdated(paused.result.goal);
      await withTimeout(
        request('turn/interrupt', {
          threadId,
          ...(activeTurnId ? { turnId: activeTurnId } : {}),
        }),
        1000
      );
    } catch {}
  };

  const handleMessage = (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && !message.method) {
      const resolve = pendingRequests.get(message.id);
      if (resolve) {
        pendingRequests.delete(message.id);
        resolve(message);
      }
      return;
    }

    if (message.id !== undefined && message.method) return answerServerRequest(message);

    const params = message.params ?? {};
    // Defensive: the app-server can host many threads; only ours matters.
    if (params.threadId && threadId && params.threadId !== threadId) return;

    switch (message.method) {
      case 'item/agentMessage/delta': {
        if (typeof params.itemId === 'string') streamedTextItems.add(params.itemId);
        if (typeof params.delta === 'string') emitText(params.delta);
        return;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        if (typeof params.itemId === 'string') streamedReasoningItems.add(params.itemId);
        if (typeof params.delta === 'string' && params.delta) callbacks.onReasoning(params.delta);
        return;
      }
      case 'item/reasoning/summaryPartAdded':
        callbacks.onReasoning('\n\n');
        return;
      case 'item/started':
        handleItem(params, false);
        return;
      case 'item/completed':
        handleItem(params, true);
        return;
      case 'turn/started': {
        turnActive = true;
        activeTurnId = typeof params.turn?.id === 'string' ? params.turn.id : null;
        clearContinuationTimer();
        if (textSeen) pendingTextBreak = true;
        return;
      }
      case 'turn/completed':
        handleTurnCompleted(params);
        return;
      case 'turn/plan/updated':
        handlePlanUpdate(params);
        return;
      case 'thread/tokenUsage/updated': {
        const stats = codexStatsFromTokenUsage(params.tokenUsage, model.id);
        if (stats) callbacks.onStats(stats);
        return;
      }
      case 'thread/goal/updated': {
        if (params.goal) handleGoalUpdated(params.goal);
        return;
      }
      case 'thread/goal/cleared': {
        goalStatus = 'cleared';
        callbacks.onGoal(null);
        clearContinuationTimer();
        if (!turnActive) endRun('\n\n_Goal cleared._');
        return;
      }
      case 'error': {
        const detail = stringifySummary(params.error?.message ?? '', 300);
        if (detail) {
          callbacks.onActivity({
            type: 'error',
            title: params.willRetry ? 'Codex retrying' : 'Codex error',
            detail,
            status: 'error',
          });
        }
        return;
      }
      default:
        return;
    }
  };

  return { start, handleMessage, stopGoalRun };
};

// Goal runs whose driver must be asked to pause before the process is killed
// (agent:stopTurn). Keyed by runId; cleaned up in finalizeRun.
export const codexGoalRunDrivers = new Map();

// ---------------------------------------------------------------------------
// Claude persistent sessions (Agent SDK). The one-shot `claude --print` spawn
// ends the harness process with every turn, which kills any background
// subagents the model left running and silences the task notifications that
// are supposed to re-invoke it — long multi-phase runs died at each turn
// boundary. Claude turns therefore run on a persistent Agent SDK session per
// thread: one CLI process spans the whole conversation, user turns are pushed
// over stream-json stdin, steer/stop interrupt the turn in place instead of
// SIGTERMing the process, and turns the harness starts on its own (a
// background task finishing) are emitted as `started` events flagged
// `background` so the renderer can grow the transcript. `/btw` asides and
// title generation keep the one-shot CLI path.


// Goal ops on a thread with no live goal run (pause after the run already
// ended, clear, status refresh). Runs a short-lived app-server dialog:
// initialize → thread/resume → goal op → kill.
export const runCodexGoalOp = ({ sessionId, cwd, action }) =>
  new Promise((resolve) => {
    const child = spawn(loginShell, ['-lc', 'codex app-server'], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let nextId = 1;
    let buffer = '';
    const pending = new Map();
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      killAgentChild(child);
      resolve(value);
    };
    const timeout = setTimeout(() => settle({ ok: false, error: 'Codex app-server timed out.' }), 20000);
    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {}
    };
    const request = (method, params) =>
      new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        write({ jsonrpc: '2.0', id, method, params });
      });
    child.on('error', (error) => settle({ ok: false, error: error.message }));
    child.on('exit', () => settle({ ok: false, error: 'Codex app-server exited early.' }));
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const message = JSON.parse(trimmed);
          if (message.id !== undefined && !message.method && pending.has(message.id)) {
            const res = pending.get(message.id);
            pending.delete(message.id);
            res(message);
          }
        } catch {}
      }
    });
    (async () => {
      try {
        const init = await request('initialize', {
          clientInfo: { name: 'orion', title: 'Orion', version: app.getVersion?.() ?? '0.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        if (init.error) return settle({ ok: false, error: init.error.message });
        write({ jsonrpc: '2.0', method: 'initialized', params: {} });
        const resumed = await request('thread/resume', { threadId: sessionId, cwd });
        if (resumed.error) return settle({ ok: false, error: resumed.error.message });
        if (action === 'pause') {
          const result = await request('thread/goal/set', { threadId: sessionId, status: 'paused' });
          if (result.error) return settle({ ok: false, error: result.error.message });
          return settle({ ok: true, goal: result.result?.goal ? codexGoalForRenderer(result.result.goal) : null });
        }
        if (action === 'clear') {
          const result = await request('thread/goal/clear', { threadId: sessionId });
          if (result.error) return settle({ ok: false, error: result.error.message });
          return settle({ ok: true, goal: null });
        }
        const result = await request('thread/goal/get', { threadId: sessionId });
        if (result.error) return settle({ ok: false, error: result.error.message });
        return settle({ ok: true, goal: result.result?.goal ? codexGoalForRenderer(result.result.goal) : null });
      } catch (error) {
        settle({ ok: false, error: error?.message ?? String(error) });
      }
    })();
  });
