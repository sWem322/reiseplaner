import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Zwei getrennte Projekte: Unit laeuft ohne jede Infrastruktur,
    // Integration darf Datenbank und In-Memory-Adapter benutzen.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/server/**'],
      exclude: [
        '**/*.test.ts',
        // Reine Typdeklarationen — zur Laufzeit existiert davon nichts,
        // eine Abdeckungszahl waere ein Artefakt.
        'src/domain/ports/**',
        'src/server/db/schema.ts',
        // Verbindungsaufbau: laeuft im Betrieb, nicht im Test. Die Tests
        // arbeiten bewusst gegen eine eigene Wegwerf-Instanz.
        'src/server/db/client.ts',
      ],
      thresholds: {
        // Die Domaene ist der Kern des Projekts und wird streng geprueft.
        'src/domain/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        // Adapter und Repositories duerfen etwas lockerer sein — ihre
        // Fehlerpfade haengen an externen Systemen.
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
    },
  },
});
