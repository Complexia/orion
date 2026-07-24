import { type AgentModel, type ClaudeContextWindow, type ClaudeReasoningEffort, defaultClaudeReasoningEffort } from '../agentCatalog';

export const claudeOneMillionOnlyModelSlugs = new Set(['claude-fable-5', 'claude-sonnet-5']);

export const getDefaultClaudeReasoningEffort = (model: AgentModel | undefined): ClaudeReasoningEffort =>
  model?.slug === 'claude-opus-4-7' ? 'xhigh' : defaultClaudeReasoningEffort;

export const getEffectiveClaudeContextWindow = (
  model: AgentModel | undefined,
  selectedContextWindow: ClaudeContextWindow
): ClaudeContextWindow => {
  if (model?.providerId === 'claude' && claudeOneMillionOnlyModelSlugs.has(model.slug)) {
    return '1m';
  }
  return selectedContextWindow;
};
