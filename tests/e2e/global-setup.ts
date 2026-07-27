import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIGRATIONS_FOLDER = './drizzle';

async function hasMigrations(): Promise<boolean> {
  try {
    await access(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Startet eine wegwerfbare Datenbank fuer den E2E-Lauf.
 *
 * Bewusst eingebettet statt als Container: Der E2E-Lauf soll weder einen
 * Docker-Daemon noch eine erreichbare Container-Registry voraussetzen. In CI
 * ist genau das eine wiederkehrende Fehlerquelle — ein Ausfall der Registry
 * darf keinen roten Testlauf erzeugen, der nichts mit dem Code zu tun hat.
 *
 * Playwright startet den Webserver erst nach diesem Setup, deshalb sieht die
 * Anwendung die hier gesetzte DATABASE_URL.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const dataDir = await mkdtemp(join(tmpdir(), 'reiseplaner-e2e-'));
  const port = 54_500 + Math.floor(Math.random() * 500);

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'e2e',
    password: 'e2e',
    port,
    persistent: false,
    onLog: () => {
      // Server-Ausgabe unterdruecken.
    },
  });

  await server.initialise();
  await server.start();
  await server.createDatabase('reiseplaner_e2e');

  const connectionString = `postgresql://e2e:e2e@localhost:${String(port)}/reiseplaner_e2e`;
  process.env.DATABASE_URL = connectionString;

  if (await hasMigrations()) {
    const pool = new Pool({ connectionString, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await pool.end();
    }
  }

  return async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}
