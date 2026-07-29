import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { summarize, type AgentEvent } from '@/domain/agent';
import type { Repositories } from '@/domain/ports/repositories';
import { createSeedProviders } from '@/server/adapters/factory';
import { createScriptedLlm } from '@/server/agent/llm/scripted';
import { createRuleBasedLlm } from '@/server/agent/llm/rule-based';
import { runConversationTurn } from '@/server/agent/run-conversation';
import { createRepositories } from '@/server/db/repositories';
import { startTestDatabase, type TestDatabase } from './helpers/test-database';

/**
 * Ein vollständiger Gesprächszug gegen eine echte Datenbank — mit
 * skriptgesteuertem Modell und Seed-Adaptern, also ohne Netz und Schlüssel.
 */

describe('Gesprächszug', () => {
  let database: TestDatabase;
  let repositories: Repositories;

  async function collect(generator: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];

    for await (const event of generator) {
      events.push(event);
    }

    return events;
  }

  async function createConversation(): Promise<string> {
    const dialog = await repositories.conversations.create();
    await repositories.tripDrafts.createForConversation(dialog.id);

    return dialog.id;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    repositories = createRepositories(database.db);
  });

  afterAll(async () => {
    await database.stop();
  });

  afterEach(async () => {
    await database.db.execute(sql`truncate table conversation cascade`);
  });

  it('speichert Nutzernachricht und Antwort mit Inhaltsblöcken', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [{ blocks: [{ type: 'text', text: 'Wohin genau soll es gehen?' }] }],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Ich will verreisen',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const nachrichten = await repositories.messages.listByConversation(conversationId);

    expect(nachrichten).toHaveLength(2);
    expect(nachrichten[0]?.role).toBe('user');
    expect(nachrichten[1]?.role).toBe('assistant');
    expect(nachrichten[1]?.blocks[0]).toEqual({
      type: 'text',
      text: 'Wohin genau soll es gehen?',
    });
  });

  it('hält Werkzeugaufrufe in der gespeicherten Antwort fest', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'resolve_destination',
              input: { query: 'Mallorca' },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Ich habe Palma gefunden.' }] },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Nach Mallorca bitte',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const nachrichten = await repositories.messages.listByConversation(conversationId);

    /*
     * Gespeichert wird der Verlauf so, wie der Lauf ihn erzeugt hat: Frage,
     * Werkzeugaufruf, Ergebnis, Antwort. Frueher entstand daraus eine einzige
     * Nachricht ohne die Ergebnisse — ein Gespraech mit Aufrufen, auf die nie
     * jemand geantwortet hat. Beim naechsten Zug bekam das Modell damit einen
     * Verlauf zurueck, den es so nie erzeugt haben konnte.
     */
    expect(
      nachrichten.map((nachricht) => [
        nachricht.role,
        nachricht.blocks.map((block) => block.type).join('+'),
      ]),
    ).toEqual([
      ['user', 'text'],
      ['assistant', 'tool_use'],
      ['user', 'tool_result'],
      ['assistant', 'text'],
    ]);
  });

  it('lässt keinen Werkzeugaufruf ohne Ergebnis im Verlauf stehen', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'resolve_destination',
              input: { query: 'Mallorca' },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Gefunden.' }] },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Nach Mallorca bitte',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const bloecke = (await repositories.messages.listByConversation(conversationId)).flatMap(
      (nachricht) => nachricht.blocks,
    );

    const aufrufe = bloecke.filter((block) => block.type === 'tool_use').map((b) => b.toolCallId);
    const ergebnisse = bloecke
      .filter((block) => block.type === 'tool_result')
      .map((b) => b.toolCallId);

    expect(aufrufe).not.toHaveLength(0);
    expect(ergebnisse).toEqual(aufrufe);
  });

  it('protokolliert jeden Werkzeugaufruf in der Datenbank', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'resolve_destination',
              input: { query: 'Mallorca' },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'fertig' }] },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Mallorca',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const protokoll = await repositories.toolCallLogs.listByConversation(conversationId);

    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]?.toolName).toBe('resolve_destination');
    expect(protokoll[0]?.outcome).toBe('ok');
  });

  it('zählt den Tokenverbrauch auf den Dialog', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [{ type: 'text', text: 'Antwort' }],
          usage: { inputTokens: 250, outputTokens: 40 },
        },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Hallo',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const dialog = await repositories.conversations.findById(conversationId);

    expect(dialog?.inputTokens).toBe(250);
    expect(dialog?.outputTokens).toBe(40);
  });

  it('schreibt Angaben aus dem Gespräch in den Entwurf', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'update_trip_draft',
              input: { adults: 2, budgetEuros: 1500 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Notiert.' }] },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Zu zweit, bis 1500 Euro',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const entwurf = await repositories.tripDrafts.findByConversation(conversationId);

    expect(entwurf?.adults).toBe(2);
    expect(entwurf?.budgetEuros).toBe(1_500);
  });

  it('setzt den Titel, sobald das Ziel feststeht', async () => {
    const conversationId = await createConversation();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'update_trip_draft',
              input: {
                destination: {
                  name: 'Palma de Mallorca',
                  iataCode: 'PMI',
                  latitude: 39.5517,
                  longitude: 2.7388,
                },
              },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Gemerkt.' }] },
      ],
    });

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Nach Mallorca',
        llm,
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const [dialog] = await repositories.conversations.listByUser(
      // Der Dialog gehoert keinem Konto — deshalb ueber die Kennung pruefen.
      '00000000-0000-4000-8000-000000000000',
    );

    expect(dialog).toBeUndefined();

    const geladen = await repositories.conversations.findById(conversationId);

    expect(geladen).not.toBeNull();
  });

  it('führt das Gespräch über mehrere Züge fort', async () => {
    const conversationId = await createConversation();
    const llm = createRuleBasedLlm();
    const providers = createSeedProviders();

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Ich möchte nach Mallorca',
        llm,
        providers,
        repositories,
      }),
    );

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Zu zweit im September für eine Woche',
        llm,
        providers,
        repositories,
      }),
    );

    const nachrichten = await repositories.messages.listByConversation(conversationId);

    // Zwei Zuege, je eine Nutzernachricht und eine Antwort.
    expect(nachrichten.length).toBeGreaterThanOrEqual(4);
    expect(nachrichten.map((nachricht) => nachricht.seq)).toEqual(
      [...nachrichten].map((nachricht) => nachricht.seq).sort((a, b) => a - b),
    );
  });

  it('meldet einen unbekannten Dialog, ohne zu werfen', async () => {
    const events = await collect(
      runConversationTurn({
        conversationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        userMessage: 'Hallo',
        llm: createScriptedLlm({ turns: [] }),
        providers: createSeedProviders(),
        repositories,
      }),
    );

    expect(summarize(events).stopReason).toBe('llm_error');
  });

  it('speichert die Nutzernachricht auch bei einem gescheiterten Lauf', async () => {
    const conversationId = await createConversation();

    await collect(
      runConversationTurn({
        conversationId,
        userMessage: 'Diese Nachricht muss bleiben',
        llm: createScriptedLlm({ turns: [], onExhausted: 'error' }),
        providers: createSeedProviders(),
        repositories,
      }),
    );

    const nachrichten = await repositories.messages.listByConversation(conversationId);

    expect(nachrichten[0]?.blocks[0]).toEqual({
      type: 'text',
      text: 'Diese Nachricht muss bleiben',
    });
  });
});
