import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GenerateContentResponse } from '@google/genai';
import type { LlmRequest } from '@/domain/ports/llm';
import { unwrap } from '@/domain/result';
import { createGeminiLlm, type GeminiClient } from './gemini';
import { ModelRotation } from './model-rotation';
import { toGeminiSchema } from './gemini-schema';

/**
 * Kein Test dieser Datei braucht einen Schlüssel oder eine Verbindung. Der
 * SDK-Client wird untergeschoben — deshalb ist er im Adapter überhaupt
 * austauschbar.
 */

interface Recorded {
  model?: string | undefined;
  contents?: unknown;
  config?: Record<string, unknown> | undefined;
}

function createClient(
  response: Partial<GenerateContentResponse>,
  recorded: Recorded = {},
): GeminiClient {
  return {
    models: {
      generateContent(request) {
        recorded.model = request.model;
        recorded.contents = request.contents;
        recorded.config = request.config;

        return Promise.resolve(response as GenerateContentResponse);
      },
    },
  };
}

function throwingClient(error: Error): GeminiClient {
  return {
    models: {
      generateContent() {
        return Promise.reject(error);
      },
    },
  };
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    systemPrompt: 'Du bist ein Reiseassistent.',
    messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Ich will nach Mallorca.' }] }],
    tools: [],
    ...overrides,
  };
}

