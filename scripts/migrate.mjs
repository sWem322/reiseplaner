/**
 * Wendet alle ausstehenden Migrationen an.
 *
 * Bewusst programmatisch statt ueber die drizzle-kit-CLI: In Produktion soll
 * kein Entwicklungswerkzeug noetig sein, und ein leerer Migrationsordner darf
 * nicht in einen haengenden Prozess laufen.
 *
 *   node scripts/migrate.mjs
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = join(projectRoot, 'drizzle');

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://reiseplaner:reiseplaner@localhost:5432/reiseplaner';

try {
  await access(join(migrationsFolder, 'meta', '_journal.json'));
} catch {
  console.log('Keine Migrationen vorhanden — nichts anzuwenden.');
  process.exit(0);
}

const pool = new pg.Pool({ connectionString, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('Migrationen angewendet.');
} catch (error) {
  /*
   * Drizzle meldet nur die abgebrochene Abfrage — der Grund steht eine Ebene
   * tiefer in `cause`. Ohne diese Kette liest sich ein nicht laufender Server
   * wie ein Fehler in der Migration selbst.
   */
  console.error('Migration fehlgeschlagen:', error instanceof Error ? error.message : error);

  for (let ursache = error?.cause; ursache !== undefined; ursache = ursache?.cause) {
    console.error('  Ursache:', ursache instanceof Error ? ursache.message : ursache);

    if (ursache?.code === 'ECONNREFUSED') {
      console.error(`  Unter ${connectionString} nimmt niemand Verbindungen an.`);
      console.error('  Laeuft "npm run db:local" noch in einem eigenen Terminal?');
    }

    if (ursache?.code === '28P01' || ursache?.code === '3D000') {
      console.error('  Zugangsdaten oder Datenbankname passen nicht zu DATABASE_URL.');
    }
  }

  process.exitCode = 1;
} finally {
  await pool.end();
}
