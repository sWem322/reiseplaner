import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createAuthService, type AuthService } from '@/server/auth/session';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

describe('Konten und Sitzungen', () => {
  let database: TestDatabase;
  let auth: AuthService;

  beforeAll(async () => {
    database = await startTestDatabase();
    auth = createAuthService(database.db);
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(async () => {
    await database.db.execute(sql`truncate table "user" cascade`);
  });

  describe('Registrierung', () => {
    it('legt ein Konto an und startet eine Sitzung', async () => {
      const result = await auth.register({
        email: 'reise@example.de',
        password: 'sicheres-passwort',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.email).toBe('reise@example.de');
        expect(result.value.user.isGuest).toBe(false);
        expect(result.value.token.length).toBe(64);
      }
    });

    it('speichert das Passwort niemals im Klartext', async () => {
      await auth.register({ email: 'test@example.de', password: 'geheim-geheim' });

      const zeilen = await database.db.execute<{ password_hash: string }>(
        sql`select password_hash from "user" where email = 'test@example.de'`,
      );
      const gespeichert = zeilen.rows[0]?.password_hash ?? '';

      expect(gespeichert).not.toContain('geheim-geheim');
      expect(gespeichert.startsWith('$argon2id$')).toBe(true);
    });

    it('normalisiert die E-Mail-Adresse', async () => {
      const result = await auth.register({
        email: '  Reise@Example.DE  ',
        password: 'sicheres-passwort',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.email).toBe('reise@example.de');
      }
    });

    it('lehnt eine bereits vergebene Adresse ab', async () => {
      await auth.register({ email: 'doppelt@example.de', password: 'sicheres-passwort' });
      const zweiter = await auth.register({
        email: 'doppelt@example.de',
        password: 'anderes-passwort',
      });

      expect(zweiter.ok).toBe(false);
      if (!zweiter.ok) {
        expect(zweiter.error.kind).toBe('validation_error');
      }
    });

    it.each([
      ['keine E-Mail', { email: 'keine-mail', password: 'sicheres-passwort' }],
      ['zu kurzes Passwort', { email: 'kurz@example.de', password: 'kurz' }],
    ])('lehnt %s ab', async (_beschreibung, credentials) => {
      const result = await auth.register(credentials);

      expect(result.ok).toBe(false);
    });
  });

  describe('Anmeldung', () => {
    it('meldet mit richtigem Passwort an', async () => {
      await auth.register({ email: 'login@example.de', password: 'sicheres-passwort' });

      const result = await auth.login({
        email: 'login@example.de',
        password: 'sicheres-passwort',
      });

      expect(result.ok).toBe(true);
    });

    it('lehnt ein falsches Passwort ab', async () => {
      await auth.register({ email: 'login@example.de', password: 'sicheres-passwort' });

      const result = await auth.login({ email: 'login@example.de', password: 'falsch-falsch' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });

    it('gibt bei unbekannter Adresse dieselbe Meldung wie bei falschem Passwort', async () => {
      await auth.register({ email: 'bekannt@example.de', password: 'sicheres-passwort' });

      const falschesPasswort = await auth.login({
        email: 'bekannt@example.de',
        password: 'falsch-falsch',
      });
      const unbekannteAdresse = await auth.login({
        email: 'unbekannt@example.de',
        password: 'sicheres-passwort',
      });

      expect(falschesPasswort.ok).toBe(false);
      expect(unbekannteAdresse.ok).toBe(false);

      // Gleiche Meldung: Sonst liesse sich abfragen, welche Adressen registriert sind.
      if (!falschesPasswort.ok && !unbekannteAdresse.ok) {
        expect(unbekannteAdresse.error.message).toBe(falschesPasswort.error.message);
      }
    });
  });

  describe('Gastzugang', () => {
    it('legt ohne Angaben ein Konto an', async () => {
      const { user, token } = await auth.createGuest();

      expect(user.isGuest).toBe(true);
      expect(user.email).toBeNull();
      expect(token.length).toBe(64);
    });

    it('erzeugt für jeden Gast ein eigenes Konto', async () => {
      const ersterGast = await auth.createGuest();
      const zweiterGast = await auth.createGuest();

      expect(zweiterGast.user.id).not.toBe(ersterGast.user.id);
    });
  });

  describe('Sitzungen', () => {
    it('löst ein gültiges Token zum Konto auf', async () => {
      const { user, token } = await auth.createGuest();

      const aufgeloest = await auth.resolveSession(token);

      expect(aufgeloest?.id).toBe(user.id);
    });

    it('gibt für ein unbekanntes Token nichts zurück', async () => {
      expect(await auth.resolveSession('nicht-vorhanden')).toBeNull();
    });

    it('gibt ohne Token nichts zurück', async () => {
      expect(await auth.resolveSession(undefined)).toBeNull();
      expect(await auth.resolveSession('')).toBeNull();
    });

    it('macht eine Sitzung beim Abmelden ungültig', async () => {
      const { token } = await auth.createGuest();

      await auth.logout(token);

      expect(await auth.resolveSession(token)).toBeNull();
    });

    it('erkennt eine abgelaufene Sitzung nicht mehr an', async () => {
      const { token } = await auth.createGuest();

      await database.db.execute(
        sql`update session set expires_at = now() - interval '1 day' where token = ${token}`,
      );

      expect(await auth.resolveSession(token)).toBeNull();
    });

    it('löscht Sitzungen mit dem Konto', async () => {
      const { user, token } = await auth.createGuest();

      await database.db.execute(sql`delete from "user" where id = ${user.id}`);

      expect(await auth.resolveSession(token)).toBeNull();
    });
  });

  describe('Tageskontingent', () => {
    it('zählt jede Nachricht', async () => {
      const { user } = await auth.createGuest();

      const ersteNachricht = await auth.consumeQuota(user.id, 3);
      const zweiteNachricht = await auth.consumeQuota(user.id, 3);

      expect(ersteNachricht).toEqual({ allowed: true, used: 1 });
      expect(zweiteNachricht).toEqual({ allowed: true, used: 2 });
    });

    it('meldet die Überschreitung, ohne zu werfen', async () => {
      const { user } = await auth.createGuest();

      await auth.consumeQuota(user.id, 2);
      await auth.consumeQuota(user.id, 2);
      const dritte = await auth.consumeQuota(user.id, 2);

      expect(dritte.allowed).toBe(false);
      expect(dritte.used).toBe(3);
    });

    it('zählt auch bei gleichzeitigen Anfragen richtig', async () => {
      const { user } = await auth.createGuest();

      await Promise.all(Array.from({ length: 10 }, () => auth.consumeQuota(user.id, 100)));

      expect(await auth.remainingQuota(user.id, 100)).toBe(90);
    });

    it('nennt das verbleibende Kontingent', async () => {
      const { user } = await auth.createGuest();

      expect(await auth.remainingQuota(user.id, 20)).toBe(20);

      await auth.consumeQuota(user.id, 20);

      expect(await auth.remainingQuota(user.id, 20)).toBe(19);
    });

    it('gibt nie eine negative Restmenge zurück', async () => {
      const { user } = await auth.createGuest();

      await auth.consumeQuota(user.id, 1);
      await auth.consumeQuota(user.id, 1);
      await auth.consumeQuota(user.id, 1);

      expect(await auth.remainingQuota(user.id, 1)).toBe(0);
    });

    it('trennt die Zähler verschiedener Konten', async () => {
      const ersterGast = await auth.createGuest();
      const zweiterGast = await auth.createGuest();

      await auth.consumeQuota(ersterGast.user.id, 5);
      await auth.consumeQuota(ersterGast.user.id, 5);

      expect(await auth.remainingQuota(zweiterGast.user.id, 5)).toBe(5);
    });
  });
});
