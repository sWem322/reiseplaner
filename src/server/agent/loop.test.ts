import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_LIMITS, summarize, type AgentEvent } from '@/domain/agent';
import type { TripDraftRepository } from '@/domain/ports/repositories';
import { emptyTripDraft, tripDraftSchema, type TripDraft } from '@/domain/trip/trip';
import { ok, type Result } from '@/domain/result';
import { createSeedProviders } from '@/server/adapters/factory';
import { collectEvents, runAgent } from './loop';
import { createFailingLlm, createLoopingLlm, createScriptedLlm } from './llm/scripted';
import { createToolRegistry } from './tools';

/**
 * Alle Tests laufen gegen ein skriptgesteuertes Modell und Seed-Adapter:
 * kein Netz, kein Schluessel, kein Zufall.
 */

const CONVERSATION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Entwurfs-Repository im Speicher — die Datenbank ist hier nicht der Pruefgegenstand. */
function createInMemoryDrafts(initial: TripDraft = emptyTripDraft()): TripDraftRepository & {
  current: () => TripDraft;
} {
  let draft = initial;

  return {
    createForConversation(): Promise<TripDraft> {
      draft = emptyTripDraft();
      return Promise.resolve(draft);
    },
    findByConversation(): Promise<TripDraft | null> {
      return Promise.resolve(draft);
    },
    save(_conversationId: string, next: TripDraft): Promise<Result<TripDraft>> {
      const parsed = tripDraftSchema.safeParse(next);

      if (!parsed.success) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'validation_error', message: 'ungültig' },
        });
      }

      draft = parsed.data;
      return Promise.resolve(ok(draft));
    },
    current: () => draft,
  };
}

function createTools(drafts: TripDraftRepository = createInMemoryDrafts()) {
  return createToolRegistry({ providers: createSeedProviders(), tripDrafts: drafts });
}

function baseInput(overrides: Partial<Parameters<typeof runAgent>[0]> = {}) {
  return {
    conversationId: CONVERSATION_ID,
    systemPrompt: 'Du bist ein Reiseassistent.',
    messages: [
      {
        role: 'user' as const,
        blocks: [{ type: 'text' as const, text: 'Ich will nach Mallorca.' }],
      },
    ],
    llm: createScriptedLlm({ turns: [] }),
    tools: createTools(),
    limits: DEFAULT_AGENT_LIMITS,
    ...overrides,
  };
}

