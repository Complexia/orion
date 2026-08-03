import type { Thread } from '../store';

export type EpicThreadRow = {
  thread: Thread;
  depth: number;
};

const threadActivityTime = (thread: Thread) => {
  const transcriptTime = new Date(thread.messages.at(-1)?.ts ?? thread.createdAt).getTime();
  const terminalTime = thread.terminalActivityAt
    ? new Date(thread.terminalActivityAt).getTime()
    : Number.NEGATIVE_INFINITY;
  return Math.max(
    Number.isFinite(transcriptTime) ? transcriptTime : 0,
    Number.isFinite(terminalTime) ? terminalTime : Number.NEGATIVE_INFINITY
  );
};

const compareThreadActivity = (a: Thread, b: Thread) => {
  const activityDelta = threadActivityTime(b) - threadActivityTime(a);
  if (activityDelta !== 0) return activityDelta;
  const createdDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return createdDelta !== 0 ? createdDelta : a.id.localeCompare(b.id);
};

/**
 * Returns every thread owned by an epic as a stable, navigable hierarchy.
 *
 * Child/subagent threads stay out of the compact sidebar, but the Epic
 * overview is an inventory of all work performed in the Epic. Older data can
 * contain descendants without their own epicId, so inherit membership through
 * an included parent unless the child is explicitly assigned to another Epic.
 */
export const epicThreadRows = (threads: Thread[], epicId: string): EpicThreadRow[] => {
  const includedIds = new Set(
    threads.filter((thread) => thread.epicId === epicId).map((thread) => thread.id)
  );

  let foundLegacyDescendant = true;
  while (foundLegacyDescendant) {
    foundLegacyDescendant = false;
    for (const thread of threads) {
      if (
        !thread.epicId &&
        thread.parentThreadId &&
        includedIds.has(thread.parentThreadId) &&
        !includedIds.has(thread.id)
      ) {
        includedIds.add(thread.id);
        foundLegacyDescendant = true;
      }
    }
  }

  const included = threads.filter((thread) => includedIds.has(thread.id));
  const childrenByParent = new Map<string, Thread[]>();
  for (const thread of included) {
    if (!thread.parentThreadId || !includedIds.has(thread.parentThreadId)) continue;
    const children = childrenByParent.get(thread.parentThreadId);
    if (children) children.push(thread);
    else childrenByParent.set(thread.parentThreadId, [thread]);
  }
  for (const children of childrenByParent.values()) children.sort(compareThreadActivity);

  const roots = included
    .filter((thread) => !thread.parentThreadId || !includedIds.has(thread.parentThreadId))
    .sort(compareThreadActivity);
  const rows: EpicThreadRow[] = [];
  const seen = new Set<string>();
  const collect = (thread: Thread, depth: number) => {
    if (seen.has(thread.id)) return;
    seen.add(thread.id);
    rows.push({ thread, depth });
    for (const child of childrenByParent.get(thread.id) ?? []) collect(child, depth + 1);
  };
  for (const root of roots) collect(root, 0);

  // Corrupt parent cycles have no root. Keep those threads discoverable and
  // render each exactly once rather than silently dropping the whole cycle.
  for (const thread of [...included].sort(compareThreadActivity)) collect(thread, 0);
  return rows;
};
