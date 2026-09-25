import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

import { readImportableSessions, scanImportableSessions } from '../src/main/session-import.js';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-session-import-'));
const originalProviderEnv = {
  CODEX_HOME: process.env.CODEX_HOME,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};
// Keep the default-root fixtures independent of the developer's environment.
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
try {
  const project = path.join(home, 'work', 'my-app');
  await fs.mkdir(project, { recursive: true });
  const missingProject = path.join(home, 'work', 'deleted-app');

  const jsonl = (values) => `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
  const writeFile = async (filePath, content) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  };

  // --- Claude Code fixtures --------------------------------------------------
  const claudeDir = path.join(home, '.claude', 'projects', '-work-my-app');
  const claudeLine = (uuid, parentUuid, type, content, extra = {}) => ({
    uuid,
    parentUuid,
    type,
    sessionId: extra.sessionId ?? 'claude-cli',
    entrypoint: extra.entrypoint ?? 'cli',
    cwd: extra.cwd ?? project,
    timestamp: extra.timestamp ?? `2026-09-20T10:00:0${uuid.length % 10}.000Z`,
    isSidechain: extra.isSidechain ?? false,
    ...(extra.isMeta ? { isMeta: true } : {}),
    message: type === 'assistant' ? { role: 'assistant', model: 'claude-opus-5-5', content } : { role: 'user', content },
  });

  await writeFile(
    path.join(claudeDir, 'claude-cli.jsonl'),
    jsonl([
      claudeLine('u0', null, 'user', '<command-name>/model</command-name>\n<command-args></command-args>', { timestamp: '2026-09-20T10:00:00.000Z' }),
      claudeLine('u0s', 'u0', 'user', '<local-command-stdout>Set model</local-command-stdout>', { timestamp: '2026-09-20T10:00:00.500Z' }),
      claudeLine('u1', 'u0s', 'user', 'Fix the login bug', { timestamp: '2026-09-20T10:00:01.000Z' }),
      claudeLine('m1', 'u1', 'user', '<system-reminder>injected</system-reminder>', { isMeta: true, timestamp: '2026-09-20T10:00:01.100Z' }),
      claudeLine('a1', 'm1', 'assistant', [{ type: 'text', text: 'Looking at auth.' }], { timestamp: '2026-09-20T10:00:02.000Z' }),
      claudeLine('a2', 'a1', 'assistant', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls src' } }], { timestamp: '2026-09-20T10:00:03.000Z' }),
      claudeLine('r1', 'a2', 'user', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'auth.ts\nindex.ts' }], { timestamp: '2026-09-20T10:00:04.000Z' }),
      claudeLine('side', 'r1', 'assistant', [{ type: 'text', text: 'SIDECHAIN TEXT' }], { isSidechain: true, timestamp: '2026-09-20T10:00:04.500Z' }),
      claudeLine('a3', 'r1', 'assistant', [{ type: 'text', text: 'Fixed it.' }], { timestamp: '2026-09-20T10:00:05.000Z' }),
      // Rewound branch: the user edited their follow-up; the abandoned one must not appear.
      claudeLine('u2old', 'a3', 'user', 'ABANDONED FOLLOW-UP', { timestamp: '2026-09-20T10:00:06.000Z' }),
      claudeLine('a4old', 'u2old', 'assistant', [{ type: 'text', text: 'ABANDONED REPLY' }], { timestamp: '2026-09-20T10:00:07.000Z' }),
      claudeLine('u2', 'a3', 'user', [{ type: 'text', text: 'Now add a test' }], { timestamp: '2026-09-20T10:00:08.000Z' }),
      claudeLine('a4', 'u2', 'assistant', [{ type: 'text', text: 'Test added.' }], { timestamp: '2026-09-20T10:00:09.000Z' }),
      { type: 'ai-title', aiTitle: 'Fix login bug', sessionId: 'claude-cli' },
    ])
  );
  // Orion's own Agent SDK run — never importable.
  await writeFile(
    path.join(claudeDir, 'claude-sdk.jsonl'),
    jsonl([
      claudeLine('s1', null, 'user', 'orion run', { sessionId: 'claude-sdk', entrypoint: 'sdk-ts' }),
      claudeLine('s2', 's1', 'assistant', [{ type: 'text', text: 'ok' }], { sessionId: 'claude-sdk', entrypoint: 'sdk-ts' }),
    ])
  );
  // Only a local command, never a model turn.
  await writeFile(
    path.join(claudeDir, 'claude-clear.jsonl'),
    jsonl([claudeLine('c1', null, 'user', '<command-name>/clear</command-name>', { sessionId: 'claude-clear' })])
  );
  // Already linked to an Orion thread.
  await writeFile(
    path.join(claudeDir, 'claude-known.jsonl'),
    jsonl([
      claudeLine('k1', null, 'user', 'hello', { sessionId: 'claude-known' }),
      claudeLine('k2', 'k1', 'assistant', [{ type: 'text', text: 'hi' }], { sessionId: 'claude-known' }),
    ])
  );
  // Working directory no longer exists.
  await writeFile(
    path.join(home, '.claude', 'projects', '-work-deleted-app', 'claude-missing.jsonl'),
    jsonl([
      claudeLine('x1', null, 'user', 'hello', { sessionId: 'claude-missing', cwd: missingProject }),
      claudeLine('x2', 'x1', 'assistant', [{ type: 'text', text: 'hi' }], { sessionId: 'claude-missing', cwd: missingProject }),
    ])
  );

  // --- Codex fixtures ----------------------------------------------------------
  const codexDir = path.join(home, '.codex', 'sessions', '2026', '09', '21');
  const codexId = '019f0000-0000-7000-8000-000000000001';
  const codexMeta = (id, extra = {}) => ({
    timestamp: '2026-09-21T09:00:00.000Z',
    type: 'session_meta',
    payload: { id, cwd: project, originator: 'codex_cli_rs', source: 'cli', timestamp: '2026-09-21T09:00:00.000Z', ...extra },
  });
  const item = (ts, payload) => ({ timestamp: ts, type: 'response_item', payload });
  const event = (ts, payload) => ({ timestamp: ts, type: 'event_msg', payload });

  await writeFile(
    path.join(codexDir, `rollout-2026-09-21T09-00-00-${codexId}.jsonl`),
    jsonl([
      codexMeta(codexId),
      { timestamp: '2026-09-21T09:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.5' } },
      item('2026-09-21T09:00:01.000Z', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] }),
      item('2026-09-21T09:00:01.100Z', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the button' }] }),
      event('2026-09-21T09:00:01.100Z', { type: 'user_message', message: 'Rename the button' }),
      item('2026-09-21T09:00:02.000Z', { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Find the component' }] }),
      item('2026-09-21T09:00:03.000Z', { type: 'function_call', name: 'shell', call_id: 'call_1', arguments: JSON.stringify({ command: ['bash', '-lc', 'rg Button'] }) }),
      item('2026-09-21T09:00:04.000Z', { type: 'function_call_output', call_id: 'call_1', output: JSON.stringify({ output: 'src/Button.tsx', metadata: { exit_code: 0 } }) }),
      item('2026-09-21T09:00:05.000Z', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_2', input: '*** Begin Patch\n*** Update File: src/Button.tsx\n@@\n-Old\n+New\n*** End Patch' }),
      item('2026-09-21T09:00:06.000Z', { type: 'custom_tool_call_output', call_id: 'call_2', output: 'Success' }),
      item('2026-09-21T09:00:07.000Z', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed.\n<oai-mem-citation>\n<citation_entries>MEMORY.md:1-2</citation_entries>\n</oai-mem-citation>' }] }),
      event('2026-09-21T09:00:07.000Z', { type: 'agent_message', message: 'Renamed.' }),
    ])
  );
  await writeFile(
    path.join(home, '.codex', 'session_index.jsonl'),
    jsonl([{ id: codexId, thread_name: 'Rename button', updated_at: '2026-09-21T09:00:07Z' }])
  );
  const excludedCodex = [
    ['019f0000-0000-7000-8000-000000000002', { originator: 'orion', source: 'vscode' }],
    ['019f0000-0000-7000-8000-000000000003', { originator: 'codex_exec', source: 'exec' }],
    ['019f0000-0000-7000-8000-000000000004', { originator: 'Codex Desktop', source: { subagent: 'review' }, thread_source: 'subagent' }],
  ];
  for (const [id, extra] of excludedCodex) {
    await writeFile(
      path.join(codexDir, `rollout-2026-09-21T09-00-00-${id}.jsonl`),
      jsonl([
        codexMeta(id, extra),
        event('2026-09-21T09:00:01.000Z', { type: 'user_message', message: 'hi' }),
        item('2026-09-21T09:00:02.000Z', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }),
      ])
    );
  }

  // --- Scan --------------------------------------------------------------------
  const scan = await scanImportableSessions({ home, excludeSessionIds: ['claude-known'] });
  assert.deepEqual(
    scan.sessions.map((session) => session.sessionId).sort(),
    ['claude-cli', codexId].sort(),
    'only interactive, unlinked sessions with an existing directory are offered'
  );
  assert.equal(scan.missingDirectory, 1);
  const claudeSummary = scan.sessions.find((session) => session.providerId === 'claude');
  assert.equal(claudeSummary.title, 'Fix login bug');
  assert.equal(claudeSummary.cwd, project);
  assert.equal(scan.sessions.find((session) => session.providerId === 'codex').title, 'Rename button');
  assert.equal(scan.sessions[0].providerId, 'codex', 'newest session first');

  // --- Read ----------------------------------------------------------------------
  const [claude, codex, outside] = await readImportableSessions({
    home,
    sessions: [
      claudeSummary,
      scan.sessions.find((session) => session.providerId === 'codex'),
      { providerId: 'claude', filePath: path.join(home, 'elsewhere.jsonl') },
    ],
  });
  assert.equal(outside, null, 'paths outside the provider stores are refused');

  assert.equal(claude.sessionId, 'claude-cli');
  assert.equal(claude.model, 'claude-opus-5-5');
  assert.deepEqual(
    claude.messages.map((message) => [message.role, message.content]),
    [
      ['user', 'Fix the login bug'],
      ['agent', 'Looking at auth.\n\nFixed it.'],
      ['user', 'Now add a test'],
      ['agent', 'Test added.'],
    ],
    'local commands, injected context, sidechains and rewound branches are dropped'
  );
  const bash = claude.messages[1].activities[0];
  assert.equal(bash.type, 'command');
  assert.equal(bash.output, 'auth.ts\nindex.ts');
  assert.equal(bash.status, 'done');
  assert.equal(bash.contentOffset, 'Looking at auth.'.length, 'tool rows interleave at their text offset');
  assert.equal(claude.messages[1].kind, 'agent-run');
  assert.equal(claude.messages[1].modelId, 'claude:claude-opus-5-5');

  assert.equal(codex.sessionId, codexId);
  assert.equal(codex.model, 'gpt-5.5');
  assert.deepEqual(
    codex.messages.map((message) => [message.role, message.content]),
    [
      ['user', 'Rename the button'],
      ['agent', 'Renamed.'],
    ],
    'Codex prompts come from user events, not injected response items'
  );
  const [thought, shell, patch] = codex.messages[1].activities;
  assert.equal(thought.type, 'thought');
  assert.equal(shell.title, 'Command - rg Button');
  assert.equal(shell.output, 'src/Button.tsx');
  assert.equal(shell.exitCode, 0);
  assert.equal(patch.title, 'Edit Button.tsx');
  assert.equal(patch.output, 'Success');

  // A large first prompt must remain discoverable even when a base64 image
  // crosses the scan head budget. Include a preceding metadata record, too.
  const imageSessionPath = path.join(claudeDir, 'claude-image.jsonl');
  await writeFile(imageSessionPath, jsonl([
    { type: 'file-history-snapshot', snapshot: {} },
    claudeLine('image-u', null, 'user', [
      { type: 'text', text: 'Explain this screenshot' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(400 * 1024) } },
      { type: 'text', text: 'Keep the explanation brief 🔎' },
    ], { sessionId: 'claude-image' }),
    claudeLine('image-a', 'image-u', 'assistant', [{ type: 'text', text: 'Screenshot explanation.' }], {
      sessionId: 'claude-image',
    }),
  ]));
  const imageScan = await scanImportableSessions({ home, excludeSessionIds: ['claude-known'] });
  const imageSummary = imageScan.sessions.find((session) => session.sessionId === 'claude-image');
  assert.ok(imageSummary, 'a first prompt larger than the scan head is discovered');
  assert.equal(imageSummary.title, 'Explain this screenshot');
  const [imageTranscript] = await readImportableSessions({ home, sessions: [imageSummary] });
  assert.deepEqual(imageTranscript.messages.map((message) => message.content), [
    'Explain this screenshot\n\nKeep the explanation brief 🔎',
    'Screenshot explanation.',
  ]);

  // Both providers must use the configured root for discovery, title lookup,
  // and the reader allowlist. Leave the default stores in place to catch fallback.
  const customClaude = path.join(home, 'custom-claude');
  const customCodex = path.join(home, 'custom-codex');
  await fs.cp(path.join(home, '.claude'), customClaude, { recursive: true });
  await fs.cp(path.join(home, '.codex'), customCodex, { recursive: true });
  await writeFile(path.join(customCodex, 'session_index.jsonl'), jsonl([
    { id: codexId, thread_name: 'Title from custom Codex home' },
  ]));
  process.env.CLAUDE_CONFIG_DIR = `${customClaude}${path.sep}`;
  process.env.CODEX_HOME = `${customCodex}${path.sep}`;
  const customScan = await scanImportableSessions({ home, excludeSessionIds: ['claude-known'] });
  assert.deepEqual(customScan.sessions.map((session) => session.sessionId).sort(),
    ['claude-cli', 'claude-image', codexId].sort());
  assert.equal(customScan.missingDirectory, 1);
  for (const session of customScan.sessions) {
    const root = session.providerId === 'claude' ? customClaude : customCodex;
    assert.ok(session.filePath.startsWith(`${root}${path.sep}`), 'scan uses configured provider roots');
  }
  assert.equal(customScan.sessions.find((session) => session.providerId === 'codex').title,
    'Title from custom Codex home');
  const customTranscripts = await readImportableSessions({ home, sessions: customScan.sessions });
  assert.ok(customTranscripts.every(Boolean), 'reader accepts sessions inside configured roots');
  assert.equal(customTranscripts.find((session) => session.providerId === 'codex').title,
    'Title from custom Codex home');
  assert.deepEqual(await readImportableSessions({ home, sessions: scan.sessions }), [null, null],
    'default-root files are outside the allowlist when custom roots are configured');

  // Replay rewinds in both current event-based rollouts and older rollouts
  // whose user prompts are available only as response items.
  const rewindPath = path.join(customCodex, 'sessions', 'rewind.jsonl');
  const ts = '2026-09-21T10:00:00.000Z';
  const agentReply = (text) => item(ts, {
    type: 'message', role: 'assistant', content: [{ type: 'output_text', text }],
  });
  const context = (model) => ({ type: 'turn_context', timestamp: ts, payload: { model } });
  const rewind = (num_turns) => event(ts, { type: 'thread_rolled_back', num_turns });
  for (const withUserEvents of [true, false]) {
    const prompt = (text) => [
      item(ts, { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }),
      ...(withUserEvents ? [event(ts, { type: 'user_message', message: text })] : []),
    ];
    const kept = [context('gpt-5.5'), ...prompt('Keep question'), agentReply('Keep answer')];
    const discarded = [
      context('gpt-6-astra'), ...prompt('Discard question'),
      item(ts, { type: 'function_call', name: 'shell', call_id: 'removed-call', arguments: '{"command":"pwd"}' }),
      item(ts, { type: 'function_call_output', call_id: 'removed-call', output: 'discarded output' }),
      agentReply('Discard answer'),
    ];
    const replacement = [...prompt('Replacement question'), agentReply('Replacement answer')];
    const readRewind = async (records) => {
      await writeFile(rewindPath, jsonl([codexMeta('rewind-session'), ...records]));
      return (await readImportableSessions({ home, sessions: [{ providerId: 'codex', filePath: rewindPath }] }))[0];
    };
    const replaced = await readRewind([...kept, ...discarded, rewind(1), ...replacement]);
    assert.deepEqual(replaced.messages.map((message) => message.content), [
      'Keep question', 'Keep answer', 'Replacement question', 'Replacement answer',
    ], 'rewound exchanges are removed before importing their replacement');
    assert.equal(replaced.model, 'gpt-5.5', 'rewinding restores the surviving model when no new context is recorded');
    assert.equal(replaced.messages.at(-1).modelId, 'codex:gpt-5.5');
    assert.deepEqual(replaced.messages.at(-1).activities, [], 'discarded tools do not leak into the replacement');

    const multi = await readRewind([
      ...kept, ...discarded, ...prompt('Unanswered question'), rewind(2),
    ]);
    assert.deepEqual(multi.messages.map((message) => message.content), ['Keep question', 'Keep answer'],
      'multi-turn rewinds include an unanswered user prompt');
    assert.equal(multi.model, 'gpt-5.5');

    const compacted = await readRewind([
      ...kept, ...discarded,
      { type: 'compacted', timestamp: ts, payload: { message: 'Discarded compact summary', replacement_history: [] } },
      agentReply('Discarded post-compaction answer'), rewind(1),
      context('gpt-6-sol'), ...replacement,
    ]);
    assert.deepEqual(compacted.messages.map((message) => message.content), [
      'Keep question', 'Keep answer', 'Replacement question', 'Replacement answer',
    ], 'rewinds also remove responses after compaction within the discarded turn');
    assert.equal(compacted.model, 'gpt-6-sol', 'an explicit replacement model overrides the restored model');
    assert.equal(compacted.messages.at(-1).modelId, 'codex:gpt-6-sol');

    const repeated = await readRewind([...kept, ...discarded, rewind(1), ...replacement, rewind(1)]);
    assert.deepEqual(repeated.messages.map((message) => message.content), ['Keep question', 'Keep answer'],
      'later rewinds operate on the surviving history');
    assert.equal(await readRewind([...discarded, rewind(1)]), null, 'fully rewound conversations are not imported');
    assert.equal(await readRewind([...discarded, rewind(20)]), null, 'oversized rewind counts drop all available turns');

    const noOp = await readRewind([
      ...kept, rewind(0), rewind(-1), rewind(1.5), rewind('1'), agentReply('Continued answer'),
    ]);
    assert.deepEqual(noOp.messages.map((message) => message.content), ['Keep question', 'Keep answer\n\nContinued answer'],
      'zero or malformed rewind counts do not split or remove the current turn');

    const emptyPromptRewound = await readRewind([...kept, ...prompt(''), agentReply('Empty prompt answer'), rewind(1)]);
    assert.deepEqual(emptyPromptRewound?.messages.map((message) => message.content), ['Keep question', 'Keep answer'],
      'recognized user messages retain their turn boundary independently of display text');

    for (const imageFormat of withUserEvents ? ['user_message', 'item_completed'] : ['legacy']) {
      const imageContent = [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }];
      const imagePrompt = [
        item(ts, { type: 'message', role: 'user', content: imageContent }),
        ...(imageFormat === 'user_message'
          ? [event(ts, { type: 'user_message', message: '  ', images: [], local_images: ['/tmp/screenshot.png'] })]
          : imageFormat === 'item_completed'
            ? [event(ts, { type: 'item_completed', item: {
              type: 'UserMessage', content: [{ type: 'image', image_url: 'data:image/png;base64,AA==' }],
            } })]
            : []),
      ];
      const imageTurn = [context('gpt-6-astra'), ...imagePrompt, agentReply('Image answer')];
      const withImage = await readRewind([...kept, ...imageTurn]);
      assert.deepEqual(withImage.messages.map((message) => message.content), [
        'Keep question', 'Keep answer', 'Attached image', 'Image answer',
      ], `${imageFormat}: image-only prompts separate assistant turns without duplicating response items`);

      const imageRewound = await readRewind([...kept, ...imageTurn, rewind(1)]);
      assert.deepEqual(imageRewound?.messages.map((message) => message.content), ['Keep question', 'Keep answer'],
        `${imageFormat}: rewinding an image-only turn preserves the preceding text exchange`);
      assert.equal(imageRewound.model, 'gpt-5.5');

      const imageUnanswered = await readRewind([...kept, ...imagePrompt, rewind(1), ...replacement]);
      assert.deepEqual(imageUnanswered.messages.map((message) => message.content), [
        'Keep question', 'Keep answer', 'Replacement question', 'Replacement answer',
      ], `${imageFormat}: an unanswered image prompt still consumes one rewind boundary`);

      const imageOnly = await readRewind([...imageTurn]);
      assert.deepEqual(imageOnly.messages.map((message) => message.content), ['Attached image', 'Image answer']);
      assert.ok((await scanImportableSessions({ home })).sessions.some((session) => session.sessionId === 'rewind-session'),
        `${imageFormat}: an image-only conversation is discoverable`);
      assert.equal(await readRewind([...imageTurn, rewind(1)]), null,
        `${imageFormat}: rewinding the sole image turn leaves no importable conversation`);
    }
  }
} finally {
  for (const [key, value] of Object.entries(originalProviderEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(home, { recursive: true, force: true });
}
console.log('session import tests passed');
app.quit();
