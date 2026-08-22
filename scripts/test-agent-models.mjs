import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  agentModels,
  cursorFrontierModelSlugs,
  cursorFallbackModels,
  openCodeFallbackModels,
  parseCursorModelsOutput,
  parseOpenCodeModelsOutput,
} from '../src/main/models.js';
import { validateAgentWorkspace } from '../src/main/agent-run-preflight.js';

const grokModels = agentModels.filter((model) => model.providerId === 'grok');
assert.deepEqual(
  grokModels.map(({ slug, shortcut }) => ({ slug, shortcut })),
  [
    { slug: 'grok-4.6', shortcut: '⌘1' },
    { slug: 'grok-4.5', shortcut: '⌘2' },
    { slug: 'grok-composer-2.5-fast', shortcut: '⌘3' },
  ],
  'the Grok provider should expose Grok 4.6 first without removing existing models'
);

const parsed = parseCursorModelsOutput(`
Available models

auto - Auto (current, default)
gpt-5.3-codex-low - Codex 5.3 Low
cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast
composer-2.5 - Composer 2.5

Tip: use --model <id> to switch.
`);

assert.deepEqual(
  parsed.map(({ slug, label, favorite }) => ({ slug, label, favorite })),
  [
    { slug: 'auto', label: 'Auto', favorite: true },
    {
      slug: 'cursor-grok-4.6-high-fast',
      label: 'Cursor Grok 4.6 Fast',
      favorite: true,
    },
    { slug: 'composer-2.5', label: 'Composer 2.5', favorite: true },
    { slug: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low', favorite: false },
  ],
  'Cursor CLI discovery should parse current rows and promote primary models above legacy rows'
);

const frontierFixture = parseCursorModelsOutput(`
gpt-5.3-codex-low - Codex 5.3 Low
gemini-3.6-flash-high - Gemini 3.6 Flash
gpt-5.6-terra-high - GPT-5.6 Terra 1M High
claude-opus-5-thinking-high - Opus 5 1M Thinking
cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast
auto - Auto (default)
future-model - Future Model
`);
assert.deepEqual(
  frontierFixture.map((model) => model.slug),
  [
    'auto',
    'cursor-grok-4.6-high-fast',
    'claude-opus-5-thinking-high',
    'gpt-5.6-terra-high',
    'gemini-3.6-flash-high',
    'gpt-5.3-codex-low',
    'future-model',
  ],
  'available frontier representatives should lead while all other CLI models retain their order'
);
assert.ok(
  cursorFrontierModelSlugs.includes('gpt-5.6-terra-high') &&
    cursorFrontierModelSlugs.includes('gemini-3.6-flash-high'),
  'the promoted Cursor set should cover current GPT and Gemini frontier families'
);

assert.ok(
  cursorFallbackModels.some(
    (model) =>
      model.slug === 'cursor-grok-4.6-high-fast' && model.label === 'Cursor Grok 4.6 Fast'
  ),
  'the authenticated-account fallback should include Cursor Grok 4.6'
);
assert.ok(
  cursorFallbackModels.some((model) => model.slug === 'claude-opus-5-thinking-high'),
  'the fallback should include Cursor Opus 5'
);
assert.ok(
  cursorFallbackModels.some((model) => model.slug === 'gpt-5.6-sol-high'),
  'the fallback should include Cursor GPT-5.6 Sol'
);

const openCodeModels = parseOpenCodeModelsOutput(`
\u001b[32mopencode/big-pickle\u001b[0m
anthropic/claude-sonnet-4-6
openai/gpt-5.6
anthropic/claude-sonnet-4-6
Error: ignored diagnostic
`);
assert.deepEqual(
  openCodeModels.map(({ id, slug, label, favorite }) => ({ id, slug, label, favorite })),
  [
    {
      id: 'opencode:opencode/big-pickle',
      slug: 'opencode/big-pickle',
      label: 'Big Pickle',
      favorite: true,
    },
    {
      id: 'opencode:anthropic/claude-sonnet-4-6',
      slug: 'anthropic/claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Anthropic)',
      favorite: false,
    },
    {
      id: 'opencode:openai/gpt-5.6',
      slug: 'openai/gpt-5.6',
      label: 'GPT 5.6 (OpenAI)',
      favorite: false,
    },
  ],
  'OpenCode discovery should keep every provider/model slug, remove duplicates, and disambiguate labels'
);
assert.equal(openCodeFallbackModels.length, 7, 'OpenCode should retain its built-in Zen catalog as fallback');
assert.deepEqual(
  openCodeFallbackModels.slice(0, 3).map(({ label, reasoningVariants }) => ({ label, reasoningVariants })),
  [
    { label: '0x Alpha Free (Unlimited)', reasoningVariants: ['low', 'high', 'max'] },
    { label: 'Nemotron 3.5 Lightning Free', reasoningVariants: undefined },
    {
      label: 'Muse Spark 1.2 Free',
      reasoningVariants: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    },
  ],
  'the fallback should mirror OpenCode display names, newest-first order, and model variants'
);
assert.ok(
  !openCodeFallbackModels.some((model) => model.slug === 'anthropic/claude-sonnet-4-6'),
  'the OpenCode fallback must not advertise an unconfigured Anthropic model'
);

const verboseOpenCodeModels = parseOpenCodeModelsOutput(`
opencode/big-pickle
{
  "name": "Big Pickle",
  "release_date": "2025-10-17",
  "variants": {}
}
opencode/muse-spark-1.2-contributor-free
{
  "name": "Muse Spark 1.2 Free",
  "release_date": "2026-08-05",
  "variants": { "minimal": {}, "low": {}, "medium": {}, "high": {}, "xhigh": {} }
}
opencode/x-preview-f-free
{
  "name": "Ox Alpha Free (Unlimited)",
  "release_date": "2026-08-21",
  "variants": { "low": {}, "high": {}, "max": {} }
}
`);
assert.deepEqual(
  verboseOpenCodeModels.map(({ slug, label, reasoningVariants }) => ({
    slug,
    label,
    reasoningVariants,
  })),
  [
    {
      slug: 'opencode/x-preview-f-free',
      label: '0x Alpha Free (Unlimited)',
      reasoningVariants: ['low', 'high', 'max'],
    },
    {
      slug: 'opencode/muse-spark-1.2-contributor-free',
      label: 'Muse Spark 1.2 Free',
      reasoningVariants: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    },
    { slug: 'opencode/big-pickle', label: 'Big Pickle', reasoningVariants: undefined },
  ],
  'verbose discovery should use OpenCode names and variant keys and sort like its model picker'
);

const streamAdapterSource = (await readFile(
  new URL('../src/main/stream-adapters.js', import.meta.url),
  'utf8'
)).replace("import { shell } from 'electron';", 'const shell = { openExternal: async () => {} };');
const {
  extractCursorTextFromJsonEvent,
  extractOpenCodeActivitiesFromJsonEvent,
  extractOpenCodeTextFromJsonEvent,
  extractSessionIdFromJsonEvent,
} = await import(
  `data:text/javascript;base64,${Buffer.from(streamAdapterSource).toString('base64')}`
);
const cursorContext = { textSeen: false };
let cursorText = '';
for (const event of [
  { type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'HELLO' }] } },
  { type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: '_CURSOR' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'HELLO_CURSOR' }] } },
  { type: 'result', result: 'HELLO_CURSOR' },
]) {
  const chunk = extractCursorTextFromJsonEvent(event, cursorContext);
  if (chunk) {
    cursorText += chunk;
    cursorContext.textSeen = true;
  }
}
assert.equal(cursorText, 'HELLO_CURSOR', 'Cursor partial output and its final aggregates should render once');

