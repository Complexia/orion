import { BrowserWindow } from 'electron';

// Taps on agent turn events, so main-process consumers (remote control) can
// follow runs without a renderer in the loop. Listener errors never break the
// renderer path.
const agentEventListeners = new Set();

export const addAgentEventListener = (listener) => {
  agentEventListeners.add(listener);
  return () => agentEventListeners.delete(listener);
};

const notifyAgentEventListeners = (event) => {
  for (const listener of agentEventListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('agent event listener error', error);
    }
  }
};

export const emitAgentEvent = (webContents, event) => {
  if (!webContents.isDestroyed()) {
    webContents.send('agent:turnEvent', event);
  }
  notifyAgentEventListeners(event);
};

export const sendToAllWindows = (channel, payload) => {
  let delivered = 0;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
      delivered += 1;
    }
  }
  if (channel === 'agent:turnEvent') notifyAgentEventListeners(payload);
  return delivered;
};
