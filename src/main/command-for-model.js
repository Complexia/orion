import { app } from 'electron';
import { chromeDevtoolsMcpPackage, claudeEffortForCli, claudeModelArgForContextWindow, codexReasoningEffortForModel, defaultClaudeContextWindow, defaultClaudeReasoningEffort, defaultCodexServiceTier, parseExtraArgs } from './models.js';

export const commandForModel = (model, input) => {
  const prompt =
    model.providerId === 'claude' && input.claudeReasoningEffort === 'ultrathink'
      ? `ultrathink\n\n${input.prompt}`
      : input.prompt;
  const cwd = input.projectPath;
  const modelArg = model.slug;
  const accessMode = input.accessMode || 'full-access';
  const options = input.providerOptions && typeof input.providerOptions === 'object' ? input.providerOptions : {};
  const extraArgs = parseExtraArgs(options.extraArgs);
  const resumeSessionId =
    typeof input.resumeSessionId === 'string' && input.resumeSessionId ? input.resumeSessionId : null;

  if (model.providerId === 'codex') {
    // Goal runs (/goal) speak JSON-RPC over `codex app-server` — model,
    // sandbox, and config overrides travel in the dialog, not argv.
    if (input.codexGoal) return ['codex', 'app-server'];
    const reasoningEffort = codexReasoningEffortForModel(model, input.codexReasoningEffort);
    // Inline code reviews (/review) need the current Codex thread so the
    // reviewer can see the conversation that led to the changes. The
    // app-server's review/start method resumes that thread and runs the
    // dedicated reviewer in place; `codex exec review` always starts a
    // context-free session.
    if (input.codexReview && typeof input.codexReview === 'object') {
      return ['codex', 'app-server'];
    }
    const serviceTier = input.codexServiceTier || defaultCodexServiceTier;
    const configArgs = [
      '--config',
      `model_reasoning_effort="${reasoningEffort}"`,
      // GPT-5.6 models default to no reasoning summaries on the CLI — request
      // them so the Reasoning activity streams like the desktop app.
      '--config',
      'model_reasoning_summary="detailed"',
      '--config',
      `service_tier="${serviceTier}"`,
    ];
    if (options.networkAccess) configArgs.push('--config', 'sandbox_workspace_write.network_access=true');
    if (options.webSearch) configArgs.push('--config', 'tools.web_search=true');
    // Browser control: the ChatGPT-extension browser backend is hard-gated to
    // the ChatGPT.app process tree (code-sign ancestry check on its
    // /tmp/codex-browser-use sockets), so codex spawned by Orion can never use
    // it. Instead expose Google's chrome-devtools-mcp as a purpose-built
    // browser connector — the codex chrome plugin docs explicitly prefer
    // purpose-built connectors over the Chrome plugin. Uses a persistent
    // profile (~/.cache/chrome-devtools-mcp/chrome-profile), so logins stick
    // across runs.
    const browserControlEnabled =
      options.browserControl === true && accessMode !== 'read-only';
    if (browserControlEnabled) {
      // autoConnect attaches to the user's real signed-in Chrome profile
      // (Chrome 144+, after the one-time chrome://inspect/#remote-debugging
      // toggle); otherwise chrome-devtools-mcp launches a dedicated Chrome
      // with its own persistent profile.
      const mcpArgs = JSON.stringify([
        '-y',
        chromeDevtoolsMcpPackage,
        ...(options.browserAutoConnect ? ['--autoConnect'] : []),
      ]);
      configArgs.push(
        '--config',
        'mcp_servers.chrome_devtools.command="npx"',
        '--config',
        `mcp_servers.chrome_devtools.args=${mcpArgs}`,
        '--config',
        'mcp_servers.chrome_devtools.startup_timeout_sec=90',
      );
    }
    // Orion's spawn_subagent bridge (@-mention delegation / orchestration).
    // A spawned subagent can run for a long time, so lift codex's 60s default
    // MCP tool timeout well clear of real runs.
    if (input.orionMcp) {
      configArgs.push(
        '--config',
        `mcp_servers.orion.command=${JSON.stringify(input.orionMcp.command)}`,
        '--config',
        `mcp_servers.orion.args=${JSON.stringify(input.orionMcp.args)}`,
        '--config',
        'mcp_servers.orion.env={ELECTRON_RUN_AS_NODE = "1"}',
        '--config',
        'mcp_servers.orion.startup_timeout_sec=30',
        '--config',
        'mcp_servers.orion.tool_timeout_sec=7200',
        // codex 0.144 gates MCP tools behind an approval prompt that headless
        // exec runs auto-cancel ("user cancelled MCP tool call") — pre-approve
        // Orion's own tool. The spawned subthread runs with the driver
        // thread's access mode, so this grants nothing extra.
        '--config',
        'mcp_servers.orion.default_tools_approval_mode="approve"',
      );
    }
    // Without this steer, codex's bundled control-chrome skill grabs browser
    // tasks, hits the dead extension backend, and gives up without ever trying
    // the chrome_devtools tools (verified empirically). The skill defers to a
    // user-named alternative, which this note provides.
    const browserNote = !browserControlEnabled
      ? ''
      : options.browserAutoConnect
        ? `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search); they attach to the user's real signed-in Chrome, so treat open tabs and logins with care and do not close tabs you did not open. If those tools report "Could not connect to Chrome", tell the user to open chrome://inspect/#remote-debugging in Chrome, turn the remote debugging toggle on, quit and reopen Chrome (the server only starts on launch), and retry — do not attempt workarounds.]\n\n`
        : `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search).]\n\n`;
    const codexPrompt = `${browserNote}${prompt}`;

    if (resumeSessionId) {
      // `exec resume` has no --cd/--sandbox/--color flags: cwd comes from the
      // spawn cwd and the sandbox from a config override.
      const accessArgs =
        accessMode === 'full-access'
          ? ['--dangerously-bypass-approvals-and-sandbox']
          : ['--config', `sandbox_mode="${accessMode === 'read-only' ? 'read-only' : 'workspace-write'}"`];
      return [
        'codex',
        'exec',
        'resume',
        resumeSessionId,
        '--json',
        '--skip-git-repo-check',
        '--model',
        modelArg,
        ...configArgs,
        ...accessArgs,
        ...extraArgs,
        codexPrompt,
      ];
    }

    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', accessMode === 'read-only' ? 'read-only' : 'workspace-write'];
    return [
      'codex',
      'exec',
      '--json',
      '--cd',
      cwd,
      '--skip-git-repo-check',
      '--color',
      'never',
      '--model',
      modelArg,
      ...configArgs,
      ...accessArgs,
      ...extraArgs,
      codexPrompt,
    ];
  }

  if (model.providerId === 'claude') {
    const reasoningEffort = input.claudeReasoningEffort || defaultClaudeReasoningEffort;
    const contextWindow = input.claudeContextWindow || defaultClaudeContextWindow;
    const claudeModelArg = claudeModelArgForContextWindow(modelArg, contextWindow);
    const settingsArgs = reasoningEffort === 'ultracode' ? ['--settings', JSON.stringify({ ultracode: true })] : [];
    const accessArgs =
      accessMode === 'full-access'
        ? ['--dangerously-skip-permissions']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    // Headless runs can't show permission prompts, so tools outside the
    // permission mode's defaults must be pre-approved here. Claude in Chrome
    // tools are MCP tools, so enabling --chrome also pre-approves its server.
    const chromeEnabled = options.chrome === true && accessMode !== 'read-only';
    const chromeArgs = chromeEnabled ? ['--chrome'] : [];
    const configuredAllowedTools = String(options.allowedTools || '')
      .split(',')
      .map((tool) => tool.trim())
      .filter(
        (tool) =>
          Boolean(tool) &&
          (accessMode !== 'read-only' || !tool.startsWith('mcp__claude-in-chrome'))
      );
    const allowedTools = [...configuredAllowedTools, chromeEnabled ? 'mcp__claude-in-chrome' : '']
      .filter(Boolean)
      .join(',');
    // MUST be the single-token --flag=value form: --allowedTools is variadic
    // (space-separated), so `--allowedTools a,b <prompt>` swallows the prompt.
    const allowedToolsArgs =
      accessMode !== 'full-access' && allowedTools ? [`--allowedTools=${allowedTools}`] : [];
    const resumeArgs = resumeSessionId
      ? ['--resume', resumeSessionId, ...(input.forkSession ? ['--fork-session'] : [])]
      : [];
    return [
      'claude',
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--model',
      claudeModelArg,
      '--effort',
      claudeEffortForCli(reasoningEffort),
      ...settingsArgs,
      ...accessArgs,
      ...chromeArgs,
      ...allowedToolsArgs,
      ...resumeArgs,
      ...extraArgs,
      prompt,
    ];
  }

  if (model.providerId === 'cursor') {
    const accessArgs = accessMode === 'read-only' ? ['--mode', 'plan'] : ['--force'];
    const resumeArgs = resumeSessionId ? ['--resume', resumeSessionId] : [];
    const pluginArgs = input.orionMcp?.pluginDir
      ? ['--plugin-dir', input.orionMcp.pluginDir]
      : [];
    return [
      'cursor-agent',
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--workspace',
      cwd,
      '--model',
      modelArg,
      ...pluginArgs,
      ...accessArgs,
      ...resumeArgs,
      ...extraArgs,
      prompt,
    ];
  }

  if (model.providerId === 'grok') {
    // Real turns speak ACP (JSON-RPC over `grok agent stdio`): the prompt,
    // cwd, session resume, and permission answers travel over the dialog, not
    // flags. The headless streaming-json format only ever emits thought/text/
    // end, so ACP is the only way to stream tool calls, plans, and diffs.
    if (input.acp) {
      const effortArgs = input.grokReasoningEffort
        ? ['--reasoning-effort', input.grokReasoningEffort]
        : [];
      const pluginArgs = input.orionMcp?.pluginDir
        ? ['--plugin-dir', input.orionMcp.pluginDir]
        : [];
      return [
        'grok',
        'agent',
        '-m',
        modelArg,
        ...effortArgs,
        ...pluginArgs,
        ...(accessMode === 'full-access' ? ['--always-approve'] : []),
        ...extraArgs,
        'stdio',
      ];
    }

    // One-shot text-only path (thread title generation).
    const accessArgs =
      accessMode === 'full-access'
        ? ['--permission-mode', 'bypassPermissions', '--always-approve']
        : ['--permission-mode', accessMode === 'read-only' ? 'plan' : 'acceptEdits'];
    const resumeArgs = resumeSessionId
      ? ['--resume', resumeSessionId, ...(input.forkSession ? ['--fork-session'] : [])]
      : [];
    return [
      'grok',
      '--cwd',
      cwd,
      '--model',
      modelArg,
      '--output-format',
      'streaming-json',
      ...accessArgs,
      ...resumeArgs,
      ...extraArgs,
      '--single',
      prompt,
    ];
  }

  if (model.providerId === 'kimi') {
    // kimi always speaks ACP (JSON-RPC over `kimi acp`): the prompt, cwd,
    // session resume (session/load), model selection (session/set_config_option)
    // and permission mode (session/set_mode: plan/default/yolo) all travel
    // over the dialog, not argv. Prompt mode (`kimi -p`) is never used, even
    // for hidden one-shot turns: it auto-approves every tool and rejects
    // --plan ("Cannot combine --prompt with --plan" on 0.26), so it cannot
    // honor any access mode below Full access. Title generation goes through
    // kimiPlanModeOneShot (ACP plan mode) instead.
    return ['kimi', ...extraArgs, 'acp'];
  }

  return ['opencode', 'run', '--model', modelArg, ...extraArgs, prompt];
};
