

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
export const startingAgentRuns = new Map(); // runId -> { aborted }
// ACP/app-server processes (kimi, grok, codex goals) idle forever once their
// turn resolves, and a SIGTERM alone is not a guarantee: escalate to SIGKILL
// if the process is still alive shortly after.
export const terminatingAgentChildren = new WeakMap();
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

export const killAgentChild = (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  const existing = terminatingAgentChildren.get(child);
  if (existing) return existing;

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
  const trackedTermination = trackAgentShutdown(termination);
  terminatingAgentChildren.set(child, trackedTermination);
  return trackedTermination;
};
// Runs whose terminal event is being prepared: the run has been forgotten
// (activeAgentRuns / activeTurns) but the emit still awaits git summarization.
// Lets the renderer's steer race distinguish "outcome in flight" from "no
// outcome coming" — see agent:isRunFinalizing.
export const finalizingAgentRuns = new Set();
