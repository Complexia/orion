import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import mcpBridgeShimSource from '../mcp-bridge-shim.cjs?raw';
import { runShellCommand } from './shell-env.js';

export let legacyMcpCleanupPromise = Promise.resolve();

// Orchestration: spawn_subagent calls waiting on the renderer to run the
// subthread and report back via the orchestration:subagentResult invoke.
export const pendingSubagentSpawns = new Map(); // spawnId -> { resolve }

// Orchestration: stop_subagent calls waiting on the renderer to halt the
// subthread and report back via the orchestration:subagentStopResult invoke.
export const pendingSubagentStops = new Map(); // stopId -> { resolve }

// Ask the renderer to run a subagent subthread and resolve with its final
// report. Failures resolve as text (never reject) so every caller — the
// Claude SDK tool and the socket bridge below — hands the model a readable
// outcome instead of a protocol error.
export const requestSubagentSpawn = ({ getSender, threadId, projectPath, accessMode }, args) =>
  new Promise((resolve) => {
    // Read the sender at call time: sessions rebind it when the window
    // closes and reopens.
    const sender = getSender();
    if (!sender || sender.isDestroyed()) {
      resolve('Unable to spawn subagent: the Orion window is no longer available.');
      return;
    }
    const spawnId = crypto.randomUUID();
    pendingSubagentSpawns.set(spawnId, { resolve });
    try {
      sender.send('orchestration:spawnRequest', {
        spawnId,
        threadId,
        projectPath,
        accessMode,
        model: String(args.model ?? ''),
        prompt: String(args.prompt ?? ''),
        ...(args.title ? { title: String(args.title) } : {}),
        ...(args.role ? { role: String(args.role) } : {}),
      });
    } catch {
      pendingSubagentSpawns.delete(spawnId);
      resolve('Unable to spawn subagent: the Orion window is no longer available.');
    }
  });

// Ask the renderer to stop a running subagent subthread of the calling
// driver thread. Resolves as text for the same reason as spawns above.
export const requestSubagentStop = ({ getSender, threadId }, args) =>
  new Promise((resolve) => {
    const sender = getSender();
    if (!sender || sender.isDestroyed()) {
      resolve('Unable to stop subagent: the Orion window is no longer available.');
      return;
    }
    const stopId = crypto.randomUUID();
    pendingSubagentStops.set(stopId, { resolve });
    try {
      sender.send('orchestration:stopRequest', {
        stopId,
        threadId,
        ...(args.model ? { model: String(args.model) } : {}),
        ...(args.title ? { title: String(args.title) } : {}),
        ...(args.all === true ? { all: true } : {}),
      });
    } catch {
      pendingSubagentStops.delete(stopId);
      resolve('Unable to stop subagent: the Orion window is no longer available.');
    }
  });

// -------------------- Orion MCP bridge (non-Claude providers) --------------------
// Claude turns get spawn_subagent from the in-process SDK MCP server below;
// every other provider CLI is handed the dependency-free stdio shim written
// to userData. Cursor and Grok receive it through process-only plugins;
// Codex, Kimi, and OpenCode accept per-run MCP configuration directly. Every
// path carries an exact token, so concurrent runs never route by cwd.
export const mcpBridgeSessions = new Map(); // token -> { getSender, threadId, projectPath, accessMode }

