import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const IS_CI = process.env.CI !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Startet eine eingebettete Datenbank und setzt DATABASE_URL, bevor der
  // Webserver hochfaehrt. Kein Docker, keine Registry, keine Vorbedingungen.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : '50%',
  reporter: IS_CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // E2E laeuft gegen einen Produktionsbuild, damit getestet wird, was auch
  // deployt wird. Ohne gesetzte Anbieter-Schluessel greifen die Seed-Adapter,
  // wodurch der Ablauf deterministisch bleibt.
  webServer: {
    command: `npm run build && npm run start -- --port ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
