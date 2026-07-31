import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_LIMITS, summarize } from '@/domain/agent';
import { emptyTripDraft, tripDraftSchema, type TripDraft } from '@/domain/trip/trip';
import { ok, unwrap, type Result } from '@/domain/result';
import type { LlmRequest } from '@/domain/ports/llm';
import { createSeedProviders } from '@/server/adapters/factory';
import { collectEvents, runAgent } from '../loop';
import { createToolRegistry } from '../tools';
import { createRuleBasedLlm, extractTripParameters } from './rule-based';

const HEUTE = new Date('2026-07-28T00:00:00Z');

describe('Extraktion aus freiem Text', () => {
  it('erkennt das Ziel', () => {
    expect(extractTripParameters('Ich will nach Mallorca', HEUTE).destinationIata).toBe('PMI');
  });

  it('erkennt Abflugort und Ziel', () => {
    const params = extractTripParameters('von Düsseldorf nach Mallorca', HEUTE);

    expect(params.originIata).toBe('DUS');
    expect(params.destinationIata).toBe('PMI');
  });

  it('erkennt ein Ziel auch ohne Präposition', () => {
    expect(extractTripParameters('Kreta wäre schön', HEUTE).destinationIata).toBe('HER');
  });

  it.each([
    ['zu zweit', 2],
    ['alleine', 1],
    ['mit 3 Personen', 3],
    ['wir sind zu viert', 4],
  ])('erkennt „%s" als %i Reisende', (text, expected) => {
    expect(extractTripParameters(text, HEUTE).adults).toBe(expected);
  });

  it.each([
    ['bis 2000 €', 2_000],
    ['unter 1.500 Euro', 1_500],
    ['max. 800€', 800],
    ['höchstens 950 eur', 950],
  ])('erkennt Budget „%s"', (text, expected) => {
    expect(extractTripParameters(text, HEUTE).budgetEuros).toBe(expected);
  });

  it('erkennt ein Datum im ISO-Format', () => {
    expect(extractTripParameters('am 2026-09-05 los', HEUTE).departureDate).toBe('2026-09-05');
  });

  it('erkennt ein deutsches Datum', () => {
    expect(extractTripParameters('am 05.09.2026 los', HEUTE).departureDate).toBe('2026-09-05');
  });

  it('legt bei einem Monatsnamen die Monatsmitte fest', () => {
    expect(extractTripParameters('im September', HEUTE).departureDate).toBe('2026-09-15');
  });

  it('nimmt das Folgejahr, wenn der Monat schon vorbei ist', () => {
    // Referenzdatum ist Juli 2026 — der März liegt bereits hinter uns.
    expect(extractTripParameters('im März', HEUTE).departureDate).toBe('2027-03-15');
  });

  it.each([
    ['eine Woche', 7],
    ['zwei Wochen', 14],
    ['10 Tage', 10],
    ['3 Nächte', 3],
  ])('erkennt Dauer „%s" als %i Nächte', (text, expected) => {
    expect(extractTripParameters(text, HEUTE).nights).toBe(expected);
  });

  it('liest ein zweites Datum als Rückreisedatum', () => {
    // „vom … bis …" nennt beide Enden. Frueher blieb das Rueckreisedatum
    // leer, solange keine Dauer im Satz stand — der Eval meldete das in drei
    // Faellen, die wie drei verschiedene Fehler aussahen.
    const params = extractTripParameters('vom 12.09.2026 bis 19.09.2026');

    expect(params.departureDate).toBe('2026-09-12');
    expect(params.returnDate).toBe('2026-09-19');
  });

  it('nimmt keinen Monatsnamen als zweites Datum', () => {
    // „im Oktober" ist ein Monat, kein Zeitraum.
    const params = extractTripParameters('im Oktober nach Mallorca', new Date('2026-07-31'));

    expect(params.returnDate).toBeNull();
  });

  it('berechnet das Rückreisedatum aus Datum und Dauer', () => {
    const params = extractTripParameters('im September für eine Woche', HEUTE);

    expect(params.departureDate).toBe('2026-09-15');
    expect(params.returnDate).toBe('2026-09-22');
  });

  it('bewältigt die Beispielanfrage aus der Aufgabenstellung', () => {
    const params = extractTripParameters(
      'im September für eine Woche nach Mallorca zu zweit von Düsseldorf bis 2000 €',
      HEUTE,
    );

    expect(params).toMatchObject({
      originIata: 'DUS',
      destinationIata: 'PMI',
      departureDate: '2026-09-15',
      returnDate: '2026-09-22',
      adults: 2,
      budgetEuros: 2_000,
    });
  });

  it('gibt bei unverständlicher Eingabe überall null zurück', () => {
    const params = extractTripParameters('hallo wie geht es dir', HEUTE);

    expect(params.destinationIata).toBeNull();
    expect(params.departureDate).toBeNull();
    expect(params.budgetEuros).toBeNull();
  });
});

