

export const activeAgentRuns = new Map(); // runId -> { child, threadId }
// Runs killed on purpose (stop / steer) — their nonzero exit must not trigger
// the "resume failed, retry fresh" fallback in agent:runTurn.
export const stoppedAgentRuns = new Set();
// Runs whose agent:runTurn handler is still in async startup (model checks,
// git snapshots) — registered synchronously at handler entry, before the run
// is stoppable via activeAgentRuns or a claude session turn. A stop/steer
// landing in that window marks the entry aborted (and reads as interrupted)
// so the startup bails instead of launching a run the renderer no longer
// tracks.
export const startingAgentRuns = new Map(); // runId -> { aborted, threadId, terminateBackground? }
// ACP/app-server processes (kimi, grok, codex goals) idle forever once their
// turn resolves, and a SIGTERM alone is not a guarantee: escalate to SIGKILL
// if the process is still alive shortly after.
export const terminatingAgentChildren = new WeakMap();
// Once finalization removes a run from activeAgentRuns, destructive thread
// teardown must still be able to find and await its provider process.
const terminatingAgentChildrenByThread = new Map();
export const pendingAgentShutdowns = new Set();
export const trackAgentShutdown = (operation) => {
  let tracked;
  tracked = Promise.resolve(operation)
    .catch(() => {})
    .then(() => pendingAgentShutdowns.delete(tracked));
  pendingAgentShutdowns.add(tracked);
  return tracked;
};

export const waitForPendingAgentShutdowns = async () => {
  while (pendingAgentShutdowns.size > 0) {
    await Promise.all([...pendingAgentShutdowns]);
  }
};

export const killAgentChild = (child, threadId) => {
  let trackedTermination;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    trackedTermination = Promise.resolve();
  } else {
    trackedTermination = terminatingAgentChildren.get(child);
    if (!trackedTermination) {
      const termination = new Promise((resolve) => {
        let settled = false;
        let forceTimer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (forceTimer) clearTimeout(forceTimer);
          child.removeListener?.('exit', finish);
          child.removeListener?.('close', finish);
          resolve();
        };

        child.once('exit', finish);
        child.once('close', finish);
        // The child can exit between the initial check and listener setup.
        if (child.exitCode !== null || child.signalCode !== null) {
          finish();
          return;
        }

        forceTimer = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) {
            finish();
            return;
          }
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 2000);

        try {
          child.kill('SIGTERM');
        } catch {}
      });
      trackedTermination = trackAgentShutdown(termination);
      terminatingAgentChildren.set(child, trackedTermination);
    }
  }

  if (threadId) {
    let threadShutdowns = terminatingAgentChildrenByThread.get(threadId);
    if (!threadShutdowns) {
      threadShutdowns = new Set();
      terminatingAgentChildrenByThread.set(threadId, threadShutdowns);
    }
    if (!threadShutdowns.has(trackedTermination)) {
      threadShutdowns.add(trackedTermination);
      void trackedTermination.finally(() => {
        const current = terminatingAgentChildrenByThread.get(threadId);
        if (!current) return;
        current.delete(trackedTermination);
        if (current.size === 0) terminatingAgentChildrenByThread.delete(threadId);
      });
    }
  }
  return trackedTermination;
};

export const waitForAgentThreadShutdowns = async (threadId) => {
  let found = false;
  let threadShutdowns = terminatingAgentChildrenByThread.get(threadId);
  while (threadShutdowns?.size) {
    found = true;
    await Promise.all([...threadShutdowns]);
    threadShutdowns = terminatingAgentChildrenByThread.get(threadId);
  }
  return found;
};
// Runs whose terminal event is being prepared: the run has been forgotten
// (activeAgentRuns / activeTurns) but the emit still awaits git summarization.
// Lets the renderer's steer race distinguish "outcome in flight" from "no
// outcome coming" — see agent:isRunFinalizing.
export const finalizingAgentRuns = new Set();
