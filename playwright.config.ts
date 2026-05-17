import { defineConfig, devices } from '@playwright/test';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./tests/global-setup'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm start',
      cwd: './backend',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: TEST_DB_URL,
        NODE_ENV: 'test',
        PORT: '4000',
      },
    },
    {
      command: 'npm run dev',
      cwd: './frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
