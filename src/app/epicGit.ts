export type EpicGitWorkStatus = {
  hasChangesToCommit: boolean;
  hasUnpushedCommits: boolean;
};

/** Whether the selected commit action can make progress in its current mode. */
export const epicHasActionableCommitWork = (
  status: EpicGitWorkStatus | undefined,
  commitWithoutPush: boolean
) => !status || status.hasChangesToCommit || (!commitWithoutPush && status.hasUnpushedCommits);