function eventsOfType<T extends AgentEvent['type']>(
  events: readonly AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

describe('Antwort ohne Werkzeug', () => {
  it('endet nach einer Iteration mit completed', async () => {
    const llm = createScriptedLlm({
      turns: [{ blocks: [{ type: 'text', text: 'Wohin genau soll es gehen?' }] }],
    });

    const events = await collectEvents(runAgent(baseInput({ llm })));
    const result = summarize(events);

    expect(result.stopReason).toBe('completed');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.text).toContain('Wohin genau');
  });

  it('reicht die Werkzeugbeschreibungen an das Modell', async () => {
    const llm = createScriptedLlm({ turns: [{ blocks: [{ type: 'text', text: 'ok' }] }] });

    await collectEvents(runAgent(baseInput({ llm })));

    const namen = llm.requests[0]?.tools.map((tool) => tool.name) ?? [];

    expect(namen).toEqual(
      expect.arrayContaining([
        'resolve_destination',
        'search_flights',
        'search_hotels',
        'get_weather_outlook',
        'update_trip_draft',
        'get_trip_draft',
      ]),
    );
  });

  it('leitet ein JSON-Schema aus der Zod-Definition ab', async () => {
    const llm = createScriptedLlm({ turns: [{ blocks: [{ type: 'text', text: 'ok' }] }] });

    await collectEvents(runAgent(baseInput({ llm })));

    const flugWerkzeug = llm.requests[0]?.tools.find((tool) => tool.name === 'search_flights');

    expect(flugWerkzeug?.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('Werkzeugaufrufe', () => {
  it('fuehrt einen Aufruf aus und gibt das Ergebnis an das Modell zurueck', async () => {
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

    const events = await collectEvents(runAgent(baseInput({ llm })));
    const finished = eventsOfType(events, 'tool_finished');

    expect(finished).toHaveLength(1);
    expect(finished[0]?.outcome).toBe('ok');
    expect(summarize(events).stopReason).toBe('completed');

    // Der zweite Zug muss das Ergebnis des ersten gesehen haben.
    const zweiteAnfrage = llm.requests[1];
    const letzterBlock = zweiteAnfrage?.messages.at(-1)?.blocks[0];

    expect(letzterBlock).toMatchObject({ type: 'tool_result', toolCallId: 'c1', isError: false });
  });

  it('fuehrt mehrere Aufrufe eines Zuges parallel aus', async () => {
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
            {
              type: 'tool_use',
              toolCallId: 'c2',
              toolName: 'get_weather_outlook',
              input: { destinationIata: 'PMI', month: 9 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'fertig' }] },
      ],
    });

    const events = await collectEvents(runAgent(baseInput({ llm })));

    expect(eventsOfType(events, 'tool_started')).toHaveLength(2);
    expect(eventsOfType(events, 'tool_finished')).toHaveLength(2);

    // Beide Ergebnisse gehen gesammelt in einer Nachricht zurueck.
    const ergebnisBloecke = llm.requests[1]?.messages.at(-1)?.blocks ?? [];

    expect(ergebnisBloecke).toHaveLength(2);
  });
});

describe('Selbstkorrektur', () => {
  it('gibt eine ungueltige Eingabe als Fehler zurueck und laeuft weiter', async () => {
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              // Kleinbuchstaben sind kein gueltiger IATA-Code.
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'get_weather_outlook',
              input: { destinationIata: 'pmi', month: 9 },
            },
          ],
        },
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c2',
              toolName: 'get_weather_outlook',
              input: { destinationIata: 'PMI', month: 9 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Im September ist es warm.' }] },
      ],
    });

    const events = await collectEvents(runAgent(baseInput({ llm })));
    const finished = eventsOfType(events, 'tool_finished');

    expect(finished[0]?.outcome).toBe('validation_error');
    expect(finished[1]?.outcome).toBe('ok');
    expect(summarize(events).stopReason).toBe('completed');
  });

  it('nennt dem Modell das fehlerhafte Feld, nicht nur dass etwas falsch ist', async () => {
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'get_weather_outlook',
              input: { destinationIata: 'pmi', month: 9 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'verstanden' }] },
      ],
    });

    await collectEvents(runAgent(baseInput({ llm })));

    const ergebnis = llm.requests[1]?.messages.at(-1)?.blocks[0];
    const inhalt = JSON.stringify(ergebnis);

    expect(inhalt).toContain('destinationIata');
    expect(inhalt).toContain('Großbuchstaben');
  });

  it('behandelt ein unbekanntes Werkzeug als korrigierbaren Fehler', async () => {
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [{ type: 'tool_use', toolCallId: 'c1', toolName: 'buche_alles', input: {} }],
        },
        { blocks: [{ type: 'text', text: 'Das kann ich nicht.' }] },
      ],
    });

    const events = await collectEvents(runAgent(baseInput({ llm })));
    const ergebnis = JSON.stringify(llm.requests[1]?.messages.at(-1)?.blocks[0]);

    expect(eventsOfType(events, 'tool_finished')[0]?.outcome).toBe('validation_error');
    // Die Fehlermeldung nennt die verfuegbaren Werkzeuge.
    expect(ergebnis).toContain('resolve_destination');
    expect(summarize(events).stopReason).toBe('completed');
  });

  it('meldet einen nicht auffindbaren Ort als upstream-Fehler und bricht nicht ab', async () => {
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'resolve_destination',
              input: { query: 'Atlantis' },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Diesen Ort kenne ich nicht.' }] },
      ],
    });

    const events = await collectEvents(runAgent(baseInput({ llm })));

    expect(eventsOfType(events, 'tool_finished')[0]?.outcome).toBe('upstream_error');
    expect(summarize(events).stopReason).toBe('completed');
  });

  it('faengt eine Ausnahme aus einem Werkzeug ab', async () => {
    const explodierendesWerkzeug = createToolRegistry({
      providers: createSeedProviders(),
      tripDrafts: {
        createForConversation: () => Promise.resolve(emptyTripDraft()),
        findByConversation: () => {
          throw new Error('Datenbank weg');
        },
        save: (_id, draft) => Promise.resolve(ok(draft)),
      },
    });

    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [{ type: 'tool_use', toolCallId: 'c1', toolName: 'get_trip_draft', input: {} }],
        },
        { blocks: [{ type: 'text', text: 'Ich versuche es später.' }] },
      ],
    });

    const events = await collectEvents(runAgent(baseInput({ llm, tools: explodierendesWerkzeug })));

    expect(eventsOfType(events, 'tool_finished')[0]?.outcome).toBe('upstream_error');
    expect(summarize(events).stopReason).toBe('completed');
  });
});

