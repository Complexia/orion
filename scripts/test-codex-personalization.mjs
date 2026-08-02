import assert from 'node:assert/strict';
import {
  codexConfigArgs,
  codexPersonalizationConfig,
  codexUtilityPrivacyOptions,
} from '../src/main/codex-config.js';

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

console.log('Codex personalization config tests passed.');
