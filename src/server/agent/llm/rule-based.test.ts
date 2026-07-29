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

  it('arbeitet ohne Netzwerk und ohne Schlüssel', async () => {
    const { events } = run('von Düsseldorf nach Mallorca im September für eine Woche zu zweit');

    const result = summarize(await events);

    expect(result.stopReason).toBe('completed');
    expect(result.toolCalls).toBeGreaterThan(0);
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
