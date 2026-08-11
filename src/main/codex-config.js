const codexSettingMode = (value) =>
  value === 'enabled' || value === 'disabled' ? value : 'inherit';

// Hidden title/git-message turns should never read from or contribute to the
// user's memories. Keep this in the shared config module so every utility
// caller gets the same fail-closed policy without renderer-provided settings.
export const codexUtilityPrivacyOptions = Object.freeze({
  codexMemoryMode: 'disabled',
  codexChronicleMode: 'disabled',
  codexMemoryExternalContextMode: 'disabled',
});

/**
 * Config shared by `codex exec` and app-server-backed turns.
 *
 * The modes are deliberately tri-state. An absent Orion preference must keep
 * honoring the user's normal $CODEX_HOME/config.toml instead of quietly
 * turning a privacy-sensitive Codex feature on or off.
 */
export const codexPersonalizationConfig = (providerOptions) => {
  const options =
    providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
  const config = {};

  const memoryMode = codexSettingMode(options.codexMemoryMode);
  if (memoryMode !== 'inherit') {
    const enabled = memoryMode === 'enabled';
    config['features.memories'] = enabled;
    config['memories.use_memories'] = enabled;
    config['memories.generate_memories'] = enabled;
  }

  const chronicleMode = codexSettingMode(options.codexChronicleMode);
  if (chronicleMode !== 'inherit') {
    config['features.chronicle'] = chronicleMode === 'enabled';
  }

  const externalContextMode = codexSettingMode(
    options.codexMemoryExternalContextMode
  );
  if (externalContextMode !== 'inherit') {
    config['memories.disable_on_external_context'] =
      externalContextMode === 'disabled';
  }

  if (
    options.codexPersonality === 'none' ||
    options.codexPersonality === 'friendly' ||
    options.codexPersonality === 'pragmatic'
  ) {
    config.personality = options.codexPersonality;
  }

  const developerInstructions =
    typeof options.codexDeveloperInstructions === 'string'
      ? options.codexDeveloperInstructions.trim()
      : '';
  if (developerInstructions) {
    config.developer_instructions = developerInstructions;
  }

  return config;
};

export const codexConfigArgs = (config) =>
  Object.entries(config).flatMap(([key, value]) => [
    '--config',
    `${key}=${JSON.stringify(value)}`,
  ]);

export const codexBrowserUseMode = (providerOptions) => {
  const options =
    providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
  if (
    options.browserUseMode === 'disabled' ||
    options.browserUseMode === 'extension' ||
    options.browserUseMode === 'mcp'
  ) {
    return options.browserUseMode;
  }
  // Only migrate users who explicitly enabled the old signed-in Chrome
  // auto-connect option. browserControl by itself meant a separate profile
  // and must not be reinterpreted as access to the user's normal Chrome.
  return options.browserControl === true && options.browserAutoConnect === true
    ? 'mcp'
    : 'disabled';
};

export const codexBrowserMcpConfig = (providerOptions, accessMode, mcpPackage) => {
  if (accessMode === 'read-only' || codexBrowserUseMode(providerOptions) !== 'mcp') return {};
  const options =
    providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
  return {
    'mcp_servers.chrome_devtools.command': 'npx',
    'mcp_servers.chrome_devtools.args': [
      '-y',
      mcpPackage,
      ...(options.browserAutoConnect === false ? [] : ['--autoConnect']),
    ],
    'mcp_servers.chrome_devtools.startup_timeout_sec': 90,
  };
};

// Keep browser steering shared by exec and app-server turns. The extension
// mode is only selected at runtime after Orion verifies the local integration;
// otherwise main.js changes the effective mode to the MCP fallback.
export const codexBrowserEnvironmentNote = (providerOptions, accessMode) => {
  if (accessMode === 'read-only') return '';
  const mode = codexBrowserUseMode(providerOptions);
  if (mode === 'extension') {
    return `[Environment note: browser control is enabled through the user's installed ChatGPT Chrome extension and verified Codex browser integration. For browser tasks, use the control-chrome skill and its browser-client workflow through node_repl. Control the user's existing signed-in Chrome carefully: preserve tabs you did not open, and do not use chrome_devtools MCP.]\n\n`;
  }
  if (mode === 'mcp') {
    if (providerOptions?.browserAutoConnect === false) {
      return `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For browser tasks, use the chrome_devtools MCP tools (discover them via tools_search). They run in a dedicated browser profile, so signed-in Chrome tabs, logins, and cookies are unavailable.]\n\n`;
    }
    return `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search); they attach to the user's real signed-in Chrome, so treat open tabs and logins with care and do not close tabs you did not open. If those tools report "Could not connect to Chrome", tell the user to open chrome://inspect/#remote-debugging in Chrome, turn the remote debugging toggle on, quit and reopen Chrome (the server only starts on launch), and retry — do not attempt workarounds.]\n\n`;
  }
  return '';
};