const textResponse = {
  candidates: [{ content: { parts: [{ text: 'Wohin genau?' }] } }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
};

describe('Schema-Umbau für Gemini', () => {
  it('entfernt Felder, die Gemini nicht kennt', () => {
    const jsonSchema = z.toJSONSchema(z.object({ query: z.string() }), { io: 'input' });
    const converted = toGeminiSchema(jsonSchema);

    expect(converted).not.toHaveProperty('$schema');
    expect(converted).not.toHaveProperty('additionalProperties');
    expect(converted.type).toBe('object');
  });

  it('behält Beschreibungen, weil das Modell sie liest', () => {
    const schema = z.toJSONSchema(
      z.object({ iata: z.string().describe('IATA-Code des Flughafens') }),
      { io: 'input' },
    );

    const converted = toGeminiSchema(schema) as {
      properties: { iata: { description: string } };
    };

    expect(converted.properties.iata.description).toBe('IATA-Code des Flughafens');
  });

  it('löst eine nullable-Union in nullable auf', () => {
    const schema = z.toJSONSchema(z.object({ budget: z.number().nullable() }), { io: 'input' });

    const converted = toGeminiSchema(schema) as {
      properties: { budget: { type: string; nullable?: boolean } };
    };

    expect(converted.properties.budget.type).toBe('number');
    expect(converted.properties.budget.nullable).toBe(true);
  });

  it('behandelt verschachtelte Objekte und Listen', () => {
    const schema = z.toJSONSchema(
      z.object({
        places: z.array(z.object({ name: z.string(), lat: z.number() })),
      }),
      { io: 'input' },
    );

    const converted = toGeminiSchema(schema) as {
      properties: {
        places: { type: string; items: { type: string; properties: Record<string, unknown> } };
      };
    };

    expect(converted.properties.places.type).toBe('array');
    expect(converted.properties.places.items.type).toBe('object');
    expect(Object.keys(converted.properties.places.items.properties)).toEqual(['name', 'lat']);
  });

  it('entfernt Formate, die Gemini nicht unterstützt', () => {
    const converted = toGeminiSchema({ type: 'string', format: 'uuid' });

    expect(converted).not.toHaveProperty('format');
  });

  it('gibt einem Objekt ohne Eigenschaften ein leeres properties-Feld', () => {
    const schema = z.toJSONSchema(z.object({}), { io: 'input' });

    expect(toGeminiSchema(schema)).toMatchObject({ type: 'object', properties: {} });
  });

  it('behält Pflichtfelder', () => {
    const schema = z.toJSONSchema(z.object({ a: z.string(), b: z.string().optional() }), {
      io: 'input',
    });

    expect(toGeminiSchema(schema).required).toEqual(['a']);
  });

  it('verkraftet unbrauchbare Eingaben', () => {
    expect(toGeminiSchema(null)).toEqual({ type: 'string' });
    expect(toGeminiSchema('kein Schema')).toEqual({ type: 'string' });
  });
});

describe('Gemini-Adapter', () => {
  it('gibt eine Textantwort samt Tokenverbrauch zurück', async () => {
    const llm = createGeminiLlm({ apiKey: 'test', client: createClient(textResponse) });

    const response = unwrap(await llm.complete(request()));

    expect(response.blocks).toEqual([{ type: 'text', text: 'Wohin genau?' }]);
    expect(response.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it('nennt Modell und Anbieter im Namen', () => {
    const llm = createGeminiLlm({ apiKey: 'test', model: 'gemini-2.5-flash' });

    expect(llm.name).toBe('gemini:gemini-2.5-flash');
  });

  it('übergibt den Systemprompt als systemInstruction', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(request({ systemPrompt: 'Antworte auf Deutsch.' }));

    expect(recorded.config?.systemInstruction).toBe('Antworte auf Deutsch.');
  });

  it('übersetzt die Rolle assistant in model', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(
      request({
        messages: [
          { role: 'user', blocks: [{ type: 'text', text: 'Hallo' }] },
          { role: 'assistant', blocks: [{ type: 'text', text: 'Guten Tag' }] },
        ],
      }),
    );

    const contents = recorded.contents as { role: string }[];

    expect(contents.map((c) => c.role)).toEqual(['user', 'model']);
  });

  it('gibt Werkzeugbeschreibungen im Gemini-Format weiter', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(
      request({
        tools: [
          {
            name: 'resolve_destination',
            description: 'Löst einen Ortsnamen auf.',
            inputSchema: z.toJSONSchema(z.object({ query: z.string() }), { io: 'input' }),
          },
        ],
      }),
    );

    const tools = recorded.config?.tools as [
      { functionDeclarations: { name: string; parameters: Record<string, unknown> }[] },
    ];
    const declaration = tools[0].functionDeclarations[0];

    expect(declaration?.name).toBe('resolve_destination');
    expect(declaration?.parameters).not.toHaveProperty('$schema');
  });

  it('sendet ohne Werkzeuge auch kein tools-Feld', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(request({ tools: [] }));

    expect(recorded.config).not.toHaveProperty('tools');
  });

  it('wandelt einen Werkzeugaufruf des Modells in einen tool_use-Block', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'call_42',
                    name: 'resolve_destination',
                    args: { query: 'Mallorca' },
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 15 },
      }),
    });

    const response = unwrap(await llm.complete(request()));

    expect(response.blocks[0]).toEqual({
      type: 'tool_use',
      toolCallId: 'call_42',
      toolName: 'resolve_destination',
      input: { query: 'Mallorca' },
    });
  });

  it('erzeugt eine Kennung, wenn Gemini keine liefert', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_trip_draft', args: {} } }],
            },
          },
        ],
      }),
    });

    const response = unwrap(await llm.complete(request()));
    const block = response.blocks[0];

    expect(block?.type).toBe('tool_use');
    if (block?.type === 'tool_use') {
      expect(block.toolCallId.length).toBeGreaterThan(0);
    }
  });

  it('verarbeitet Text und Werkzeugaufruf im selben Zug', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Ich schaue nach.' },
                { functionCall: { name: 'search_flights', args: { originIata: 'DUS' } } },
              ],
            },
          },
        ],
      }),
    });

    const response = unwrap(await llm.complete(request()));

    expect(response.blocks.map((block) => block.type)).toEqual(['text', 'tool_use']);
  });

  it('gibt mehrere Werkzeugaufrufe eines Zuges zurück', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'resolve_destination', args: { query: 'Mallorca' } } },
                { functionCall: { name: 'get_weather_outlook', args: { month: 9 } } },
              ],
            },
          },
        ],
      }),
    });

    const response = unwrap(await llm.complete(request()));

    expect(response.blocks).toHaveLength(2);
  });

  it('schickt ein Werkzeugergebnis als functionResponse zurück', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(
      request({
        messages: [
          { role: 'user', blocks: [{ type: 'text', text: 'Mallorca' }] },
          {
            role: 'assistant',
            blocks: [
              {
                type: 'tool_use',
                toolCallId: 'c1',
                toolName: 'resolve_destination',
                input: { query: 'Mallorca' },
              },
            ],
          },
          {
            role: 'user',
            blocks: [
              {
                type: 'tool_result',
                toolCallId: 'c1',
                isError: false,
                content: { matches: [{ iataCode: 'PMI' }] },
              },
            ],
          },
        ],
      }),
    );

    const contents = recorded.contents as {
      parts: { functionResponse?: { name: string; response: Record<string, unknown> } }[];
    }[];
    const antwortTeil = contents[2]?.parts[0]?.functionResponse;

    // Der Name wird über die Aufruf-Kennung aufgelöst — Gemini ordnet Ergebnisse
    // über den Werkzeugnamen zu, nicht über eine Kennung.
    expect(antwortTeil?.name).toBe('resolve_destination');
    expect(antwortTeil?.response).toHaveProperty('result');
  });

  it('kennzeichnet ein fehlgeschlagenes Werkzeugergebnis als Fehler', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient(textResponse, recorded),
    });

    await llm.complete(
      request({
        messages: [
          {
            role: 'assistant',
            blocks: [{ type: 'tool_use', toolCallId: 'c1', toolName: 'search_flights', input: {} }],
          },
          {
            role: 'user',
            blocks: [
              {
                type: 'tool_result',
                toolCallId: 'c1',
                isError: true,
                content: { error: 'IATA-Code ungültig' },
              },
            ],
          },
        ],
      }),
    );

    const contents = recorded.contents as {
      parts: { functionResponse?: { response: Record<string, unknown> } }[];
    }[];

    expect(contents[1]?.parts[0]?.functionResponse?.response).toHaveProperty('error');
  });

  it('lehnt einen leeren Verlauf ab, ohne den Anbieter zu fragen', async () => {
    let called = false;
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: {
        models: {
          generateContent() {
            called = true;
            return Promise.resolve({} as GenerateContentResponse);
          },
        },
      },
    });

    const result = await llm.complete(request({ messages: [] }));

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('verkraftet eine Antwort ohne Kandidaten', async () => {
    const llm = createGeminiLlm({ apiKey: 'test', client: createClient({}) });

    const response = unwrap(await llm.complete(request()));

    expect(response.blocks).toEqual([]);
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('Fehlerzuordnung', () => {
  it.each([
    ['429 RESOURCE_EXHAUSTED: quota exceeded', 'rate_limited'],
    ['403 PERMISSION_DENIED: API key not valid', 'unauthorized'],
    ['401 UNAUTHENTICATED', 'unauthorized'],
    ['400 INVALID_ARGUMENT: bad schema', 'upstream_error'],
    ['fetch failed', 'upstream_error'],
  ])('ordnet „%s" der Fehlerart %s zu', async (message, expectedKind) => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: throwingClient(new Error(message)),
    });

    const result = await llm.complete(request());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(expectedKind);
    }
  });

  it('wirft nie, sondern gibt ein Result zurück', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: throwingClient(new Error('irgendein Fehler')),
    });

    await expect(llm.complete(request())).resolves.toMatchObject({ ok: false });
  });
});

