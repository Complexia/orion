import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Check, ChevronDown, FilePen, Globe, ListChecks, Search, Terminal, Wrench, X } from 'lucide-react';
import { type AgentActivity, type BtwExchange, type Message, type ThreadGoal, type TurnTokenStats } from '../store';

export const formatRunDuration = (startedAt?: string, completedAt?: string) => {
  if (!startedAt) return '';
  const started = new Date(startedAt).getTime();
  const ended = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return '';

  const seconds = Math.max(0, Math.round((ended - started) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

export const AgentActivityIcon: React.FC<{ activity: AgentActivity }> = ({ activity }) => {
  if (activity.type === 'plan') return <ListChecks size={15} />;
  if (activity.kind === 'edit') return <FilePen size={15} />;
  if (activity.kind === 'read') return <BookOpen size={15} />;
  if (activity.kind === 'search') return <Search size={15} />;
  if (activity.kind === 'fetch') return <Globe size={15} />;
  if (activity.kind === 'task') return <Bot size={15} />;
  if (activity.type === 'thought') return <Bot size={15} />;
  if (activity.type === 'command' || activity.kind === 'execute') return <Terminal size={15} />;
  if (activity.type === 'error') return <X size={15} />;
  if (activity.type === 'result') return <Check size={15} />;
  return <Wrench size={15} />;
};

// A detail long enough that the one-line preview loses information — these
// rows expand on click to show the full text.
export const isExpandableDetail = (detail?: string) =>
  !!detail && (detail.length > 160 || detail.includes('\n'));

export const hostnameForUrl = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export const formatTokenCount = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
};

// Compact per-turn usage: "31.4k tokens · 82% cached · 1.2k reasoning".
export const formatTurnStats = (stats: TurnTokenStats) => {
  const parts: string[] = [];
  const total = formatTokenCount(stats.totalTokens ?? stats.inputTokens);
  if (total) parts.push(`${total} tokens`);
  if (
    typeof stats.cachedReadTokens === 'number' &&
    typeof stats.inputTokens === 'number' &&
    stats.inputTokens > 0
  ) {
    parts.push(`${Math.round((stats.cachedReadTokens / stats.inputTokens) * 100)}% cached`);
  }
  const reasoning = formatTokenCount(stats.reasoningTokens);
  if (reasoning && stats.reasoningTokens! > 0) parts.push(`${reasoning} reasoning`);
  return parts.join(' · ');
};

// Codex goal (/goal) presentation helpers.
export const goalStatusLabels: Record<ThreadGoal['status'], string> = {
  active: 'Pursuing',
  paused: 'Paused',
  blocked: 'Blocked',
  usageLimited: 'Usage-limited',
  budgetLimited: 'Budget hit',
  complete: 'Achieved',
};

export const goalUsageSummary = (goal: ThreadGoal) => {
  const used = formatTokenCount(goal.tokensUsed ?? 0) ?? '0';
  const budget =
    typeof goal.tokenBudget === 'number' ? formatTokenCount(goal.tokenBudget) : null;
  if (budget) return `${used}/${budget} tokens`;
  if ((goal.tokensUsed ?? 0) > 0) return `${used} tokens`;
  return '';
};

export const goalSummaryLine = (goal: ThreadGoal) => {
  const usage = goalUsageSummary(goal);
  return `${goalStatusLabels[goal.status] ?? goal.status}: ${goal.objective}${usage ? ` · ${usage}` : ''}`;
};

// Live task checklist streamed by the agent (grok ACP plan updates).
export const AgentPlanChecklist: React.FC<{ activity: AgentActivity }> = ({ activity }) => (
  <div className="agent-plan-list">
    {(activity.plan ?? []).map((entry, index) => (
      <div key={index} className={`agent-plan-entry ${entry.status}`}>
        <span className="agent-plan-marker">
          {entry.status === 'completed' ? (
            <Check size={12} />
          ) : entry.status === 'in_progress' ? (
            <span className="agent-plan-spinner" aria-hidden="true" />
          ) : (
            <span className="agent-plan-dot" aria-hidden="true" />
          )}
        </span>
        <span className="agent-plan-content">{entry.content}</span>
      </div>
    ))}
  </div>
);

// Floating, movable "Tasks" card pinned over the chat area. Only rendered
// when the current agent turn streamed a plan (grok ACP task list) — simple
// turns that never emit tasks never show it. Mirrors the same plan activity
// that lives inside the Agent steps card, so it needs no extra plumbing.
export const FloatingTasksCard: React.FC<{
  activity: AgentActivity;
  running: boolean;
  position: { x: number; y: number } | null;
  onMove: (position: { x: number; y: number }) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDismiss: () => void;
}> = ({ activity, running, position, onMove, collapsed, onToggleCollapsed, onDismiss }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const entries = activity.plan ?? [];
  const completed = entries.filter((entry) => entry.status === 'completed').length;
  const allDone = entries.length > 0 && completed === entries.length;
  const activeEntry = entries.find((entry) => entry.status === 'in_progress');

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Header buttons (collapse/close) should click, not start a drag.
    if ((event.target as HTMLElement).closest('button')) return;
    const card = cardRef.current;
    const host = card?.offsetParent as HTMLElement | null;
    if (!card || !host) return;
    event.preventDefault();
    const cardRect = card.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const grabX = event.clientX - cardRect.left;
    const grabY = event.clientY - cardRect.top;
    const margin = 8;
    setDragging(true);
    const handleMove = (move: PointerEvent) => {
      const maxX = hostRect.width - cardRect.width - margin;
      const maxY = hostRect.height - cardRect.height - margin;
      onMove({
        x: Math.min(Math.max(move.clientX - hostRect.left - grabX, margin), Math.max(maxX, margin)),
        y: Math.min(Math.max(move.clientY - hostRect.top - grabY, margin), Math.max(maxY, margin)),
      });
    };
    const handleUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div
      ref={cardRef}
      className={`tasks-float-card${collapsed ? ' collapsed' : ''}${dragging ? ' dragging' : ''}`}
      style={position ? { left: position.x, top: position.y, right: 'auto' } : undefined}
    >
      <div
        className="tasks-float-header"
        onPointerDown={handlePointerDown}
        onDoubleClick={onToggleCollapsed}
        title="Drag to move · double-click to collapse"
      >
        <span className="tasks-float-title">
          <ListChecks size={13} />
          <span>Tasks</span>
          <span className="tasks-float-progress">
            {completed}/{entries.length}
          </span>
          {allDone ? (
            <span className="tasks-float-state done">
              <Check size={12} />
            </span>
          ) : running ? (
            <span className="agent-plan-spinner" aria-hidden="true" />
          ) : null}
        </span>
        <span className="tasks-float-actions">
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand tasks' : 'Collapse tasks'}
          >
            <ChevronDown size={13} />
          </button>
          <button type="button" onClick={onDismiss} title="Hide tasks card">
            <X size={13} />
          </button>
        </span>
      </div>
      <div className="tasks-float-meter" aria-hidden="true">
        <span
          className="tasks-float-meter-fill"
          style={{ width: `${entries.length > 0 ? (completed / entries.length) * 100 : 0}%` }}
        />
      </div>
      {collapsed ? (
        activeEntry && <div className="tasks-float-current">{activeEntry.content}</div>
      ) : (
        <div className="tasks-float-body">
          <AgentPlanChecklist activity={activity} />
        </div>
      )}
    </div>
  );
};

export const collapsedDetailPreview = (activity: AgentActivity) => {
  const flattened = (activity.detail ?? '').replace(/\s+/g, ' ').trim();
  // Thought streams show the tail so the card tracks what the agent is
  // thinking now, not the opening words.
  if (activity.type === 'thought' && flattened.length > 300) {
    return `…${flattened.slice(-300)}`;
  }
  return flattened;
};

export const AgentActivityCard: React.FC<{
  activities: AgentActivity[];
  runStatus?: Message['status'];
}> = ({ activities, runStatus }) => {
  const [expanded, setExpanded] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  // Collapsed view tracks the newest steps so the card shows what the agent
  // is doing now, not what it did first.
  const visibleActivities = expanded ? activities : activities.slice(-4);

  const toggleRow = (id: string) =>
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (activities.length === 0) return null;

  return (
    <div className={`agent-tools-card ${expanded ? 'expanded' : ''}`}>
      <button
        className="agent-tools-header"
        onClick={() => setExpanded((current) => !current)}
        title={expanded ? 'Collapse agent steps' : 'Expand agent steps'}
      >
        <span className="agent-tools-header-label">
          <Bot size={13} />
          Agent steps ({activities.length})
        </span>
        <span className="agent-tools-header-chevron">
          <ChevronDown size={14} />
        </span>
      </button>
      <div className="agent-tools-list">
        {visibleActivities.map((activity) => {
          const rowRunning = runStatus === 'running' && activity.status === 'running';
          const status =
            runStatus !== 'running' &&
            (activity.status === 'running' || activity.status === 'waiting')
              ? 'done'
              : activity.status ?? 'done';
          const expandable = isExpandableDetail(activity.detail) || !!activity.output;
          const rowExpanded = expandable && expandedRows.has(activity.id);
          // Live terminal output shows a short tail while the tool runs so
          // the user watches the command work; the full text sits behind the
          // row's expand toggle.
          const showOutput = !!activity.output && (rowExpanded || rowRunning);
          const outputText =
            rowExpanded || !activity.output
              ? activity.output
              : activity.output.slice(-400).replace(/^[^\n]*\n/, '');

          if (activity.type === 'plan') {
            return (
              <div key={activity.id} className={`agent-tool-row plan ${status}`}>
                <span className="agent-tool-icon">
                  <AgentActivityIcon activity={activity} />
                </span>
                <span className="agent-tool-text">
                  <span className="agent-tool-title">{activity.title}</span>
                  <AgentPlanChecklist activity={activity} />
                </span>
              </div>
            );
          }

          return (
            <div
              key={activity.id}
              className={`agent-tool-row ${status}${expandable ? ' expandable' : ''}${rowExpanded ? ' open' : ''}`}
              onClick={expandable ? () => toggleRow(activity.id) : undefined}
              role={expandable ? 'button' : undefined}
              title={
                expandable ? (rowExpanded ? 'Collapse full text' : 'Expand full text') : undefined
              }
            >
              <span className="agent-tool-icon">
                <AgentActivityIcon activity={activity} />
              </span>
              <span className="agent-tool-text">
                <span className="agent-tool-title-line">
                  <span className="agent-tool-title">{activity.title}</span>
                  {activity.diff && (
                    <span className="agent-tool-chip diff" title={activity.diff.path}>
                      <span className="diff-add">+{activity.diff.additions}</span>
                      <span className="diff-delete">−{activity.diff.deletions}</span>
                    </span>
                  )}
                  {typeof activity.exitCode === 'number' && activity.exitCode !== 0 && (
                    <span className="agent-tool-chip exit">exit {activity.exitCode}</span>
                  )}
                  {activity.status === 'waiting' && runStatus === 'running' && (
                    <span className="agent-tool-chip waiting">needs approval</span>
                  )}
                </span>
                {activity.detail && (
                  <span className={`agent-tool-detail${rowExpanded ? ' expanded' : ''}`}>
                    {rowExpanded ? activity.detail : collapsedDetailPreview(activity)}
                  </span>
                )}
                {showOutput && outputText && (
                  <pre className="agent-tool-output">{outputText}</pre>
                )}
                {!!activity.sources?.length && (
                  <span className="agent-tool-sources">
                    {activity.sources.slice(0, 4).map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        title={source.url}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void window.orion?.openExternalUrl?.(source.url);
                        }}
                      >
                        {hostnameForUrl(source.url)}
                      </a>
                    ))}
                  </span>
                )}
              </span>
              {expandable && (
                <span className="agent-tool-chevron">
                  <ChevronDown size={13} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Split an agent run into chronological segments: text that streamed before
// an activity renders before it, text after it renders after. Activities
// recorded before contentOffset existed (older messages) anchor at 0, which
// reproduces the previous steps-then-text layout.
export type AgentRunSegment =
  | { kind: 'text'; text: string }
  | { kind: 'activities'; activities: AgentActivity[] }
  | { kind: 'btw'; exchange: BtwExchange };

export const buildAgentRunSegments = (
  content: string,
  activities: AgentActivity[],
  btwExchanges: BtwExchange[] = []
): AgentRunSegment[] => {
  const segments: AgentRunSegment[] = [];
  let cursor = 0;

  const markers = [
    ...activities.map((activity, index) => ({
      kind: 'activity' as const,
      value: activity,
      offset: activity.contentOffset ?? 0,
      ts: activity.ts,
      index,
    })),
    ...btwExchanges.map((exchange, index) => ({
      kind: 'btw' as const,
      value: exchange,
      offset: exchange.contentOffset ?? content.length,
      ts: exchange.createdAt,
      index: activities.length + index,
    })),
  ].sort((a, b) => a.offset - b.offset || a.ts.localeCompare(b.ts) || a.index - b.index);

  for (const marker of markers) {
    const offset = Math.max(cursor, Math.min(marker.offset, content.length));
    if (offset > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, offset) });
      cursor = offset;
    }
    if (marker.kind === 'btw') {
      segments.push({ kind: 'btw', exchange: marker.value });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'activities') {
      last.activities.push(marker.value);
    } else {
      segments.push({ kind: 'activities', activities: [marker.value] });
    }
  }

  if (cursor < content.length) {
    segments.push({ kind: 'text', text: content.slice(cursor) });
  }

  return segments;
};

// Re-render once a second while a run is active so the elapsed time ticks.
export const useRunTicker = (enabled: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
};

// Live run status docked to the bottom of the chat area, so the user always
// sees what the agent is doing right now without scrolling back up to the
// top of the running message.
export const PinnedRunStatus: React.FC<{ message: Message }> = ({ message }) => {
  useRunTicker(true);
  const duration = formatRunDuration(message.startedAt, message.completedAt);
  const latestActivity = message.activities?.length
    ? message.activities[message.activities.length - 1]
    : undefined;
  // Prefer whichever activity is blocked on approval — that's the state the
  // user can act on — over whatever streamed last.
  const waitingActivity = message.activities?.find((activity) => activity.status === 'waiting');
  const runningLabel = waitingActivity
    ? `Waiting for approval · ${waitingActivity.title}`
    : latestActivity?.title ?? message.statusText ?? 'Working on it...';

  return (
    <div className="agent-status-line running pinned">
      <span className="working-dots" aria-hidden="true"><span /><span /><span /></span>
      <span>{runningLabel}</span>
      {duration && <span className="agent-status-elapsed">{duration}</span>}
    </div>
  );
};