assert.equal(
  extractCursorTextFromJsonEvent(
    { type: 'assistant', message: { content: [{ type: 'text', text: 'FALLBACK' }] } },
    { textSeen: false }
  ),
  'FALLBACK',
  'the final Cursor assistant aggregate should remain a fallback when no partial output arrived'
);

const openCodeTextEvent = {
  type: 'text',
  sessionID: 'ses_test',
  part: { type: 'text', text: 'OPENCODE_OK' },
};
assert.equal(extractSessionIdFromJsonEvent('opencode', openCodeTextEvent), 'ses_test');
assert.equal(extractOpenCodeTextFromJsonEvent(openCodeTextEvent), 'OPENCODE_OK');
assert.deepEqual(
  extractOpenCodeActivitiesFromJsonEvent({
    type: 'tool_use',
    part: {
      type: 'tool',
      tool: 'bash',
      callID: 'call_test',
      title: 'pwd',
      state: {
        status: 'completed',
        input: { command: 'pwd' },
        output: '/tmp\n',
        metadata: { exit: 0 },
      },
    },
  }),
  [
    {
      key: 'call_test',
      type: 'command',
      title: 'Command - pwd',
      detail: 'pwd',
      status: 'done',
      input: '{\n  "command": "pwd"\n}',
      output: '/tmp',
      exitCode: 0,
    },
  ],
  'OpenCode tool events should render as completed Orion activity rows'
);

assert.equal(
  await validateAgentWorkspace('/existing', async () => ({ isDirectory: () => true })),
  null
);
assert.match(
  await validateAgentWorkspace('/missing-rift', async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  }),
  /workspace no longer exists.*Recreate the Rift/i,
  'missing Rift workspaces should fail before spawning a provider'
);
assert.match(
  await validateAgentWorkspace('/locked', async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  }),
  /could not access.*permission denied/i,
  'workspace access failures should not be misreported as deleted workspaces'
);

console.log('Agent model catalog regression tests passed.');
