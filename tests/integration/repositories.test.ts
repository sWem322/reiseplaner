import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Repositories } from '@/domain/ports/repositories';
import { createRepositories } from '@/server/db/repositories';
import { emptyTripDraft, type TripDraft } from '@/domain/trip/trip';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

function futureDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const duesseldorf = {
  name: 'Düsseldorf',
  iataCode: 'DUS',
  latitude: 51.2895,
  longitude: 6.7668,
};

const palma = {
  name: 'Palma de Mallorca',
  iataCode: 'PMI',
  latitude: 39.5517,
  longitude: 2.7388,
};

function filledDraft(): TripDraft {
  return {
    ...emptyTripDraft(),
    origin: duesseldorf,
    destination: palma,
    departureDate: futureDate(30),
    returnDate: futureDate(37),
    adults: 2,
    childAges: [4],
    budgetEuros: 2000,
    preferences: ['Strandnähe'],
    status: 'searching',
  };
}

describe('Repositories', () => {
  let database: TestDatabase;
  let repos: Repositories;

  beforeAll(async () => {
    database = await startTestDatabase();
    repos = createRepositories(database.db);
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(async () => {
    // Kaskaden raeumen Nachrichten, Entwuerfe und Protokolle mit ab.
    await database.db.execute(sql`truncate table conversation cascade`);
  });

  describe('Dialoge', () => {
    it('legt einen Dialog mit Standardwerten an', async () => {
      const created = await repos.conversations.create();

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.summary).toBeNull();
      expect(created.inputTokens).toBe(0);
      expect(created.outputTokens).toBe(0);
    });

    it('findet einen angelegten Dialog wieder', async () => {
      const created = await repos.conversations.create();
      const found = await repos.conversations.findById(created.id);

      expect(found?.id).toBe(created.id);
    });

    it('gibt null fuer einen unbekannten Dialog zurueck', async () => {
      const found = await repos.conversations.findById('3f2504e0-4f89-41d3-9a0c-0305e82c3301');

      expect(found).toBeNull();
    });

    it('zaehlt Tokenverbrauch additiv hoch', async () => {
      const created = await repos.conversations.create();

      await repos.conversations.addTokenUsage(created.id, { inputTokens: 100, outputTokens: 40 });
      await repos.conversations.addTokenUsage(created.id, { inputTokens: 250, outputTokens: 60 });

      const updated = await repos.conversations.findById(created.id);

      expect(updated?.inputTokens).toBe(350);
      expect(updated?.outputTokens).toBe(100);
    });

    it('haelt paralleles Hochzaehlen aus', async () => {
      const created = await repos.conversations.create();

      await Promise.all(
        Array.from({ length: 10 }, () =>
          repos.conversations.addTokenUsage(created.id, { inputTokens: 10, outputTokens: 5 }),
        ),
      );

      const updated = await repos.conversations.findById(created.id);

      expect(updated?.inputTokens).toBe(100);
      expect(updated?.outputTokens).toBe(50);
    });

    it('speichert die Zusammenfassung mit Verdichtungsgrenze', async () => {
      const created = await repos.conversations.create();

      await repos.conversations.saveSummary(created.id, 'Mallorca im September, zu zweit', 42);

      const updated = await repos.conversations.findById(created.id);

      expect(updated?.summary).toBe('Mallorca im September, zu zweit');
      expect(updated?.summarizedUntilSeq).toBe(42);
    });
  });

  describe('Nachrichten', () => {
    it('speichert Inhaltsbloecke originalgetreu', async () => {
      const dialog = await repos.conversations.create();

      const saved = await repos.messages.append({
        conversationId: dialog.id,
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'Ich suche Flüge …' },
          { type: 'tool_use', toolCallId: 'c1', toolName: 'search_flights', input: { to: 'PMI' } },
        ],
      });

      expect(saved.blocks).toHaveLength(2);
      expect(saved.blocks[0]).toEqual({ type: 'text', text: 'Ich suche Flüge …' });
      expect(saved.blocks[1]).toMatchObject({ type: 'tool_use', toolCallId: 'c1' });
    });

    it('gibt Nachrichten in zeitlicher Reihenfolge zurueck', async () => {
      const dialog = await repos.conversations.create();

      for (const text of ['erste', 'zweite', 'dritte']) {
        await repos.messages.append({
          conversationId: dialog.id,
          role: 'user',
          blocks: [{ type: 'text', text }],
        });
      }

      const messages = await repos.messages.listByConversation(dialog.id);
      const texts = messages.map((m) => (m.blocks[0]?.type === 'text' ? m.blocks[0].text : ''));

      expect(texts).toEqual(['erste', 'zweite', 'dritte']);
    });

    it('vergibt streng wachsende Folgenummern', async () => {
      const dialog = await repos.conversations.create();

      const erste = await repos.messages.append({
        conversationId: dialog.id,
        role: 'user',
        blocks: [{ type: 'text', text: 'erste' }],
      });
      const zweite = await repos.messages.append({
        conversationId: dialog.id,
        role: 'assistant',
        blocks: [{ type: 'text', text: 'zweite' }],
      });

      expect(zweite.seq).toBeGreaterThan(erste.seq);
    });

    it('grenzt die Verdichtung exakt an der Folgenummer ab', async () => {
      const dialog = await repos.conversations.create();
      const alt = await repos.messages.append({
        conversationId: dialog.id,
        role: 'user',
        blocks: [{ type: 'text', text: 'alt' }],
      });
      await repos.messages.append({
        conversationId: dialog.id,
        role: 'user',
        blocks: [{ type: 'text', text: 'neu' }],
      });

      const neuere = await repos.messages.listByConversation(dialog.id, { afterSeq: alt.seq });

      expect(neuere).toHaveLength(1);
      expect(neuere[0]?.blocks[0]).toEqual({ type: 'text', text: 'neu' });
    });

    it('schliesst die Grenznachricht selbst aus, auch bei gleicher Zeitmarke', async () => {
      // Der eigentliche Grund fuer die Folgenummer: Zeitstempel verlieren beim
      // Weg aus der Datenbank Mikrosekunden und wuerden die Grenznachricht
      // erneut mitliefern.
      const dialog = await repos.conversations.create();

      const nachrichten = await Promise.all(
        ['a', 'b', 'c'].map((text) =>
          repos.messages.append({
            conversationId: dialog.id,
            role: 'user',
            blocks: [{ type: 'text', text }],
          }),
        ),
      );

      const hoechsteSeq = Math.max(...nachrichten.map((n) => n.seq));
      const danach = await repos.messages.listByConversation(dialog.id, { afterSeq: hoechsteSeq });

      expect(danach).toEqual([]);
    });

    it('trennt Nachrichten verschiedener Dialoge', async () => {
      const ersterDialog = await repos.conversations.create();
      const zweiterDialog = await repos.conversations.create();

      await repos.messages.append({
        conversationId: ersterDialog.id,
        role: 'user',
        blocks: [{ type: 'text', text: 'gehoert zum ersten' }],
      });

      expect(await repos.messages.listByConversation(zweiterDialog.id)).toEqual([]);
    });

    it('loescht Nachrichten mit dem Dialog', async () => {
      const dialog = await repos.conversations.create();
      await repos.messages.append({
        conversationId: dialog.id,
        role: 'user',
        blocks: [{ type: 'text', text: 'x' }],
      });

      await database.db.execute(sql`delete from conversation where id = ${dialog.id}`);

      expect(await repos.messages.listByConversation(dialog.id)).toEqual([]);
    });
  });

  describe('Reise-Entwurf', () => {
    it('legt einen leeren Entwurf an', async () => {
      const dialog = await repos.conversations.create();
      const draft = await repos.tripDrafts.createForConversation(dialog.id);

      expect(draft).toEqual(emptyTripDraft());
    });

    it('speichert und liest einen vollstaendigen Entwurf verlustfrei', async () => {
      const dialog = await repos.conversations.create();
      await repos.tripDrafts.createForConversation(dialog.id);

      const result = await repos.tripDrafts.save(dialog.id, filledDraft());

      expect(result.ok).toBe(true);

      const geladen = await repos.tripDrafts.findByConversation(dialog.id);

      expect(geladen).toEqual(filledDraft());
    });

    it('haelt Koordinaten als Zahlen', async () => {
      const dialog = await repos.conversations.create();
      await repos.tripDrafts.createForConversation(dialog.id);
      await repos.tripDrafts.save(dialog.id, filledDraft());

      const geladen = await repos.tripDrafts.findByConversation(dialog.id);

      expect(geladen?.origin?.latitude).toBeCloseTo(51.2895, 4);
      expect(typeof geladen?.origin?.longitude).toBe('number');
    });

    it('lehnt einen ungueltigen Entwurf ab, ohne zu schreiben', async () => {
      const dialog = await repos.conversations.create();
      await repos.tripDrafts.createForConversation(dialog.id);

      const ungueltig: TripDraft = { ...filledDraft(), adults: 0 };
      const result = await repos.tripDrafts.save(dialog.id, ungueltig);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('validation_error');
      }

      const geladen = await repos.tripDrafts.findByConversation(dialog.id);

      expect(geladen).toEqual(emptyTripDraft());
    });

    it('meldet einen fehlenden Entwurf statt still zu scheitern', async () => {
      const dialog = await repos.conversations.create();

      const result = await repos.tripDrafts.save(dialog.id, filledDraft());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('not_found');
      }
    });

    it('erlaubt nur einen Entwurf je Dialog', async () => {
      const dialog = await repos.conversations.create();
      await repos.tripDrafts.createForConversation(dialog.id);

      await expect(repos.tripDrafts.createForConversation(dialog.id)).rejects.toThrow();
    });
  });

  describe('Werkzeug-Protokoll', () => {
    it('protokolliert einen erfolgreichen Aufruf', async () => {
      const dialog = await repos.conversations.create();

      const eintrag = await repos.toolCallLogs.record({
        conversationId: dialog.id,
        toolName: 'search_flights',
        input: { origin: 'DUS', destination: 'PMI' },
        outcome: 'ok',
        errorMessage: null,
        durationMs: 342,
      });

      expect(eintrag.outcome).toBe('ok');
      expect(eintrag.durationMs).toBe(342);
      expect(eintrag.input).toEqual({ origin: 'DUS', destination: 'PMI' });
    });

    it('protokolliert einen Fehlschlag mit Meldung', async () => {
      const dialog = await repos.conversations.create();

      const eintrag = await repos.toolCallLogs.record({
        conversationId: dialog.id,
        toolName: 'search_hotels',
        input: {},
        outcome: 'upstream_error',
        errorMessage: 'Zeitüberschreitung nach 10s',
        durationMs: 10_000,
      });

      expect(eintrag.outcome).toBe('upstream_error');
      expect(eintrag.errorMessage).toBe('Zeitüberschreitung nach 10s');
    });

    it('gibt alle Eintraege eines Dialogs in Reihenfolge zurueck', async () => {
      const dialog = await repos.conversations.create();

      for (const toolName of ['resolve_destination', 'search_flights', 'search_hotels']) {
        await repos.toolCallLogs.record({
          conversationId: dialog.id,
          toolName,
          input: {},
          outcome: 'ok',
          errorMessage: null,
          durationMs: 10,
        });
      }

      const eintraege = await repos.toolCallLogs.listByConversation(dialog.id);

      expect(eintraege.map((e) => e.toolName)).toEqual([
        'resolve_destination',
        'search_flights',
        'search_hotels',
      ]);
    });
  });
});
