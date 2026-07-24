import { BrowserWindow } from 'electron';

export const emitAgentEvent = (webContents, event) => {
  if (!webContents.isDestroyed()) {
    webContents.send('agent:turnEvent', event);
  }
};

export const sendToAllWindows = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};
