import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.join(os.homedir(), '.cache/ms-playwright');
const local = fs.existsSync(root)
  ? fs
      .readdirSync(root)
      .filter((p) => /^chromium-\d+$/.test(p))
      .sort()
      .reverse()
      .map((p) => path.join(root, p, 'chrome-linux64/chrome'))
      .find((p) => fs.existsSync(p))
  : undefined;
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:5011',
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      ...(local ? { executablePath: local } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 5011',
    url: 'http://127.0.0.1:5011',
    reuseExistingServer: false,
  },
});
