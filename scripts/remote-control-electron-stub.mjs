// Minimal 'electron' stand-in so the remote-control engine can run under
// plain node in tests. userData comes from ORION_TEST_USERDATA so each test
// process gets its own machine identity.
import os from 'node:os';

export const app = {
  isPackaged: process.env.ORION_TEST_PACKAGED === '1',
  getPath: () => process.env.ORION_TEST_USERDATA ?? os.tmpdir(),
  getVersion: () => '0.0.0-test',
};

export const safeStorage = {
  isEncryptionAvailable: () => process.env.ORION_TEST_SAFE_STORAGE === '1',
  getSelectedStorageBackend: () => process.env.ORION_TEST_STORAGE_BACKEND ?? 'unknown',
  encryptString: () => {
    throw new Error('safeStorage is unavailable in tests');
  },
  decryptString: () => {
    throw new Error('safeStorage is unavailable in tests');
  },
};

export default { app, safeStorage };
