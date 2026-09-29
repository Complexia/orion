import { type AgentModel, type ClaudeContextWindow } from '../agentCatalog';

export const claudeOneMillionOnlyModelSlugs = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
]);

export const getEffectiveClaudeContextWindow = (
  model: AgentModel | undefined,
  selectedContextWindow: ClaudeContextWindow
): ClaudeContextWindow => {
  if (model?.providerId === 'claude' && claudeOneMillionOnlyModelSlugs.has(model.slug)) {
    return '1m';
  }
  return selectedContextWindow;
};
