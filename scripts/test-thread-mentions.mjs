import assert from 'node:assert/strict';

import {
  allowsThreadMentionsInComposer,
  getChatMentionReplaceEnd,
  hasThreadReaderSupport,
  isThreadReferenceCandidate,
} from '../src/app/chatMentions.ts';
import {
  isEffectiveThreadReaderBridgeReady,
  isMcpBridgeProvider,
  isRequiredThreadReaderBridgeMissing,
  requiresRegisteredThreadReaderBridge,
} from '../src/main/thread-reader-routing.js';
import { withThreadStartReservation } from '../src/app/turnStart.ts';

const pendingThreadStarts = new Set();
let releasePreflight;
const preflight = new Promise((resolve) => {
  releasePreflight = resolve;
});
const firstStart = withThreadStartReservation(pendingThreadStarts, 'thread-1', async () => {
  await preflight;
  assert.equal(
    pendingThreadStarts.has('thread-1'),
    true,
    'the thread reservation must remain held through asynchronous preflight'
  );
  return 'registered';
});
const concurrentStart = await withThreadStartReservation(
  pendingThreadStarts,
  'thread-1',
  async () => 'must not run'
);
assert.deepEqual(
  concurrentStart,
  { acquired: false },
  'a concurrent turn must not enter preflight for the same thread'
);
releasePreflight();
assert.deepEqual(await firstStart, { acquired: true, value: 'registered' });
assert.equal(
  pendingThreadStarts.has('thread-1'),
  false,
  'the reservation must release after turn registration completes'
);

assert.equal(
  hasThreadReaderSupport('cursor', { providerId: 'cursor', supported: false }),
  false,
  'a failed Cursor plugin probe must hide thread mentions'
);
assert.equal(
  hasThreadReaderSupport('grok', { providerId: 'cursor', supported: true }),
  false,
  'capability results from a previously selected provider must not leak'
);
assert.equal(
  hasThreadReaderSupport('grok', { providerId: 'grok', supported: true }),
  true,
  'thread mentions should be offered after the effective provider is confirmed capable'
);

assert.equal(
  allowsThreadMentionsInComposer('/review compare with @'),
  false,
  'reviews must not offer thread mentions because their dispatcher cannot resolve them'
);
assert.equal(
  allowsThreadMentionsInComposer('  /BTW ask about @'),
  false,
  'btw asides must not offer thread mentions because their dispatcher cannot resolve them'
);
assert.equal(
  allowsThreadMentionsInComposer('/goal compare against @'),
  false,
  'goal runs must not offer thread mentions because their dispatcher cannot resolve them'
);
assert.equal(
  allowsThreadMentionsInComposer('/reviewer compare with @'),
  true,
  'ordinary messages whose first word only starts like a command should keep thread mentions'
);
assert.equal(
  allowsThreadMentionsInComposer('Compare this with @'),
  true,
  'normal turns should keep thread mentions'
);

assert.equal(
  isThreadReferenceCandidate('terminal-thread', 'current-thread', true),
  false,
  'terminal-only threads must not be offered as unreadable reference targets'
);
assert.equal(
  isThreadReferenceCandidate('transcript-thread', 'current-thread', false),
  true,
  'ordinary transcript-backed threads should remain reference candidates'
);

for (const providerId of ['codex', 'cursor', 'grok', 'kimi', 'opencode']) {
  assert.equal(isMcpBridgeProvider(providerId), true, `${providerId} should use the per-run MCP bridge`);
  assert.equal(
    requiresRegisteredThreadReaderBridge(providerId, true),
    true,
    `${providerId} mentions must require a successfully registered bridge`
  );
  assert.equal(
    isRequiredThreadReaderBridgeMissing(providerId, true, false),
    true,
    `${providerId} referenced-thread turns must fail when registration returns null`
  );
  assert.equal(
    isRequiredThreadReaderBridgeMissing(providerId, true, true),
    false,
    `${providerId} referenced-thread turns may start after registration succeeds`
  );
}
assert.equal(
  requiresRegisteredThreadReaderBridge('claude', true),
  false,
  'Claude registers read_thread in-process instead of through the bridge'
);
assert.equal(
  requiresRegisteredThreadReaderBridge('codex', false),
  false,
  'ordinary bridge-backed turns may keep their existing best-effort bridge behavior'
);
assert.equal(
  isEffectiveThreadReaderBridgeReady('opencode', true, false),
  false,
  'OpenCode registration is ineffective when its inline MCP config cannot be merged'
);
assert.equal(
  isRequiredThreadReaderBridgeMissing(
    'opencode',
    true,
    isEffectiveThreadReaderBridgeReady('opencode', true, false)
  ),
  true,
  'referenced-thread OpenCode turns must fail closed when effective MCP config is unavailable'
);
assert.equal(
  isEffectiveThreadReaderBridgeReady('opencode', true, true),
  true,
  'OpenCode may dispatch after registration and inline MCP config merging both succeed'
);
assert.equal(
  isEffectiveThreadReaderBridgeReady('codex', true, false),
  true,
  'providers without inline OpenCode config only require bridge registration'
);

const multiword = 'Compare @previous release with this one';
const queryStart = multiword.indexOf('@');
const caret = multiword.indexOf(' with this one');
const mention = {
  start: queryStart,
  query: multiword.slice(queryStart + 1, caret),
};

assert.equal(
  getChatMentionReplaceEnd(multiword, mention, 'thread'),
  caret,
  'thread selection must preserve unrelated draft text after the caret'
);

const multiline = `${multiword}\nKeep this prompt text`;
assert.equal(
  getChatMentionReplaceEnd(multiline, mention, 'thread'),
  caret,
  'thread selection must preserve the current line suffix and later lines'
);

const modelMention = 'Ask @gpt-5.6-mini then continue';
const modelAt = modelMention.indexOf('@');
assert.equal(
  getChatMentionReplaceEnd(modelMention, { start: modelAt, query: 'gpt-5' }, 'model'),
  modelMention.indexOf(' ', modelAt),
  'model selection should retain its slug-like token boundary'
);

console.log('Thread mention regression checks passed.');