describe('Guardrails', () => {
  it('stoppt an der Iterationsgrenze', async () => {
    const llm = createLoopingLlm('resolve_destination', { query: 'Mallorca' });

    const events = await collectEvents(
      runAgent(baseInput({ llm, limits: { ...DEFAULT_AGENT_LIMITS, maxIterations: 3 } })),
    );
    const result = summarize(events);

    expect(result.stopReason).toBe('max_iterations');
    expect(result.iterations).toBe(3);
  });

  it('stoppt an der Grenze der Werkzeugaufrufe', async () => {
    const llm = createLoopingLlm('resolve_destination', { query: 'Mallorca' });

    const events = await collectEvents(
      runAgent(
        baseInput({
          llm,
          limits: { ...DEFAULT_AGENT_LIMITS, maxIterations: 20, maxToolCalls: 2 },
        }),
      ),
    );

    expect(summarize(events).stopReason).toBe('max_tool_calls');
    expect(eventsOfType(events, 'tool_started')).toHaveLength(2);
  });

  it('stoppt, bevor das Token-Budget ueberschritten wird', async () => {
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
          usage: { inputTokens: 900, outputTokens: 200 },
        },
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c2',
              toolName: 'resolve_destination',
              input: { query: 'Ibiza' },
            },
          ],
          usage: { inputTokens: 900, outputTokens: 200 },
        },
      ],
    });

    const events = await collectEvents(
      runAgent(baseInput({ llm, limits: { ...DEFAULT_AGENT_LIMITS, tokenBudget: 2_000 } })),
    );

    expect(summarize(events).stopReason).toBe('budget_exceeded');
    // Nach zwei Zuegen sind 2 200 Tokens verbraucht — der dritte startet nicht mehr.
    expect(llm.callCount).toBe(2);
  });

  it('erklaert jeden Abbruch mit einem lesbaren Satz', async () => {
    const llm = createLoopingLlm('resolve_destination', { query: 'Mallorca' });

    const events = await collectEvents(
      runAgent(baseInput({ llm, limits: { ...DEFAULT_AGENT_LIMITS, maxIterations: 1 } })),
    );

    expect(summarize(events).text).toMatch(/angehalten|Stand bisher/);
  });

  it('zaehlt einen Zug mit mehreren Aufrufen vollstaendig gegen die Grenze', async () => {
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
            {
              type: 'tool_use',
              toolCallId: 'c2',
              toolName: 'resolve_destination',
              input: { query: 'Ibiza' },
            },
            {
              type: 'tool_use',
              toolCallId: 'c3',
              toolName: 'resolve_destination',
              input: { query: 'Kreta' },
            },
          ],
        },
      ],
    });

    const events = await collectEvents(
      runAgent(baseInput({ llm, limits: { ...DEFAULT_AGENT_LIMITS, maxToolCalls: 2 } })),
    );

    expect(summarize(events).stopReason).toBe('max_tool_calls');
    // Keiner der drei Aufrufe wurde ausgefuehrt — die Grenze greift vorher.
    expect(eventsOfType(events, 'tool_started')).toHaveLength(0);
  });
});

