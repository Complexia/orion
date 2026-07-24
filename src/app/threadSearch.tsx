import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Message, type Project, type Thread, useOrionStore } from '../store';
import { formatShortTime, getThreadActivityTime } from './time';

export type ThreadSearchEntry = {
  thread: Thread;
  projectName: string;
  projectPath: string;
  haystack: string;
  tokens: string[];
};

export type CachedThreadSearchEntry = {
  projectName: string;
  projectPath: string;
  entry: ThreadSearchEntry;
};

export const THREAD_SEARCH_INDEX_REFRESH_MS = 150;

export const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/_ .:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildThreadSearchEntry = (
  thread: Thread,
  projectName: string,
  projectPath: string
): ThreadSearchEntry => {
  const messageText = thread.messages
    .map((message) => {
      const activityText = message.activities
        ?.map((activity) => `${activity.title} ${activity.detail ?? ''}`)
        .join(' ');
      const changedFileText = message.changedFiles
        ?.map((file) => `${file.path} ${file.status}`)
        .join(' ');
      return [message.content, activityText, changedFileText].filter(Boolean).join(' ');
    })
    .join(' ');
  const haystack = normalizeSearchText(
    [
      thread.title,
      projectName,
      projectPath,
      thread.modelId,
      thread.status,
      messageText,
    ].join(' ')
  );

  return {
    thread,
    projectName,
    projectPath,
    haystack,
    tokens: Array.from(new Set(haystack.split(' ').filter(Boolean))),
  };
};

export const fuzzySubsequenceScore = (needle: string, haystack: string) => {
  if (!needle) return 0;
  let searchIndex = 0;
  let score = 0;
  let streak = 0;

  for (const char of needle) {
    const foundIndex = haystack.indexOf(char, searchIndex);
    if (foundIndex === -1) return 0;
    const gap = foundIndex - searchIndex;
    streak = gap === 0 ? streak + 1 : 1;
    score += 3 + streak * 2 - Math.min(gap, 12) * 0.18;
    searchIndex = foundIndex + 1;
  }

  return Math.max(1, score);
};

export const scoreThreadSearchEntry = (entry: ThreadSearchEntry, query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length === 0) return 0;

  const title = normalizeSearchText(entry.thread.title);
  const project = normalizeSearchText(entry.projectName);
  let score = 0;

  for (const token of queryTokens) {
    if (title === token) score += 120;
    else if (title.startsWith(token)) score += 80;
    else if (title.includes(token)) score += 56;

    if (project.startsWith(token)) score += 42;
    else if (project.includes(token)) score += 28;

    if (entry.tokens.includes(token)) score += 24;
    else if (entry.haystack.includes(token)) score += 12;
    else score += fuzzySubsequenceScore(token, entry.haystack);
  }

  const activityMs = getThreadActivityTime(entry.thread).getTime();
  const ageHours = Math.max(0, (Date.now() - activityMs) / (1000 * 60 * 60));
  return score + Math.max(0, 8 - Math.log2(ageHours + 1));
};

