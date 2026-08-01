import { defineConfig, devices } from '@playwright/test';

/**
 * Eigene Konfiguration für die Aufnahme des Demo-GIFs.
 *
 * Getrennt von `playwright.config.ts`, weil sich beide in fast allem
 * widersprechen: Der E2E-Lauf will Geschwindigkeit, Parallelität und
 * Determinismus ohne fremde Dienste; die Aufnahme will ein Video, ein
 * einzelnes Fenster in fester Größe und das **echte** Sprachmodell.
 *
 * Läuft ausdrücklich gegen den Entwicklungsserver auf Port 3000, der bereits
 * steht — mit der `.env`, die auch sonst gilt. Ein eigener Produktionsbuild
 * wäre hier nur Wartezeit; und wer das GIF aufnimmt, hat die Anwendung ohnehin
 * gerade offen.
 */

/*
 * `localhost`, nicht `127.0.0.1`: Der Entwicklungsserver von Next.js sieht
 * die zweite Schreibweise als fremde Herkunft an und blockt seine eigenen
 * HMR-Ressourcen. Auf die Aufnahme wirkt sich das nicht aus, aber es füllt
 * die Konsole mit einer Warnung, die nach einem Fehler aussieht.
 */
const BASE_URL = process.env.DEMO_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './demo',
  testMatch: '**/*.spec.ts',
  // Eine Aufnahme, kein Testlauf: keine Parallelität, keine Wiederholungen.
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,

  use: {
    baseURL: BASE_URL,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',

    /*
     * 1280×800 ist ein Kompromiss: gross genug, dass Entwurfsleiste und Karten
     * nebeneinander passen, klein genug, dass das GIF unter zehn Megabyte
     * bleibt. GitHub zeigt es im README auf etwa 800 Pixel Breite an.
     */
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  outputDir: './demo/aufnahme',
});
