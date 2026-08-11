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

// Codex's bundled Chrome integration can only connect from ChatGPT.app.
// Keep this provider steer in one place so exec asides and app-server turns
// both direct browser work to the MCP server Orion actually configured.
export const codexBrowserEnvironmentNote = (providerOptions, accessMode) => {
  const options =
    providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
  if (options.browserControl !== true || accessMode === 'read-only') return '';
  return options.browserAutoConnect
    ? `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search); they attach to the user's real signed-in Chrome, so treat open tabs and logins with care and do not close tabs you did not open. If those tools report "Could not connect to Chrome", tell the user to open chrome://inspect/#remote-debugging in Chrome, turn the remote debugging toggle on, quit and reopen Chrome (the server only starts on launch), and retry — do not attempt workarounds.]\n\n`
    : `[Environment note: the ChatGPT-extension browser backend is unavailable here (it only works inside the ChatGPT desktop app). Do not use the control-chrome skill, the browser plugin, or agent.browsers — they cannot connect. For any browser task, use the chrome_devtools MCP tools (discover them via tools_search).]\n\n`;
};
