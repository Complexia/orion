const mcpBridgeProviderIds = new Set(['codex', 'cursor', 'grok', 'kimi', 'muse', 'opencode']);

const runPluginHelpCommand = (providerId) =>
  providerId === 'cursor'
    ? 'cursor-agent --help'
    : providerId === 'grok'
      ? 'grok agent --help'
      : null;

export const probeProviderRunPluginSupport = async (
  providerId,
  { shellPathReady, runShellCommand }
) => {
  const helpCommand = runPluginHelpCommand(providerId);
  if (!helpCommand) return true;

  // Finder-launched builds begin with a minimal PATH. Do not cache a failed
  // Grok/Cursor capability result until Orion has imported the user's shell
  // PATH, otherwise the composer hides @thread choices for the whole app run.
  await shellPathReady;
  try {
    const { stdout, stderr } = await runShellCommand(helpCommand, 10000);
    return `${stdout}\n${stderr}`.includes('--plugin-dir');
  } catch {
    return false;
  }
};

export const isMcpBridgeProvider = (providerId) => mcpBridgeProviderIds.has(providerId);

export const requiresRegisteredThreadReaderBridge = (providerId, hasThreadMentions) =>
  hasThreadMentions === true && isMcpBridgeProvider(providerId);

// OpenCode and Muse take the bridge through provider-specific config that can
// fail to build after registration succeeds (inline config merge / synthetic
// settings root), so their readiness needs that extra signal.
export const isEffectiveThreadReaderBridgeReady = (
  providerId,
  bridgeRegistered,
  openCodeConfigReady,
  museConfigReady
) =>
  bridgeRegistered === true &&
  (providerId !== 'opencode' || openCodeConfigReady === true) &&
  (providerId !== 'muse' || museConfigReady === true);

export const isRequiredThreadReaderBridgeMissing = (
  providerId,
  hasThreadMentions,
  bridgeRegistered
) => requiresRegisteredThreadReaderBridge(providerId, hasThreadMentions) && !bridgeRegistered;