export const getThreadSearchExcerpt = (entry: ThreadSearchEntry, query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  const firstToken = normalizedQuery.split(' ').find(Boolean);
  let lastMessage: Message | undefined;
  for (let index = entry.thread.messages.length - 1; index >= 0; index -= 1) {
    const message = entry.thread.messages[index];
    if (message.content.trim().length === 0) continue;
    lastMessage = message;
    break;
  }
  const source = lastMessage?.content.replace(/\s+/g, ' ').trim() || entry.projectPath;
  if (!source) return '';

  if (!firstToken) return source.slice(0, 120);
  const lowerSource = normalizeSearchText(source);
  const hitIndex = lowerSource.indexOf(firstToken);
  const start = hitIndex > 24 ? hitIndex - 24 : 0;
  const excerpt = source.slice(start, start + 140).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${source.length > start + 140 ? '...' : ''}`;
};

export type ThreadSearchResultsProps = {
  projects: Project[];
  query: string;
  onSelectThread: (threadId: string) => void;
};

/**
 * Mounted only while search is open, so live transcript changes refresh the
 * index without waking the application shell while search is closed.
 */
export const ThreadSearchResults = React.memo(function ThreadSearchResults({
  projects,
  query,
  onSelectThread,
}: ThreadSearchResultsProps) {
  const threads = useOrionStore((state) => state.threads);
  const latestThreadsRef = useRef(threads);
  const indexedThreadsRef = useRef(threads);
  const [indexedThreads, setIndexedThreads] = useState(threads);
  const indexRefreshTimerRef = useRef<number | null>(null);
  const entryCacheRef = useRef(new WeakMap<Thread, CachedThreadSearchEntry>());

  useEffect(() => {
    latestThreadsRef.current = threads;
    if (
      indexedThreadsRef.current === threads ||
      indexRefreshTimerRef.current !== null
    ) {
      return;
    }
    indexRefreshTimerRef.current = window.setTimeout(() => {
      indexRefreshTimerRef.current = null;
      const latestThreads = latestThreadsRef.current;
      indexedThreadsRef.current = latestThreads;
      setIndexedThreads(latestThreads);
    }, THREAD_SEARCH_INDEX_REFRESH_MS);
  }, [threads]);

  useEffect(
    () => () => {
      if (indexRefreshTimerRef.current !== null) {
        window.clearTimeout(indexRefreshTimerRef.current);
      }
    },
    []
  );

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  const recentThreadEntries = useMemo<ThreadSearchEntry[]>(() => {
    if (hasQuery) return [];

    return indexedThreads
      .slice()
      .sort(
        (a, b) =>
          getThreadActivityTime(b).getTime() -
          getThreadActivityTime(a).getTime()
      )
      .slice(0, 12)
      .map((thread) => {
        const project = projectById.get(thread.projectId);
        return {
          thread,
          projectName: project?.name ?? 'Unknown project',
          projectPath: project?.path ?? '',
          haystack: '',
          tokens: [],
        };
      });
  }, [hasQuery, indexedThreads, projectById]);

  const threadSearchIndex = useMemo<ThreadSearchEntry[]>(() => {
    if (!hasQuery) return [];

    return indexedThreads.map((thread) => {
      const project = projectById.get(thread.projectId);
      const projectName = project?.name ?? 'Unknown project';
      const projectPath = project?.path ?? '';
      const cached = entryCacheRef.current.get(thread);
      if (
        cached &&
        cached.projectName === projectName &&
        cached.projectPath === projectPath
      ) {
        return cached.entry;
      }

      const entry = buildThreadSearchEntry(thread, projectName, projectPath);
      entryCacheRef.current.set(thread, { projectName, projectPath, entry });
      return entry;
    });
  }, [hasQuery, indexedThreads, projectById]);

  const results = useMemo(() => {
    if (!hasQuery) {
      return recentThreadEntries.map((entry) => ({ entry, score: 1 }));
    }

    return threadSearchIndex
      .map((entry) => ({
        entry,
        score: scoreThreadSearchEntry(entry, trimmedQuery),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (
          getThreadActivityTime(b.entry.thread).getTime() -
          getThreadActivityTime(a.entry.thread).getTime()
        );
      })
      .slice(0, 30);
  }, [hasQuery, recentThreadEntries, threadSearchIndex, trimmedQuery]);

  return (
    <>
      {results.map(({ entry }) => (
        <button
          key={entry.thread.id}
          type="button"
          className="thread-search-result"
          onClick={() => onSelectThread(entry.thread.id)}
        >
          <span className="thread-search-title">{entry.thread.title}</span>
          <span className="thread-search-meta">
            {entry.projectName} · {formatShortTime(getThreadActivityTime(entry.thread))}
          </span>
          <span className="thread-search-excerpt">
            {getThreadSearchExcerpt(entry, query)}
          </span>
        </button>
      ))}
      {results.length === 0 && (
        <div className="thread-search-empty">No matching threads</div>
      )}
    </>
  );
});