let mcpBridgeInstanceIdCache = null;
// The single-instance lock already prevents two processes from sharing one
// profile. Hashing userData keeps dev and packaged profiles distinct while
// leaving one stable socket path that can be unlinked on restart. Computed
// lazily because the dev build swaps userData after startup imports.
const mcpBridgeInstanceId = () => {
  mcpBridgeInstanceIdCache ??= crypto
    .createHash('sha256')
    .update(app.getPath('userData'))
    .digest('hex')
    .slice(0, 16);
  return mcpBridgeInstanceIdCache;
};
export const mcpBridgeSocketPath = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\orion-mcp-${mcpBridgeInstanceId()}`
    : path.join(app.getPath('userData'), `orion-mcp-${mcpBridgeInstanceId()}.sock`);

export const handleMcpBridgeConnection = (socket) => {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message = null;
      try {
        message = JSON.parse(line);
      } catch {}
      if (!message || message.id === undefined) continue;
      const reply = (ok, text) => {
        try {
          socket.write(`${JSON.stringify({ id: message.id, ok, text })}\n`);
        } catch {}
      };
      const session =
        typeof message.token === 'string' && message.token
          ? mcpBridgeSessions.get(message.token)
          : undefined;
      if (!session) {
        reply(false, 'This Orion agent session token is missing, invalid, or expired.');
        continue;
      }
      const args = message.args && typeof message.args === 'object' ? message.args : {};
      if (message.tool === 'spawn_subagent') {
        if (
          typeof args.model !== 'string' ||
          !args.model.trim() ||
          typeof args.prompt !== 'string' ||
          !args.prompt.trim()
        ) {
          reply(false, 'spawn_subagent requires string `model` and `prompt` arguments.');
          continue;
        }
        void requestSubagentSpawn(session, args).then((text) => reply(true, text));
        continue;
      }
      if (message.tool === 'stop_subagent') {
        if (
          (args.model !== undefined && typeof args.model !== 'string') ||
          (args.title !== undefined && typeof args.title !== 'string') ||
          (args.all !== undefined && typeof args.all !== 'boolean')
        ) {
          reply(
            false,
            'stop_subagent takes optional string `model`/`title` and boolean `all` arguments.'
          );
          continue;
        }
        void requestSubagentStop(session, args).then((text) => reply(true, text));
        continue;
      }
      reply(false, `Unknown tool: ${message.tool}`);
    }
  });
  socket.on('error', () => {});
};

export let mcpBridgePromise = null;
export const ensureMcpBridge = () => {
  if (!mcpBridgePromise) {
    mcpBridgePromise = (async () => {
      const shimPath = path.join(app.getPath('userData'), 'orion-mcp-bridge.cjs');
      let existing = null;
      try {
        existing = await fs.readFile(shimPath, 'utf-8');
      } catch {}
      if (existing !== mcpBridgeShimSource) await fs.writeFile(shimPath, mcpBridgeShimSource);
      const socketPath = mcpBridgeSocketPath();
      if (process.platform !== 'win32') {
        try {
          await fs.unlink(socketPath);
        } catch {}
      }
      const server = net.createServer(handleMcpBridgeConnection);
      await new Promise((resolve, reject) => {
        const onStartupError = (error) => reject(error);
        server.once('error', onStartupError);
        server.listen(socketPath, () => {
          server.off('error', onStartupError);
          server.on('error', (error) => console.error('Orion MCP bridge server error:', error));
          resolve();
        });
      });
      return { shimPath, socketPath };
    })().catch((error) => {
      // Allow a later run to retry a failed setup instead of caching the error.
      mcpBridgePromise = null;
      throw error;
    });
  }
  return mcpBridgePromise;
};

// Registers a run with the bridge and returns everything the provider needs
// to launch the shim. Returns null when the bridge can't start — the run then
// simply proceeds without the spawn_subagent tool.
export const isPlainRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const mcpBridgePluginConfig = ({ command, args }) => ({
  mcpServers: {
    orion: {
      command,
      args,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  },
});

export const writeMcpBridgePlugin = async ({ token, command, args }) => {
  // Keep the leaf directory stable (`orion`) so Cursor's plugin-qualified
  // server name remains stable, while the token parent isolates every run.
  const tokenRoot = path.join(app.getPath('userData'), 'mcp-runs', token);
  const pluginDir = path.join(tokenRoot, 'orion');
  const cursorManifestDir = path.join(pluginDir, '.cursor-plugin');
  const grokManifestDir = path.join(pluginDir, '.claude-plugin');
  await Promise.all([
    fs.mkdir(cursorManifestDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(grokManifestDir, { recursive: true, mode: 0o700 }),
  ]);
  const manifest = JSON.stringify(
    { name: 'orion', version: '1.0.0', description: 'Orion subagent bridge' },
    null,
    2
  );
  const mcpConfig = JSON.stringify(mcpBridgePluginConfig({ command, args }), null, 2);
  await Promise.all([
    fs.writeFile(path.join(cursorManifestDir, 'plugin.json'), `${manifest}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(grokManifestDir, 'plugin.json'), `${manifest}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(pluginDir, 'mcp.json'), `${mcpConfig}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(pluginDir, '.mcp.json'), `${mcpConfig}\n`, { mode: 0o600 }),
  ]);
  return { pluginDir, tokenRoot };
};

export const runPluginSupportPromises = new Map();
export const providerSupportsRunPlugin = (providerId) => {
  if (providerId !== 'cursor' && providerId !== 'grok') return Promise.resolve(true);
  if (!runPluginSupportPromises.has(providerId)) {
    const helpCommand = providerId === 'cursor' ? 'cursor-agent --help' : 'grok agent --help';
    runPluginSupportPromises.set(
      providerId,
      runShellCommand(helpCommand, 10000)
        .then(({ stdout, stderr }) => `${stdout}\n${stderr}`.includes('--plugin-dir'))
        .catch(() => false)
    );
  }
  return runPluginSupportPromises.get(providerId);
};

