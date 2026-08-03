const mcpBridgeProviderIds = new Set(['codex', 'cursor', 'grok', 'kimi', 'opencode']);

export const isMcpBridgeProvider = (providerId) => mcpBridgeProviderIds.has(providerId);

export const requiresRegisteredThreadReaderBridge = (providerId, hasThreadMentions) =>
  hasThreadMentions === true && isMcpBridgeProvider(providerId);

export const isEffectiveThreadReaderBridgeReady = (
  providerId,
  bridgeRegistered,
  openCodeConfigReady
) =>
  bridgeRegistered === true && (providerId !== 'opencode' || openCodeConfigReady === true);

export const isRequiredThreadReaderBridgeMissing = (
  providerId,
  hasThreadMentions,
  bridgeRegistered
) => requiresRegisteredThreadReaderBridge(providerId, hasThreadMentions) && !bridgeRegistered;
