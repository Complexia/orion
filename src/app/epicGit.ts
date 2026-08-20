export type EpicGitWorkStatus = {
  hasChangesToCommit: boolean;
  hasUnpushedCommits: boolean;
};

/** Whether the selected commit action can make progress in its current mode. */
export const epicHasActionableCommitWork = (
  status: EpicGitWorkStatus | undefined,
  commitWithoutPush: boolean
) => !status || status.hasChangesToCommit || (!commitWithoutPush && status.hasUnpushedCommits);

type EpicAutoPrSettings = {
  autoPrAfterCommit?: boolean;
  commitWithoutPush?: boolean;
};

type EpicRepositoryPrState = {
  prUrl?: string;
  prState?: 'OPEN' | 'CLOSED' | 'MERGED';
};

/** Whether a successful multi-project commit should continue into this repository's PR action. */
export const epicRepositoryShouldAutoCreatePr = (
  epic: EpicAutoPrSettings,
  repository: EpicRepositoryPrState
) =>
  Boolean(epic.autoPrAfterCommit) &&
  !epic.commitWithoutPush &&
  (!repository.prUrl || repository.prState === 'CLOSED');
