const mcpBridgeProviderIds = new Set(['codex', 'cursor', 'grok', 'kimi', 'muse', 'opencode']);

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
