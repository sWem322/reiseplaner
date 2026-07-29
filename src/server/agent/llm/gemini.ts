import { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentResponse, Part } from '@google/genai';
import type { ContentBlock } from '@/domain/conversation';
import type { LlmMessage, LlmPort, LlmRequest, LlmResponse } from '@/domain/ports/llm';
import { fail, ok, type Result } from '@/domain/result';
import { toGeminiSchema } from './gemini-schema';
import { buildModelChain, ModelRotation, suspensionFor } from './model-rotation';

/**
 * Gemini hinter dem LlmPort.
 *
 * Die Datei besteht fast vollständig aus Übersetzung — und genau das ist ihr
 * Zweck. Drei Dinge sind bei Gemini anders als im Domänenmodell:
 *
 * 1. Rollen heissen `user` und `model`, nicht `user` und `assistant`.
 * 2. Werkzeugaufrufe und -ergebnisse sind Teile einer Nachricht
 *    (`functionCall`, `functionResponse`), keine eigenständigen Blöcke.
 * 3. Gemini vergibt keine verlässlichen Aufruf-Kennungen. Der Loop braucht
 *    sie aber, um Aufruf und Ergebnis zuzuordnen — deshalb werden sie hier
 *    erzeugt und beim Rückweg über den Werkzeugnamen wieder aufgelöst.
 *
 * Punkt drei ist der Grund, warum der Adapter nicht zustandslos sein kann.
 */

/**
 * Alias statt fester Version.
 *
 * Google benennt Modelle laufend um und entzieht ältere Namen neuen Konten —
 * `gemini-2.5-flash` etwa antwortet seit Mitte 2026 mit „no longer available
 * to new users". Der Alias zeigt immer auf die aktuelle Flash-Generation.
 * Welcher Name konkret dahintersteht, zeigt `npm run llm:check`; wer ihn
 * festschreiben will, setzt GEMINI_MODEL in der .env.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

/** Schmale Sicht auf das SDK — nur das, was dieser Adapter braucht. */
export interface GeminiClient {
  readonly models: {
    generateContent(request: {
      model: string;
      contents: Content[];
      config?: Record<string, unknown>;
    }): Promise<GenerateContentResponse>;
  };
}

export interface GeminiOptions {
  readonly apiKey: string;
  /** Wunschmodell aus der Umgebung — kommt an den Anfang der Kette. */
  readonly model?: string;
  /** Vollständige Kette, stärkstes zuerst. Ersetzt die Voreinstellung. */
  readonly models?: readonly string[];
  /** Untergeschobener Client für Tests — ohne Schlüssel und ohne Netz. */
  readonly client?: GeminiClient;
  /** Geteilter Zustand der Sperren; für Tests mit gestellter Uhr. */
  readonly rotation?: ModelRotation;
}

// --- Hinweg: Domäne → Gemini -------------------------------------------

function toGeminiParts(blocks: readonly ContentBlock[], callNames: Map<string, string>): Part[] {
  const parts: Part[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) {
          parts.push({ text: block.text });
        }
        break;

      case 'tool_use':
        callNames.set(block.toolCallId, block.toolName);
        parts.push({
          functionCall: {
            name: block.toolName,
            args: (block.input ?? {}) as Record<string, unknown>,
          },
          /*
           * Die Signatur muss unveraendert zurueck. Fehlt sie, antwortet
           * Gemini mit 400: „Function call is missing a thought_signature in
           * functionCall parts. This is required for tools to work correctly."
           * Betroffen ist schon die zweite Iteration eines Laufs — der erste
           * Werkzeugaufruf geht durch, die Auswertung seines Ergebnisses
           * nicht mehr.
           */
          ...(block.providerSignature === undefined
            ? {}
            : { thoughtSignature: block.providerSignature }),
        });
        break;

      case 'tool_result': {
        const name = callNames.get(block.toolCallId) ?? 'unbekannt';

        parts.push({
          functionResponse: {
            name,
            // Gemini erwartet ein Objekt. Ein Fehler wird als solches
            // gekennzeichnet, damit das Modell ihn nicht für ein Ergebnis hält.
            response: block.isError ? { error: block.content } : { result: block.content },
          },
        });
        break;
      }
    }
  }

  return parts;
}

