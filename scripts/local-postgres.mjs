/**
 * Startet eine eingebettete PostgreSQL-Instanz ohne Docker.
 *
 * Gedacht fuer Umgebungen, in denen kein Docker-Daemon verfuegbar ist
 * (CI-Sandboxes, restriktive Arbeitsrechner). Dieselbe Server-Version,
 * dieselben Migrationen — nur ohne Container-Laufzeit.
 *
 *   node scripts/local-postgres.mjs
 *
 * Beenden mit Strg+C; die Daten liegen unter .postgres/ und bleiben erhalten.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(projectRoot, '.postgres');

const PORT = Number(process.env.PGPORT ?? 5432);
const USER = 'reiseplaner';
const PASSWORD = 'reiseplaner';
const DATABASE = 'reiseplaner';

await mkdir(dataDir, { recursive: true });

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  onLog: () => {
    // Server-Logs bleiben stumm; nur unsere eigenen Meldungen sind relevant.
  },
});

let initialised = true;
try {
  await postgres.initialise();
  initialised = false;
} catch {
  // Datenverzeichnis existiert bereits — das ist der Normalfall beim Neustart.
}

await postgres.start();

if (!initialised) {
  try {
    await postgres.createDatabase(DATABASE);
  } catch {
    // Datenbank existiert bereits.
  }
}

const url = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;
console.log(`PostgreSQL laeuft auf Port ${PORT}`);
console.log(`DATABASE_URL="${url}"`);
console.log('Beenden mit Strg+C.');

const shutdown = async () => {
  console.log('\nPostgreSQL wird beendet ...');
  await postgres.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
