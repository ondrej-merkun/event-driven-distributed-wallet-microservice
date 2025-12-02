// Set longer timeout for integration tests
jest.setTimeout(30000);

// Node.js 22 compatibility: Add crypto global for Jest
import { webcrypto } from 'crypto';
global.crypto = webcrypto as any;// DISABLED: Cron jobs should run in tests for full coverage
// process.env.NODE_ENV = 'test';
