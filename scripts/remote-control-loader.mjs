// Module customization hook: resolve 'electron' to the test stub. Registered
// by test-remote-control.mjs child processes before the engine is imported.
export const resolve = (specifier, context, nextResolve) => {
  if (specifier === 'electron') {
    return {
      url: new URL('./remote-control-electron-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
};
