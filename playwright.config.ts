import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const IS_CI = process.env.CI !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
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
    /*
     * Das Startskript bringt seine eigene Datenbank mit — kein `globalSetup`.
     *
     * Playwright startet den Webserver naemlich **vor** dem globalSetup. Eine
     * dort gesetzte DATABASE_URL erreicht den laufenden Prozess nicht mehr,
     * und jeder Test scheiterte an einer Datenbank, die es nicht gab. Wer
     * beides in einem Prozess startet, hat das Problem nicht.
     */
    command: `npm run build && node scripts/e2e-server.mjs --port ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
