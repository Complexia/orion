import path from 'node:path';
import { codexBrowserUseMode } from './codex-config.js';

export const codexBrowserExtensionStoreUrl =
  'https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg';

const rowColumns = (line) => String(line || '').trim().split(/\s{2,}/).filter(Boolean);

export const parseCodexChromePlugin = (output) => {
  const row = String(output || '')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('chrome@openai-bundled'));
  if (!row) return { installed: false, enabled: false, path: null };
  const columns = rowColumns(row);
  const status = columns[1] || '';
  return {
    installed: status.startsWith('installed'),
    enabled: status === 'installed, enabled',
    path: columns.length >= 4 ? columns[columns.length - 1] : null,
  };
};

export const parseCodexNodeReplEnabled = (output) => {
  const row = String(output || '')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('node_repl'));
  return row ? rowColumns(row).includes('enabled') : false;
};

export const codexBrowserOptionsForIntegration = (providerOptions, integrationStatus) => {
  const options =
    providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
  if (codexBrowserUseMode(options) === 'extension' && integrationStatus?.ready !== true) {
    return { ...options, browserUseMode: 'mcp', browserAutoConnect: false };
  }
  return options;
};

const parseJsonOutput = (output) => {
  try {
    return JSON.parse(String(output || '').trim());
  } catch {
    return null;
  }
};

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const diagnosticCommand = (scriptPath, extraArgs = '') =>
  `node ${shellQuote(scriptPath)}${extraArgs ? ` ${extraArgs}` : ''}`;

const runDiagnostic = async (runCommand, command) => {
  try {
    return await runCommand(command, 10000);
  } catch (error) {
    // The bundled diagnostics intentionally use non-zero exits for missing or
    // disabled setup, but still print the structured result we need.
    return { stdout: error?.stdout || '', stderr: error?.stderr || '' };
  }
};

export const probeCodexBrowserIntegration = async (runCommand) => {
  let pluginOutput = '';
  let mcpOutput = '';
  try {
    [{ stdout: pluginOutput = '' }, { stdout: mcpOutput = '' }] = await Promise.all([
      runCommand('codex plugin list', 15000),
      runCommand('codex mcp list', 10000),
    ]);
  } catch {
    return {
      status: 'unavailable',
      ready: false,
      pluginInstalled: false,
      pluginEnabled: false,
      nodeReplEnabled: false,
      extensionInstalled: null,
      extensionEnabled: null,
      nativeHostReady: null,
      detail: 'Could not inspect this Codex installation. Use the dedicated MCP browser until Codex browser support is available.',
    };
  }

  const plugin = parseCodexChromePlugin(pluginOutput);
  const nodeReplEnabled = parseCodexNodeReplEnabled(mcpOutput);
  let extensionInstalled = null;
  let extensionEnabled = null;
  let nativeHostReady = null;

  if (plugin.enabled && plugin.path) {
    const scriptsDirectory = path.join(plugin.path, 'scripts');
    try {
      const [{ stdout: extensionOutput }, { stdout: nativeHostOutput }] = await Promise.all([
        runDiagnostic(
          runCommand,
          diagnosticCommand(path.join(scriptsDirectory, 'check-extension-installed.js'), '--browser chrome --json'),
        ),
        runDiagnostic(
          runCommand,
          diagnosticCommand(path.join(scriptsDirectory, 'check-native-host-manifest.js'), '--browser chrome --json'),
        ),
      ]);
      const extension = parseJsonOutput(extensionOutput);
      const nativeHost = parseJsonOutput(nativeHostOutput);
      extensionInstalled = extension?.installed === true;
      extensionEnabled = extension?.enabled === true;
      nativeHostReady = nativeHost?.correct === true;
    } catch {}
  }

  const ready =
    plugin.enabled &&
    nodeReplEnabled &&
    extensionInstalled === true &&
    extensionEnabled === true &&
    nativeHostReady === true;
  let detail = 'Codex browser support is ready to use your signed-in Chrome.';
  if (!plugin.installed || !plugin.enabled) {
    detail = 'The Codex Chrome plugin is not installed and enabled. Install or update Codex browser support, or use the dedicated MCP browser.';
  } else if (!nodeReplEnabled) {
    detail = 'Codex node_repl browser support is not enabled. Install or update Codex browser support, or use the dedicated MCP browser.';
  } else if (extensionInstalled === false || extensionEnabled === false) {
    detail = 'Install and enable the ChatGPT Chrome extension to let Codex use your signed-in Chrome.';
  } else if (nativeHostReady === false) {
    detail = 'The Codex browser native host needs repair. Reinstall Codex browser support, or use the dedicated MCP browser.';
  } else if (!ready) {
    detail = 'Codex could not verify the Chrome extension connection. Use the dedicated MCP browser until setup is complete.';
  }

  return {
    status: ready ? 'ready' : 'setup-required',
    ready,
    pluginInstalled: plugin.installed,
    pluginEnabled: plugin.enabled,
    nodeReplEnabled,
    extensionInstalled,
    extensionEnabled,
    nativeHostReady,
    detail,
  };
};
