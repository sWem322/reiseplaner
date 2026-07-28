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

  it('ist auf UTF8 eingestellt', async () => {
    // Ohne feste Kodierung uebernimmt initdb die Systemlokale. Auf einem
    // Rechner mit kyrillischer Lokale entstand so ein WIN1251-Cluster, in dem
    // sich "Düsseldorf" nicht speichern liess.
    const result = await database.db.execute<{ encoding: string }>(
      sql`select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()`,
    );

    expect(result.rows[0]?.encoding).toBe('UTF8');
  });

  it('speichert deutsche Umlaute und Eszett verlustfrei', async () => {
    const probe = 'Düsseldorf, Köln, Zürich, Straße, Mallorca — 2 000 €';

    const result = await database.db.execute<{ wert: string }>(sql`select ${probe}::text as wert`);

    expect(result.rows[0]?.wert).toBe(probe);
  });
});
