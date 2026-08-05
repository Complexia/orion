import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty is a native module (prebuilt .node + spawn-helper binary);
      // it must stay external so it resolves from node_modules at runtime
      // instead of being bundled into the main-process bundle. Packaging
      // copies it in via the packageAfterCopy hook in forge.config.js.
      // node:sqlite is a builtin the forge vite plugin's externals list
      // predates; without this the dev build stubs it out and fails.
      external: ['node-pty', 'node:sqlite'],
    },
  },
});
