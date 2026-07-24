import { app } from 'electron';
import path from 'node:path';

export const storageFileName = 'orion-store.json';
export const threadsFileName = 'orion-threads.json';
export const accountSessionFileName = 'orion-account-session.json';
export const attachmentDirectoryName = 'attachments';
export const attachmentProtocol = 'orion-attachment';
export const appProtocol = 'orion';
export const getStorageFilePath = () => path.join(app.getPath('userData'), storageFileName);
export const getThreadsFilePath = () => path.join(app.getPath('userData'), threadsFileName);
export const getAccountSessionFilePath = () => path.join(app.getPath('userData'), accountSessionFileName);
export const getAttachmentDirectoryPath = () => path.join(app.getPath('userData'), attachmentDirectoryName);
