import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty is a native module (prebuilt .node + spawn-helper binary);
      // it must stay external so it resolves from node_modules at runtime
      // instead of being bundled into the main-process bundle. Packaging
      // copies it in via the packageAfterCopy hook in forge.config.js.
      external: ['node-pty'],
    },
  },
});