function toGeminiContents(messages: readonly LlmMessage[]): Content[] {
  const callNames = new Map<string, string>();
  const contents: Content[] = [];

  for (const message of messages) {
    const parts = toGeminiParts(message.blocks, callNames);

    if (parts.length === 0) {
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  return contents;
}

// --- Rückweg: Gemini → Domäne ------------------------------------------

function fromGeminiResponse(response: GenerateContentResponse): LlmResponse {
  const blocks: ContentBlock[] = [];
  const parts = response.candidates?.[0]?.content?.parts ?? [];

  let callIndex = 0;

  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      blocks.push({ type: 'text', text: part.text });
    }

    if (part.functionCall !== undefined) {
      callIndex += 1;

      blocks.push({
        type: 'tool_use',
        // Gemini liefert nicht immer eine Kennung — dann wird eine erzeugt,
        // damit der Loop Aufruf und Ergebnis zuordnen kann.
        toolCallId: part.functionCall.id ?? `gemini_${String(callIndex)}_${String(Date.now())}`,
        toolName: part.functionCall.name ?? 'unbekannt',
        input: part.functionCall.args ?? {},
        // Wird nicht ausgewertet, nur aufbewahrt — der Rueckweg braucht sie.
        ...(typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0
          ? { providerSignature: part.thoughtSignature }
          : {}),
      });
    }
  }

  const usage = response.usageMetadata;

  return {
    blocks,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * Ordnet einen Fehler des SDK einem DomainError zu.
 *
 * Das SDK wirft Ausnahmen mit einem Statuscode im Text. Die Zuordnung folgt
 * derselben Tabelle wie bei den HTTP-Adaptern, damit der Loop überall dieselben
 * Fehlerarten sieht.
 */
function mapError(error: unknown): Result<never> {
  const message = error instanceof Error ? error.message : String(error);

  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return fail('rate_limited', 'Gemini meldet zu viele Anfragen', { cause: message });
  }

  if (/\b401\b|\b403\b|UNAUTHENTICATED|PERMISSION_DENIED|API key/i.test(message)) {
    return fail('unauthorized', 'Gemini verweigert den Zugriff — Schlüssel prüfen', {
      cause: message,
    });
  }

  if (/\b400\b|INVALID_ARGUMENT/i.test(message)) {
    return fail('upstream_error', 'Gemini hat die Anfrage abgelehnt', { cause: message });
  }

  return fail('upstream_error', 'Gemini ist nicht erreichbar', { cause: message });
}

// --- Port ---------------------------------------------------------------

/**
 * Ein gesperrtes Modell ist kein Fehler, solange ein anderes antwortet.
 *
 * Sperrgruende sind zweierlei: ein aufgebrauchtes Kontingent (429) und ein
 * Name, den dieser Zugang nicht mehr benutzen darf (404, „no longer available
 * to new users"). Beides betrifft das Modell, nicht die Anfrage — sie darf
 * also unveraendert an das naechste gehen.
 */
function isModelUnavailable(message: string): boolean {
  return (
    /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message) ||
    /\b404\b|NOT_FOUND|no longer available/i.test(message)
  );
}

export function createGeminiLlm(options: GeminiOptions): LlmPort {
  const client: GeminiClient = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });

  const kette = options.models ?? buildModelChain(options.model);
  const rotation = options.rotation ?? new ModelRotation({ models: kette });

  return {
    name: `gemini:${kette[0] ?? DEFAULT_GEMINI_MODEL}`,

    async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
      const contents = toGeminiContents(request.messages);

      if (contents.length === 0) {
        return fail('validation_error', 'Der Verlauf enthält keine verwertbare Nachricht');
      }

      const functionDeclarations = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.inputSchema),
      }));

      // Hoechstens ein Versuch je Modell — danach ist die Kette durch.
      for (const _ of kette) {
        const model = rotation.current();

        if (model === null) {
          break;
        }

        try {
          const response = await client.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: request.systemPrompt,
              ...(request.maxOutputTokens === undefined
                ? {}
                : { maxOutputTokens: request.maxOutputTokens }),
              ...(functionDeclarations.length === 0 ? {} : { tools: [{ functionDeclarations }] }),
              // Reproduzierbarkeit vor Kreativität: Der Agent soll auf dieselbe
              // Anfrage möglichst dieselben Werkzeuge aufrufen.
              temperature: 0.2,
            },
          });

          return ok(fromGeminiResponse(response));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (!isModelUnavailable(message)) {
            return mapError(error);
          }

          const dauer = suspensionFor(message, Date.now());

          rotation.suspend(model, dauer);

          console.warn(
            `Modell ${model} pausiert für ${String(Math.round(dauer / 60_000))} min — weiter mit dem nächsten.`,
          );
        }
      }

      const frei = rotation.nextFreeAt();

      return fail(
        'rate_limited',
        frei === null
          ? 'Kein Modell hat geantwortet'
          : `Alle Modelle sind bis ${new Date(frei).toISOString().slice(11, 16)} UTC ausgelastet`,
        { models: kette, nextFreeAt: frei },
      );
    },
  };
}
