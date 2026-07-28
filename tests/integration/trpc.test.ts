import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createAuthService, type SessionUser } from '@/server/auth/session';
import { createRepositories } from '@/server/db/repositories';
import { appRouter } from '@/server/trpc/root';
import { createCallerFactory } from '@/server/trpc/trpc';
import type { AppContext } from '@/server/trpc/context';
import { emptyTripDraft } from '@/domain/trip/trip';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

/**
 * Prozeduren gegen eine echte Datenbank.
 *
 * Statt HTTP wird der Caller benutzt: Er ruft dieselben Prozeduren mit
 * demselben Kontext auf, nur ohne Netzwerkschicht. Geprueft wird die
 * Fachlogik, nicht die Serialisierung.
 */

const createCaller = createCallerFactory(appRouter);

describe('tRPC-Prozeduren', () => {
  let database: TestDatabase;

  function callerFor(user: SessionUser | null) {
    const context: AppContext = {
      user,
      repositories: createRepositories(database.db),
      auth: createAuthService(database.db),
      sessionToken: undefined,
    };

    return createCaller(context);
  }

  async function createUser() {
    const auth = createAuthService(database.db);
    const { user } = await auth.createGuest();

    return user;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(async () => {
    await database.db.execute(sql`truncate table "user", conversation cascade`);
  });

  describe('Zugriffsschutz', () => {
    it('weist Aufrufe ohne Sitzung ab', async () => {
      const caller = callerFor(null);

      await expect(caller.conversation.list()).rejects.toThrow(/Sitzung/);
    });

    it('erlaubt me() auch ohne Sitzung', async () => {
      expect(await callerFor(null).auth.me()).toBeNull();
    });

    it('nennt die angemeldete Person', async () => {
      const user = await createUser();

      expect(await callerFor(user).auth.me()).toMatchObject({ id: user.id, isGuest: true });
    });
  });

  describe('Dialoge', () => {
    it('legt Dialog und leeren Entwurf zusammen an', async () => {
      const caller = callerFor(await createUser());

      const dialog = await caller.conversation.create();
      const geladen = await caller.conversation.byId({ conversationId: dialog.id });

      expect(geladen.draft).toEqual(emptyTripDraft());
      expect(geladen.messages).toEqual([]);
      expect(geladen.missing).toContain('destination');
    });

    it('listet nur die eigenen Dialoge', async () => {
      const ersterNutzer = await createUser();
      const zweiterNutzer = await createUser();

      await callerFor(ersterNutzer).conversation.create();
      await callerFor(ersterNutzer).conversation.create();
      await callerFor(zweiterNutzer).conversation.create();

      expect(await callerFor(ersterNutzer).conversation.list()).toHaveLength(2);
      expect(await callerFor(zweiterNutzer).conversation.list()).toHaveLength(1);
    });

    it('verweigert den Zugriff auf einen fremden Dialog', async () => {
      const besitzer = await createUser();
      const fremder = await createUser();

      const dialog = await callerFor(besitzer).conversation.create();

      await expect(
        callerFor(fremder).conversation.byId({ conversationId: dialog.id }),
      ).rejects.toThrow(/gibt es nicht/);
    });

    it('verrät bei fremdem Zugriff nicht, dass der Dialog existiert', async () => {
      const besitzer = await createUser();
      const fremder = await createUser();
      const dialog = await callerFor(besitzer).conversation.create();

      const meldung = (error: unknown): string =>
        error instanceof Error ? error.message : String(error);

      const beiFremdem = await callerFor(fremder)
        .conversation.byId({ conversationId: dialog.id })
        .catch(meldung);
      const beiErfundenem = await callerFor(fremder)
        .conversation.byId({ conversationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
        .catch(meldung);

      expect(beiFremdem).toBe(beiErfundenem);
    });

    it('löscht einen Dialog samt Verlauf', async () => {
      const user = await createUser();
      const caller = callerFor(user);
      const dialog = await caller.conversation.create();

      await caller.conversation.remove({ conversationId: dialog.id });

      expect(await caller.conversation.list()).toEqual([]);
    });

    it('lässt niemanden einen fremden Dialog löschen', async () => {
      const besitzer = await createUser();
      const fremder = await createUser();
      const dialog = await callerFor(besitzer).conversation.create();

      await expect(
        callerFor(fremder).conversation.remove({ conversationId: dialog.id }),
      ).rejects.toThrow();

      expect(await callerFor(besitzer).conversation.list()).toHaveLength(1);
    });

    it('lehnt eine Kennung ab, die keine UUID ist', async () => {
      const caller = callerFor(await createUser());

      await expect(caller.conversation.byId({ conversationId: 'keine-uuid' })).rejects.toThrow();
    });
  });

  describe('Reise-Entwurf', () => {
    it('speichert Änderungen und meldet die fehlenden Angaben', async () => {
      const caller = callerFor(await createUser());
      const dialog = await caller.conversation.create();

      const ergebnis = await caller.draft.update({
        conversationId: dialog.id,
        draft: {
          ...emptyTripDraft(),
          destination: {
            name: 'Palma de Mallorca',
            iataCode: 'PMI',
            latitude: 39.5517,
            longitude: 2.7388,
          },
          adults: 2,
        },
      });

      expect(ergebnis.draft.adults).toBe(2);
      expect(ergebnis.missing).toContain('origin');
      expect(ergebnis.missing).not.toContain('destination');
    });

    it('lehnt einen unplausiblen Entwurf ab', async () => {
      const caller = callerFor(await createUser());
      const dialog = await caller.conversation.create();

      await expect(
        caller.draft.update({
          conversationId: dialog.id,
          draft: { ...emptyTripDraft(), departureDate: '2020-01-01', returnDate: '2019-01-01' },
        }),
      ).rejects.toThrow();
    });

    it('verweigert Änderungen an einem fremden Entwurf', async () => {
      const besitzer = await createUser();
      const fremder = await createUser();
      const dialog = await callerFor(besitzer).conversation.create();

      await expect(
        callerFor(fremder).draft.update({
          conversationId: dialog.id,
          draft: { ...emptyTripDraft(), adults: 9 },
        }),
      ).rejects.toThrow(/gibt es nicht/);
    });
  });

  describe('Kontingent', () => {
    it('nennt Gästen das verbleibende Kontingent', async () => {
      const caller = callerFor(await createUser());

      const ergebnis = await caller.usage.remaining();

      expect(ergebnis.unlimited).toBe(false);
      expect(ergebnis.remaining).toBe(ergebnis.limit);
    });

    it('zählt verbrauchte Nachrichten herunter', async () => {
      const user = await createUser();
      const auth = createAuthService(database.db);

      await auth.consumeQuota(user.id, 20);
      await auth.consumeQuota(user.id, 20);

      const ergebnis = await callerFor(user).usage.remaining();

      expect(ergebnis.remaining).toBe(ergebnis.limit - 2);
    });

    it('kennt für angemeldete Konten keine Grenze', async () => {
      const auth = createAuthService(database.db);
      const registriert = await auth.register({
        email: 'konto@example.de',
        password: 'sicheres-passwort',
      });

      expect(registriert.ok).toBe(true);
      if (registriert.ok) {
        const ergebnis = await callerFor(registriert.value.user).usage.remaining();

        expect(ergebnis.unlimited).toBe(true);
      }
    });
  });

  describe('Anmeldung über Prozeduren', () => {
    it('registriert und meldet danach an', async () => {
      const caller = callerFor(null);

      const registriert = await caller.auth.register({
        email: 'neu@example.de',
        password: 'sicheres-passwort',
      });

      expect(registriert.user.email).toBe('neu@example.de');

      const angemeldet = await caller.auth.login({
        email: 'neu@example.de',
        password: 'sicheres-passwort',
      });

      expect(angemeldet.user.id).toBe(registriert.user.id);
    });

    it('lehnt falsche Zugangsdaten ab', async () => {
      const caller = callerFor(null);
      await caller.auth.register({ email: 'wer@example.de', password: 'sicheres-passwort' });

      await expect(
        caller.auth.login({ email: 'wer@example.de', password: 'falsch-falsch' }),
      ).rejects.toThrow(/stimmen nicht/);
    });

    it('legt auf Wunsch ein Gastkonto an', async () => {
      const ergebnis = await callerFor(null).auth.guest();

      expect(ergebnis.user.isGuest).toBe(true);
      expect(ergebnis.token.length).toBe(64);
    });
  });
});