export const registerMcpBridgeForRun = async ({
  getSender,
  threadId,
  projectPath,
  providerId,
  accessMode,
}) => {
  try {
    await legacyMcpCleanupPromise;
    const { shimPath, socketPath } = await ensureMcpBridge();
    const token = crypto.randomUUID();
    // ELECTRON_RUN_AS_NODE turns Orion's own binary into a plain Node runtime;
    // forge.config.js deliberately keeps that fuse enabled for this shim.
    const command = process.execPath;
    const args = [shimPath, '--socket', socketPath, '--token', token];
    const { pluginDir, tokenRoot } = await writeMcpBridgePlugin({ token, command, args });
    mcpBridgeSessions.set(token, {
      getSender,
      threadId,
      projectPath,
      providerId,
      accessMode,
    });
    return {
      token,
      socketPath,
      shimPath,
      command,
      args,
      pluginDir,
      release: () => {
        mcpBridgeSessions.delete(token);
        void fs.rm(tokenRoot, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    console.error('Orion MCP bridge unavailable:', error);
    return null;
  }
};

// The ACP wire shape (session/new + session/load mcpServers) for the bridge.
export const orionAcpMcpServers = (orionMcp) =>
  orionMcp
    ? [
        {
          name: 'orion',
          command: orionMcp.command,
          args: orionMcp.args,
          env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
        },
      ]
    : [];

export const openCodeMcpConfigContent = (orionMcp, existingContent) => {
  if (!orionMcp) return null;
  let base = {};
  if (typeof existingContent === 'string' && existingContent.trim()) {
    try {
      base = JSON.parse(existingContent);
    } catch (error) {
      console.error('OpenCode inline config is invalid; Orion MCP bridge omitted:', error);
      return null;
    }
    if (!isPlainRecord(base)) {
      console.error('OpenCode inline config must be an object; Orion MCP bridge omitted.');
      return null;
    }
  }
  const existingMcp = base.mcp === undefined ? {} : base.mcp;
  if (!isPlainRecord(existingMcp)) {
    console.error('OpenCode inline `mcp` config must be an object; Orion MCP bridge omitted.');
    return null;
  }
  return JSON.stringify({
    ...base,
    mcp: {
      ...existingMcp,
      orion: {
        type: 'local',
        command: [orionMcp.command, ...orionMcp.args],
        environment: { ELECTRON_RUN_AS_NODE: '1' },
        enabled: true,
      },
    },
  });
};

// Remove only the persistent bridge entries written by the short-lived
// global-config implementation. Current runs use process-only plugins, so
// leaving these behind would load duplicate/stale Orion servers.
export const grokMcpBlockStart = '# >>> orion mcp bridge >>>';
export const grokMcpBlockEnd = '# <<< orion mcp bridge <<<';
export const cleanupLegacyMcpBridgeConfigs = async () => {
  // Per-run plugins are disposable. A crash may leave an old tokenized
  // directory behind, but no active process can legitimately use it after a
  // fresh app launch.
  await fs
    .rm(path.join(app.getPath('userData'), 'mcp-runs'), { recursive: true, force: true })
    .catch(() => {});

  const grokConfigPath = path.join(os.homedir(), '.grok', 'config.toml');
  try {
    const existing = await fs.readFile(grokConfigPath, 'utf-8');
    const startIndex = existing.indexOf(grokMcpBlockStart);
    const endIndex =
      startIndex === -1 ? -1 : existing.indexOf(grokMcpBlockEnd, startIndex);
    if (startIndex !== -1 && endIndex !== -1) {
      const afterIndex = endIndex + grokMcpBlockEnd.length;
      const before = existing.slice(0, startIndex);
      let after = existing.slice(afterIndex);
      if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
      await fs.writeFile(grokConfigPath, `${before}${after}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Could not remove legacy Grok MCP bridge:', error);
  }

  const cursorConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  try {
    const existing = await fs.readFile(cursorConfigPath, 'utf-8');
    const config = JSON.parse(existing);
    const entry = config?.mcpServers?.orion;
    const legacyArgs = Array.isArray(entry?.args) ? entry.args : [];
    const isLegacyEntry =
      typeof entry?.command === 'string' &&
      legacyArgs.some(
        (value) => typeof value === 'string' && path.basename(value) === 'orion-mcp-bridge.cjs'
      ) &&
      entry?.env?.ELECTRON_RUN_AS_NODE === '1';
    if (isLegacyEntry) {
      delete config.mcpServers.orion;
      await fs.writeFile(cursorConfigPath, `${JSON.stringify(config, null, 2)}\n`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Could not remove legacy Cursor MCP bridge:', error);
  }
};

export const startLegacyMcpCleanup = () => {
  legacyMcpCleanupPromise = cleanupLegacyMcpBridgeConfigs().catch((error) => {
    console.error('Could not finish legacy MCP bridge cleanup:', error);
  });
  return legacyMcpCleanupPromise;
};
