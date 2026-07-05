---
name: verify
description: Build, launch, and drive Orion (Electron + Forge + Vite) to verify changes at the GUI surface via Chrome DevTools Protocol.
---

# Verifying Orion changes

Orion is an Electron app (electron-forge + vite plugin). No tsconfig — Vite
transpiles TS without typechecking, so `npx vite build --config
vite.renderer.config.mjs` is the fastest renderer compile check, and
`node --input-type=module --check < src/main.js` catches main-process syntax
errors (main.js is ESM).

## Launch with a driving handle

```bash
npx electron-forge start -- --remote-debugging-port=9222 > /tmp/orion-verify.log 2>&1 &
# CDP is up within ~2s; poll http://localhost:9222/json
```

Args after `--` are forwarded to the Electron app, so Chromium switches like
`--remote-debugging-port` work. The window loads http://localhost:5173/.

## Drive via CDP (no playwright needed)

Node >= 22 has a global `WebSocket`. Connect to `webSocketDebuggerUrl` from
`GET /json`, then:

- `Runtime.evaluate` with `awaitPromise: true, returnByValue: true` to run JS
  in the renderer — including the preload bridge (`window.orion.*`), which
  exercises real IPC into the main process.
- `Page.captureScreenshot` for PNG evidence.
- Simulate clicks with `document.querySelector(...).click()`; the app's global
  Escape/outside-click handlers respond to synthetic `KeyboardEvent`s.

## Gotchas

- The user usually has the production `/Applications/Orion.app` running —
  `pgrep Orion` matches it. Kill only by the debugging-port pattern:
  `pkill -f "remote-debugging-port=9222"`.
- Main-process changes are NOT hot-reloaded reliably; restart forge.
- `osascript` Apple-events checks (e.g. asking Finder for window names) hang
  on TCC permission prompts in non-interactive sessions — don't use them.
- Error surfaces in the renderer use sonner toasts:
  `document.querySelectorAll('[data-sonner-toast]')`.
