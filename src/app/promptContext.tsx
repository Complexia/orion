import { type ImageAttachment, type LinkedBoardTask, type OrchestrationRoleId, type Thread } from '../store';
import { type AgentModel } from '../agentCatalog';

export const linkedTaskFromBoardTask = (task: OrionBoardTask): LinkedBoardTask => ({
  id: task.id,
  title: task.title,
  description: task.description,
  attachments: (task.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    name: attachment.fileName,
    mimeType: attachment.contentType,
    size: attachment.size,
    path: attachment.localPath,
    downloadError: attachment.downloadError,
  })),
  injected: false,
});

export const linkedTaskMediaAttachments = (task: LinkedBoardTask): ImageAttachment[] =>
  (task.attachments ?? [])
    .filter(
      (attachment) =>
        Boolean(attachment.path) &&
        (attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/'))
    )
    .map((attachment) => ({
      id: `board-${task.id}-${attachment.id}`,
      name: attachment.name,
      path: attachment.path!,
      mimeType: attachment.mimeType,
      size: attachment.size,
    }));

// Context block prepended to the first agent turn of a thread linked to an
// Orion board task, so the agent knows what card it's working on and can read
// local copies of every board attachment.
export const buildLinkedTaskContext = (task: LinkedBoardTask, hasUserMessage: boolean) => {
  const lines = [
    '## Linked task from the Orion board',
    `Title: ${task.title}`,
  ];
  const description = task.description.trim();
  if (description) {
    lines.push('', 'Description:', description);
  }
  const taskAttachments = task.attachments ?? [];
  if (taskAttachments.length > 0) {
    lines.push('', 'Attachments:');
    taskAttachments.forEach((attachment, index) => {
      if (attachment.path) {
        lines.push(`${index + 1}. ${attachment.name} (${attachment.mimeType}): ${attachment.path}`);
      } else {
        lines.push(
          `${index + 1}. ${attachment.name} (${attachment.mimeType}): unavailable locally${
            attachment.downloadError ? ` — ${attachment.downloadError}` : ''
          }`
        );
      }
    });
    lines.push('', 'Treat these attachments as part of the task context and inspect them as needed.');
  }
  if (hasUserMessage) {
    lines.push(
      '',
      'This thread is linked to the board task above; treat it as the goal of the work. The user message follows.',
      '',
      '---'
    );
  } else {
    lines.push(
      '',
      'This thread is linked to the board task above; treat it as the goal of the work and carry it out.'
    );
  }
  return lines.join('\n');
};

// Codex's dedicated reviewer is displayed inline on the resumed thread, but
// the reviewer model itself does not inherit prior turns. Carry Orion's recent
// transcript explicitly so references such as "the issues you found" resolve
// the same way they do in the surrounding chat.
export const REVIEW_THREAD_CONTEXT_MAX_CHARS = 80_000;
export const buildReviewThreadContext = (thread: Thread) => {
  const entries = thread.messages
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'agent') && message.content.trim().length > 0
    )
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      const attachments = (message.attachments ?? [])
        .map((attachment) => `${attachment.name}: ${attachment.path}`)
        .join('\n');
      return `${role}:\n${message.content.trim()}${
        attachments ? `\n\nAttachments:\n${attachments}` : ''
      }`;
    });

  const selected: string[] = [];
  let selectedChars = 0;
  let truncated = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const separatorChars = selected.length > 0 ? 6 : 0;
    if (selectedChars + separatorChars + entry.length > REVIEW_THREAD_CONTEXT_MAX_CHARS) {
      truncated = true;
      if (selected.length === 0) {
        selected.push(entry.slice(-REVIEW_THREAD_CONTEXT_MAX_CHARS));
      }
      break;
    }
    selected.unshift(entry);
    selectedChars += separatorChars + entry.length;
  }

  const sections: string[] = [];
  if (thread.linkedTask) sections.push(buildLinkedTaskContext(thread.linkedTask, false));
  if (selected.length > 0) {
    sections.push(
      [
        '[Orion thread context]',
        'These messages preceded the review. Use them to resolve references and understand the intent behind the changes.',
        ...(truncated ? ['Earlier messages were omitted to fit the review context limit.'] : []),
        '',
        selected.join('\n\n---\n\n'),
        '[/Orion thread context]',
      ].join('\n')
    );
  }
  return sections.join('\n\n');
};

// Human labels for the Orion orchestrator's delegation roles — shared by the
// Settings → Orchestration tab and the orchestration payload/prompt so the
// names the user configures are the names the orchestrator sees.
export const orchestrationRoleMeta: Array<{
  id: OrchestrationRoleId;
  label: string;
  desc: string;
  /** How the role is named inside the [Orion orchestration] prompt block. */
  promptLabel: string;
}> = [
  {
    id: 'mainDriver',
    label: 'Main driver',
    desc: 'Coordinates the work, talks to you, and delegates to the other models',
    promptLabel: 'main driver',
  },
  {
    id: 'computerUse',
    label: 'Computer use',
    desc: 'Desktop control and GUI automation tasks',
    promptLabel: 'computer use',
  },
  {
    id: 'exploring',
    label: 'Exploring',
    desc: 'Codebase exploration, research, and read-only investigation',
    promptLabel: 'exploring',
  },
  {
    id: 'implementation',
    label: 'Implementation',
    desc: 'Code changes and implementation work',
    promptLabel: 'implementation',
  },
  {
    id: 'imageVideoGen',
    label: 'Image / video generation',
    desc: 'Generating images, video, and other media assets',
    promptLabel: 'image/video generation',
  },
];

