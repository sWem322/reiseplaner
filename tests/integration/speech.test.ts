import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Repositories } from '@/domain/ports/repositories';
import type { TextToSpeechPort } from '@/domain/ports/speech';
import { fail, type Result } from '@/domain/result';
import type { SpokenAudio } from '@/domain/ports/speech';
import { createFixedSpeech } from '@/server/adapters/seed/speech';
import { createAuthService, type AuthService } from '@/server/auth/session';
import { createRepositories } from '@/server/db/repositories';
import { readAloud } from '@/server/speech/read-aloud';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

/**
 * Die Sprachausgabe gegen eine echte Datenbank.
 *
 * Geprueft wird hier nicht, wie ein Anbieter klingt, sondern wer was vorlesen
 * darf: Besitz, Rolle, fehlende Einrichtung. Das ist der Teil, an dem ein
 * Fehler weh taete — die Uebersetzung zum Anbieter deckt der Unit-Test ab.
 */

/** Ein Anbieter, der immer scheitert — fuer die Zuordnung der Statuscodes. */
function failingSpeech(kind: Parameters<typeof fail>[0]): TextToSpeechPort {
  return {
    name: 'immer-kaputt',
    speak: (): Promise<Result<SpokenAudio>> =>
      Promise.resolve(fail(kind, 'So war es abgesprochen')),
  };
}

describe('Sprachausgabe einer Antwort', () => {
  let database: TestDatabase;
  let auth: AuthService;
  let repositories: Repositories;

  beforeAll(async () => {
    database = await startTestDatabase();
    auth = createAuthService(database.db);
    repositories = createRepositories(database.db);
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(async () => {
    await database.db.execute(sql`truncate table "user" cascade`);
    await database.db.execute(sql`truncate table conversation cascade`);
  });

  /** Legt eine Person mit einem Gespraech und einer Antwort darin an. */
  async function gespraechMitAntwort(text = 'Palma ist im September warm.') {
    const gast = await auth.createGuest();
    const dialog = await repositories.conversations.create(gast.user.id);

    const antwort = await repositories.messages.append({
      conversationId: dialog.id,
      role: 'assistant',
      blocks: [{ type: 'text', text }],
    });

    return { userId: gast.user.id, conversationId: dialog.id, messageId: antwort.id };
  }

  it('liefert Ton zu einer eigenen Antwort', async () => {
    const { userId, messageId } = await gespraechMitAntwort();

    const ergebnis = await readAloud({
      messageId,
      userId,
      repositories,
      speech: createFixedSpeech(),
    });

    expect(ergebnis.ok).toBe(true);

    if (ergebnis.ok) {
      expect(ergebnis.audio.mimeType).toBe('audio/mpeg');
      expect(ergebnis.audio.data.byteLength).toBeGreaterThan(0);
    }
  });

  it('kennt die Nachricht einer fremden Person nicht', async () => {
    const { messageId } = await gespraechMitAntwort();
    const fremde = await auth.createGuest();

    const ergebnis = await readAloud({
      messageId,
      userId: fremde.user.id,
      repositories,
      speech: createFixedSpeech(),
    });

    expect(ergebnis).toMatchObject({ ok: false, status: 404 });
  });

  it('kennt eine erfundene Kennung nicht', async () => {
    const gast = await auth.createGuest();

    const ergebnis = await readAloud({
      messageId: '00000000-0000-4000-8000-000000000000',
      userId: gast.user.id,
      repositories,
      speech: createFixedSpeech(),
    });

    expect(ergebnis).toMatchObject({ ok: false, status: 404 });
  });

  it('liest die eigenen Worte der reisenden Person nicht vor', async () => {
    const gast = await auth.createGuest();
    const dialog = await repositories.conversations.create(gast.user.id);

    const eigene = await repositories.messages.append({
      conversationId: dialog.id,
      role: 'user',
      blocks: [{ type: 'text', text: 'Ich möchte nach Mallorca.' }],
    });

    const ergebnis = await readAloud({
      messageId: eigene.id,
      userId: gast.user.id,
      repositories,
      speech: createFixedSpeech(),
    });

    expect(ergebnis).toMatchObject({ ok: false, status: 400 });
  });

  it('sagt offen, wenn keine Stimme eingerichtet ist', async () => {
    const { userId, messageId } = await gespraechMitAntwort();

    const ergebnis = await readAloud({ messageId, userId, repositories, speech: null });

    expect(ergebnis).toMatchObject({ ok: false, status: 501 });
  });

  it('vertont eine Antwort ohne Fliesstext nicht', async () => {
    /*
     * Ein Zug kann aus einem einzigen Werkzeugaufruf bestehen. Gesprochen
     * werden kann daran nichts — und der Anbieter soll dafuer nicht gerufen
     * werden.
     */
    const gast = await auth.createGuest();
    const dialog = await repositories.conversations.create(gast.user.id);

    const nurWerkzeug = await repositories.messages.append({
      conversationId: dialog.id,
      role: 'assistant',
      blocks: [{ type: 'tool_use', toolCallId: 'ruf-1', toolName: 'search_flights', input: {} }],
    });

    const ergebnis = await readAloud({
      messageId: nurWerkzeug.id,
      userId: gast.user.id,
      repositories,
      speech: createFixedSpeech(),
    });

    expect(ergebnis).toMatchObject({ ok: false, status: 400 });
  });

  it.each([
    ['rate_limited', 429],
    ['unauthorized', 502],
    ['upstream_error', 502],
  ] as const)('uebersetzt %s des Anbieters in Status %i', async (kind, status) => {
    const { userId, messageId } = await gespraechMitAntwort();

    const ergebnis = await readAloud({
      messageId,
      userId,
      repositories,
      speech: failingSpeech(kind),
    });

    expect(ergebnis).toMatchObject({ ok: false, status });
  });
});
