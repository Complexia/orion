# Codex session ownership

Orion's shared Codex app-server keeps native conversation state between turns.
Closing a run's WebSocket releases that client's lease; recycling the server or
quitting Orion must also stop the native server behind the Codex CLI launcher.

`spawnCodexServerProcess` launches a small supervisor using Orion's Node-capable
Electron binary. An IPC connection ties the supervisor to the owning Orion
process. On shutdown, launcher exit, or loss of that connection, the supervisor
terminates the server's process group and escalates if it remains alive. The
supervisor uses a separate process group so an abrupt owner-group termination
still lets it perform cleanup. Shared servers, direct app-server runs, and
standalone goal operations all use this path. Other provider processes do not.

The supervisor finishes within the existing child-shutdown escalation window.
It does not add a new dependency to Orion's application quit barrier. Only its
own server group is signaled; it never scans for or terminates unrelated Codex
processes.

A failed `thread/resume` keeps the stored session ID and reports the actual
provider error. This includes active-writer conflicts, transport errors, and
missing history. Orion does not automatically create a context-free replacement
conversation. The generic process-exit fallback also excludes Codex.

## Validation

```sh
node --no-warnings scripts/test-codex-server-process.mjs
node --no-warnings scripts/test-codex-app-server-manager.mjs
node scripts/run-electron-test.mjs scripts/test-codex-driver.mjs
node scripts/run-electron-test.mjs scripts/test-steering.mjs
node scripts/run-electron-test.mjs scripts/test-codex-resume-live.mjs
bun run package
```

The process tests cover a launcher exiting before its SIGTERM-resistant native
child and the owner being killed without running shutdown handlers. The live
test requires Codex on the login-shell PATH. It uses a temporary `CODEX_HOME` and
a local Responses stub, so it needs no account credentials or external model
requests. It reproduces the active-writer error and verifies that follow-up
model requests retain earlier context after recycling and owner loss. Process
group cleanup and live resume were validated on macOS; Windows uses `taskkill`
and needs separate platform validation.
