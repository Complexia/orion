import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  agentModels,
  cursorFrontierModelSlugs,
  cursorFallbackModels,
  parseCursorModelsOutput,
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

const streamAdapterSource = (await readFile(
  new URL('../src/main/stream-adapters.js', import.meta.url),
  'utf8'
)).replace("import { shell } from 'electron';", 'const shell = { openExternal: async () => {} };');
const { extractCursorTextFromJsonEvent } = await import(
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
