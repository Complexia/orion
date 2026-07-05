import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
  MessageSquare,
  Code2,
  GitBranch,
  GitCommit,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  SquarePen,
  Check,
  X,
  Folder,
  FileText,
  Play,
  Search,
  Shield,
  Square,
  Terminal,
  Wrench,
  Bot,
  Sparkles,
  ArrowUp,
  Download,
  Image as ImageIcon,
  RefreshCw,
  Settings,
  Keyboard,
  Link,
  Archive,
  Plug,
  Palette,
  UserRound,
  LogIn,
  LogOut,
  Cloud,
  CloudUpload,
  CloudDownload,
  Globe,
  Copy,
  AppWindow,
  SquareArrowOutUpRight,
  ListPlus,
  Zap,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useOrionStore,
  defaultProviderSettings,
  type AgentActivity,
  type ChangedFileSummary,
  type ImageAttachment,
  type Message,
  type ProviderId,
  type ProviderRuntimeOptions,
  type Thread,
} from './store';
import { Toaster, toast } from 'sonner';
import {
  agentProviders,
  claudeContextWindowOptions,
  claudeReasoningOptions,
  codexReasoningOptions,
  codexServiceTierOptions,
  defaultAgentModelId,
  defaultClaudeContextWindow,
  defaultClaudeReasoningEffort,
  defaultCodexReasoningEffort,
  defaultCodexServiceTier,
  fallbackAgentModels,
  findAgentModel,
  providerFollowUpSupport,
  providerOptionDefs,
  type AgentModel,
  type AgentProviderId,
  type ClaudeContextWindow,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type CodexServiceTier,
} from './agentCatalog';
import orionIconUrl from '../assets/icon.png';

// Simple recursive file tree component
interface FileTreeItem {
  name: string;
  path: string;
  isDirectory: boolean;
  gitStatus?: GitStatusKind | null;
  gitStatusLabel?: string | null;
  hasChildGitStatus?: boolean;
}

type GitStatusKind =
  | 'added'
  | 'copied'
  | 'conflicted'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'untracked';

type GitBranchInfo = {
  name: string;
  current: boolean;
  hasUpstream: boolean;
};

type GitRepoState = {
  ok: boolean;
  root?: string;
  currentBranch?: string;
  branches: GitBranchInfo[];
  hasUncommittedChanges: boolean;
  ahead?: number;
  behind?: number;
  error?: string;
};

type ThreadSearchEntry = {
  thread: Thread;
  projectName: string;
  projectPath: string;
  haystack: string;
  tokens: string[];
};

type ProviderUpdateItem = {
  id: string;
  label: string;
  command: string;
  enabled: boolean;
  installed: boolean;
  path?: string | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  status: 'available' | 'current' | 'unknown' | 'missing' | 'error';
  auth: {
    authenticated: boolean | null;
    status: 'authenticated' | 'unauthenticated' | 'unknown' | 'missing' | 'error';
    label: string;
    detail?: string;
    updateAuthenticated: boolean;
    updateBlockedReason?: string;
  };
  error?: string;
};

type ProviderUpdateState = {
  checkedAt: string;
  updatesAvailable: number;
  providers: ProviderUpdateItem[];
};

type AppUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  currentVersion: string;
  checkedAt?: string | null;
  availableVersion?: string | null;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  } | null;
  error?: string | null;
};

type OrionAccountState = {
  authenticated: boolean;
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    imageUrl?: string | null;
  } | null;
  expiresAt: string | null;
};

type SettingsTab = 'account' | 'general' | 'providers' | 'cosmetics';

const gitStatusTitles: Record<GitStatusKind, string> = {
  added: 'Added',
  copied: 'Copied',
  conflicted: 'Conflicted',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  untracked: 'Untracked',
};

const THREADS_VISIBLE_LIMIT = 5;

const filenameLanguageMap: Record<string, string> = {
  '.babelrc': 'json',
  '.bash_login': 'shell',
  '.bash_profile': 'shell',
  '.bash_logout': 'shell',
  '.bashrc': 'shell',
  '.dockerignore': 'plaintext',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.envrc': 'shell',
  '.eslintrc': 'json',
  '.gitattributes': 'plaintext',
  '.gitconfig': 'ini',
  '.gitignore': 'plaintext',
  '.gitmodules': 'ini',
  '.npmrc': 'ini',
  '.prettierrc': 'json',
  '.profile': 'shell',
  '.zprofile': 'shell',
  '.zshenv': 'shell',
  '.zshrc': 'shell',
  'bun.lock': 'plaintext',
  'cargo.lock': 'ini',
  'dockerfile': 'dockerfile',
  'gemfile': 'ruby',
  'go.mod': 'go',
  'go.sum': 'plaintext',
  'makefile': 'shell',
  'package-lock.json': 'json',
  'podfile': 'ruby',
  'procfile': 'shell',
  'rakefile': 'ruby',
  'tsconfig.json': 'json',
  'vagrantfile': 'ruby',
  'yarn.lock': 'plaintext',
};

const extensionLanguageMap: Record<string, string> = {
  abap: 'abap',
  apex: 'apex',
  azcli: 'azcli',
  bat: 'bat',
  bib: 'st',
  bicep: 'bicep',
  c: 'cpp',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cljc: 'clojure',
  cljs: 'clojure',
  coffee: 'coffee',
  cpp: 'cpp',
  cs: 'csharp',
  cshtml: 'razor',
  csh: 'shell',
  css: 'css',
  cts: 'typescript',
  cu: 'cpp',
  cxx: 'cpp',
  dart: 'dart',
  dax: 'msdax',
  diff: 'plaintext',
  ecl: 'ecl',
  edn: 'clojure',
  eex: 'html',
  env: 'ini',
  ex: 'elixir',
  exs: 'elixir',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'cpp',
  handlebars: 'handlebars',
  hbs: 'handlebars',
  hcl: 'hcl',
  hh: 'cpp',
  hlsl: 'cpp',
  hpp: 'cpp',
  hs: 'plaintext',
  html: 'html',
  htm: 'html',
  hxx: 'cpp',
  ini: 'ini',
  ipynb: 'json',
  java: 'java',
  jl: 'julia',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  liquid: 'liquid',
  lua: 'lua',
  m: 'objective-c',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  mm: 'objective-c',
  mts: 'typescript',
  mysql: 'mysql',
  patch: 'plaintext',
  php: 'php',
  phtml: 'php',
  pl: 'perl',
  pm: 'perl',
  ps1: 'powershell',
  psd1: 'powershell',
  psm1: 'powershell',
  pug: 'pug',
  py: 'python',
  pyw: 'python',
  r: 'r',
  rake: 'ruby',
  rb: 'ruby',
  redis: 'redis',
  rst: 'restructuredtext',
  rs: 'rust',
  sass: 'scss',
  sb: 'sb',
  sc: 'scala',
  scala: 'scala',
  scm: 'scheme',
  scss: 'scss',
  sh: 'shell',
  sol: 'solidity',
  sql: 'sql',
  svelte: 'html',
  swift: 'swift',
  systemverilog: 'systemverilog',
  tcl: 'tcl',
  tf: 'hcl',
  tfvars: 'hcl',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  twig: 'twig',
  txt: 'plaintext',
  vb: 'vb',
  vue: 'html',
  wgsl: 'wgsl',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
};

const getLanguageFromPath = (filePath: string): string => {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const lowerName = fileName.toLowerCase();

  if (filenameLanguageMap[lowerName]) return filenameLanguageMap[lowerName];
  if (/^\.env(?:[.-].*)?$/.test(lowerName)) return 'ini';

  const ext = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : '';
  return extensionLanguageMap[ext] ?? 'plaintext';
};

const imageFileNamePattern = /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i;

const isImageFile = (file: File) =>
  file.type.startsWith('image/') || imageFileNamePattern.test(file.name);

const formatAttachmentSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const imageAttachmentSrc = (attachment: ImageAttachment) => {
  if (/^(blob|data|orion-attachment):/i.test(attachment.path)) return attachment.path;

  const normalizedPath = attachment.path.replace(/\\/g, '/');
  return `orion-attachment://local/image?path=${encodeURIComponent(normalizedPath)}`;
};