export const accessModeOptions: Array<{
  value: 'read-only' | 'workspace-write' | 'full-access';
  label: string;
}> = [
  { value: 'read-only', label: 'Read only' },
  { value: 'workspace-write', label: 'Workspace write' },
  { value: 'full-access', label: 'Full access' },
];

// Context block prepended to every orchestrated turn. main.js writes managed
// CLAUDE.md/AGENTS.md sections that tell the agent orchestration applies when
// the prompt contains exactly this [Orion orchestration] marker.
export const buildOrchestrationContext = (
  roles: Array<{ role: string; modelLabel: string; slug: string }>,
  generalInstructions: string,
  accessMode: 'read-only' | 'workspace-write' | 'full-access'
) => {
  const roleSummary = orchestrationRoleMeta
    .filter((meta) => meta.id !== 'mainDriver')
    .map((meta) => {
      const entry = roles.find((role) => role.role === meta.id);
      return entry ? `${meta.promptLabel} → ${entry.modelLabel} (${entry.slug})` : null;
    })
    .filter(Boolean)
    .join('; ');
  const lines = [
    '[Orion orchestration]',
    'You are the Orion orchestrator (main driver). Delegate specialized work to the configured role models and integrate their results; see the "Orion Orchestration" section of CLAUDE.md / AGENTS.md for delegation mechanics.',
    `Roles: ${roleSummary}.`,
    'Prefer the spawn_subagent tool when available; otherwise run the provider CLIs directly. Report progress and the integrated final result yourself.',
  ];
  if (accessMode === 'read-only') {
    lines.push(
      'Access mode: Read only. Every delegated CLI must remain read-only: codex uses `--sandbox read-only`; claude uses `--permission-mode plan`; cursor uses `--mode plan --sandbox enabled`; grok uses `--permission-mode plan`. Never use bypass, force, auto-approve, or browser-control flags. Kimi may only be delegated through the `spawn_subagent` tool, whose child inherits this access mode; never invoke kimi prompt mode directly because it auto-approves every tool and cannot be made read-only.'
    );
  } else if (accessMode === 'workspace-write') {
    lines.push(
      'Access mode: Workspace write. Delegated CLIs must remain sandboxed to the workspace: codex uses `--sandbox workspace-write`; claude uses `--permission-mode acceptEdits`; cursor uses `--sandbox enabled --force`; grok uses `--permission-mode acceptEdits`. Do not disable a sandbox or use unrestricted bypass flags. Kimi may only be delegated through the `spawn_subagent` tool, whose child inherits this access mode; never invoke kimi prompt mode directly because it auto-approves every tool and cannot be sandboxed.'
    );
  } else {
    lines.push(
      'Access mode: Full access. Delegated CLIs may use their explicit bypass/full-access flags.'
    );
  }
  const trimmedInstructions = generalInstructions.trim();
  if (trimmedInstructions) lines.push(trimmedInstructions);
  lines.push('[/Orion orchestration]');
  return lines.join('\n');
};

export type ModelMention = {
  modelId: string;
  providerId: string;
  slug: string;
  label: string;
  token: string;
};

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Slugs are normally the friendliest mention token. When two providers expose
// the same slug, qualify it with the provider id so selecting one model cannot
// silently mention both (for example Claude and Cursor's claude-opus-4-8).
export const modelMentionToken = (model: AgentModel, models: AgentModel[]) =>
  models.some(
    (candidate) =>
      candidate.id !== model.id && candidate.slug.toLowerCase() === model.slug.toLowerCase()
  )
    ? model.id
    : model.slug;

// Scan the user's original text for model mention tokens against the catalog.
// The token must not continue into a longer slug/id-like value (so
// "@gpt-5.4-mini" never also matches "@gpt-5.4").
export const parseModelMentions = (text: string, models: AgentModel[]): ModelMention[] => {
  if (!text.includes('@')) return [];
  const mentions: ModelMention[] = [];
  for (const model of models) {
    // The Orion orchestrator is not a delegation target — "@orion" is never a mention.
    if (model.providerId === 'orion') continue;
    const token = modelMentionToken(model, models);
    const pattern = new RegExp(
      `(?:^|\\s)@${escapeRegExp(token)}(?![A-Za-z0-9._:/-])`,
      'i'
    );
    if (pattern.test(text)) {
      mentions.push({
        modelId: model.id,
        providerId: model.providerId,
        slug: model.slug,
        label: model.label,
        token,
      });
    }
  }
  return mentions;
};

// Context block prepended when the user @-mentions models, on any thread —
// mentions work when talking to a specific model too, not just Orion.
export const buildModelMentionsContext = (mentions: ModelMention[]) =>
  [
    '[Model mentions]',
    'The user referenced these models with @-mentions. When asked to use a mentioned model, delegate that work to it with the `spawn_subagent` tool from Orion\'s MCP server (the fully-qualified name varies by provider, for example mcp__orion__spawn_subagent, orion.spawn_subagent, or a plugin-prefixed equivalent), passing model: "<modelId>" and a self-contained prompt. The task runs as a visible Orion subthread and the call returns its final report — integrate that into your work. Do NOT hunt for or invoke that model\'s CLI yourself unless no `spawn_subagent` tool is genuinely present in your tool list.',
    ...mentions.map((mention) => `- @${mention.token} → ${mention.label} (${mention.modelId})`),
    '[/Model mentions]',
  ].join('\n');

export const linkedTaskStatusLabel = (status?: string) => {
  switch (status) {
    case 'running':
      return 'In progress';
    case 'finished':
      return 'In review';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    default:
      return 'Linked';
  }
};
