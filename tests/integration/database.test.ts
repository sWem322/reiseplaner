import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

describe('Testdatenbank', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  it('startet und beantwortet Abfragen', async () => {
    const result = await database.db.execute<{ eins: number }>(sql`select 1 as eins`);

    expect(result.rows[0]?.eins).toBe(1);
  });

  it('laeuft auf PostgreSQL, nicht auf einem Ersatz', async () => {
    const result = await database.db.execute<{ version: string }>(sql`select version()`);

    expect(result.rows[0]?.version).toMatch(/PostgreSQL/);
  });
});
