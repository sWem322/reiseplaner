import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Ein einziger Pool pro Prozess. Im Entwicklungsmodus wird er am globalThis
 * gehalten, damit Hot Reload nicht bei jedem Neuladen neue Verbindungen
 * aufbaut und den Server irgendwann an das Verbindungslimit fahren laesst.
 */
const globalForDb = globalThis as unknown as {
  reiseplanerPool: Pool | undefined;
};

function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'production' ? 10 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool: Pool = globalForDb.reiseplanerPool ?? createPool();

if (env.NODE_ENV !== 'production') {
  globalForDb.reiseplanerPool = pool;
}

export const db: Database = drizzle(pool, { schema });