describe('Regelbasiertes Modell im Loop', () => {
  function createDrafts(): {
    repo: Parameters<typeof createToolRegistry>[0]['tripDrafts'];
    current: () => TripDraft;
  } {
    let draft = emptyTripDraft();

    return {
      repo: {
        createForConversation: () => Promise.resolve(draft),
        findByConversation: () => Promise.resolve(draft),
        save: (_id: string, next: TripDraft): Promise<Result<TripDraft>> => {
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
      },
      current: () => draft,
    };
  }

  function run(text: string) {
    const drafts = createDrafts();

    return {
      drafts,
      events: collectEvents(
        runAgent({
          conversationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
          systemPrompt: 'Reiseassistent',
          messages: [{ role: 'user', blocks: [{ type: 'text', text }] }],
          llm: createRuleBasedLlm(),
          tools: createToolRegistry({
            providers: createSeedProviders(),
            tripDrafts: drafts.repo,
          }),
          limits: DEFAULT_AGENT_LIMITS,
        }),
      ),
    };
  }

  it('schreibt erkannte Angaben in den Entwurf', async () => {
    const { drafts, events } = run('im September für eine Woche zu zweit bis 2000 €');

    await events;

    expect(drafts.current().adults).toBe(2);
    expect(drafts.current().budgetEuros).toBe(2_000);
  });

  it('stellt bei fehlendem Ziel genau eine Rückfrage', async () => {
    const { events } = run('ich möchte verreisen');

    const result = summarize(await events);

    expect(result.text).toContain('Wohin');
    expect(result.stopReason).toBe('completed');
  });

  /*
   * Dieser Fall bewacht mehr, als er auf den ersten Blick sagt: Der Loop haengt
   * Werkzeugergebnisse als Nachricht der Rolle `user` an. Wer daraus schliesst,
   * ein neuer Zug habe begonnen, sucht in jeder Iteration erneut und laeuft in
   * die Iterationsgrenze. Genau so ist es einmal passiert.
   */
  it('arbeitet ohne Netzwerk und ohne Schlüssel', async () => {
    const { events } = run('von Düsseldorf nach Mallorca im September für eine Woche zu zweit');

    const result = summarize(await events);

    expect(result.stopReason).toBe('completed');
    expect(result.toolCalls).toBeGreaterThan(0);
  });

  it('sucht genau einmal je Zug, nicht je Iteration', async () => {
    const { events } = run('von Düsseldorf nach Mallorca im September für eine Woche zu zweit');

    const suchen = (await events).filter(
      (event) => event.type === 'tool_started' && event.toolName === 'search_flights',
    );

    expect(suchen).toHaveLength(1);
  });

  it('verbraucht keine Tokens', async () => {
    const { events } = run('nach Mallorca');
    const finished = (await events).find((event) => event.type === 'finished');

    expect(finished).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });
});

/**
 * Der Ersatz muss dem Gespraech folgen, nicht nur der letzten Zeile.
 *
 * In der Abnahme uebernahm er, nachdem das Gaestekontingent aufgebraucht war —
 * und fragte „Wohin soll die Reise gehen?", obwohl das Ziel seit fuenf
 * Nachrichten feststand. Er las nur die letzte Aeusserung.
 */
describe('Gesammelter Stand über das ganze Gespräch', () => {
  function verlauf(...texte: readonly string[]): LlmRequest {
    return {
      systemPrompt: '',
      messages: texte.map((text) => ({
        role: 'user' as const,
        blocks: [{ type: 'text' as const, text }],
      })),
      tools: [],
    };
  }

  async function antwortText(request: LlmRequest): Promise<string> {
    const antwort = unwrap(await createRuleBasedLlm().complete(request));
    const block = antwort.blocks[0];

    return block?.type === 'text' ? block.text : '';
  }

  it('fragt nicht erneut nach dem Ziel, das früher genannt wurde', async () => {
    const text = await antwortText(verlauf('Ich will nach Mallorca', 'ja, 2 Kinder'));

    expect(text).not.toContain('Wohin soll die Reise gehen');
  });

  it('fragt nach der ersten Lücke, nicht nach der letzten Nachricht', async () => {
    const text = await antwortText(verlauf('nach Mallorca', 'Budget 1500 Euro'));

    expect(text).toContain('Flughafen');
  });

  it('übernimmt, was ein früherer Lauf in den Entwurf geschrieben hat', async () => {
    const request: LlmRequest = {
      systemPrompt: '',
      messages: [
        {
          role: 'assistant',
          blocks: [
            {
              type: 'tool_use',
              toolCallId: 'c1',
              toolName: 'update_trip_draft',
              // So schreibt das Sprachmodell den Entwurf — der Ersatz muss
              // damit weiterarbeiten koennen, wenn er mitten im Gespraech
              // uebernimmt.
              input: { destination: { iataCode: 'PMI' }, origin: { iataCode: 'DUS' } },
            },
          ],
        },
        { role: 'user', blocks: [{ type: 'text', text: 'ja, 2 Kinder' }] },
      ],
      tools: [],
    };

    const text = await antwortText(request);

    expect(text).not.toContain('Wohin soll die Reise gehen');
    expect(text).toContain('Datum');
  });

  it('lässt eine spätere Angabe die frühere ersetzen', async () => {
    const text = await antwortText(verlauf('nach Mallorca', 'doch lieber nach Wien'));

    // Nur die Rueckfrage verraet den Stand — das Ziel ist jedenfalls gesetzt.
    expect(text).not.toContain('Wohin soll die Reise gehen');
  });
});

describe('Entwurf aus erkannten Orten', () => {
  it('schreibt Ziel und Abflugort als vollständige Orte in den Entwurf', async () => {
    const llm = createRuleBasedLlm();

    const antwort = unwrap(
      await llm.complete({
        systemPrompt: '',
        messages: [
          {
            role: 'user',
            blocks: [{ type: 'text', text: 'von Düsseldorf nach Mallorca am 2026-10-08' }],
          },
        ],
        tools: [],
      }),
    );

    const block = antwort.blocks[0];

    // Der Extraktor kennt nur IATA-Codes, das Werkzeug will Name und
    // Koordinaten. Ohne die Umrechnung blieb die Entwurfsleiste leer,
    // obwohl beide Orte erkannt waren.
    expect(block).toMatchObject({
      type: 'tool_use',
      toolName: 'update_trip_draft',
      input: {
        origin: { iataCode: 'DUS', name: expect.any(String), latitude: expect.any(Number) },
        destination: { iataCode: 'PMI', longitude: expect.any(Number) },
      },
    });
  });

  it('lässt einen unbekannten Ort einfach weg', async () => {
    const llm = createRuleBasedLlm();

    const antwort = unwrap(
      await llm.complete({
        systemPrompt: '',
        messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Budget 900 Euro' }] }],
        tools: [],
      }),
    );

    const block = antwort.blocks[0];

    expect(block?.type === 'tool_use' ? block.input : {}).not.toHaveProperty('destination');
  });
});

/**
 * Was in der Abnahme geschah, nachdem das Gaestekontingent aufgebraucht war:
 * Der Entwurf war zu vier Fuenfteln gefuellt — Ziel, Abflug, beide Daten —
 * und der Ersatz fragte trotzdem nach dem Flughafen, verschluckte die Antwort
 * „2" auf seine eigene Frage nach den Erwachsenen und behauptete in jedem
 * weiteren Zug, er habe Verbindungen herausgesucht.
 */
describe('Der Entwurf ist die Wahrheit, nicht der Text', () => {
  function mitEntwurf(draft: Record<string, unknown>, ...texte: readonly string[]): LlmRequest {
    return {
      systemPrompt: '',
      messages: [
        {
          role: 'assistant',
          blocks: [
            { type: 'tool_use', toolCallId: 'c1', toolName: 'get_trip_draft', input: {} },
            { type: 'tool_result', toolCallId: 'c1', isError: false, content: { draft } },
          ],
        },
        ...texte.map((text) => ({
          role: 'user' as const,
          blocks: [{ type: 'text' as const, text }],
        })),
      ],
      tools: [],
    };
  }

  async function antwort(request: LlmRequest) {
    return unwrap(await createRuleBasedLlm().complete(request));
  }

  async function text(request: LlmRequest): Promise<string> {
    const block = (await antwort(request)).blocks[0];

    return block?.type === 'text' ? block.text : '';
  }

  const fastFertig = {
    origin: { iataCode: 'DUS' },
    destination: { iataCode: 'PMI' },
    departureDate: '2026-10-01',
    returnDate: '2026-10-08',
    adults: null,
  };

  it('fragt nicht nach einer Angabe, die im Entwurf steht', async () => {
    // Genau der Fall aus der Abnahme: „Von welchem Flughafen?", waehrend
    // „Düsseldorf (DUS)" in der Leiste danebenstand.
    expect(await text(mitEntwurf(fastFertig, 'ok'))).not.toContain('Flughafen');
  });

  it('fragt nach der Reisendenzahl, statt sie zu übergehen', async () => {
    // Sie ist Pflichtangabe und stand frueher in keiner einzigen Verzweigung.
    expect(await text(mitEntwurf(fastFertig, 'ok'))).toContain('Erwachsenen');
  });

  it('liest die knappe Antwort auf die eigene Frage', async () => {
    const request: LlmRequest = {
      systemPrompt: '',
      messages: [
        {
          role: 'assistant',
          blocks: [
            { type: 'tool_use', toolCallId: 'c1', toolName: 'get_trip_draft', input: {} },
            {
              type: 'tool_result',
              toolCallId: 'c1',
              isError: false,
              content: { draft: fastFertig },
            },
          ],
        },
        {
          role: 'assistant',
          blocks: [{ type: 'text', text: 'Mit wie vielen Erwachsenen reist du?' }],
        },
        { role: 'user', blocks: [{ type: 'text', text: '2' }] },
      ],
      tools: [],
    };

    const block = (await antwort(request)).blocks[0];

    expect(block).toMatchObject({
      type: 'tool_use',
      toolName: 'update_trip_draft',
      input: { adults: 2 },
    });
  });

  it('behauptet keine Suche, die in diesem Zug nicht stattgefunden hat', async () => {
    /*
     * Eine Suche aus einem frueheren Zug steht im Verlauf. Frueher galt sie
     * fuer immer, und der Schlusssatz „…und passende Verbindungen
     * herausgesucht" erschien danach auf jede beliebige Eingabe.
     */
    const request: LlmRequest = {
      systemPrompt: '',
      messages: [
        {
          role: 'assistant',
          blocks: [
            { type: 'tool_use', toolCallId: 'alt', toolName: 'search_flights', input: {} },
            { type: 'tool_result', toolCallId: 'alt', isError: false, content: { offers: [] } },
          ],
        },
        {
          role: 'assistant',
          blocks: [
            { type: 'tool_use', toolCallId: 'c1', toolName: 'get_trip_draft', input: {} },
            {
              type: 'tool_result',
              toolCallId: 'c1',
              isError: false,
              content: { draft: { ...fastFertig, adults: 2 } },
            },
          ],
        },
        { role: 'user', blocks: [{ type: 'text', text: '123' }] },
      ],
      tools: [],
    };

    // Alles bekannt, in diesem Zug noch nichts gesucht — also wird gesucht,
    // statt eine Suche zu behaupten.
    expect((await antwort(request)).blocks[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'search_flights',
    });
  });

  it('sagt es offen, wenn die Suche in diesem Zug scheiterte', async () => {
    const request: LlmRequest = {
      systemPrompt: '',
      messages: [
        { role: 'user', blocks: [{ type: 'text', text: 'los' }] },
        {
          role: 'assistant',
          blocks: [
            { type: 'tool_use', toolCallId: 'c1', toolName: 'get_trip_draft', input: {} },
            {
              type: 'tool_result',
              toolCallId: 'c1',
              isError: false,
              content: { draft: { ...fastFertig, adults: 2 } },
            },
            { type: 'tool_use', toolCallId: 'c2', toolName: 'search_flights', input: {} },
            {
              type: 'tool_result',
              toolCallId: 'c2',
              isError: true,
              content: { error: 'Anbieter nicht erreichbar' },
            },
          ],
        },
      ],
      tools: [],
    };

    expect(await text(request)).toContain('nicht geklappt');
  });
});
