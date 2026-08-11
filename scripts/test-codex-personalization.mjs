import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  codexBrowserEnvironmentNote,
  codexBrowserMcpConfig,
  codexBrowserUseMode,
  codexConfigArgs,
  codexPersonalizationConfig,
  codexUtilityPrivacyOptions,
} from '../src/main/codex-config.js';
import {
  codexBrowserOptionsForIntegration,
  parseCodexChromePlugin,
  parseCodexNodeReplEnabled,
  probeCodexBrowserIntegration,
} from '../src/main/codex-browser-integration.js';

assert.deepEqual(codexPersonalizationConfig(), {});
assert.deepEqual(
  codexPersonalizationConfig({
    codexMemoryMode: 'inherit',
    codexChronicleMode: 'inherit',
    codexMemoryExternalContextMode: 'inherit',
    codexPersonality: 'inherit',
    codexDeveloperInstructions: '   ',
  }),
  {}
);

assert.deepEqual(
  codexPersonalizationConfig({
    codexMemoryMode: 'enabled',
    codexChronicleMode: 'enabled',
    codexMemoryExternalContextMode: 'enabled',
    codexPersonality: 'pragmatic',
    codexDeveloperInstructions: '  Keep responses compact.  ',
  }),
  {
    'features.memories': true,
    'memories.use_memories': true,
    'memories.generate_memories': true,
    'features.chronicle': true,
    'memories.disable_on_external_context': false,
    personality: 'pragmatic',
    developer_instructions: 'Keep responses compact.',
  }
);

assert.deepEqual(
  codexPersonalizationConfig({
    codexMemoryMode: 'disabled',
    codexChronicleMode: 'disabled',
    codexMemoryExternalContextMode: 'disabled',
    codexPersonality: 'unexpected',
  }),
  {
    'features.memories': false,
    'memories.use_memories': false,
    'memories.generate_memories': false,
    'features.chronicle': false,
    'memories.disable_on_external_context': true,
  }
);

assert.deepEqual(codexPersonalizationConfig(codexUtilityPrivacyOptions), {
  'features.memories': false,
  'memories.use_memories': false,
  'memories.generate_memories': false,
  'features.chronicle': false,
  'memories.disable_on_external_context': true,
});

assert.deepEqual(codexConfigArgs({
  'features.memories': true,
  developer_instructions: 'Use "quoted" guidance.',
}), [
  '--config',
  'features.memories=true',
  '--config',
  'developer_instructions="Use \\"quoted\\" guidance."',
]);

assert.equal(codexBrowserEnvironmentNote({}, 'full-access'), '');
assert.equal(codexBrowserEnvironmentNote({ browserControl: true }, 'read-only'), '');
assert.equal(codexBrowserUseMode({}), 'disabled');
assert.equal(codexBrowserUseMode({ browserControl: true }), 'disabled');
assert.equal(codexBrowserUseMode({ browserControl: true, browserAutoConnect: true }), 'mcp');
assert.equal(codexBrowserUseMode({ browserControl: true, browserUseMode: 'extension' }), 'extension');
const extensionNote = codexBrowserEnvironmentNote({ browserUseMode: 'extension' }, 'full-access');
assert.match(extensionNote, /ChatGPT Chrome extension/);
assert.match(extensionNote, /control-chrome skill/);
assert.match(extensionNote, /node_repl/);
const mcpNote = codexBrowserEnvironmentNote({ browserUseMode: 'mcp' }, 'full-access');
assert.match(mcpNote, /chrome_devtools MCP tools/);
assert.match(mcpNote, /real signed-in Chrome/);
assert.match(mcpNote, /remote debugging toggle/);
const fallbackMcpNote = codexBrowserEnvironmentNote(
  { browserUseMode: 'mcp', browserAutoConnect: false },
  'full-access'
);
assert.match(fallbackMcpNote, /dedicated browser profile/);
assert.doesNotMatch(fallbackMcpNote, /enable Chrome remote debugging/);
assert.deepEqual(
  codexBrowserMcpConfig({ browserUseMode: 'mcp' }, 'full-access', 'chrome-devtools-mcp@test'),
  {
    'mcp_servers.chrome_devtools.command': 'npx',
    'mcp_servers.chrome_devtools.args': ['-y', 'chrome-devtools-mcp@test', '--autoConnect'],
    'mcp_servers.chrome_devtools.startup_timeout_sec': 90,
  }
);
assert.deepEqual(
  codexBrowserMcpConfig({ browserUseMode: 'extension' }, 'full-access', 'chrome-devtools-mcp@test'),
  {}
);
assert.deepEqual(
  codexBrowserMcpConfig(
    { browserUseMode: 'mcp', browserAutoConnect: false },
    'full-access',
    'chrome-devtools-mcp@test'
  ),
  {
    'mcp_servers.chrome_devtools.command': 'npx',
    'mcp_servers.chrome_devtools.args': ['-y', 'chrome-devtools-mcp@test'],
    'mcp_servers.chrome_devtools.startup_timeout_sec': 90,
  }
);
assert.deepEqual(
  codexBrowserMcpConfig({ browserUseMode: 'mcp' }, 'read-only', 'chrome-devtools-mcp@test'),
  {}
);