/**
 * Die Signatur des Denkschritts.
 *
 * Gemini legt sie in die `functionCall`-Teile seiner Antwort und lehnt jede
 * Folgeanfrage mit 400 ab, in der sie zu einem Werkzeugaufruf fehlt. Der
 * Adapter darf sie deshalb weder verlieren noch veraendern. Diese Tests
 * beschreiben genau den Weg hin und zurueck — er ist von aussen unsichtbar
 * und faellt sonst erst im laufenden Gespraech auf.
 */
describe('Signatur des Modells', () => {
  const signatur = 'EpoGCpcGAXLI2nx-Beispielsignatur';

  const callResponse = {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: { name: 'resolve_destination', args: { query: 'Mallorca' } },
              thoughtSignature: signatur,
            },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  };

  it('bewahrt die Signatur eines Werkzeugaufrufs auf', async () => {
    const llm = createGeminiLlm({ apiKey: 'test', client: createClient(callResponse) });

    const antwort = unwrap(await llm.complete(request()));

    expect(antwort.blocks[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'resolve_destination',
      providerSignature: signatur,
    });
  });

  it('gibt sie beim nächsten Aufruf unverändert zurück', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({ apiKey: 'test', client: createClient(textResponse, recorded) });

    await llm.complete(
      request({
        messages: [
          { role: 'user', blocks: [{ type: 'text', text: 'Mallorca' }] },
          {
            role: 'assistant',
            blocks: [
              {
                type: 'tool_use',
                toolCallId: 'call_1',
                toolName: 'resolve_destination',
                input: { query: 'Mallorca' },
                providerSignature: signatur,
              },
            ],
          },
          {
            role: 'user',
            blocks: [
              { type: 'tool_result', toolCallId: 'call_1', isError: false, content: { ok: true } },
            ],
          },
        ],
      }),
    );

    const contents = recorded.contents as { parts: { thoughtSignature?: string }[] }[];

    expect(contents[1]?.parts[0]?.thoughtSignature).toBe(signatur);
  });

  it('kommt ohne Signatur aus, wenn das Modell keine geschickt hat', async () => {
    const recorded: Recorded = {};
    const llm = createGeminiLlm({ apiKey: 'test', client: createClient(textResponse, recorded) });

    await llm.complete(
      request({
        messages: [
          {
            role: 'assistant',
            blocks: [
              {
                type: 'tool_use',
                toolCallId: 'call_1',
                toolName: 'resolve_destination',
                input: {},
              },
            ],
          },
        ],
      }),
    );

    const contents = recorded.contents as { parts: Record<string, unknown>[] }[];

    // Kein leeres Feld: Gemini soll den Schluessel gar nicht erst sehen.
    expect(contents[0]?.parts[0]).not.toHaveProperty('thoughtSignature');
  });

  it('übergeht eine leere Signatur', async () => {
    const llm = createGeminiLlm({
      apiKey: 'test',
      client: createClient({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'search_flights', args: {} }, thoughtSignature: '' }],
            },
          },
        ],
      }),
    });

    const antwort = unwrap(await llm.complete(request()));

    expect(antwort.blocks[0]).not.toHaveProperty('providerSignature');
  });
});

