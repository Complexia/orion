// Per-thread steering admission. A reservation is published synchronously,
// while each operation waits for its predecessor before doing async preflight.
// Cancellation generations let Stop invalidate both the active operation and
// submissions already waiting behind it without mutating their promises.
export const createThreadSteeringCoordinator = () => {
  const pending = new Map();
  const generations = new Map();

  const cancel = (threadIds) => {
    for (const threadId of threadIds) {
      generations.set(threadId, (generations.get(threadId) ?? 0) + 1);
      // A future run must not wait behind stale preparation or IPC from the
      // stopped generation. Those promises keep their cancellation closure
      // and remain safe to finish independently.
      pending.delete(threadId);
    }
  };

  const enqueue = (threadId, work) => {
    const generation = generations.get(threadId) ?? 0;
    const previous = pending.get(threadId);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      work(() => (generations.get(threadId) ?? 0) !== generation)
    );
    pending.set(threadId, operation);
    const release = () => {
      if (pending.get(threadId) === operation) pending.delete(threadId);
    };
    void operation.then(release, release);
    return operation;
  };

  return { cancel, enqueue };
};
