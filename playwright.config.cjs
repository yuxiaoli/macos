'use strict';
const fs = require('node:fs');
const { defineConfig } = require('@playwright/test');
const { chromium } = require('playwright');
const chromiumExecutable = process.env.CHROMIUM_EXECUTABLE_PATH || (!fs.existsSync(chromium.executablePath()) && fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.cjs',
    url: 'http://127.0.0.1:3100',
    env: { PORT: '3100' },
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : {} } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
