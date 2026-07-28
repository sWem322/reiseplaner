import EmbeddedPostgres from 'embedded-postgres';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '@/server/db/schema';

const MIGRATIONS_FOLDER = './drizzle';

/**
 * Kodierung und Sortierung fest vorgeben.
 *
 * Ohne diese Flags uebernimmt initdb die Systemlokale des Entwicklungsrechners.
 * Auf einem Windows-System mit russischer Lokale entsteht dabei ein Cluster in
 * WIN1251 — und deutsche Umlaute lassen sich dort nicht speichern
 * ("character with byte sequence 0xc3 0xbc has no equivalent"). Die Datenbank
 * muss auf jedem Rechner identisch aufgesetzt sein, sonst laufen Tests je nach
 * Spracheinstellung unterschiedlich.
 */
const INITDB_FLAGS = ['--encoding=UTF8', '--no-locale'];

async function hasMigrations(): Promise<boolean> {
  try {
    await access(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'));
    return true;
  } catch {
    return false;
  }
}

export interface TestDatabase {
  readonly db: NodePgDatabase<typeof schema>;
  readonly connectionString: string;
  readonly stop: () => Promise<void>;
}

/**
 * Startet eine wegwerfbare PostgreSQL-Instanz und wendet alle Migrationen an.
 *
 * Bewusst eine echte Datenbank statt eines Mocks: Integrationstests sollen
 * genau die SQL-Semantik pruefen, die in Produktion gilt — Constraints,
 * Kaskaden, Transaktionen. Kein Docker noetig, damit die Tests auch dort
 * laufen, wo kein Daemon verfuegbar ist.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const dataDir = await mkdtemp(join(tmpdir(), 'reiseplaner-pg-'));
  const port = 55_000 + Math.floor(Math.random() * 5_000);

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test',
    password: 'test',
    port,
    persistent: false,
    initdbFlags: INITDB_FLAGS,
    onLog: () => {
      // Server-Ausgabe unterdruecken, damit die Testausgabe lesbar bleibt.
    },
  });

  await server.initialise();
  await server.start();
  await server.createDatabase('reiseplaner_test');

  const connectionString = `postgresql://test:test@localhost:${String(port)}/reiseplaner_test`;
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  // In Etappe 0 existieren noch keine Tabellen und damit keine Migrationen.
  // Ab Etappe 1 werden sie hier gegen jede frische Instanz angewendet.
  if (await hasMigrations()) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  return {
    db,
    connectionString,
    stop: async () => {
      await pool.end();
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
