export type ThreadStartReservation<T> =
  | { acquired: false }
  | { acquired: true; value: T };

// Reserve synchronously before invoking `start`, then keep the reservation
// across every await until the caller has either failed or registered its run.
export const withThreadStartReservation = async <T>(
  pendingThreadIds: Set<string>,
  threadId: string,
  start: () => Promise<T>
): Promise<ThreadStartReservation<T>> => {
  if (pendingThreadIds.has(threadId)) return { acquired: false };
  pendingThreadIds.add(threadId);
  try {
    return { acquired: true, value: await start() };
  } finally {
    pendingThreadIds.delete(threadId);
  }
};
