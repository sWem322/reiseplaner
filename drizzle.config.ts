import type { Config } from 'drizzle-kit';

/**
 * Migrationen liegen als lesbares SQL im Repository (drizzle/), damit sie
 * im Review nachvollziehbar sind und in CI deterministisch angewendet werden.
 */
export default {
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://reiseplaner:reiseplaner@localhost:5432/reiseplaner',
  },
} satisfies Config;