const buildPromptWithAttachments = (prompt: string, attachments: ImageAttachment[]) => {
  const trimmedPrompt = prompt.trim();
  if (attachments.length === 0) return trimmedPrompt;

  const imageLines = attachments.map(
    (attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`
  );
  const attachmentText = [
    'Attached images:',
    'Use these local image file paths as visual references for the request.',
    ...imageLines,
  ].join('\n');

  return trimmedPrompt ? `${trimmedPrompt}\n\n${attachmentText}` : attachmentText;
};

const getDroppedFilePath = (file: File) => {
  const bridgePath = window.orion?.getPathForFile?.(file);
  if (bridgePath) return bridgePath;

  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === 'string' && legacyPath.length > 0 ? legacyPath : '';
};

const formatShortTime = (date: Date) => {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
};

const getThreadActivityTime = (thread: { messages: Message[]; createdAt: string }) => {
  const lastMessage = thread.messages.at(-1);
  return new Date(lastMessage?.ts ?? thread.createdAt);
};

const isDefaultTitle = (title: string) =>
  /^Thread \d{1,2}:\d{2}/i.test(title) || /^New thread$/i.test(title.trim());

const isPlausibleTitle = (title: string) => {
  if (!title) return false;
  const s = title.trim();
  if (s.length < 3 || s.length > 80) return false;
  if (/^\s*[\{\[]/.test(s)) return false;
  if (/"type"\s*:/i.test(s) || /"data"\s*:/i.test(s)) return false;
  if (/\btype["\s]*:["\s]*thought\b/i.test(s)) return false;
  // Don't let defaults or raw protocol leak in
  if (/^thread\s+\d{1,2}:\d{2}/i.test(s)) return false;
  return true;
};

const deriveTitle = (prompt: string): string => {
  let t = prompt.trim().replace(/\s+/g, ' ');
  // First line or first sentence
  t = t.split(/[\n.!?]\s/)[0] || t;
  // Strip polite prefixes
  t = t.replace(/^(please\s+|can you\s+|could you\s+|i want (you )?to\s+|i need (you )?to\s+|help me\s+|let's\s+|pls\s+)/i, '');
  t = t.trim();
  const MAX = 58;
  if (t.length > MAX) {
    t = t.slice(0, MAX).trim();
    const lastSpace = t.lastIndexOf(' ');
    if (lastSpace > 18) t = t.slice(0, lastSpace);
    t = t.replace(/[,:;\s]+$/g, '') + '…';
  }
  // Basic title casing
  t = t.replace(/\b\w/g, (c) => c.toUpperCase());
  t = t.replace(/[,:;\.\s…]+$/g, '').trim();
  return t || 'New thread';
};

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/_ .:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fuzzySubsequenceScore = (needle: string, haystack: string) => {
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

const scoreThreadSearchEntry = (entry: ThreadSearchEntry, query: string) => {
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

const getThreadSearchExcerpt = (entry: ThreadSearchEntry, query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  const firstToken = normalizedQuery.split(' ').find(Boolean);
  const lastMessage = [...entry.thread.messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);
  const source = lastMessage?.content.replace(/\s+/g, ' ').trim() || entry.projectPath;
  if (!source) return '';

  if (!firstToken) return source.slice(0, 120);
  const lowerSource = normalizeSearchText(source);
  const hitIndex = lowerSource.indexOf(firstToken);
  const start = hitIndex > 24 ? hitIndex - 24 : 0;
  const excerpt = source.slice(start, start + 140).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${source.length > start + 140 ? '...' : ''}`;
};

const tryGenerateBetterTitle = async (
  threadId: string,
  prompt: string,
  modelId: string,
  projectPath: string,
  update: (id: string, updates: { title: string }) => void
) => {
  if (!window.orion?.generateThreadTitle) return;
  try {
    const title = await window.orion.generateThreadTitle({
      prompt,
      modelId,
      projectPath,
    });
    if (title && typeof title === 'string') {
      const cleaned = title.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim().split(/[\n\r]/)[0].trim();
      if (isPlausibleTitle(cleaned)) {
        update(threadId, { title: cleaned });
      }
      // if not plausible we simply keep the heuristic title set earlier
    }
  } catch {
    // ignore failures, heuristic title remains
  }
};

const projectIconCache = new Map<string, string | null>();
const claudeOneMillionOnlyModelSlugs = new Set(['claude-fable-5', 'claude-sonnet-5']);

const getDefaultClaudeReasoningEffort = (model: AgentModel | undefined): ClaudeReasoningEffort =>
  model?.slug === 'claude-opus-4-7' ? 'xhigh' : defaultClaudeReasoningEffort;

const getEffectiveClaudeContextWindow = (
  model: AgentModel | undefined,
  selectedContextWindow: ClaudeContextWindow
): ClaudeContextWindow => {
  if (model?.providerId === 'claude' && claudeOneMillionOnlyModelSlugs.has(model.slug)) {
    return '1m';
  }
  return selectedContextWindow;
};

const ProjectIcon: React.FC<{ projectPath: string; size?: number; className?: string }> = ({
  projectPath,
  size = 14,
  className,
}) => {
  const [iconUrl, setIconUrl] = useState<string | null | undefined>(
    () => projectIconCache.get(projectPath)
  );

  useEffect(() => {
    if (!projectPath) {
      setIconUrl(null);
      return;
    }

    if (projectIconCache.has(projectPath)) {
      setIconUrl(projectIconCache.get(projectPath) ?? null);
      return;
    }

    let cancelled = false;
    if (!window.orion?.findProjectIcon) {
      setIconUrl(null);
      return;
    }

    window.orion.findProjectIcon(projectPath).then((url) => {
      projectIconCache.set(projectPath, url);
      if (!cancelled) setIconUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={`project-icon ${className ?? ''}`}
        width={size}
        height={size}
        draggable={false}
      />
    );
  }

  return <Folder size={size} className={className} />;
};

const formatRunDuration = (startedAt?: string, completedAt?: string) => {
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

const AgentActivityIcon: React.FC<{ activity: AgentActivity }> = ({ activity }) => {
  if (activity.type === 'thought') return <Bot size={15} />;
  if (activity.type === 'command') return <Terminal size={15} />;
  if (activity.type === 'error') return <X size={15} />;
  if (activity.type === 'result') return <Check size={15} />;
  return <Wrench size={15} />;
};

// A detail long enough that the one-line preview loses information — these
// rows expand on click to show the full text.
const isExpandableDetail = (detail?: string) =>
  !!detail && (detail.length > 160 || detail.includes('\n'));

const collapsedDetailPreview = (activity: AgentActivity) => {
  const flattened = (activity.detail ?? '').replace(/\s+/g, ' ').trim();
  // Thought streams show the tail so the card tracks what the agent is
  // thinking now, not the opening words.
  if (activity.type === 'thought' && flattened.length > 300) {
    return `…${flattened.slice(-300)}`;
  }
  return flattened;
};

const AgentActivityCard: React.FC<{
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
          const expandable = isExpandableDetail(activity.detail);
          const rowExpanded = expandable && expandedRows.has(activity.id);
          return (
            <div
              key={activity.id}
              className={`agent-tool-row ${
                runStatus !== 'running' && activity.status === 'running'
                  ? 'done'
                  : activity.status ?? 'done'
              }${expandable ? ' expandable' : ''}${rowExpanded ? ' open' : ''}`}
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
                <span className="agent-tool-title">{activity.title}</span>
                {activity.detail && (
                  <span className={`agent-tool-detail${rowExpanded ? ' expanded' : ''}`}>
                    {rowExpanded ? activity.detail : collapsedDetailPreview(activity)}
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
type AgentRunSegment =
  | { kind: 'text'; text: string }
  | { kind: 'activities'; activities: AgentActivity[] };

const buildAgentRunSegments = (
  content: string,
  activities: AgentActivity[]
): AgentRunSegment[] => {
  const segments: AgentRunSegment[] = [];
  let cursor = 0;

  for (const activity of activities) {
    const offset = Math.max(cursor, Math.min(activity.contentOffset ?? 0, content.length));
    if (offset > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, offset) });
      cursor = offset;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'activities') {
      last.activities.push(activity);
    } else {
      segments.push({ kind: 'activities', activities: [activity] });
    }
  }

  if (cursor < content.length) {
    segments.push({ kind: 'text', text: content.slice(cursor) });
  }

  return segments;
};

const CopyMessageButton: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied; nothing to surface.
    }
  };

  return (
    <button
      type="button"
      className={`message-copy-btn${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

const MarkdownContent: React.FC<{ content: string }> = React.memo(({ content }) => (
  <div className="markdown-content">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
));

const changedFileStatusLabels: Record<ChangedFileSummary['status'], string> = {
  added: 'A',
  copied: 'C',
  conflicted: '!',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

const ChangedFilesCard: React.FC<{ files: ChangedFileSummary[] }> = ({ files }) => {
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
  const groups = files.reduce<Array<{ directory: string; files: ChangedFileSummary[] }>>(
    (result, file) => {
      const lastSlash = file.path.lastIndexOf('/');
      const directory = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '.';
      const existing = result.find((group) => group.directory === directory);
      if (existing) {
        existing.files.push(file);
      } else {
        result.push({ directory, files: [file] });
      }
      return result;
    },
    []
  );

  return (
    <div className="changed-files-card">
      <div className="changed-files-header">
        <span>Changed files ({files.length})</span>
        <span className="changed-files-totals">
          <span className="diff-add">+{totals.additions}</span>
          <span>/</span>
          <span className="diff-delete">-{totals.deletions}</span>
        </span>
      </div>
      {files.length === 0 ? (
        <div className="changed-files-empty">No files changed.</div>
      ) : (
        <div className="changed-files-list">
          {groups.map((group) => (
            <div key={group.directory} className="changed-files-group">
              <div className="changed-files-directory" title={group.directory}>
                <Folder size={15} />
                <span>{group.directory}</span>
              </div>
              {group.files.map((file) => {
                const name = file.path.split('/').pop() ?? file.path;
                return (
                  <div key={file.path} className="changed-file-row" title={file.path}>
                    <span className={`changed-file-status ${file.status}`}>
                      {changedFileStatusLabels[file.status]}
                    </span>
                    <FileText size={14} />
                    <span className="changed-file-name">{name}</span>
                    <span className="changed-file-counts">
                      <span className="diff-add">+{file.additions}</span>
                      <span>/</span>
                      <span className="diff-delete">-{file.deletions}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Re-render once a second while a run is active so the elapsed time ticks.
const useRunTicker = (enabled: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
};

const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
  const attachments = message.attachments ?? [];
  const isAgentRun = message.role === 'agent' && message.kind === 'agent-run';
  const isRunning = isAgentRun && message.status === 'running';
  useRunTicker(isRunning);

  if (isAgentRun) {
    const duration = formatRunDuration(message.startedAt, message.completedAt);
    const hasContent = message.content.trim().length > 0;
    const latestActivity = message.activities?.length
      ? message.activities[message.activities.length - 1]
      : undefined;
    const runningLabel = latestActivity?.title ?? message.statusText ?? 'Working on it...';

    return (
      <div className={`message agent agent-run ${message.status ?? ''}`}>
        {!isRunning && (
          <div className="agent-response-divider">
            <span>Response{duration && ` · worked for ${duration}`}</span>
            {hasContent && <CopyMessageButton text={message.content} className="in-divider" />}
          </div>
        )}
        {(message.statusText || isRunning) && (
          <div className={`agent-status-line ${isRunning ? 'running' : ''}`}>
            {isRunning && <span className="working-dots" aria-hidden="true"><span /><span /><span /></span>}
            <span>{isRunning ? runningLabel : message.statusText}</span>
            {isRunning && duration && <span className="agent-status-elapsed">{duration}</span>}
          </div>
        )}
        {buildAgentRunSegments(message.content, message.activities ?? []).map((segment, index) =>
          segment.kind === 'activities' ? (
            <AgentActivityCard
              key={segment.activities[0].id}
              activities={segment.activities}
              runStatus={message.status}
            />
          ) : segment.text.trim() ? (
            <MarkdownContent key={`text-${index}`} content={segment.text} />
          ) : null
        )}
        {!hasContent &&
          isRunning &&
          !message.activities?.length && (
            <div className="agent-empty-output">Waiting for the agent to produce output...</div>
          )}
        {!isRunning && message.changedFiles && <ChangedFilesCard files={message.changedFiles} />}
        {message.error && <div className="agent-error">{message.error}</div>}
      </div>
    );
  }

  return (
    <div className={`message ${message.role}`}>
      {message.role === 'agent' ? (
        <MarkdownContent content={message.content} />
      ) : (
        <>
          {message.content && <div className="whitespace-pre-wrap break-words">{message.content}</div>}
          {attachments.length > 0 && (
            <div className="message-attachments">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="message-attachment" title={attachment.path}>
                  <img src={imageAttachmentSrc(attachment)} alt={attachment.name} />
                  <span>{attachment.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {(message.role === 'user' || message.role === 'agent') && message.content.trim() && (
        <CopyMessageButton text={message.content} />
      )}
    </div>
  );
};

const AgentsWelcome: React.FC<{
  projectName?: string | null;
}> = ({ projectName }) => (
  <div className="agents-welcome">
    <div className="agents-welcome-icon">
      <Sparkles size={26} />
    </div>
    <h2>
      What should we build in <strong>{projectName ?? 'this project'}</strong>?
    </h2>
  </div>
);

const getFileIconMeta = (name: string, isDirectory: boolean) => {
  if (isDirectory) return { kind: 'folder', label: '' };

  const lowerName = name.toLowerCase();
  const ext = lowerName.split('.').pop() || '';

  if (lowerName === '.gitignore' || lowerName === '.gitattributes') {
    return { kind: 'git', label: 'G' };
  }
  if (lowerName === 'package.json' || lowerName === 'package-lock.json') {
    return { kind: 'node', label: 'JS' };
  }
  if (lowerName.includes('tailwind')) return { kind: 'tailwind', label: '~' };
  if (lowerName.includes('vite')) return { kind: 'vite', label: 'V' };
  if (lowerName.includes('postcss')) return { kind: 'config', label: '@' };

  const byExtension: Record<string, { kind: string; label: string }> = {
    css: { kind: 'css', label: '{}' },
    html: { kind: 'html', label: '<>' },
    js: { kind: 'javascript', label: 'JS' },
    json: { kind: 'json', label: '{}' },
    jsx: { kind: 'react', label: 'R' },
    md: { kind: 'markdown', label: 'M' },
    mjs: { kind: 'javascript', label: 'JS' },
    ts: { kind: 'typescript', label: 'TS' },
    tsx: { kind: 'react', label: 'R' },
    yml: { kind: 'yaml', label: 'Y' },
    yaml: { kind: 'yaml', label: 'Y' },
  };

  return byExtension[ext] ?? { kind: 'text', label: '' };
};

const FileTreeNode: React.FC<{
  item: FileTreeItem;
  depth?: number;
  onFileClick: (path: string) => void;
  activePath?: string | null;
  loadChildren: (path: string) => Promise<FileTreeItem[]>;
  rootPath?: string | null;
  refreshToken?: number;
  onRequestDelete: (item: FileTreeItem) => void;
  onRenamed: (oldPath: string, newPath: string, isDirectory: boolean) => void;
}> = ({
  item,
  depth = 0,
  onFileClick,
  activePath,
  loadChildren,
  rootPath,
  refreshToken = 0,
  onRequestDelete,
  onRenamed,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.name);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [createValue, setCreateValue] = useState('');
  const iconMeta = getFileIconMeta(item.name, item.isDirectory);
  const gitStatusTitle = item.gitStatus ? gitStatusTitles[item.gitStatus] : null;

  // Re-fetch already-loaded children when the tree is refreshed after a
  // create/rename/delete elsewhere, without collapsing expanded folders.
  useEffect(() => {
    if (refreshToken > 0 && children !== null) {
      loadChildren(item.path).then(setChildren);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = async () => {
    if (renaming) return;
    if (item.isDirectory) {
      if (!expanded && !children) {
        setLoading(true);
        const kids = await loadChildren(item.path);
        setChildren(kids);
        setLoading(false);
      }
      setExpanded(!expanded);
    } else {
      onFileClick(item.path);
    }
  };

  const handleContextMenu = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.orion?.showFileTreeMenu) return;
    const action = await window.orion.showFileTreeMenu({
      path: item.path,
      isDirectory: item.isDirectory,
      rootPath,
    });
    if (action === 'rename') {
      setRenameValue(item.name);
      setRenaming(true);
    } else if (action === 'delete') {
      onRequestDelete(item);
    } else if (action === 'new-file' || action === 'new-folder') {
      setCreating(action === 'new-file' ? 'file' : 'folder');
      setCreateValue('');
      if (!expanded) {
        if (!children) {
          setLoading(true);
          const kids = await loadChildren(item.path);
          setChildren(kids);
          setLoading(false);
        }
        setExpanded(true);
      }
    }
  };

  const submitRename = async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === item.name || /[/\\]/.test(newName)) return;
    const parentPrefix = item.path.slice(0, item.path.length - item.name.length);
    const newPath = parentPrefix + newName;
    const result = await window.orion.renamePath(item.path, newPath);
    if (!result?.ok) {
      toast.error(result?.error ?? 'Rename failed');
      return;
    }
    onRenamed(item.path, newPath, item.isDirectory);
  };

  const submitCreate = async () => {
    const kind = creating;
    const name = createValue.trim();
    setCreating(null);
    if (!kind || !name || /[/\\]/.test(name)) return;
    const newPath = await window.orion.join(item.path, name);
    const ok =
      kind === 'file'
        ? await window.orion.createFile(newPath)
        : await window.orion.createDirectory(newPath);
    if (!ok) {
      toast.error(`Could not create ${kind === 'file' ? 'file' : 'folder'}`);
      return;
    }
    const kids = await loadChildren(item.path);
    setChildren(kids);
    if (kind === 'file') onFileClick(newPath);
  };

  return (
    <div>
      <div
        className={`file-item ${activePath === item.path ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={item.path}
      >
        {item.isDirectory ? (
          <span className="file-disclosure">
            <ChevronRight
              size={14}
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </span>
        ) : (
          <span className="file-disclosure" />
        )}
        <span className={`file-tree-icon ${item.isDirectory ? 'folder' : iconMeta.kind}`}>
          {item.isDirectory ? (
            <Folder size={15} />
          ) : iconMeta.label ? (
            <span>{iconMeta.label}</span>
          ) : (
            <FileText size={14} />
          )}
        </span>
        {renaming ? (
          <input
            className="file-rename-input"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onFocus={(e) => {
              const dotIndex = e.currentTarget.value.lastIndexOf('.');
              e.currentTarget.setSelectionRange(0, dotIndex > 0 ? dotIndex : e.currentTarget.value.length);
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              else if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <span className="file-name truncate">{item.name}</span>
        )}
        {item.gitStatus && (
          item.isDirectory ? (
            <span
              className={`git-status-dot ${item.gitStatus}`}
              title={`${gitStatusTitle} changes inside`}
            />
          ) : (
            <span
              className={`git-status-badge ${item.gitStatus}`}
              title={gitStatusTitle ?? undefined}
            >
              {item.gitStatusLabel}
            </span>
          )
        )}
      </div>

      {item.isDirectory && expanded && (
        <div className="file-children">
          {creating && (
            <div className="file-item" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
              <span className="file-disclosure" />
              <span className={`file-tree-icon ${creating === 'folder' ? 'folder' : 'text'}`}>
                {creating === 'folder' ? <Folder size={15} /> : <FileText size={14} />}
              </span>
              <input
                className="file-rename-input"
                autoFocus
                value={createValue}
                placeholder={creating === 'folder' ? 'Folder name' : 'File name'}
                onChange={(e) => setCreateValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                  else if (e.key === 'Escape') setCreating(null);
                }}
                onBlur={() => setCreating(null)}
              />
            </div>
          )}
          {loading && <div className="file-item" style={{ paddingLeft: 20 + depth * 12 }}>Loading...</div>}
          {children?.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              activePath={activePath}
              loadChildren={loadChildren}
              rootPath={rootPath}
              refreshToken={refreshToken}
              onRequestDelete={onRequestDelete}
              onRenamed={onRenamed}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    projects,
    threads,
    selectedProjectId,
    selectedThreadId,
    addProject,
    removeProject,
    renameProject,
    createThread,
    selectProject,
    selectThread,
    updateThread,
    deleteThread,
    addMessageToThread,
    appendToThreadMessage,
    updateThreadMessage,
    addActivityToThreadMessage,
    workspacePath,
    setWorkspacePath,
    openFiles,
    activeFilePath,
    openFile,
    closeFile,
    setActiveFile,
    updateOpenFileContent,
    markFileSaved,
    closeAllFiles,
    providerSettings,
    setProviderEnabled,
    setProviderOptions,
    setThreadAgentSession,
    queueMessageToThread,
    removeQueuedThreadMessage,
  } = useOrionStore();

  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [treeItems, setTreeItems] = useState<FileTreeItem[]>([]);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatAttachments, setChatAttachments] = useState<ImageAttachment[]>([]);
  const [draggingImages, setDraggingImages] = useState(false);
  // One agent run may be active per thread; runs in other threads are
  // independent, so starting/stopping one never blocks the rest.
  const [activeRunsByThread, setActiveRunsByThread] = useState<Record<string, string>>({});
  const activeRunId = selectedThreadId ? activeRunsByThread[selectedThreadId] ?? null : null;
  const isSending = Boolean(activeRunId);
  const clearActiveRun = useCallback((runId: string) => {
    setActiveRunsByThread((current) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [threadId, id] of Object.entries(current)) {
        if (id === runId) changed = true;
        else next[threadId] = id;
      }
      return changed ? next : current;
    });
  }, []);
  const [currentEditorValue, setCurrentEditorValue] = useState<string>('');
  const [agentModels, setAgentModels] = useState<AgentModel[]>(fallbackAgentModels);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [activeProviderTab, setActiveProviderTab] = useState<AgentProviderId>('grok');
  const [codexSettingsOpen, setCodexSettingsOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [openWithApps, setOpenWithApps] = useState<
    Array<{ id: string; name: string; icon: string | null }>
  >([]);
  const [openWithOpen, setOpenWithOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [gitState, setGitState] = useState<GitRepoState | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [cloudState, setCloudState] = useState<OrionCloudState | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);
  const [threadListLimits, setThreadListLimits] = useState<Record<string, number>>({});
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [recentAgentsOpen, setRecentAgentsOpen] = useState(true);
  const [recentAgentsShowAll, setRecentAgentsShowAll] = useState(false);
  const [editorBottomPadding, setEditorBottomPadding] = useState(280);
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState | null>(null);
  const [providerUpdatesRunning, setProviderUpdatesRunning] = useState(false);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [authenticatingProviderId, setAuthenticatingProviderId] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<OrionAccountState>({
    authenticated: false,
    user: null,
    expiresAt: null,
  });
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountBusy, setAccountBusy] = useState(false);
  const [revealedProviderEmails, setRevealedProviderEmails] = useState<Record<string, boolean>>({});
  const [expandedProviderOptions, setExpandedProviderOptions] = useState<Record<string, boolean>>({});
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const openWithRef = useRef<HTMLDivElement>(null);
  const threadSearchRef = useRef<HTMLDivElement>(null);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const runOutputMessages = useRef(new Map<string, { threadId: string; messageId: string }>());
  const recoveredInterruptedRuns = useRef(false);
  const dragDepth = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatPinnedRef = useRef(true);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const codexSettingsRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [chatInput]);

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const selectedThreadProject = selectedThread
    ? projects.find((p) => p.id === selectedThread.projectId)
    : null;
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? selectedThreadProject ?? null;
  const latestThreadProjectId =
    threads
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
      ?.projectId ?? null;
  const defaultNewThreadProject =
    selectedProject ??
    projects.find((project) => project.id === latestThreadProjectId) ??
    projects[0] ??
    null;
  const activeThreadProject = selectedThreadProject ?? defaultNewThreadProject;
  const canChangeSelectedThreadProject =
    !!selectedThread && selectedThread.messages.length === 0 && selectedThread.status === 'idle' && !isSending;

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const shellTitle =
    activeTab === 'agents'
      ? selectedThread?.title ?? 'New thread'
      : activeFilePath
        ? activeFilePath.split(/[\\/]/).pop() ?? 'Code'
        : 'Code';
  const shellSubtitle =
    activeTab === 'agents'
      ? undefined
      : workspacePath
        ? workspacePath.split(/[\\/]/).pop() ?? workspacePath
        : undefined;
  const selectedAgentModel = findAgentModel(
    agentModels,
    selectedThread?.modelId ?? defaultAgentModelId
  );
  const selectedCodexReasoning = selectedThread?.codexReasoningEffort ?? defaultCodexReasoningEffort;
  const selectedCodexServiceTier = selectedThread?.codexServiceTier ?? defaultCodexServiceTier;
  const selectedCodexReasoningLabel =
    codexReasoningOptions.find((option) => option.value === selectedCodexReasoning)?.label ??
    'Medium';
  const selectedCodexServiceTierLabel =
    codexServiceTierOptions.find((option) => option.value === selectedCodexServiceTier)?.label ??
    'Standard';
  const selectedClaudeDefaultReasoning = getDefaultClaudeReasoningEffort(selectedAgentModel);
  const selectedClaudeReasoning =
    selectedThread?.claudeReasoningEffort ?? selectedClaudeDefaultReasoning;
  const selectedClaudeContextWindow =
    selectedThread?.claudeContextWindow ?? defaultClaudeContextWindow;
  const effectiveClaudeContextWindow = getEffectiveClaudeContextWindow(
    selectedAgentModel,
    selectedClaudeContextWindow
  );
  const selectedClaudeReasoningLabel =
    claudeReasoningOptions.find((option) => option.value === selectedClaudeReasoning)?.label ??
    'High';
  const selectedClaudeContextWindowLabel =
    claudeContextWindowOptions.find((option) => option.value === effectiveClaudeContextWindow)
      ?.label ?? '200k';
  const shouldShowAgentSettings =
    selectedAgentModel?.providerId === 'codex' || selectedAgentModel?.providerId === 'claude';
  const normalizedProviderSettings = useMemo(
    () => ({
      ...defaultProviderSettings,
      ...providerSettings,
    }),
    [providerSettings]
  );
  const enabledProviderIds = useMemo(
    () =>
      agentProviders
        .map((provider) => provider.id)
        .filter((id) => normalizedProviderSettings[id as ProviderId]?.enabled !== false),
    [normalizedProviderSettings]
  );
  const enabledProviderIdSet = useMemo(() => new Set(enabledProviderIds), [enabledProviderIds]);
  const visibleAgentModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return agentModels.filter((model) => {
      const providerMatches = model.providerId === activeProviderTab;
      const providerEnabled = enabledProviderIdSet.has(model.providerId);
      const queryMatches =
        !query ||
        model.label.toLowerCase().includes(query) ||
        model.providerLabel.toLowerCase().includes(query) ||
        model.slug.toLowerCase().includes(query);
      return providerEnabled && providerMatches && queryMatches;
    });
  }, [activeProviderTab, agentModels, enabledProviderIdSet, modelSearch]);
  const availableProviderUpdates = useMemo(
    () => providerUpdateState?.providers.filter((provider) => provider.updateAvailable) ?? [],
    [providerUpdateState]
  );
  const providerUpdateSummary =
    availableProviderUpdates.length === 1
      ? `${availableProviderUpdates[0].label} update available`
      : `${availableProviderUpdates.length} CLI updates available`;
  const providerUpdateTooltip = useMemo(
    () =>
      availableProviderUpdates
        .map((provider) => {
          const versionLabel =
            provider.currentVersion && provider.latestVersion
              ? `${provider.currentVersion} -> ${provider.latestVersion}`
              : 'update available';
          return `${provider.label}: ${versionLabel}`;
        })
        .join('\n'),
    [availableProviderUpdates]
  );
  const providerStatusById = useMemo(
    () => new Map((providerUpdateState?.providers ?? []).map((provider) => [provider.id, provider])),
    [providerUpdateState]
  );
  const appUpdateVisible =
    !!appUpdateState &&
    ['available', 'downloading', 'downloaded', 'error'].includes(appUpdateState.status);
  const appUpdatePercent = Math.max(
    0,
    Math.min(100, Math.round(appUpdateState?.progress?.percent ?? 0))
  );
  const appUpdateLabel =
    appUpdateState?.status === 'downloaded'
      ? 'Restart to update'
      : appUpdateState?.status === 'downloading'
        ? `Downloading ${appUpdatePercent}%`
        : appUpdateState?.status === 'error'
          ? 'Update failed'
          : appUpdateState?.availableVersion
            ? `Update ${appUpdateState.availableVersion}`
            : 'Update available';
  const appUpdateTitle =
    appUpdateState?.status === 'error'
      ? appUpdateState.error ?? 'Update failed'
      : appUpdateState?.availableVersion
        ? `Orion ${appUpdateState.availableVersion} is available`
        : appUpdateLabel;
  const accountName =
    accountState.user?.name ||
    accountState.user?.email ||
    (accountState.authenticated ? 'Orion account' : 'Not signed in');
  const accountEmail = accountState.user?.email ?? null;
  const accountInitials = (accountState.user?.name || accountState.user?.email || 'O')
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  // Order projects by their most recently active thread (same activity signal
  // as the Recent agents list) so current work stays at the top. Projects with
  // no threads sort last, keeping their insertion order. Merely selecting a
  // project does not reorder the sidebar.
  const sortedProjects = useMemo(() => {
    const lastActivityByProject = new Map<string, number>();
    for (const thread of threads) {
      const ts = getThreadActivityTime(thread).getTime();
      const prev = lastActivityByProject.get(thread.projectId) ?? -Infinity;
      if (ts > prev) lastActivityByProject.set(thread.projectId, ts);
    }
    return [...projects].sort(
      (a, b) =>
        (lastActivityByProject.get(b.id) ?? -Infinity) -
        (lastActivityByProject.get(a.id) ?? -Infinity)
    );
  }, [projects, threads]);

  const recentThreads = useMemo(
    () =>
      threads
        .filter((t) => !t.hiddenFromRecent)
        .sort(
          (a, b) =>
            getThreadActivityTime(b).getTime() - getThreadActivityTime(a).getTime()
        ),
    [threads]
  );

  const runningAgentCount = useMemo(
    () => threads.filter((t) => t.status === 'running').length,
    [threads]
  );

  const getProjectThreads = useCallback(
    (projectId: string) =>
      threads
        .filter((t) => t.projectId === projectId)
        .sort(
          (a, b) =>
            getThreadActivityTime(b).getTime() - getThreadActivityTime(a).getTime()
        ),
    [threads]
  );

  const threadSearchIndex = useMemo<ThreadSearchEntry[]>(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));

    return threads.map((thread) => {
      const project = projectById.get(thread.projectId);
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
          project?.name ?? '',
          project?.path ?? '',
          thread.modelId,
          thread.status,
          messageText,
        ].join(' ')
      );
      return {
        thread,
        projectName: project?.name ?? 'Unknown project',
        projectPath: project?.path ?? '',
        haystack,
        tokens: Array.from(new Set(haystack.split(' ').filter(Boolean))),
      };
    });
  }, [projects, threads]);

  const threadSearchResults = useMemo(() => {
    const query = threadSearchQuery.trim();
    if (!query) {
      return threadSearchIndex
        .slice()
        .sort((a, b) => getThreadActivityTime(b.thread).getTime() - getThreadActivityTime(a.thread).getTime())
        .slice(0, 12)
        .map((entry) => ({ entry, score: 1 }));
    }

    return threadSearchIndex
      .map((entry) => ({ entry, score: scoreThreadSearchEntry(entry, query) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return getThreadActivityTime(b.entry.thread).getTime() - getThreadActivityTime(a.entry.thread).getTime();
      })
      .slice(0, 30);
  }, [threadSearchIndex, threadSearchQuery]);

  const refreshAgentModels = useCallback(async () => {
    if (!window.orion?.listAgentModels) return;
    try {
      const models = await window.orion.listAgentModels();
      if (models.length > 0) {
        setAgentModels(models);
      }
    } catch {
      // The fallback catalog remains usable when the bridge is unavailable.
    }
  }, []);

  const refreshProviderUpdates = useCallback(async () => {
    if (!window.orion?.checkProviderUpdates) return;
    try {
      setProviderUpdateState(await window.orion.checkProviderUpdates({ enabledProviderIds }));
    } catch {
      setProviderUpdateState(null);
    }
  }, [enabledProviderIds]);

  useEffect(() => {
    void refreshAgentModels();
    void refreshProviderUpdates();
  }, [refreshAgentModels, refreshProviderUpdates]);

  useEffect(() => {
    let mounted = true;

    void window.orion?.getAppUpdateState?.().then((state) => {
      if (mounted) setAppUpdateState(state);
    });

    const unsubscribe = window.orion?.onAppUpdateState?.((state) => {
      setAppUpdateState(state);
      setAppUpdateBusy(false);
    });

    void window.orion?.checkForAppUpdate?.().catch(() => {
      // The main process publishes the visible error state.
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    void window.orion?.getAccountSession?.()
      .then((state) => {
        if (mounted) setAccountState(state);
      })
      .catch(() => {
        if (mounted) {
          setAccountState({ authenticated: false, user: null, expiresAt: null });
        }
      })
      .finally(() => {
        if (mounted) setAccountLoading(false);
      });

    const unsubscribe = window.orion?.onAccountChanged?.((state) => {
      setAccountState(state);
      setAccountLoading(false);
      setAccountBusy(false);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    chatPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    chatPinnedRef.current = true;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [selectedThreadId]);

  // Follow streaming output (chunks and activities mutate the messages array)
  // while the user stays pinned near the bottom; never fight a manual scroll.
  // 'instant' overrides the container's smooth scroll-behavior, which would
  // otherwise restart its animation on every streamed chunk.
  useEffect(() => {
    if (!chatPinnedRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [selectedThread?.messages, selectedThread?.queuedMessages, isSending]);

  useEffect(() => {
    if (!modelPickerOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) {
        setModelPickerOpen(false);
        setModelSearch('');
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelPickerOpen(false);
        setModelSearch('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!codexSettingsOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!codexSettingsRef.current?.contains(event.target as Node)) {
        setCodexSettingsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCodexSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [codexSettingsOpen]);

  useEffect(() => {
    if (!shouldShowAgentSettings) {
      setCodexSettingsOpen(false);
    }
  }, [shouldShowAgentSettings]);

  const refreshGitState = useCallback(async () => {
    const projectPath = activeThreadProject?.path;
    if (!projectPath || !window.orion?.getGitState) {
      setGitState(null);
      return;
    }

    setGitLoading(true);
    try {
      setGitState(await window.orion.getGitState(projectPath));
    } catch (error) {
      setGitState({
        ok: false,
        branches: [],
        hasUncommittedChanges: false,
        error: error instanceof Error ? error.message : 'Unable to read git state',
      });
    } finally {
      setGitLoading(false);
    }
  }, [activeThreadProject?.path]);

  useEffect(() => {
    void refreshGitState();
  }, [refreshGitState]);

  const refreshCloudState = useCallback(async () => {
    const projectPath = activeThreadProject?.path;
    if (!projectPath || !window.orion?.getCloudState) {
      setCloudState(null);
      return;
    }

    try {
      setCloudState(await window.orion.getCloudState(projectPath));
    } catch (error) {
      setCloudState({
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to read Orion Cloud state',
      });
    }
  }, [activeThreadProject?.path]);

  // Cloud state depends on both the account session and local git state
  // (each git action can change what is ahead/behind the cloud copy).
  useEffect(() => {
    void refreshCloudState();
  }, [refreshCloudState, accountState.authenticated, gitState]);

  const handleUpdateProviders = useCallback(async () => {
    if (!window.orion?.updateProviders || providerUpdatesRunning) return;

    setProviderUpdatesRunning(true);
    try {
      const result = await window.orion.updateProviders({ enabledProviderIds });
      setProviderUpdateState(result.state);
      await refreshAgentModels();

      if (result.ok) {
        toast.success('Provider CLIs updated');
      } else {
        toast.error(result.error ?? 'Some provider updates failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update provider CLIs');
    } finally {
      setProviderUpdatesRunning(false);
    }
  }, [enabledProviderIds, providerUpdatesRunning, refreshAgentModels]);

  const handleAppUpdateClick = useCallback(async () => {
    if (!appUpdateState || appUpdateBusy) return;
    if (appUpdateState.status === 'downloading' || appUpdateState.status === 'checking') return;

    setAppUpdateBusy(true);
    try {
      if (appUpdateState.status === 'downloaded') {
        await window.orion?.restartToUpdate?.();
        return;
      }

      if (appUpdateState.status === 'available') {
        await window.orion?.downloadAppUpdate?.();
        return;
      }

      await window.orion?.checkForAppUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update Orion');
      setAppUpdateBusy(false);
    }
  }, [appUpdateBusy, appUpdateState]);

  const handleStartAccountAuth = useCallback(async () => {
    if (!window.orion?.startAccountAuth || accountBusy) return;

    setAccountBusy(true);
    try {
      const result = await window.orion.startAccountAuth();
      if (!result.ok) {
        toast.error(result.error ?? 'Could not start Orion sign in');
        setAccountBusy(false);
      } else {
        toast.info('Continue sign in in your browser');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Orion sign in');
      setAccountBusy(false);
    }
  }, [accountBusy]);

  const handleSignOutAccount = useCallback(async () => {
    if (!window.orion?.signOutAccount || accountBusy) return;

    setAccountBusy(true);
    try {
      setAccountState(await window.orion.signOutAccount());
      toast.success('Signed out of Orion');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out');
    } finally {
      setAccountBusy(false);
    }
  }, [accountBusy]);

  const handleAuthenticateProvider = useCallback(async (providerId: string) => {
    if (!window.orion?.authenticateProvider || authenticatingProviderId) return;

    setAuthenticatingProviderId(providerId);
    try {
      const result = await window.orion.authenticateProvider(providerId);
      if (result.ok) {
        toast.info('Authentication started');
        window.setTimeout(() => {
          void refreshProviderUpdates();
        }, 2500);
      } else {
        toast.error(result.error ?? 'Could not start authentication');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start authentication');
    } finally {
      setAuthenticatingProviderId(null);
    }
  }, [authenticatingProviderId, refreshProviderUpdates]);

  useEffect(() => {
    if (
      !projectPickerOpen &&
      !branchPickerOpen &&
      !threadSearchOpen &&
      !threadMenuOpen &&
      !openWithOpen &&
      projectMenuOpenId === null
    ) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (projectPickerOpen && !projectPickerRef.current?.contains(target)) {
        setProjectPickerOpen(false);
      }
      if (branchPickerOpen && !branchPickerRef.current?.contains(target)) {
        setBranchPickerOpen(false);
      }
      if (openWithOpen && !openWithRef.current?.contains(target)) {
        setOpenWithOpen(false);
      }
      if (threadSearchOpen && !threadSearchRef.current?.contains(target)) {
        setThreadSearchOpen(false);
      }
      if (threadMenuOpen && !threadMenuRef.current?.contains(target)) {
        setThreadMenuOpen(false);
      }
      if (projectMenuOpenId !== null && !projectMenuRef.current?.contains(target)) {
        setProjectMenuOpenId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectPickerOpen(false);
        setBranchPickerOpen(false);
        setThreadSearchOpen(false);
        setThreadMenuOpen(false);
        setOpenWithOpen(false);
        setProjectMenuOpenId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchPickerOpen, projectPickerOpen, threadMenuOpen, threadSearchOpen, openWithOpen, projectMenuOpenId]);

  useEffect(() => {
    setThreadMenuOpen(false);
  }, [selectedThreadId]);

  useEffect(() => {
    let cancelled = false;
    void window.orion?.listOpenWithApps?.().then((apps) => {
      if (!cancelled && Array.isArray(apps)) setOpenWithApps(apps);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Streamed chunks can arrive many times per second; buffer them briefly so
  // each token doesn't trigger a full store update (and a store persist).
  const chunkBuffers = useRef(
    new Map<string, { threadId: string; messageId: string; text: string }>()
  );
  const chunkFlushTimer = useRef<number | null>(null);

  const flushChunkBuffers = useCallback(() => {
    if (chunkFlushTimer.current !== null) {
      window.clearTimeout(chunkFlushTimer.current);
      chunkFlushTimer.current = null;
    }
    if (chunkBuffers.current.size === 0) return;
    const buffered = Array.from(chunkBuffers.current.values());
    chunkBuffers.current.clear();
    for (const { threadId, messageId, text } of buffered) {
      if (text) appendToThreadMessage(threadId, messageId, text);
    }
  }, [appendToThreadMessage]);

  useEffect(() => {
    if (!window.orion?.onAgentTurnEvent) return undefined;
    const unsubscribe = window.orion.onAgentTurnEvent((event) => {
      const tracked = runOutputMessages.current.get(event.runId);
      if (!tracked) return;

      if (event.type === 'started') {
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          kind: 'agent-run',
          status: 'running',
          statusText: "I'm working on this now.",
          command: event.command,
          startedAt: new Date().toISOString(),
        });
      }

      if (event.type === 'activity' && event.activity) {
        // Flush buffered text first so the activity anchors after the text
        // that streamed before it (contentOffset), not before it.
        flushChunkBuffers();
        addActivityToThreadMessage(tracked.threadId, tracked.messageId, event.activity);
      }

      if (event.type === 'session' && event.sessionId && event.providerId) {
        setThreadAgentSession(tracked.threadId, event.providerId as ProviderId, event.sessionId);
      }

      if (event.type === 'chunk' && event.chunk) {
        const buffer = chunkBuffers.current.get(event.runId);
        if (buffer) {
          buffer.text += event.chunk;
        } else {
          chunkBuffers.current.set(event.runId, {
            threadId: tracked.threadId,
            messageId: tracked.messageId,
            text: event.chunk,
          });
        }
        if (chunkFlushTimer.current === null) {
          chunkFlushTimer.current = window.setTimeout(flushChunkBuffers, 60);
        }
      }

      if (event.type === 'done') {
        flushChunkBuffers();
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'done',
          completedAt: new Date().toISOString(),
          statusText: 'Finished.',
          changedFiles: event.changedFiles ?? [],
        });
        updateThread(tracked.threadId, { status: 'done' });
        runOutputMessages.current.delete(event.runId);
        clearActiveRun(event.runId);
      }

      if (event.type === 'error') {
        flushChunkBuffers();
        if (event.error) {
          appendToThreadMessage(tracked.threadId, tracked.messageId, `\n\n${event.error}`);
        }
        updateThreadMessage(tracked.threadId, tracked.messageId, {
          status: 'error',
          completedAt: new Date().toISOString(),
          statusText: 'The agent stopped with an error.',
          error: event.error,
          changedFiles: event.changedFiles ?? [],
        });
        updateThread(tracked.threadId, { status: 'error' });
        runOutputMessages.current.delete(event.runId);
        clearActiveRun(event.runId);
      }
    });

    return () => {
      unsubscribe?.();
      flushChunkBuffers();
    };
  }, [addActivityToThreadMessage, appendToThreadMessage, clearActiveRun, flushChunkBuffers, setThreadAgentSession, updateThread, updateThreadMessage]);

  useEffect(() => {
    if (recoveredInterruptedRuns.current || threads.length === 0) return;
    recoveredInterruptedRuns.current = true;
    for (const thread of threads) {
      if (thread.status !== 'running') continue;
      const lastMessage = thread.messages.at(-1);
      if (lastMessage?.role === 'agent' && lastMessage.content.trim().length === 0) {
        appendToThreadMessage(
          thread.id,
          lastMessage.id,
          'The previous agent run was interrupted before Orion received output. Send the prompt again to start a fresh run.'
        );
      } else {
        addMessageToThread(thread.id, {
          role: 'system',
          content: 'The previous agent run was interrupted before Orion received completion.',
        });
      }
      updateThread(thread.id, { status: 'error' });
    }
  }, [addMessageToThread, appendToThreadMessage, threads, updateThread]);

  // Sync workspace with first project if none set
  useEffect(() => {
    if (!workspacePath && projects.length > 0) {
      setWorkspacePath(projects[0].path);
    }
  }, [workspacePath, projects, setWorkspacePath]);

  // Keep treeRoot in sync
  useEffect(() => {
    setTreeRoot(workspacePath);
  }, [workspacePath]);

  // Load tree when root changes
  const loadRoot = useCallback(async (root: string) => {
    if (!root || !window.orion) return;
    const items = await window.orion.readDirectory(root);
    setTreeItems(items);
  }, []);

  useEffect(() => {
    if (treeRoot) {
      loadRoot(treeRoot);
    } else {
      setTreeItems([]);
    }
  }, [treeRoot, loadRoot]);

  useEffect(() => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return undefined;

    const updatePadding = () => {
      const nextPadding = Math.round(editorContainer.clientHeight * 0.5);
      if (nextPadding > 0) {
        setEditorBottomPadding(nextPadding);
      }
    };

    updatePadding();

    const resizeObserver = new ResizeObserver(updatePadding);
    resizeObserver.observe(editorContainer);
    return () => resizeObserver.disconnect();
  }, [activeTab]);

  // Load a file into editor (from Code tab)
  const handleOpenFile = async (filePath: string) => {
    if (!window.orion) return;
    const content = await window.orion.readFile(filePath);
    openFile(filePath, content);
    setCurrentEditorValue(content);
  };

  // Load children for tree nodes
  const loadChildren = async (dirPath: string): Promise<FileTreeItem[]> => {
    if (!window.orion) return [];
    return await window.orion.readDirectory(dirPath);
  };

  // Reload the root listing and tell expanded nodes to re-fetch their children.
  const refreshTree = useCallback(() => {
    if (treeRoot) loadRoot(treeRoot);
    setTreeRefreshToken((v) => v + 1);
  }, [treeRoot, loadRoot]);

  const isPathWithin = (candidate: string, ancestor: string) =>
    candidate === ancestor ||
    candidate.startsWith(`${ancestor}/`) ||
    candidate.startsWith(`${ancestor}\\`);

  // Delete a tree entry after native confirmation; closes any editor tabs
  // showing the deleted file (or files inside the deleted folder).
  const handleDeleteTreeItem = async (item: FileTreeItem) => {
    if (!window.orion) return;
    const confirmed = await window.orion.confirmDeletePath({
      path: item.path,
      isDirectory: item.isDirectory,
    });
    if (!confirmed) return;
    const ok = await window.orion.deletePath(item.path);
    if (!ok) {
      toast.error(`Could not delete ${item.name}`);
      return;
    }
    for (const file of openFiles) {
      if (isPathWithin(file.path, item.path)) closeFile(file.path);
    }
    toast.success(`Deleted ${item.name}`);
    refreshTree();
  };

  // After a rename, retarget open editor tabs and refresh the tree.
  const handleTreeItemRenamed = async (oldPath: string, newPath: string, isDirectory: boolean) => {
    const wasOpen = openFiles.some((file) => file.path === oldPath);
    for (const file of openFiles) {
      if (isPathWithin(file.path, oldPath)) closeFile(file.path);
    }
    if (!isDirectory && wasOpen) {
      await handleOpenFile(newPath);
    }
    refreshTree();
  };

  // Save current file
  const saveActiveFile = useCallback(async () => {
    if (!activeFile || !window.orion) return;

    const success = await window.orion.writeFile(activeFile.path, currentEditorValue);
    if (success) {
      updateOpenFileContent(activeFile.path, currentEditorValue);
      markFileSaved(activeFile.path);
    } else {
      toast.error('Failed to save file');
    }
  }, [activeFile, currentEditorValue, markFileSaved, updateOpenFileContent]);

  // Handle editor changes
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setCurrentEditorValue(value);
    if (activeFilePath) {
      updateOpenFileContent(activeFilePath, value);
    }
  };

  // Keyboard save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (activeTab === 'code' && activeFilePath) {
          void saveActiveFile();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        if (activeTab === 'code' && activeFilePath) {
          e.preventDefault();
          closeFile(activeFilePath);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [activeTab, activeFilePath, closeFile, saveActiveFile]);

  // When switching active file, load its content into local editor state
  useEffect(() => {
    if (activeFile) {
      setCurrentEditorValue(activeFile.content);
    } else {
      setCurrentEditorValue('');
    }
  }, [activeFilePath]);

  // Add a project
  const handleAddProject = async () => {
    if (!window.orion) return;
    const dir = await window.orion.openDirectory();
    if (!dir) return;

    const name = await window.orion.basename(dir);
    const projectId = addProject({ name, path: dir });

    // Also set workspace to this project
    setWorkspacePath(dir);

    // Adding a project means the user wants to work in it now — drop them
    // straight into a fresh thread for it.
    handleCreateThread(projectId);

    toast.success(`Added project: ${name}`);
  };

  // Open folder directly for code tab
  const handleOpenFolderForCode = async () => {
    if (!window.orion) return;
    const dir = await window.orion.openDirectory();
    if (dir) {
      setWorkspacePath(dir);
      closeAllFiles();
      toast.success('Workspace opened');
    }
  };

  const handleSetActiveTab = (tab: 'agents' | 'code') => {
    if (tab === 'code' && selectedProject && workspacePath !== selectedProject.path) {
      setWorkspacePath(selectedProject.path);
      closeAllFiles();
    }

    setActiveTab(tab);
  };

  const handleNewAgent = () => {
    const projectId = defaultNewThreadProject?.id ?? projects[0]?.id;
    if (!projectId) {
      void handleAddProject();
      return;
    }

    handleCreateThread(projectId);
  };

  const handleChangeSelectedThreadProject = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;

    if (!selectedThread) {
      selectProject(projectId);
      setProjectPickerOpen(false);
      return;
    }

    if (!canChangeSelectedThreadProject) {
      toast.error('Project can only be changed before the agent runs in this thread');
      setProjectPickerOpen(false);
      return;
    }

    updateThread(selectedThread.id, { projectId });
    selectProject(projectId);
    setProjectPickerOpen(false);
  };

  const handleCheckoutBranch = async (branchName: string) => {
    if (!activeThreadProject?.path || !window.orion?.checkoutGitBranch || gitBusy) return;
    if (gitState?.hasUncommittedChanges) {
      toast.error('Commit or discard local changes before checking out another branch');
      return;
    }

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeThreadProject.path,
        branchName,
      });
      if (result.ok) {
        toast.success(`Checked out ${branchName}`);
        setBranchPickerOpen(false);
        await refreshGitState();
      } else {
        toast.error(result.error ?? `Could not check out ${branchName}`);
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!activeThreadProject?.path || !window.orion?.checkoutGitBranch || gitBusy) return;

    const branchName = prompt('New branch name');
    const normalized = branchName?.trim();
    if (!normalized) return;

    setGitBusy(true);
    try {
      const result = await window.orion.checkoutGitBranch({
        projectPath: activeThreadProject.path,
        branchName: normalized,
        create: true,
      });
      if (result.ok) {
        toast.success(`Created ${normalized}`);
        setBranchPickerOpen(false);
        await refreshGitState();
      } else {
        toast.error(result.error ?? `Could not create ${normalized}`);
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCommitAndPush = async () => {
    if (!activeThreadProject?.path || !window.orion?.commitAndPush || gitBusy) return;

    setGitBusy(true);
    try {
      const result = await window.orion.commitAndPush(activeThreadProject.path);
      if (result.ok) {
        toast.success(`Committed and pushed ${result.branch ?? gitState?.currentBranch ?? 'branch'}`);
        await refreshGitState();
      } else {
        toast.error(result.error ?? 'Commit and push failed');
      }
    } finally {
      setGitBusy(false);
    }
  };

  const handleCloudPublish = async () => {
    if (!activeThreadProject?.path || !window.orion?.publishToCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.publishToCloud({ projectPath: activeThreadProject.path });
      if (result.ok && result.alreadyLinked) {
        toast.success(result.upToDate ? 'Orion Cloud is already up to date' : 'Pushed to Orion Cloud');
        await refreshCloudState();
      } else if (result.ok) {
        toast.success(`Published to Orion Cloud as ${result.repo?.name ?? 'repository'}`, {
          description: 'Press Deploy on Orion Cloud to host it as an app.',
          action: {
            label: 'Open',
            onClick: () => void window.orion?.openCloudRepoInBrowser?.(activeThreadProject.path),
          },
        });
        await refreshCloudState();
      } else if (result.needsAuth) {
        toast.error(result.error ?? 'Sign in first.');
        setSettingsTab('account');
        setSettingsOpen(true);
      } else {
        toast.error(result.error ?? 'Publish failed');
      }
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudPush = async () => {
    if (!activeThreadProject?.path || !window.orion?.pushToCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pushToCloud(activeThreadProject.path);
      if (result.ok && result.upToDate) {
        toast.info('Orion Cloud is already up to date');
      } else if (result.ok) {
        toast.success(
          `Pushed ${result.pushed?.length === 1 ? result.pushed[0] : `${result.pushed?.length ?? 0} branches`} to Orion Cloud`,
          result.app?.url
            ? {
                description: `Redeploying ${new URL(result.app.url).host}`,
                action: {
                  label: 'Open app',
                  onClick: () => void window.orion?.openExternalUrl?.(result.app!.url),
                },
              }
            : undefined
        );
      } else {
        toast.error(result.error ?? 'Push to Orion Cloud failed');
      }
      if (result.skipped?.length) {
        toast.info(`Skipped ${result.skipped.map((item) => item.branch).join(', ')}: ${result.skipped[0].reason}`);
      }
      await refreshCloudState();
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudPull = async () => {
    if (!activeThreadProject?.path || !window.orion?.pullFromCloud || cloudBusy) return;

    setCloudBusy(true);
    try {
      const result = await window.orion.pullFromCloud(activeThreadProject.path);
      if (!result.ok) {
        toast.error(result.error ?? 'Pull from Orion Cloud failed');
      } else {
        const merge = result.merge;
        if (merge?.status === 'fast-forwarded' || merge?.status === 'checked-out') {
          toast.success('Pulled latest changes from Orion Cloud');
        } else if (merge?.status === 'up-to-date') {
          toast.info('Already up to date with Orion Cloud');
        } else if (merge?.status === 'diverged') {
          toast.info(merge.hint ?? 'Local and cloud history diverged — merge manually.');
        } else if (merge?.status === 'ff-failed' || merge?.status === 'unborn-dirty') {
          toast.info(merge.error ?? merge.hint ?? 'Fetched, but could not update your branch.');
        } else if (merge?.status === 'local-ahead') {
          toast.info('Fetched — your branch is ahead of Orion Cloud. Push when ready.');
        } else {
          toast.success('Fetched from Orion Cloud');
        }
      }
      await refreshGitState();
      await refreshCloudState();
    } finally {
      setCloudBusy(false);
    }
  };

  // Create new thread for a project
  const handleCreateThread = (projectId: string) => {
    setCollapsedProjects((prev) => (prev[projectId] ? { ...prev, [projectId]: false } : prev));
    // Prevent spamming empty threads: if selected thread for this project is empty and nothing typed, do nothing
    if (
      selectedThread &&
      selectedThread.projectId === projectId &&
      selectedThread.messages.length === 0 &&
      !chatInput.trim() &&
      chatAttachments.length === 0
    ) {
      setActiveTab('agents');
      return selectedThread.id;
    }
    const id = createThread(projectId);
    setActiveTab('agents');
    return id;
  };

  const attachImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter(isImageFile);
      if (imageFiles.length === 0) return false;

      let targetThreadId = selectedThreadId;
      if (!targetThreadId) {
        const projectId = selectedProject?.id ?? projects[0]?.id;
        if (!projectId) {
          toast.error('Add a project before attaching images');
          return true;
        }
        targetThreadId = handleCreateThread(projectId);
      }

      if (activeTab !== 'agents') {
        setActiveTab('agents');
      }
      selectThread(targetThreadId);

      if (!window.orion?.saveImageAttachment) {
        toast.error('Image attachments are unavailable');
        return true;
      }

      const savedAttachments: ImageAttachment[] = [];
      for (const file of imageFiles) {
        const droppedPath = getDroppedFilePath(file);
        if (droppedPath) {
          savedAttachments.push({
            id: crypto.randomUUID(),
            name: file.name || droppedPath.split(/[\\/]/).pop() || 'image',
            path: droppedPath,
            mimeType: file.type || 'image/*',
            size: file.size,
          });
          continue;
        }

        try {
          const result = await window.orion.saveImageAttachment({
            name: file.name || 'image',
            mimeType: file.type || 'image/*',
            data: await file.arrayBuffer(),
          });

          if (result.ok && result.attachment) {
            savedAttachments.push(result.attachment);
          } else {
            toast.error(result.error ?? `Could not attach ${file.name || 'image'}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          toast.error(
            message.includes('No handler registered')
              ? 'Restart Orion to finish enabling image attachments.'
              : message || `Could not attach ${file.name || 'image'}`
          );
        }
      }

      if (savedAttachments.length > 0) {
        setChatAttachments((current) => [...current, ...savedAttachments]);
      }

      return true;
    },
    [
      activeTab,
      handleCreateThread,
      projects,
      selectThread,
      selectedProject?.id,
      selectedThreadId,
      setActiveTab,
    ]
  );

  const handleRootDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingImages(true);
  }, []);

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleRootDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDraggingImages(false);
    }
  }, []);

  const handleRootDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDraggingImages(false);
      void attachImageFiles(event.dataTransfer.files);
    },
    [attachImageFiles]
  );

  const removeChatAttachment = (id: string) => {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  // Start a turn on any thread — not just the selected one — so queued
  // follow-ups can dispatch for threads running in the background. Preflight
  // and transcript setup are synchronous; the CLI spawn result is handled in
  // the continuation.
  const startTurnForThread = useCallback(
    (
      threadId: string,
      promptText: string,
      attachments: ImageAttachment[]
    ): { ok: boolean; error?: string } => {
      const state = useOrionStore.getState();
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return { ok: false, error: 'Thread no longer exists' };
      const project = state.projects.find((p) => p.id === thread.projectId);
      if (!project) return { ok: false, error: 'Select a project for this thread first' };
      const model = findAgentModel(agentModels, thread.modelId ?? defaultAgentModelId);
      if (!model) return { ok: false, error: 'Select an agent model first' };
      if (normalizedProviderSettings[model.providerId]?.enabled === false) {
        return { ok: false, error: `${model.providerLabel} is disabled` };
      }
      if (model.available === false) {
        return { ok: false, error: model.unavailableReason ?? `${model.label} is unavailable` };
      }
      if (!window.orion?.runAgentTurn) {
        return { ok: false, error: 'Agent runtime is unavailable' };
      }

      const userContent = promptText || 'Attached image';
      const agentPrompt = buildPromptWithAttachments(promptText, attachments);

      // Auto-generate a relevant thread title from the first user message (like Codex / T3 Code)
      if (thread.messages.length === 0 && isDefaultTitle(thread.title)) {
        const initialTitle = deriveTitle(userContent);
        if (isPlausibleTitle(initialTitle)) {
          updateThread(threadId, { title: initialTitle });
        }
        // Kick off async LLM refinement for a nicer title
        void tryGenerateBetterTitle(threadId, userContent, model.id, project.path, updateThread);
      }

      if (threadId === state.selectedThreadId) chatPinnedRef.current = true;
      addMessageToThread(threadId, {
        role: 'user',
        content: userContent,
        attachments,
      });
      updateThread(threadId, { status: 'running' });

      const messageId = addMessageToThread(threadId, {
        role: 'agent',
        content: '',
        kind: 'agent-run',
        status: 'running',
        statusText: "I'm working on this now.",
        startedAt: new Date().toISOString(),
        activities: [],
      });
      const runId = crypto.randomUUID();
      runOutputMessages.current.set(runId, { threadId, messageId });
      setActiveRunsByThread((current) => ({ ...current, [threadId]: runId }));

      void window.orion
        .runAgentTurn({
          runId,
          threadId,
          projectPath: project.path,
          prompt: agentPrompt,
          modelId: model.id,
          accessMode: thread.accessMode ?? 'full-access',
          resumeSessionId: thread.agentSessionIds?.[model.providerId],
          providerOptions: normalizedProviderSettings[model.providerId]?.options,
          ...(model.providerId === 'codex'
            ? {
                codexReasoningEffort: thread.codexReasoningEffort ?? defaultCodexReasoningEffort,
                codexServiceTier: thread.codexServiceTier ?? defaultCodexServiceTier,
              }
            : {}),
          ...(model.providerId === 'claude'
            ? {
                claudeReasoningEffort:
                  thread.claudeReasoningEffort ?? getDefaultClaudeReasoningEffort(model),
                claudeContextWindow: getEffectiveClaudeContextWindow(
                  model,
                  thread.claudeContextWindow ?? defaultClaudeContextWindow
                ),
              }
            : {}),
        })
        .then((result) => {
          if (result.ok && result.runId) {
            if (result.runId !== runId) {
              runOutputMessages.current.delete(runId);
              runOutputMessages.current.set(result.runId, { threadId, messageId });
              setActiveRunsByThread((current) =>
                current[threadId] === runId ? { ...current, [threadId]: result.runId! } : current
              );
            }
          } else {
            runOutputMessages.current.delete(runId);
            clearActiveRun(runId);
            appendToThreadMessage(threadId, messageId, result.error ?? 'The agent failed to start.');
            updateThreadMessage(threadId, messageId, {
              status: 'error',
              completedAt: new Date().toISOString(),
              statusText: 'The agent failed to start.',
              error: result.error,
            });
            updateThread(threadId, { status: 'error' });
          }
        });

      return { ok: true };
    },
    [
      agentModels,
      normalizedProviderSettings,
      addMessageToThread,
      appendToThreadMessage,
      updateThread,
      updateThreadMessage,
      clearActiveRun,
    ]
  );

  // Queued follow-ups dispatch as soon as their thread has no run in flight —
  // after a turn finishes (done or error) and after app-restart recovery. Each
  // dispatch resumes the provider session, so the agent keeps its context.
  useEffect(() => {
    for (const thread of threads) {
      const next = thread.queuedMessages?.[0];
      if (!next) continue;
      if (thread.status === 'running' || activeRunsByThread[thread.id]) continue;
      removeQueuedThreadMessage(thread.id, next.id);
      const result = startTurnForThread(thread.id, next.text, next.attachments ?? []);
      if (!result.ok) {
        addMessageToThread(thread.id, {
          role: 'system',
          content: `Could not send the queued message: ${result.error}`,
        });
      }
    }
  }, [threads, activeRunsByThread, removeQueuedThreadMessage, startTurnForThread, addMessageToThread]);

  const sendMessage = () => {
    if (!selectedThreadId || !selectedThread) return;
    const promptText = chatInput.trim();
    if (!promptText && chatAttachments.length === 0) return;

    // Agent mid-run: hold the message; it dispatches when the current turn ends.
    if (isSending) {
      chatPinnedRef.current = true;
      queueMessageToThread(selectedThreadId, { text: promptText, attachments: chatAttachments });
      setChatInput('');
      setChatAttachments([]);
      return;
    }

    const result = startTurnForThread(selectedThreadId, promptText, chatAttachments);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setChatInput('');
    setChatAttachments([]);
    setModelPickerOpen(false);
    setCodexSettingsOpen(false);
  };

  // Steering = interrupt the running CLI and immediately resume its session
  // with the new instruction. Needs the harness to have reported a session id
  // (arrives within the first events of a run).
  const steerSupported =
    isSending && !!selectedAgentModel && providerFollowUpSupport[selectedAgentModel.providerId].steer;
  const steerReady =
    steerSupported &&
    !!selectedAgentModel &&
    !!selectedThread?.agentSessionIds?.[selectedAgentModel.providerId];

  const steerWithContent = async (promptText: string, attachments: ImageAttachment[]) => {
    if (!selectedThreadId || !activeRunId || !steerReady || !window.orion?.stopAgentTurn) return;
    if (!promptText && attachments.length === 0) return;

    const runId = activeRunId;
    const threadId = selectedThreadId;
    // Untrack before killing so the dying process's tail events can't write
    // into the transcript.
    const tracked = runOutputMessages.current.get(runId);
    runOutputMessages.current.delete(runId);
    clearActiveRun(runId);
    flushChunkBuffers();
    if (tracked) {
      updateThreadMessage(tracked.threadId, tracked.messageId, {
        status: 'stopped',
        completedAt: new Date().toISOString(),
        statusText: 'Interrupted — steered to a new instruction.',
      });
    }
    await window.orion.stopAgentTurn(runId);
    // Give the CLI a beat to flush its session file before we resume it.
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const result = startTurnForThread(threadId, promptText, attachments);
    if (!result.ok) {
      toast.error(result.error);
      updateThread(threadId, { status: 'error' });
    }
  };

  // Composer ⚡ / ⌘⏎: steer with the current draft.
  const steerActiveAgent = async () => {
    const promptText = chatInput.trim();
    const attachments = chatAttachments;
    if (!promptText && attachments.length === 0) return;
    setChatInput('');
    setChatAttachments([]);
    await steerWithContent(promptText, attachments);
  };

  // "Steer now" on a queued transcript bubble: promote that message to an
  // immediate interrupt-and-resume instead of waiting for the turn to end.
  const steerQueuedMessage = async (queuedId: string) => {
    if (!selectedThreadId || !activeRunId || !steerReady) return;
    const thread = useOrionStore.getState().threads.find((t) => t.id === selectedThreadId);
    const queued = thread?.queuedMessages?.find((q) => q.id === queuedId);
    if (!queued) return;
    removeQueuedThreadMessage(selectedThreadId, queuedId);
    await steerWithContent(queued.text, queued.attachments ?? []);
  };

  const stopActiveAgent = async () => {
    // Stops only the selected thread's run; agents in other threads keep going.
    if (!activeRunId || !window.orion?.stopAgentTurn) return;
    // Stop means "halt everything": queued follow-ups return to the composer
    // instead of auto-dispatching against the stopped run's session.
    const thread = useOrionStore.getState().threads.find((t) => t.id === selectedThreadId);
    const queued = thread?.queuedMessages ?? [];
    if (thread && queued.length > 0) {
      updateThread(thread.id, { queuedMessages: [] });
      setChatInput((current) =>
        [...queued.map((q) => q.text), current].filter(Boolean).join('\n\n')
      );
      setChatAttachments((current) => [...queued.flatMap((q) => q.attachments ?? []), ...current]);
    }
    await window.orion.stopAgentTurn(activeRunId);
    flushChunkBuffers();
    const tracked = runOutputMessages.current.get(activeRunId);
    if (tracked) {
      appendToThreadMessage(tracked.threadId, tracked.messageId, '\n\nStopped by user.');
      updateThreadMessage(tracked.threadId, tracked.messageId, {
        status: 'stopped',
        completedAt: new Date().toISOString(),
        statusText: 'Stopped by user.',
      });
      updateThread(tracked.threadId, { status: 'idle' });
      runOutputMessages.current.delete(activeRunId);
    }
    clearActiveRun(activeRunId);
  };

  // Handle chat submit: ⏎ sends (or queues mid-run), ⌘⏎ steers mid-run.
  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if ((e.metaKey || e.ctrlKey) && isSending && steerReady) {
      void steerActiveAgent();
      return;
    }
    sendMessage();
  };

  const currentLanguage = activeFilePath ? getLanguageFromPath(activeFilePath) : 'plaintext';

  const formatCheckedTime = (iso: string): string => {
    try {
      const then = new Date(iso).getTime();
      const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
      if (mins < 1) return 'just now';
      if (mins === 1) return '1m ago';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return 'recently';
    }
  };

  const renderSidebarFooter = () => (
    <div className="sidebar-footer">
      {appUpdateVisible && (
        <button
          type="button"
          className={`sidebar-update-button ${appUpdateState?.status ?? 'idle'}`}
          onClick={handleAppUpdateClick}
          title={appUpdateTitle}
          disabled={appUpdateBusy || appUpdateState?.status === 'downloading'}
        >
          {appUpdateState?.status === 'downloaded' ? (
            <RefreshCw size={15} />
          ) : appUpdateState?.status === 'downloading' ? (
            <span className="sidebar-update-progress" style={{ '--update-progress': `${appUpdatePercent}%` } as React.CSSProperties}>
              <Download size={14} />
            </span>
          ) : (
            <Download size={15} />
          )}
          <span>{appUpdateLabel}</span>
        </button>
      )}
      <button
        type="button"
        className={`sidebar-account-button ${accountState.authenticated ? 'signed-in' : ''}`}
        onClick={() => {
          if (accountState.authenticated) {
            setSettingsTab('account');
            setSettingsOpen(true);
            return;
          }
          handleStartAccountAuth();
        }}
        title={accountState.authenticated ? accountName : 'Sign in to Orion'}
        disabled={accountLoading || accountBusy}
      >
        {accountState.authenticated && accountState.user?.imageUrl ? (
          <img src={accountState.user.imageUrl} alt="" />
        ) : accountState.authenticated ? (
          <span>{accountInitials || 'O'}</span>
        ) : (
          <LogIn size={16} />
        )}
      </button>
      <button
        type="button"
        className="sidebar-settings-button"
        onClick={() => setSettingsOpen(true)}
        title="Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  );

  return (
    <div
      className={`app-container ${draggingImages ? 'dragging-images' : ''}`}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <Toaster position="top-center" richColors closeButton />
      {draggingImages && (
        <div className="image-drop-overlay">
          <div className="image-drop-target">
            <ImageIcon size={28} />
            <span>Drop images to attach</span>
          </div>
        </div>
      )}

      <div className="app-shellbar">
        <div className="shell-sidebar-chrome">
          <div className="shell-brand">
            <img src={orionIconUrl} alt="Orion" className="shell-brand-logo" width={28} height={28} draggable={false} />
            <span className="shell-brand-name">Orion</span>
          </div>
        </div>

        <div className="shell-main-chrome">
          <div className="shell-title-group">
            {activeTab === 'agents' && selectedThread ? (
              <div className="thread-title-menu shell-thread-title-menu" ref={threadMenuRef}>
                <span className="shell-title truncate">{shellTitle}</span>
                <button
                  type="button"
                  className="thread-title-menu-trigger"
                  onClick={() => setThreadMenuOpen((open) => !open)}
                  aria-label="Thread options"
                  aria-haspopup="menu"
                  aria-expanded={threadMenuOpen}
                  title="Thread options"
                >
                  <Ellipsis size={14} />
                </button>
                {threadMenuOpen && (
                  <div className="thread-menu" role="menu">
                    <button
                      type="button"
                      className="project-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuOpen(false);
                        if (!selectedThread) return;
                        const newTitle = prompt('Rename thread', selectedThread.title);
                        if (newTitle) updateThread(selectedThread.id, { title: newTitle });
                      }}
                    >
                      <SquarePen size={13} /> Rename
                    </button>
                    <button
                      type="button"
                      className="project-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuOpen(false);
                        if (confirm('Delete this thread?')) {
                          deleteThread(selectedThread.id);
                        }
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <span className="shell-title truncate">{shellTitle}</span>
            )}
            {shellSubtitle && (
              <>
                <span className="shell-title-divider" />
                <span className="shell-subtitle truncate">{shellSubtitle}</span>
              </>
            )}
            {activeTab === 'agents' && activeThreadProject && (
              <>
                <span className="shell-title-divider" />
                <div className="shell-project-control" ref={projectPickerRef}>
                  <button
                    type="button"
                    className="shell-project-trigger"
                    onClick={() => {
                      if (selectedThread && !canChangeSelectedThreadProject) return;
                      setProjectPickerOpen((open) => !open);
                    }}
                    disabled={!!selectedThread && !canChangeSelectedThreadProject}
                    title={
                      selectedThread && !canChangeSelectedThreadProject
                        ? 'Project is locked after an agent runs'
                        : activeThreadProject.path
                    }
                    aria-haspopup="menu"
                    aria-expanded={projectPickerOpen}
                  >
                    <ProjectIcon projectPath={activeThreadProject.path} size={14} />
                    <span className="truncate">{activeThreadProject.name}</span>
                    {(!selectedThread || canChangeSelectedThreadProject) && (
                      <ChevronDown
                        size={13}
                        className={`project-pill-chevron ${projectPickerOpen ? 'open' : ''}`}
                      />
                    )}
                  </button>
                  {projectPickerOpen && (!selectedThread || canChangeSelectedThreadProject) && (
                    <div className="shell-project-picker" role="menu">
                      {projects.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`project-picker-item ${option.id === activeThreadProject.id ? 'selected' : ''}`}
                          onClick={() => handleChangeSelectedThreadProject(option.id)}
                          title={option.path}
                        >
                          <ProjectIcon projectPath={option.path} size={13} />
                          <span className="truncate">{option.name}</span>
                          {option.id === activeThreadProject.id && <Check size={13} />}
                        </button>
                      ))}
                      <div className="project-picker-divider" />
                      <button
                        type="button"
                        className="project-picker-item"
                        onClick={() => {
                          setProjectPickerOpen(false);
                          void handleAddProject();
                        }}
                      >
                        <Plus size={13} /> Add project
                      </button>
                      {activeThreadProject && projects.length > 1 && (
                        <button
                          type="button"
                          className="project-picker-item danger"
                          onClick={() => {
                            setProjectPickerOpen(false);
                            if (confirm(`Remove project "${activeThreadProject.name}"?`)) {
                              removeProject(activeThreadProject.id);
                            }
                          }}
                        >
                          <Trash2 size={13} /> Remove project
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="shell-branch-control" ref={branchPickerRef}>
                  <button
                    type="button"
                    className="shell-branch-trigger"
                    onClick={() => setBranchPickerOpen((open) => !open)}
                    disabled={gitLoading || gitBusy || !gitState?.ok}
                    title={gitState?.error ?? gitState?.root ?? 'Git state'}
                    aria-haspopup="menu"
                    aria-expanded={branchPickerOpen}
                  >
                    <GitBranch size={14} />
                    <span className="truncate">
                      {gitLoading ? 'Git...' : gitState?.currentBranch ?? 'No Git'}
                    </span>
                    <ChevronDown
                      size={13}
                      className={`project-pill-chevron ${branchPickerOpen ? 'open' : ''}`}
                    />
                  </button>
                  {branchPickerOpen && (
                    <div className="shell-branch-picker" role="menu">
                      {gitState?.hasUncommittedChanges && (
                        <div className="branch-picker-note">Commit local changes before switching branches.</div>
                      )}
                      {gitState?.branches.map((branch) => (
                        <button
                          key={branch.name}
                          type="button"
                          className={`branch-picker-item ${branch.current ? 'selected' : ''}`}
                          onClick={() => handleCheckoutBranch(branch.name)}
                          disabled={branch.current || gitState.hasUncommittedChanges || gitBusy}
                          title={
                            gitState.hasUncommittedChanges && !branch.current
                              ? 'Unavailable with uncommitted changes'
                              : branch.name
                          }
                        >
                          <GitBranch size={13} />
                          <span className="truncate">{branch.name}</span>
                          {branch.current && <Check size={13} />}
                        </button>
                      ))}
                      {gitState?.branches.length === 0 && (
                        <div className="branch-picker-empty">{gitState?.error ?? 'No branches found'}</div>
                      )}
                      <div className="project-picker-divider" />
                      <button
                        type="button"
                        className="branch-picker-item"
                        onClick={handleCreateBranch}
                        disabled={gitBusy || !gitState?.ok}
                      >
                        <Plus size={13} /> New branch
                      </button>
                      <button
                        type="button"
                        className="branch-picker-item"
                        onClick={() => {
                          setBranchPickerOpen(false);
                          void handleCommitAndPush();
                        }}
                        disabled={gitBusy || !gitState?.ok || !gitState.currentBranch}
                        title="git add . && git commit && git push"
                      >
                        <GitCommit size={13} /> Commit and Push
                      </button>
                    </div>
                  )}
                </div>

                {gitState?.ok && cloudState?.ok && (
                  <button
                    type="button"
                    className={`shell-cloud-button ${
                      cloudState.linked && (cloudState.sync === 'ahead' || cloudState.sync === 'diverged')
                        ? 'attention'
                        : ''
                    }`}
                    onClick={() => {
                      if (!cloudState.authenticated) {
                        toast.info('Sign in to your Orion account to publish this repository.');
                        setSettingsTab('account');
                        setSettingsOpen(true);
                        return;
                      }
                      if (cloudState.linked) {
                        void handleCloudPush();
                      } else {
                        void handleCloudPublish();
                      }
                    }}
                    disabled={cloudBusy || gitBusy}
                    title={
                      !cloudState.linked
                        ? 'Publish this repository to Orion Cloud'
                        : cloudState.sync === 'diverged'
                          ? 'Local and cloud history diverged'
                          : 'Push local commits to Orion Cloud'
                    }
                  >
                    {cloudState.linked ? <CloudUpload size={14} /> : <Cloud size={14} />}
                    <span>
                      {cloudBusy
                        ? cloudState.linked
                          ? 'Pushing…'
                          : 'Publishing…'
                        : cloudState.linked
                          ? 'Push'
                          : 'Publish'}
                    </span>
                  </button>
                )}

                {gitState?.ok && cloudState?.ok && cloudState.linked && (
                  <div className="shell-cloud-group" title={`Orion Cloud: ${cloudState.repoName ?? ''}`}>
                    <button
                      type="button"
                      className={`shell-cloud-icon-button ${
                        cloudState.sync === 'behind' || cloudState.sync === 'diverged' ? 'attention' : ''
                      }`}
                      onClick={() => void handleCloudPull()}
                      disabled={cloudBusy || gitBusy}
                      title={
                        cloudState.sync === 'behind'
                          ? 'Orion Cloud has new changes — pull them'
                          : 'Pull from Orion Cloud'
                      }
                    >
                      <CloudDownload size={14} />
                    </button>
                    <button
                      type="button"
                      className="shell-cloud-icon-button"
                      onClick={() =>
                        activeThreadProject?.path &&
                        void window.orion?.openCloudRepoInBrowser?.(activeThreadProject.path)
                      }
                      disabled={!cloudState.linked}
                      title="Open on Orion Cloud"
                    >
                      <Globe size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
            {activeTab === 'agents' && selectedThread && (
              <span className={`status-dot shell-status-dot ${selectedThread.status}`} />
            )}
          </div>

          <div className="shell-right-group">
            {openWithApps.length > 0 && activeThreadProject?.path && (
              <div className="shell-openwith-control" ref={openWithRef}>
                <button
                  type="button"
                  className="shell-openwith-trigger"
                  onClick={() => setOpenWithOpen((open) => !open)}
                  title={`Open ${activeThreadProject.name} in another app`}
                  aria-label="Open with"
                  aria-haspopup="menu"
                  aria-expanded={openWithOpen}
                >
                  <SquareArrowOutUpRight size={14} />
                  <ChevronDown
                    size={13}
                    className={`project-pill-chevron ${openWithOpen ? 'open' : ''}`}
                  />
                </button>
                {openWithOpen && (
                  <div className="shell-openwith-menu" role="menu">
                    {openWithApps.map((appOption) => (
                      <button
                        key={appOption.id}
                        type="button"
                        className="openwith-item"
                        role="menuitem"
                        onClick={() => {
                          setOpenWithOpen(false);
                          void window.orion
                            ?.openProjectWith?.({
                              appId: appOption.id,
                              projectPath: activeThreadProject.path,
                            })
                            .then((result) => {
                              if (result && !result.ok && result.error) {
                                toast.error(result.error);
                              }
                            });
                        }}
                      >
                        {appOption.icon ? (
                          <img
                            src={appOption.icon}
                            alt=""
                            className="openwith-item-icon"
                            width={18}
                            height={18}
                            draggable={false}
                          />
                        ) : (
                          <AppWindow size={16} className="openwith-item-icon" />
                        )}
                        <span className="truncate">{appOption.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="shell-mode-tabs" role="tablist" aria-label="Mode">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'agents'}
                className={`shell-mode-tab ${activeTab === 'agents' ? 'active' : ''}`}
                onClick={() => handleSetActiveTab('agents')}
              >
                <MessageSquare size={15} /> Agents
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'code'}
                className={`shell-mode-tab ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => handleSetActiveTab('code')}
              >
                <Code2 size={15} /> Code
              </button>
            </div>
          </div>
        </div>
      </div>

      {!settingsOpen && availableProviderUpdates.length > 0 && (
        <div className="provider-update-banner" role="status">
          <div className="provider-update-copy" title={providerUpdateTooltip}>
            <RefreshCw size={14} className={providerUpdatesRunning ? 'spinning' : ''} />
            <span>{providerUpdateSummary}</span>
          </div>
          <button
            type="button"
            className="provider-update-button"
            onClick={handleUpdateProviders}
            disabled={providerUpdatesRunning}
            aria-busy={providerUpdatesRunning}
          >
            Update providers
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="settings-page">
          <div className="settings-sidebar">
            <div className="settings-sidebar-header">
              <Settings size={16} />
              <span>Settings</span>
            </div>
            <div className="settings-nav">
              {[
                { id: 'account', label: 'Account', Icon: UserRound },
                { id: 'general', label: 'General', Icon: Settings },
                { id: 'providers', label: 'Providers', Icon: Plug },
                { id: 'cosmetics', label: 'Cosmetics', Icon: Palette },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item ${settingsTab === id ? 'active' : ''}`}
                  onClick={() => setSettingsTab(id as SettingsTab)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="settings-sidebar-footer">
              <button
                type="button"
                className="settings-back-button"
                onClick={() => setSettingsOpen(false)}
              >
                ← Back
              </button>
            </div>
          </div>

          <div className="settings-content">
            <div className="settings-content-header">
              {settingsTab === 'account' && 'ACCOUNT'}
              {settingsTab === 'general' && 'GENERAL'}
              {settingsTab === 'providers' && 'PROVIDERS'}
              {settingsTab === 'cosmetics' && 'COSMETICS'}
            </div>

            <div className="settings-panel">
              {settingsTab === 'account' && (
                <>
                  <div className="account-row">
                    <div className="account-card-main">
                      {accountState.user?.imageUrl ? (
                        <img
                          className="account-avatar"
                          src={accountState.user.imageUrl}
                          alt=""
                          aria-hidden
                        />
                      ) : (
                        <div className="account-avatar account-avatar-fallback">
                          {accountInitials || 'O'}
                        </div>
                      )}
                      <div className="account-card-text">
                        <div className="account-card-title">{accountName}</div>
                        <div className="account-card-subtitle">
                          {accountLoading
                            ? 'Checking Orion account...'
                            : accountState.authenticated
                              ? accountEmail || 'Signed in to Orion Web'
                              : 'Sign in through Orion Web to authorize this desktop app.'}
                        </div>
                      </div>
                    </div>
                    <span className={`account-status-chip ${accountState.authenticated ? 'signed-in' : ''}`}>
                      {accountLoading ? 'Checking' : accountState.authenticated ? 'Signed in' : 'Signed out'}
                    </span>
                  </div>

                  {accountState.authenticated && (
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Desktop session</div>
                        <div className="setting-label-desc">
                          Authorized by Orion Web{accountState.expiresAt ? ` until ${formatCheckedTime(accountState.expiresAt)}` : ''}.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="provider-auth-button"
                        onClick={handleSignOutAccount}
                        disabled={accountBusy}
                      >
                        <LogOut size={13} />
                        Sign out
                      </button>
                    </div>
                  )}

                  {!accountState.authenticated && (
                    <div className="setting-row">
                      <div className="setting-label">
                        <div className="setting-label-title">Authorize Orion Desktop</div>
                        <div className="setting-label-desc">
                          Opens Orion Web in your browser and returns here after approval.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="provider-auth-button account-primary-button"
                        onClick={handleStartAccountAuth}
                        disabled={accountBusy || accountLoading}
                      >
                        <LogIn size={13} />
                        {accountBusy ? 'Opening...' : 'Sign in'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {settingsTab === 'general' && (
                <>
                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Theme</div>
                      <div className="setting-label-desc">Choose how Orion looks across the app.</div>
                    </div>
                    <select className="setting-select" defaultValue="system">
                      <option value="system">System</option>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Time format</div>
                      <div className="setting-label-desc">System default follows your browser or OS clock preference.</div>
                    </div>
                    <select className="setting-select" defaultValue="system">
                      <option value="system">System default</option>
                      <option value="12h">12-hour</option>
                      <option value="24h">24-hour</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Word wrap</div>
                      <div className="setting-label-desc">Wrap long lines in code blocks, tables, diffs, and file previews by default.</div>
                    </div>
                    <label className="provider-toggle" title="Word wrap">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Hide whitespace changes</div>
                      <div className="setting-label-desc">Set whether the diff panel ignores whitespace-only edits by default.</div>
                    </div>
                    <label className="provider-toggle" title="Hide whitespace">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Assistant output</div>
                      <div className="setting-label-desc">Show token-by-token output while a response is in progress.</div>
                    </div>
                    <label className="provider-toggle" title="Assistant output">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Provider update checks</div>
                      <div className="setting-label-desc">Check installed provider CLIs for newer available versions.</div>
                    </div>
                    <label className="provider-toggle" title="Provider update checks">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">New threads</div>
                      <div className="setting-label-desc">Pick the default workspace mode for newly created draft threads.</div>
                    </div>
                    <select className="setting-select" defaultValue="local">
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Archive confirmation</div>
                      <div className="setting-label-desc">Require a second click on the inline archive action before a thread is archived.</div>
                    </div>
                    <label className="provider-toggle" title="Archive confirmation">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <div className="setting-label-title">Delete confirmation</div>
                      <div className="setting-label-desc">Ask before deleting a thread and its chat history.</div>
                    </div>
                    <label className="provider-toggle" title="Delete confirmation">
                      <input type="checkbox" defaultChecked />
                      <span />
                    </label>
                  </div>
                </>
              )}

              {settingsTab === 'providers' && (
                <>
                  <div className="providers-toolbar">
                    <div className="providers-toolbar-actions">
                      {providerUpdateState?.checkedAt && (
                        <span className="providers-checked">
                          Checked {formatCheckedTime(providerUpdateState.checkedAt)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="providers-action-btn"
                        title="Refresh"
                        onClick={() => {
                          void refreshProviderUpdates();
                        }}
                        disabled={providerUpdatesRunning}
                      >
                        <RefreshCw size={13} className={providerUpdatesRunning ? 'spinning' : ''} />
                      </button>
                    </div>
                  </div>
                  {agentProviders.map((provider) => {
                      const Icon = provider.icon;
                      const status = providerStatusById.get(provider.id);
                      const providerEnabled =
                        normalizedProviderSettings[provider.id as ProviderId]?.enabled !== false;
                      const authenticated = status?.auth?.authenticated === true;
                      const canAuthenticate = status?.installed !== false && status?.auth?.status !== 'missing';
                      const version = status?.currentVersion
                        ? status.currentVersion.replace(/^v/i, '')
                        : null;
                      const hasUpdate = !!status?.updateAvailable;
                      const isEarly = provider.id === 'cursor' || provider.id === 'grok';

                      // Determine subtitle
                      let subtitle = '';
                      if (!providerEnabled) {
                        subtitle = `Disabled – ${provider.label} is disabled in settings.`;
                      } else if (status?.installed === false) {
                        const cmd = status?.command || provider.id;
                        subtitle = `Not found – ${provider.label} CLI (${cmd}) is not installed or not on PATH.`;
                      } else if (authenticated) {
                        const raw = status?.auth?.detail || 'Authenticated';
                        subtitle = /authenticated/i.test(raw) ? raw : `Authenticated as ${raw}`;
                      } else if (status?.auth?.authenticated === false) {
                        subtitle = 'Available – Installed and ready, but authentication could not be verified.';
                      } else if (status?.installed) {
                        subtitle = 'Available – Installed and ready.';
                      } else {
                        subtitle = status?.auth?.label || 'Unknown';
                      }

                      const revealed = !!revealedProviderEmails[provider.id];
                      const displaySubtitle = subtitle.replace(
                        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
                        (email) =>
                          revealed
                            ? email
                            : email.replace(/^(.{1,2}).*?(@.*)$/, '$1••••$2')
                      );
                      const hasEmailInSubtitle = /\S+@\S+/.test(subtitle);

                      const statusColor = !providerEnabled
                        ? 'yellow'
                        : status?.installed === false
                          ? 'red'
                          : 'green';

                      const optionDefs = providerOptionDefs[provider.id] ?? [];
                      const optionsExpanded = !!expandedProviderOptions[provider.id];
                      const optionValues =
                        providerSettings[provider.id as ProviderId]?.options ?? {};

                      return (
                        <div key={provider.id} className="provider-row-wrap">
                        <div className="provider-row">
                          <div className="provider-left">
                            <span className={`provider-status-dot ${statusColor}`} />
                            <span className="provider-icon-wrap">
                              <Icon size={18} />
                            </span>
                            <div className="provider-meta">
                              <div className="provider-head">
                                <span className="provider-name">{provider.label}</span>
                                {version && <span className="provider-version">v{version}</span>}
                                {hasUpdate && <span className="provider-update-arrow" title="Update available">↑</span>}
                                {isEarly && <span className="provider-badge early">Early Access</span>}
                              </div>
                              <div
                                className="provider-subtitle"
                                onClick={() => {
                                  if (hasEmailInSubtitle) {
                                    setRevealedProviderEmails((prev) => ({
                                      ...prev,
                                      [provider.id]: !prev[provider.id],
                                    }));
                                  }
                                }}
                                title={hasEmailInSubtitle && !revealed ? 'Click to reveal email' : undefined}
                              >
                                {displaySubtitle}
                              </div>
                            </div>
                          </div>

                          <div className="provider-right">
                            <button
                              type="button"
                              className={`provider-menu-btn ${optionsExpanded ? 'open' : ''}`}
                              title={optionsExpanded ? 'Hide options' : 'Provider options'}
                              onClick={() => {
                                setExpandedProviderOptions((prev) => ({
                                  ...prev,
                                  [provider.id]: !prev[provider.id],
                                }));
                              }}
                            >
                              <ChevronDown size={14} />
                            </button>

                            {canAuthenticate && (
                              <button
                                type="button"
                                className="provider-auth-button compact"
                                onClick={() => handleAuthenticateProvider(provider.id)}
                                disabled={authenticatingProviderId === provider.id}
                              >
                                {authenticated ? 'Re-authenticate' : 'Authenticate'}
                              </button>
                            )}

                            <label className="provider-toggle" title={providerEnabled ? 'Enabled' : 'Disabled'}>
                              <input
                                type="checkbox"
                                checked={providerEnabled}
                                onChange={(event) => {
                                  setProviderEnabled(provider.id as ProviderId, event.target.checked);
                                }}
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        {optionsExpanded && optionDefs.length > 0 && (
                          <div className="provider-options">
                            {optionDefs.map((option) => {
                              if (option.type === 'boolean') {
                                const checked = optionValues[option.key] === true;
                                return (
                                  <div key={option.key} className="provider-option">
                                    <span className="provider-option-text">
                                      <span className="provider-option-label">{option.label}</span>
                                      <span className="provider-option-description">{option.description}</span>
                                    </span>
                                    <label className="provider-toggle">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => {
                                          setProviderOptions(provider.id as ProviderId, {
                                            [option.key]: event.target.checked,
                                          } as Partial<ProviderRuntimeOptions>);
                                        }}
                                      />
                                      <span />
                                    </label>
                                  </div>
                                );
                              }

                              const value = optionValues[option.key];
                              return (
                                <div key={option.key} className="provider-option column">
                                  <span className="provider-option-text">
                                    <span className="provider-option-label">{option.label}</span>
                                    <span className="provider-option-description">{option.description}</span>
                                  </span>
                                  <input
                                    type="text"
                                    className="provider-option-input"
                                    placeholder={option.placeholder}
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={(event) => {
                                      setProviderOptions(provider.id as ProviderId, {
                                        [option.key]: event.target.value,
                                      } as Partial<ProviderRuntimeOptions>);
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </>
              )}

              {settingsTab === 'cosmetics' && (
                <div className="settings-empty-panel">
                  <div className="settings-panel-title">Cosmetics</div>
                  <div className="settings-muted">Coming soon.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!settingsOpen && (
        <div className="main-content">
        {/* ========== AGENTS TAB ========== */}
        {activeTab === 'agents' && (
          <>
            {/* Sidebar: Projects + Threads */}
            <div className="sidebar agents-sidebar">
              <div className="sidebar-content agents-sidebar-content">
                {projects.length === 0 && (
                  <div className="empty-state p-8 text-center">
                    <div className="empty-state-icon">
                      <FolderOpen size={28} />
                    </div>
                    <div className="empty-state-title">No projects yet</div>
                    <div className="text-xs text-[#6b6b74]">Add a folder to start agent threads</div>
                    <button onClick={handleAddProject} className="btn mt-3">
                      <Plus size={14} /> Add Project
                    </button>
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="sidebar-primary-actions">
                    <button type="button" className="sidebar-action-button primary" onClick={handleNewAgent}>
                      <SquarePen size={15} />
                      <span>New agent</span>
                    </button>
                    <div className="sidebar-search-wrap" ref={threadSearchRef}>
                      <button
                        type="button"
                        className={`sidebar-action-button ${threadSearchOpen ? 'active' : ''}`}
                        onClick={() => setThreadSearchOpen((open) => !open)}
                        aria-expanded={threadSearchOpen}
                      >
                        <Search size={15} />
                        <span>Search</span>
                      </button>
                      {threadSearchOpen && (
                        <div className="thread-search-panel">
                          <div className="thread-search-input">
                            <Search size={14} />
                            <input
                              autoFocus
                              value={threadSearchQuery}
                              onChange={(event) => setThreadSearchQuery(event.target.value)}
                              placeholder="Search threads..."
                            />
                          </div>
                          <div className="thread-search-results">
                            {threadSearchResults.map(({ entry }) => (
                              <button
                                key={entry.thread.id}
                                type="button"
                                className="thread-search-result"
                                onClick={() => {
                                  selectThread(entry.thread.id);
                                  setActiveTab('agents');
                                  setThreadSearchOpen(false);
                                }}
                              >
                                <span className="thread-search-title">{entry.thread.title}</span>
                                <span className="thread-search-meta">
                                  {entry.projectName} · {formatShortTime(getThreadActivityTime(entry.thread))}
                                </span>
                                <span className="thread-search-excerpt">
                                  {getThreadSearchExcerpt(entry, threadSearchQuery)}
                                </span>
                              </button>
                            ))}
                            {threadSearchResults.length === 0 && (
                              <div className="thread-search-empty">No matching threads</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="recent-agents-section">
                    <button
                      type="button"
                      className="sidebar-section-toggle"
                      onClick={() => setRecentAgentsOpen((open) => !open)}
                      aria-expanded={recentAgentsOpen}
                    >
                      <ChevronRight
                        size={12}
                        className={`sidebar-section-chevron ${recentAgentsOpen ? 'open' : ''}`}
                      />
                      <span>Recent agents</span>
                      {runningAgentCount > 0 && (
                        <span className="sidebar-section-count">{runningAgentCount}</span>
                      )}
                    </button>
                    {recentAgentsOpen && (
                      <>
                      <div className="threads-list recent-agents-list">
                        {recentThreads.length === 0 ? (
                          <div className="recent-agents-empty">No recent agents</div>
                        ) : (
                          (recentAgentsShowAll
                            ? recentThreads
                            : recentThreads.slice(0, THREADS_VISIBLE_LIMIT)
                          ).map((thread) => (
                            <div
                              key={thread.id}
                              className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                              onClick={() => selectThread(thread.id)}
                            >
                              <span className="thread-title">{thread.title}</span>
                              <span className="thread-project-tag thread-meta">
                                {projects.find((p) => p.id === thread.projectId)?.name}
                              </span>
                              <span className="thread-time thread-meta">
                                {thread.status === 'running' ? (
                                  <span className="thread-working-dot" title="Working" />
                                ) : (
                                  formatShortTime(getThreadActivityTime(thread))
                                )}
                              </span>
                              <button
                                type="button"
                                className="thread-delete"
                                title="Remove from Recent agents"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateThread(thread.id, { hiddenFromRecent: true });
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      {!recentAgentsShowAll && recentThreads.length > THREADS_VISIBLE_LIMIT && (
                        <button
                          type="button"
                          className="threads-show-more"
                          onClick={() => setRecentAgentsShowAll(true)}
                        >
                          Show more
                        </button>
                      )}
                      </>
                    )}
                  </div>
                )}

                {projects.length > 0 && (
                  <div className="sidebar-section-header">
                    <span className="sidebar-section-title">Projects</span>
                    <button
                      type="button"
                      className="sidebar-section-action"
                      title="Add project"
                      onClick={() => void handleAddProject()}
                    >
                      <FolderPlus size={14} />
                    </button>
                  </div>
                )}

                {sortedProjects.map((project) => {
                  const projectThreads = getProjectThreads(project.id);
                  const isActiveProject = selectedProject?.id === project.id;
                  const isCollapsed = collapsedProjects[project.id] ?? false;
                  const visibleLimit = threadListLimits[project.id] ?? THREADS_VISIBLE_LIMIT;
                  const visibleThreads = projectThreads.slice(0, visibleLimit);
                  const hasMoreThreads = projectThreads.length > visibleLimit;

                  return (
                    <div
                      key={project.id}
                      className={`project-section ${isActiveProject ? 'project-section-active' : ''}`}
                    >
                      <div className="project-section-header-row">
                        <button
                          type="button"
                          className="project-collapse-toggle"
                          title={isCollapsed ? 'Expand threads' : 'Collapse threads'}
                          aria-expanded={!isCollapsed}
                          onClick={() =>
                            setCollapsedProjects((prev) => ({
                              ...prev,
                              [project.id]: !isCollapsed,
                            }))
                          }
                        >
                          <ChevronRight
                            size={12}
                            className={`sidebar-section-chevron ${isCollapsed ? '' : 'open'}`}
                          />
                        </button>
                        <button
                          type="button"
                          className="project-section-header"
                          onClick={() => selectProject(project.id)}
                          title={project.path}
                        >
                          <ProjectIcon projectPath={project.path} size={13} />
                          <span className="truncate">{project.name}</span>
                          {isCollapsed && projectThreads.length > 0 && (
                            <span className="sidebar-section-count">{projectThreads.length}</span>
                          )}
                        </button>
                        <div
                          className="project-menu-wrap"
                          ref={projectMenuOpenId === project.id ? projectMenuRef : undefined}
                        >
                          <button
                            type="button"
                            className="project-options-trigger"
                            title="Project options"
                            aria-label={`Options for ${project.name}`}
                            aria-haspopup="menu"
                            aria-expanded={projectMenuOpenId === project.id}
                            onClick={() =>
                              setProjectMenuOpenId((open) =>
                                open === project.id ? null : project.id
                              )
                            }
                          >
                            <Ellipsis size={13} />
                          </button>
                          {projectMenuOpenId === project.id && (
                            <div className="thread-menu project-menu" role="menu">
                              <button
                                type="button"
                                className="project-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuOpenId(null);
                                  const newName = prompt('Rename project', project.name);
                                  if (newName?.trim()) renameProject(project.id, newName.trim());
                                }}
                              >
                                <SquarePen size={13} /> Rename
                              </button>
                              <button
                                type="button"
                                className="project-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuOpenId(null);
                                  if (
                                    confirm(
                                      `Remove "${project.name}" and its threads? Files on disk are not affected.`
                                    )
                                  ) {
                                    removeProject(project.id);
                                  }
                                }}
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="project-new-thread"
                          title={`New thread in ${project.name}`}
                          onClick={() => handleCreateThread(project.id)}
                        >
                          <SquarePen size={13} />
                        </button>
                      </div>

                      {!isCollapsed && (
                        <>
                        <div className="threads-list">
                          {projectThreads.length === 0 ? (
                            <button
                              type="button"
                              className="thread-item thread-item-empty"
                              onClick={() => handleCreateThread(project.id)}
                            >
                              <span className="thread-title">New thread</span>
                            </button>
                          ) : (
                            visibleThreads.map((thread) => (
                              <div
                                key={thread.id}
                                className={`thread-item ${selectedThreadId === thread.id ? 'selected' : ''}`}
                                onClick={() => selectThread(thread.id)}
                              >
                                <span className="thread-title">{thread.title}</span>
                                <span className="thread-time thread-meta">
                                  {thread.status === 'running' ? (
                                    <span className="thread-working-dot" title="Working" />
                                  ) : (
                                    formatShortTime(getThreadActivityTime(thread))
                                  )}
                                </span>
                                <button
                                  type="button"
                                  className="thread-delete"
                                  title="Delete thread"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Delete this thread?')) {
                                      deleteThread(thread.id);
                                    }
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
  
                        {hasMoreThreads && (
                          <button
                            type="button"
                            className="threads-show-more"
                            onClick={() =>
                              setThreadListLimits((prev) => ({
                                ...prev,
                                [project.id]: projectThreads.length,
                              }))
                            }
                          >
                            Show more
                          </button>
                        )}
                        </>
                      )}

                    </div>
                  );
                })}
              </div>
              {renderSidebarFooter()}
            </div>

            {/* Main Panel: Thread view */}
            <div className="panel agents-panel">
              {!selectedThread ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <Bot size={30} />
                  </div>
                  <div className="empty-state-title">Select a thread</div>
                  <div className="text-xs text-[#6b6b74]">Pick a conversation or start a new one</div>
                  {projects.length > 0 && (
                    <button
                      onClick={() => handleCreateThread(selectedProject?.id ?? projects[0].id)}
                      className="btn mt-2"
                    >
                      <Plus size={15} /> Start new thread
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="panel-content">
                    <div className="chat-scroll" ref={chatScrollRef} onScroll={handleChatScroll}>
                      <div className="chat-container">
                        {selectedThread.messages.length === 0 && (
                          <AgentsWelcome projectName={selectedThreadProject?.name} />
                        )}

                        {selectedThread.messages.map((msg) => (
                          <ChatMessage key={msg.id} message={msg} />
                        ))}

                        {isSending && selectedThread.messages.at(-1)?.role !== 'agent' && (
                          <div className="message agent opacity-70">Starting agent...</div>
                        )}

                        {(selectedThread.queuedMessages ?? []).map((queued) => (
                          <div key={queued.id} className="message user queued">
                            {queued.text && (
                              <div className="whitespace-pre-wrap break-words">{queued.text}</div>
                            )}
                            {(queued.attachments?.length ?? 0) > 0 && (
                              <div className="message-attachments">
                                {queued.attachments!.map((attachment) => (
                                  <div
                                    key={attachment.id}
                                    className="message-attachment"
                                    title={attachment.path}
                                  >
                                    <img
                                      src={imageAttachmentSrc(attachment)}
                                      alt={attachment.name}
                                    />
                                    <span>{attachment.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="queued-message-bar">
                              <span className="queued-message-badge">Queued</span>
                              {steerSupported && (
                                <button
                                  type="button"
                                  className="queued-message-action steer"
                                  onClick={() => steerQueuedMessage(queued.id)}
                                  disabled={!steerReady}
                                  title={
                                    steerReady
                                      ? 'Interrupt the agent and send this now'
                                      : 'Steer becomes available once the agent reports its session'
                                  }
                                >
                                  <Zap size={12} />
                                  Steer now
                                </button>
                              )}
                              <button
                                type="button"
                                className="queued-message-action remove"
                                onClick={() =>
                                  removeQueuedThreadMessage(selectedThread.id, queued.id)
                                }
                                title="Remove queued message"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    </div>

                    <div className="chat-input-area">
                      <div className="composer-shell">
                        {chatAttachments.length > 0 && (
                          <div className="composer-attachments">
                            {chatAttachments.map((attachment) => (
                              <div key={attachment.id} className="composer-attachment" title={attachment.path}>
                                <img src={imageAttachmentSrc(attachment)} alt={attachment.name} />
                                <span className="composer-attachment-meta">
                                  <span className="composer-attachment-name">{attachment.name}</span>
                                  <span className="composer-attachment-size">
                                    {formatAttachmentSize(attachment.size)}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="composer-attachment-remove"
                                  onClick={() => removeChatAttachment(attachment.id)}
                                  title="Remove image"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <textarea
                          ref={chatInputRef}
                          className="chat-input min-h-[52px]"
                          placeholder={
                            isSending
                              ? steerSupported
                                ? 'Queue a follow-up (⏎) or steer the agent now (⌘⏎)…'
                                : 'Queue a follow-up — sends when the agent finishes (⏎)…'
                              : chatAttachments.length > 0
                                ? 'Ask something about the attached image...'
                                : 'Describe what you want the agent to do...'
                          }
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={handleChatKeyDown}
                          rows={2}
                        />
                        <div className="composer-controls">
                          <div className="model-picker-anchor" ref={modelPickerRef}>
                            <button
                              className="model-trigger"
                              onClick={() => {
                                setModelPickerOpen((open) => {
                                  if (!open) {
                                    setActiveProviderTab(selectedAgentModel.providerId);
                                  }
                                  return !open;
                                });
                              }}
                              disabled={isSending}
                            >
                              {selectedAgentModel && (() => {
                                const ProviderIcon =
                                  agentProviders.find((provider) => provider.id === selectedAgentModel.providerId)
                                    ?.icon ?? Play;
                                return <ProviderIcon size={15} />;
                              })()}
                              <span>{selectedAgentModel?.label ?? 'Select model'}</span>
                              <ChevronDown size={14} className={`model-trigger-chevron ${modelPickerOpen ? 'open' : ''}`} />
                            </button>

                            {modelPickerOpen && (
                              <div className="model-picker-popover">
                              <div className="model-provider-rail">
                                {agentProviders.map((provider) => {
                                  const Icon = provider.icon;
                                  return (
                                    <button
                                      key={provider.id}
                                      className={`provider-rail-button ${activeProviderTab === provider.id ? 'active' : ''}`}
                                      onClick={() => setActiveProviderTab(provider.id)}
                                      title={provider.label}
                                    >
                                      <Icon size={19} />
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="model-picker-panel">
                                <div className="model-search">
                                  <Search size={16} />
                                  <input
                                    autoFocus
                                    value={modelSearch}
                                    onChange={(event) => setModelSearch(event.target.value)}
                                    placeholder="Search models..."
                                  />
                                </div>
                                <div className="model-list">
                                  {visibleAgentModels.map((model) => {
                                    const ProviderIcon =
                                      agentProviders.find((provider) => provider.id === model.providerId)
                                        ?.icon ?? Play;
                                    const selected = selectedThread.modelId === model.id;
                                    return (
                                      <button
                                        key={model.id}
                                        className={`model-row ${selected ? 'selected' : ''}`}
                                        onClick={() => {
                                          updateThread(selectedThread.id, { modelId: model.id });
                                          setModelPickerOpen(false);
                                          setModelSearch('');
                                          if (model.providerId !== 'codex' && model.providerId !== 'claude') {
                                            setCodexSettingsOpen(false);
                                          }
                                        }}
                                        disabled={model.available === false}
                                        title={model.unavailableReason ?? model.slug}
                                      >
                                        <ProviderIcon size={18} />
                                        <span className="model-row-text">
                                          <span className="model-row-label">{model.label}</span>
                                          <span className="model-row-provider">{model.providerLabel}</span>
                                        </span>
                                        {model.shortcut && <span className="model-shortcut">{model.shortcut}</span>}
                                        {selected && <Check size={15} />}
                                      </button>
                                    );
                                  })}
                                  {visibleAgentModels.length === 0 && (
                                    <div className="model-empty">No models</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {shouldShowAgentSettings && (
                          <div className="codex-settings-anchor" ref={codexSettingsRef}>
                            <button
                              className="codex-settings-trigger"
                              onClick={() => setCodexSettingsOpen((open) => !open)}
                              disabled={isSending}
                              title={
                                selectedAgentModel?.providerId === 'claude'
                                  ? 'Claude reasoning and context window'
                                  : 'Codex reasoning and service tier'
                              }
                            >
                              <span>
                                {selectedAgentModel?.providerId === 'claude'
                                  ? selectedClaudeReasoningLabel
                                  : selectedCodexReasoningLabel}
                              </span>
                              <span className="control-dot">·</span>
                              <span>
                                {selectedAgentModel?.providerId === 'claude'
                                  ? selectedClaudeContextWindowLabel
                                  : selectedCodexServiceTierLabel}
                              </span>
                              <ChevronDown
                                size={14}
                                className={`model-trigger-chevron ${codexSettingsOpen ? 'open' : ''}`}
                              />
                            </button>

                            {codexSettingsOpen && (
                              <div className="codex-settings-popover">
                                {selectedAgentModel?.providerId === 'claude' ? (
                                  <>
                                    <div className="codex-settings-section">
                                      <div className="codex-settings-heading">Reasoning</div>
                                      <div className="codex-settings-options">
                                        {claudeReasoningOptions.map((option) => {
                                          const selected = selectedClaudeReasoning === option.value;
                                          const isDefault = option.value === selectedClaudeDefaultReasoning;
                                          return (
                                            <button
                                              key={option.value}
                                              className={`codex-settings-row ${selected ? 'selected' : ''}`}
                                              onClick={() =>
                                                updateThread(selectedThread.id, {
                                                  claudeReasoningEffort: option.value as ClaudeReasoningEffort,
                                                })
                                              }
                                            >
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{isDefault ? ' (default)' : ''}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <div className="codex-settings-divider" />

                                    <div className="codex-settings-section">
                                      <div className="codex-settings-heading">Context Window</div>
                                      <div className="codex-settings-options">
                                        {claudeContextWindowOptions.map((option) => {
                                          const selected = effectiveClaudeContextWindow === option.value;
                                          const oneMillionOnly =
                                            !!selectedAgentModel &&
                                            claudeOneMillionOnlyModelSlugs.has(selectedAgentModel.slug);
                                          const disabled = oneMillionOnly && option.value === '200k';
                                          return (
                                            <button
                                              key={option.value}
                                              className={`codex-settings-row ${selected ? 'selected' : ''}`}
                                              onClick={() =>
                                                updateThread(selectedThread.id, {
                                                  claudeContextWindow: option.value as ClaudeContextWindow,
                                                })
                                              }
                                              disabled={disabled}
                                              title={
                                                disabled && selectedAgentModel
                                                  ? `${selectedAgentModel.label} always uses 1M context`
                                                  : undefined
                                              }
                                            >
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{option.value === defaultClaudeContextWindow && !oneMillionOnly ? ' (default)' : ''}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="codex-settings-section">
                                      <div className="codex-settings-heading">Reasoning</div>
                                      <div className="codex-settings-options">
                                        {codexReasoningOptions.map((option) => {
                                          const selected = selectedCodexReasoning === option.value;
                                          return (
                                            <button
                                              key={option.value}
                                              className={`codex-settings-row ${selected ? 'selected' : ''}`}
                                              onClick={() =>
                                                updateThread(selectedThread.id, {
                                                  codexReasoningEffort: option.value as CodexReasoningEffort,
                                                })
                                              }
                                            >
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{option.default ? ' (default)' : ''}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <div className="codex-settings-divider" />

                                    <div className="codex-settings-section">
                                      <div className="codex-settings-heading">Service Tier</div>
                                      <div className="codex-settings-options">
                                        {codexServiceTierOptions.map((option) => {
                                          const selected = selectedCodexServiceTier === option.value;
                                          return (
                                            <button
                                              key={option.value}
                                              className={`codex-settings-row ${selected ? 'selected' : ''}`}
                                              onClick={() =>
                                                updateThread(selectedThread.id, {
                                                  codexServiceTier: option.value as CodexServiceTier,
                                                })
                                              }
                                            >
                                              <span className="settings-check">
                                                {selected && <Check size={17} />}
                                              </span>
                                              <span>{option.label}{option.default ? ' (default)' : ''}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <label className="access-select">
                          <Shield size={15} />
                          <select
                            value={selectedThread.accessMode ?? 'full-access'}
                            onChange={(event) =>
                              updateThread(selectedThread.id, {
                                accessMode: event.target.value as typeof selectedThread.accessMode,
                              })
                            }
                            disabled={isSending}
                          >
                            <option value="read-only">Read only</option>
                            <option value="workspace-write">Workspace write</option>
                            <option value="full-access">Full access</option>
                          </select>
                          <ChevronDown size={13} />
                        </label>

                        {isSending ? (
                          <>
                            {(chatInput.trim() || chatAttachments.length > 0) && (
                              <>
                                <button
                                  className="send-button"
                                  onClick={sendMessage}
                                  title="Queue — sends when the current run finishes (⏎)"
                                >
                                  <ListPlus size={15} />
                                </button>
                                {steerSupported && (
                                  <button
                                    className="send-button steer"
                                    onClick={steerActiveAgent}
                                    disabled={!steerReady}
                                    title={
                                      steerReady
                                        ? 'Steer — interrupt the agent and redirect it now (⌘⏎)'
                                        : 'Steer becomes available once the agent reports its session'
                                    }
                                  >
                                    <Zap size={14} />
                                  </button>
                                )}
                              </>
                            )}
                            <button className="send-button stop" onClick={stopActiveAgent} title="Stop agent">
                              <Square size={14} fill="currentColor" />
                            </button>
                          </>
                        ) : (
                          <button
                            className="send-button"
                            onClick={sendMessage}
                            disabled={
                              (!chatInput.trim() && chatAttachments.length === 0) ||
                              selectedAgentModel?.available === false
                            }
                            title="Send"
                          >
                            <ArrowUp size={16} strokeWidth={2.5} />
                          </button>
                        )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ========== CODE TAB ========== */}
        {activeTab === 'code' && (
          <>
            {/* File Explorer Sidebar */}
            <div className="sidebar">
              <div className="sidebar-header">
                <span>Explorer</span>
                <div className="flex gap-1">
                  <button
                    onClick={handleOpenFolderForCode}
                    className="btn secondary small"
                    title="Open folder"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={() => {
                      const p = selectedProject ?? projects[0];
                      if (p) {
                        setWorkspacePath(p.path);
                        closeAllFiles();
                        toast.info(`Opened ${p.name}`);
                      } else {
                        handleOpenFolderForCode();
                      }
                    }}
                    className="btn secondary small"
                    title="Use selected project as workspace"
                  >
                    <Folder size={13} />
                  </button>
                  <button
                    onClick={() => {
                      if (workspacePath) loadRoot(workspacePath);
                    }}
                    className="btn secondary small"
                    title="Refresh"
                  >
                    ↻
                  </button>
                </div>
              </div>

              <div className="sidebar-content">
                {!treeRoot && (
                  <div className="empty-state p-6">
                    <Folder size={32} />
                    <div className="mt-1">No folder open</div>
                    <button onClick={handleOpenFolderForCode} className="btn mt-3">
                      Open Folder
                    </button>
                    {projects.length > 0 && (
                      <div className="mt-4 text-[11px] text-[#777]">
                        Or select a project in Agents tab
                      </div>
                    )}
                  </div>
                )}

                {treeRoot && (
                  <div className="file-tree pt-1">
                    {treeItems.map((item) => (
                      <FileTreeNode
                        key={item.path}
                        item={item}
                        onFileClick={handleOpenFile}
                        activePath={activeFilePath}
                        loadChildren={loadChildren}
                        rootPath={treeRoot}
                        refreshToken={treeRefreshToken}
                        onRequestDelete={handleDeleteTreeItem}
                        onRenamed={handleTreeItemRenamed}
                      />
                    ))}
                  </div>
                )}
              </div>
              {renderSidebarFooter()}
            </div>

            {/* Editor Panel */}
            <div className="panel">
              {/* Editor Tabs */}
              {openFiles.length > 0 && (
                <div className="editor-tabs">
                  {openFiles.map((file) => {
                    const fileName = file.path.split(/[\\/]/).pop() || file.path;
                    const isActive = file.path === activeFilePath;
                    return (
                      <div
                        key={file.path}
                        className={`editor-tab ${isActive ? 'active' : ''}`}
                        onClick={() => setActiveFile(file.path)}
                        title={file.path}
                      >
                        <span className="truncate">{fileName}</span>
                        {file.isDirty && <span className="text-[#f4a261]">●</span>}
                        <span
                          className="close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeFile(file.path);
                          }}
                        >
                          <X size={13} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="editor-container" ref={editorContainerRef}>
                {activeFilePath && activeFile ? (
                  <Editor
                    height="100%"
                    language={currentLanguage}
                    value={currentEditorValue}
                    onChange={handleEditorChange}
                    theme="vs-dark"
                    options={{
                      fontSize: 13,
                      minimap: { enabled: true },
                      scrollBeyondLastLine: false,
                      padding: { bottom: editorBottomPadding },
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                    }}
                  />
                ) : (
                  <div className="empty-state">
                    <FileText size={42} className="opacity-30" />
                    <div>Open a file from the explorer</div>
                    <div className="text-xs mt-1 text-[#555]">
                      VSCode-powered editor (Monaco)
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
};

export default App;
