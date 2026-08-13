import assert from 'node:assert/strict';

import {
  cursorFallbackModels,
  parseCursorModelsOutput,
} from '../src/main/models.js';

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
    { slug: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low', favorite: false },
    {
      slug: 'cursor-grok-4.6-high-fast',
      label: 'Cursor Grok 4.6 Fast',
      favorite: true,
    },
    { slug: 'composer-2.5', label: 'Composer 2.5', favorite: true },
  ],
  'Cursor CLI discovery should parse current rows and keep stable primary favorites'
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

console.log('Agent model catalog regression tests passed.');
