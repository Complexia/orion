#!/usr/bin/env node
// Orion MCP bridge shim: a dependency-free stdio MCP server that provider
// CLIs (codex, cursor, grok, kimi) spawn as the `orion` MCP server. It
// exposes the spawn_subagent tool and forwards calls to the Orion desktop
// app over a local socket; the app runs the subagent as a visible subthread
// and returns its final report. Claude runs use the in-process SDK server in
// main.js instead — this file is copied to userData and never bundled.
//
// Identity travels out-of-band through --socket/--token argv in the per-run
// MCP configuration. Environment fallbacks are retained for compatibility.
'use strict';
const net = require('net');

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index !== -1 && index + 1 < argv.length ? argv[index + 1] : undefined;
};
const socketPath = argValue('--socket') || process.env.ORION_MCP_SOCKET || '';
const token = argValue('--token') || process.env.ORION_MCP_TOKEN || '';

const spawnSubagentTool = {
  name: 'spawn_subagent',
  description:
    'Spawn an Orion subagent on a specific model to perform a task. Blocks until the subagent finishes and returns its final report. Safe to call multiple times in one message — parallel calls run their subagents concurrently. Use for delegating work to specialized models (computer use, exploration, implementation, image/video generation) or to a model the user requested by @-mention.',
  // Claude-Code-derived clients (grok) only run MCP tool calls concurrently
  // when readOnlyHint is set; without it parallel spawns serialize behind the
  // first child's entire run. The call mutates nothing in the driver's
  // session, and the child inherits the driver's access mode.
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Target model: model id (e.g. "codex:gpt-5.6-sol"), slug, or label',
      },
      prompt: {
        type: 'string',
        description:
          'Complete, self-contained task for the subagent, including all context it needs and what to report back',
      },
      title: { type: 'string', description: 'Short title for the subthread shown in the sidebar' },
      role: {
        type: 'string',
        description:
          'Orchestration role this delegation fulfils: computerUse | exploring | implementation | imageVideoGen',
      },
    },
    required: ['model', 'prompt'],
    additionalProperties: false,
  },
};

const write = (message) => {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {}
};
const respond = (id, result) => write({ jsonrpc: '2.0', id, result });
const respondError = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

// One socket connection per call; a spawned subagent can run for a long time,
// so there is deliberately no client-side timeout.
const callOrion = (args) =>
  new Promise((resolve) => {
    if (!socketPath) {
      resolve({ ok: false, text: 'The Orion bridge socket path is not configured.' });
      return;
    }
    let settled = false;
    let buffer = '';
    const socket = net.connect(socketPath);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      try {
        socket.destroy();
      } catch {}
    };
    socket.on('connect', () => {
      socket.write(
        `${JSON.stringify({ id: 1, token, tool: 'spawn_subagent', args })}\n`
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        finish({ ok: reply.ok !== false, text: String(reply.text ?? '') });
      } catch {
        finish({ ok: false, text: 'Received an invalid response from Orion.' });
      }
    });
    socket.on('error', (error) => {
      finish({
        ok: false,
        text: `Could not reach the Orion desktop app (${error.message}). Is Orion running?`,
      });
    });
    socket.on('close', () => {
      finish({ ok: false, text: 'The connection to Orion closed before a result arrived.' });
    });
  });

const handleMessage = async (message) => {
  const method = message.method;
  if (method === 'initialize') {
    const requested = message.params?.protocolVersion;
    respond(message.id, {
      protocolVersion: typeof requested === 'string' && requested ? requested : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'orion', version: '1.0.0' },
    });
    return;
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  if (method === 'tools/list') {
    respond(message.id, { tools: [spawnSubagentTool] });
    return;
  }
  if (method === 'tools/call') {
    const name = message.params?.name;
    if (name !== 'spawn_subagent') {
      respondError(message.id, -32602, `Unknown tool: ${name}`);
      return;
    }
    const rawArgs = message.params?.arguments;
    const result = await callOrion(rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
    respond(message.id, { content: [{ type: 'text', text: result.text }], isError: !result.ok });
    return;
  }
  if (method === 'ping') {
    respond(message.id, {});
    return;
  }
  // Some clients probe these even when the capability isn't advertised.
  if (method === 'resources/list') {
    respond(message.id, { resources: [] });
    return;
  }
  if (method === 'prompts/list') {
    respond(message.id, { prompts: [] });
    return;
  }
  if (message.id !== undefined) respondError(message.id, -32601, `Method not found: ${method}`);
};

let inputBuffer = '';
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk.toString();
  let newline;
  while ((newline = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    let message = null;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message && typeof message === 'object') void handleMessage(message);
  }
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
