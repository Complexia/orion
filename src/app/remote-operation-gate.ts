export type LatestOperationGate = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (operation: number) => boolean;
};

// A tiny request-generation gate shared by RemoteMachineView's async paths.
// Every begin supersedes the prior operation; selection or machine changes can
// invalidate without starting replacement work.
export const createLatestOperationGate = (): LatestOperationGate => {
  let generation = 0;
  return {
    begin: () => {
      generation += 1;
      return generation;
    },
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (operation) => operation === generation,
  };
};
