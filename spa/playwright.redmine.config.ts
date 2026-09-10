import { defineConfig, devices } from '@playwright/test';

// The CI suite runs against fixture-sized data, where 60 s is generous. The
// 10,000-issue load run is a different budget entirely: its two data requests
// alone once exceeded this, turning a slow-but-successful endpoint into a bare
// timeout with no numbers (GitHub issue #10). Set the budget for that run
// deliberately rather than inheriting this one.
const DEFAULT_TIMEOUT_MS = 60_000;

const configuredTimeoutMs = Number(process.env.CANVAS_GANTT_SMOKE_TIMEOUT_MS);
const timeoutMs = Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : DEFAULT_TIMEOUT_MS;

export default defineConfig({
  testDir: './tests/e2e-redmine',
  testMatch: /.*\.pw\.ts$/,
  timeout: timeoutMs,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.REDMINE_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
