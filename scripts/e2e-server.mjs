/**
 * Webserver fuer den E2E-Lauf, samt eigener Datenbank.
 *
 * Warum nicht im `globalSetup` von Playwright? Weil Playwright den Webserver
 * **vor** dem globalSetup startet. Eine dort gesetzte DATABASE_URL erreicht
 * einen Prozess, den es zu diesem Zeitpunkt schon gibt, nicht mehr — der
 * Server lief dann gegen die voreingestellte Adresse, an der niemand horcht,
 * und jeder Test scheiterte mit ECONNREFUSED beim Anlegen des Gastkontos.
 *
 * Es fiel lange nicht auf, weil die frueheren E2E-Faelle nur eine statische
 * Seite oeffneten und die Datenbank nie brauchten.
 *
 * Deshalb gehoert beides in einen Prozess: erst die Datenbank, dann der
 * Server, der ihre Adresse von Anfang an kennt.
 *
 *   node scripts/e2e-server.mjs --port 3100
 */
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const portIndex = process.argv.indexOf('--port');
const WEB_PORT = portIndex === -1 ? '3100' : (process.argv[portIndex + 1] ?? '3100');

/*
 * Freien Port vom Betriebssystem erfragen statt einen zu wuerfeln: Ein fester
 * Port kollidiert mit einer laufenden Entwicklungs-Instanz, ein gewuerfelter
 * gelegentlich mit einem anderen Testlauf. Beides endet damit, dass zwei
 * Prozesse dieselbe Datenbank benutzen, ohne es zu merken.
 */
const DB_PORT = await freePort();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();

      probe.close(() => {
        resolve(port);
      });
    });
  });
}

const dataDir = await mkdtemp(join(tmpdir(), 'reiseplaner-e2e-'));

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'e2e',
  password: 'e2e',
  port: DB_PORT,
  persistent: false,
  // Siehe tests/integration/helpers/test-database.ts: ohne feste Kodierung
  // entsteht auf manchen Rechnern ein Cluster ohne Umlaute.
  initdbFlags: ['--encoding=UTF8', '--no-locale'],
  onLog: () => {
    // Server-Ausgabe unterdruecken.
  },
});

await postgres.initialise();
await postgres.start();
await postgres.createDatabase('reiseplaner_e2e');

const connectionString = `postgresql://e2e:e2e@localhost:${String(DB_PORT)}/reiseplaner_e2e`;

const pool = new Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}

console.log(`E2E-Datenbank bereit auf Port ${String(DB_PORT)}`);

const server = spawn('npx', ['next', 'start', '--port', WEB_PORT], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: connectionString,
    // Der Ablauf haengt sonst an der Erreichbarkeit von Overpass, und ein
    // ausgefallener Fremddienst faerbt den Lauf rot.
    USE_NETWORK_PROVIDERS: 'false',
    NODE_ENV: 'production',
  },
});

let aufgeraeumt = false;

async function aufraeumen(code) {
  if (aufgeraeumt) {
    return;
  }

  aufgeraeumt = true;
  server.kill();

  try {
    await postgres.stop();
    await rm(dataDir, { recursive: true, force: true });
  } catch {
    // Beim Herunterfahren ist ein misslungenes Aufraeumen kein Grund, den
    // Lauf rot zu faerben.
  }

  process.exit(code ?? 0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => void aufraeumen(0));
}

server.on('exit', (code) => void aufraeumen(code ?? 0));