describe('Nicht erreichbares Modell', () => {
  it('endet mit llm_error und einer Erklaerung', async () => {
    const events = await collectEvents(runAgent(baseInput({ llm: createFailingLlm() })));
    const result = summarize(events);

    expect(result.stopReason).toBe('llm_error');
    expect(result.text).toMatch(/Sprachdienst/);
  });
});

describe('Zustandsfuehrung', () => {
  it('schreibt Angaben in den Entwurf und meldet fehlende Slots', async () => {
    const drafts = createInMemoryDrafts();
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
                adults: 2,
              },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Von wo aus möchtest du fliegen?' }] },
      ],
    });

    await collectEvents(runAgent(baseInput({ llm, tools: createTools(drafts) })));

    expect(drafts.current().destination?.iataCode).toBe('PMI');
    expect(drafts.current().adults).toBe(2);

    const ergebnis = JSON.stringify(llm.requests[1]?.messages.at(-1)?.blocks[0]);

    expect(ergebnis).toContain('origin');
    expect(ergebnis).toContain('departureDate');
  });

  it('meldet eine Aenderung des Entwurfs als Ereignis', async () => {
    const drafts = createInMemoryDrafts();
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'update_trip_draft',
              input: { adults: 3 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'Notiert.' }] },
      ],
    });

    const events = await collectEvents(
      runAgent(baseInput({ llm, tools: createTools(drafts), tripDrafts: drafts })),
    );

    const draftEvents = eventsOfType(events, 'draft_updated');

    expect(draftEvents).toHaveLength(1);
    expect(draftEvents[0]?.draft.adults).toBe(3);
  });

  it('laesst nicht genannte Felder unveraendert', async () => {
    const drafts = createInMemoryDrafts({ ...emptyTripDraft(), adults: 4 });
    const llm = createScriptedLlm({
      turns: [
        {
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'update_trip_draft',
              input: { budgetEuros: 1500 },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'ok' }] },
      ],
    });

    await collectEvents(runAgent(baseInput({ llm, tools: createTools(drafts) })));

    expect(drafts.current().adults).toBe(4);
    expect(drafts.current().budgetEuros).toBe(1_500);
  });
});

describe('Protokollierung', () => {
  it('protokolliert jeden Aufruf mit Ausgang und Dauer', async () => {
    const eintraege: { toolName: string; outcome: string; durationMs: number }[] = [];

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
            {
              type: 'tool_use',
              toolCallId: 'c2',
              toolName: 'resolve_destination',
              input: { query: 'Atlantis' },
            },
          ],
        },
        { blocks: [{ type: 'text', text: 'fertig' }] },
      ],
    });

    await collectEvents(
      runAgent(
        baseInput({
          llm,
          toolCallLogs: {
            record: (entry) => {
              eintraege.push({
                toolName: entry.toolName,
                outcome: entry.outcome,
                durationMs: entry.durationMs,
              });

              return Promise.resolve({
                ...entry,
                id: '00000000-0000-4000-8000-000000000000',
                createdAt: new Date(),
              });
            },
            listByConversation: () => Promise.resolve([]),
          },
        }),
      ),
    );

    expect(eintraege).toHaveLength(2);
    expect(eintraege.map((e) => e.outcome)).toEqual(['ok', 'upstream_error']);
    expect(eintraege.every((e) => e.durationMs >= 0)).toBe(true);
  });
});
