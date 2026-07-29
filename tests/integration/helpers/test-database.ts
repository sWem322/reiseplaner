import EmbeddedPostgres from 'embedded-postgres';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
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

/** `admin_shutdown` — PostgreSQL beendet die Sitzung beim Herunterfahren. */
const SHUTDOWN_ERROR_CODE = '57P01';

/**
 * Einen tatsaechlich freien Port besorgen.
 *
 * Vorher wurde einer aus einem Bereich gewuerfelt. Bei fuenf gleichzeitig
 * laufenden Testdateien trafen zwei irgendwann denselben — die zweite
 * verband sich dann mit dem fremden Cluster, und sobald der erste sich
 * beendete, brachen deren Verbindungen ab: „terminating connection due to
 * administrator command". Die Tests liefen trotzdem durch, aber der Lauf
 * scheiterte an zwei unbehandelten Fehlern. Nur in CI, nur manchmal.
 *
 * Das Betriebssystem weiss besser, welcher Port frei ist: Port 0 anfragen,
 * die Zuteilung ablesen, wieder schliessen.
 */
async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();

      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Der Testlauf konnte keinen freien Port ermitteln'));

        return;
      }

      probe.close(() => {
        resolve(address.port);
      });
    });
  });
}

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
  const port = await freePort();

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

  /*
   * Ein Fehler auf einer ruhenden Verbindung wuerde sonst als unbehandeltes
   * Ereignis den ganzen Lauf beenden. Beim Herunterfahren des Clusters ist
   * genau das zu erwarten und harmlos — alles andere wird gemeldet.
   */
  pool.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== SHUTDOWN_ERROR_CODE) {
      console.error('Unerwarteter Fehler im Verbindungspool:', error);
    }
  });

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