const pluginList = `chrome@openai-bundled  installed, enabled  1.2.3  /tmp/chrome-plugin`;
assert.deepEqual(parseCodexChromePlugin(pluginList), {
  installed: true,
  enabled: true,
  path: '/tmp/chrome-plugin',
});
assert.equal(parseCodexNodeReplEnabled('node_repl  /tmp/node_repl  -  -  -  enabled  Unsupported'), true);
assert.deepEqual(
  codexBrowserOptionsForIntegration({ browserUseMode: 'extension', webSearch: true }, { ready: false }),
  { browserUseMode: 'mcp', browserAutoConnect: false, webSearch: true }
);
assert.deepEqual(
  codexBrowserOptionsForIntegration({ browserUseMode: 'extension' }, { ready: true }),
  { browserUseMode: 'extension' }
);
const probeCommands = [];
const readyProbe = await probeCodexBrowserIntegration(async (command) => {
  probeCommands.push(command);
  if (command === 'codex plugin list') return { stdout: pluginList };
  if (command === 'codex mcp list') {
    return { stdout: 'node_repl  /tmp/node_repl  -  -  -  enabled  Unsupported' };
  }
  if (command.includes('check-extension-installed.js')) {
    return { stdout: JSON.stringify({ installed: true, enabled: true }) };
  }
  if (command.includes('check-native-host-manifest.js')) {
    return { stdout: JSON.stringify({ correct: true }) };
  }
  throw new Error(`Unexpected command: ${command}`);
});
assert.equal(readyProbe.ready, true);
assert.equal(probeCommands.length, 4);
const missingExtensionProbe = await probeCodexBrowserIntegration(async (command) => {
  if (command === 'codex plugin list') return { stdout: pluginList };
  if (command === 'codex mcp list') {
    return { stdout: 'node_repl  /tmp/node_repl  -  -  -  enabled  Unsupported' };
  }
  const error = new Error('diagnostic reported missing setup');
  error.stdout = command.includes('check-extension-installed.js')
    ? JSON.stringify({ installed: false, enabled: false })
    : JSON.stringify({ correct: true });
  throw error;
});
assert.equal(missingExtensionProbe.ready, false);
assert.equal(missingExtensionProbe.extensionInstalled, false);
assert.match(missingExtensionProbe.detail, /Install and enable/);

const [commandSource, appServerSource, settingsSource, preloadSource] = await Promise.all([
  readFile(new URL('../src/main/command-for-model.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/codex-driver.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/SettingsPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/preload.js', import.meta.url), 'utf8'),
]);
for (const source of [commandSource, appServerSource]) {
  assert.match(source, /chromeDevtoolsMcpPackage/);
  assert.match(source, /codexBrowserMcpConfig/);
}
assert.match(settingsSource, /Browser use/);
assert.match(settingsSource, /Install extension/);
assert.match(settingsSource, /Your Chrome \(MCP\)/);
assert.match(settingsSource, /browserAutoConnect/);
assert.match(settingsSource, /Set up in Chrome/);
assert.match(preloadSource, /openChromeDebugSetup/);

console.log('Codex personalization config tests passed.');