/**
 * Heisser Wechsel zwischen Modellen.
 *
 * Das kostenlose Kontingent gilt je Modell. Faellt das staerkste aus, soll
 * dieselbe Anfrage beim naechsten landen — ohne dass der Loop davon etwas
 * merkt. Von Hand ist das kaum zu pruefen: Ein Tageslimit erschoepft sich
 * einmal am Tag.
 */
describe('Wechsel des Modells bei erschöpftem Kontingent', () => {
  const KETTE = ['stark', 'mittel', 'schwach'];

  /** Antwortet erst, wenn eines der genannten Modelle gefragt wird. */
  function clientMitLimit(
    erschoepft: readonly string[],
    gefragt: string[],
    fehler = '{"error":{"code":429,"message":"You exceeded your current quota"}}',
  ): GeminiClient {
    return {
      models: {
        generateContent(request) {
          gefragt.push(request.model);

          if (erschoepft.includes(request.model)) {
            return Promise.reject(new Error(fehler));
          }

          return Promise.resolve(textResponse as GenerateContentResponse);
        },
      },
    };
  }

  function rotation(models: readonly string[] = KETTE): ModelRotation {
    return new ModelRotation({ models });
  }

  it('weicht auf das nächste Modell aus und liefert eine Antwort', async () => {
    const gefragt: string[] = [];
    const llm = createGeminiLlm({
      apiKey: 'test',
      models: KETTE,
      rotation: rotation(),
      client: clientMitLimit(['stark'], gefragt),
    });

    const antwort = await llm.complete(request());

    expect(antwort.ok).toBe(true);
    expect(gefragt).toEqual(['stark', 'mittel']);
  });

  it('überspringt das gesperrte Modell beim nächsten Aufruf sofort', async () => {
    const gefragt: string[] = [];
    const geteilt = rotation();
    const client = clientMitLimit(['stark'], gefragt);

    const llm = createGeminiLlm({ apiKey: 'test', models: KETTE, rotation: geteilt, client });

    await llm.complete(request());
    gefragt.length = 0;

    await llm.complete(request());

    // Kein zweiter Anlauf gegen ein Modell, dessen Kontingent bekannt leer ist.
    expect(gefragt).toEqual(['mittel']);
  });

  it('geht auch bei einem entzogenen Modellnamen weiter', async () => {
    const gefragt: string[] = [];
    const llm = createGeminiLlm({
      apiKey: 'test',
      models: KETTE,
      rotation: rotation(),
      client: clientMitLimit(
        ['stark'],
        gefragt,
        '{"error":{"code":404,"message":"no longer available to new users"}}',
      ),
    });

    await expect(llm.complete(request())).resolves.toMatchObject({ ok: true });
    expect(gefragt).toEqual(['stark', 'mittel']);
  });

  it('meldet rate_limited, erst wenn die ganze Kette erschöpft ist', async () => {
    const gefragt: string[] = [];
    const llm = createGeminiLlm({
      apiKey: 'test',
      models: KETTE,
      rotation: rotation(),
      client: clientMitLimit(KETTE, gefragt),
    });

    const antwort = await llm.complete(request());

    expect(antwort.ok).toBe(false);
    if (!antwort.ok) {
      expect(antwort.error.kind).toBe('rate_limited');
    }

    expect(gefragt).toEqual(KETTE);
  });

  it('wechselt nicht bei einem Fehler, der nicht am Modell liegt', async () => {
    const gefragt: string[] = [];

    const llm = createGeminiLlm({
      apiKey: 'test',
      models: KETTE,
      rotation: rotation(),
      client: {
        models: {
          generateContent(anfrage) {
            gefragt.push(anfrage.model);

            return Promise.reject(new Error('{"error":{"code":400,"message":"bad request"}}'));
          },
        },
      },
    });

    const antwort = await llm.complete(request());

    expect(antwort.ok).toBe(false);
    // Eine abgelehnte Anfrage wird bei jedem anderen Modell genauso abgelehnt.
    expect(gefragt).toEqual(['stark']);
  });

  it('behält den Verlauf beim Wechsel unverändert', async () => {
    const gesehen: unknown[] = [];

    const llm = createGeminiLlm({
      apiKey: 'test',
      models: KETTE,
      rotation: rotation(),
      client: {
        models: {
          generateContent(anfrage) {
            gesehen.push(anfrage.contents);

            if (anfrage.model === 'stark') {
              return Promise.reject(new Error('429 quota'));
            }

            return Promise.resolve(textResponse as GenerateContentResponse);
          },
        },
      },
    });

    await llm.complete(request());

    expect(gesehen).toHaveLength(2);
    expect(gesehen[1]).toEqual(gesehen[0]);
  });
});
