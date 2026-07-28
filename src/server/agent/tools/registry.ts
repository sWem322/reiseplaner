import { z } from 'zod';
import type { LlmToolDescription } from '@/domain/ports/llm';
import type { Result } from '@/domain/result';
import { fail } from '@/domain/result';

/**
 * Werkzeug-Registry.
 *
 * Ein Werkzeug besteht aus vier Teilen:
 * 1. Name — Bezeichner fuer das Modell.
 * 2. Beschreibung — der Text, an dem das Modell entscheidet, wann es das
 *    Werkzeug aufruft. Faktisch der wichtigste Teil und deshalb ausfuehrlich.
 * 3. Zod-Schema der Eingabe — die Grenze zwischen Modell und Aussenwelt.
 * 4. Ausfuehrung — bekommt bereits geprueftes Material.
 *
 * Punkt drei ist der Kern der Kontrollierbarkeit: Zwischen dem, was das Modell
 * ausdenkt, und dem, was einen Anbieter erreicht, steht eine Validierung. Das
 * Modell kann keinen Unsinn an eine externe Schnittstelle schicken — im
 * schlimmsten Fall bekommt es eine Fehlermeldung zurueck und korrigiert sich.
 */

export interface ToolExecutionContext {
  readonly conversationId: string;
}

export interface Tool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  /**
   * Fuehrt das Werkzeug aus. Gibt ein Result zurueck; der Loop reicht auch
   * Fehlschlaege als tool_result an das Modell weiter.
   */
  execute(input: TInput, context: ToolExecutionContext): Promise<Result<unknown>>;
}

export type ToolRegistry = ReadonlyMap<string, Tool>;

export function createRegistry(tools: readonly Tool[]): ToolRegistry {
  const map = new Map<string, Tool>();

  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Werkzeugname doppelt vergeben: ${tool.name}`);
    }

    map.set(tool.name, tool);
  }

  return map;
}

/**
 * Beschreibungen fuer das Modell, abgeleitet aus den Zod-Schemata.
 *
 * Bewusst generiert statt handgeschrieben: Ein zweites, manuell gepflegtes
 * JSON-Schema wuerde frueher oder spaeter von der Zod-Definition abweichen —
 * und dann validiert die Anwendung etwas anderes, als das Modell zu sehen
 * bekommt.
 */
export function describeTools(registry: ToolRegistry): LlmToolDescription[] {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }),
  }));
}

export interface ValidatedCall<TInput = unknown> {
  readonly tool: Tool<TInput>;
  readonly input: TInput;
}

/**
 * Prueft einen Werkzeugaufruf des Modells.
 *
 * Beide Fehlerfaelle — unbekannter Name, ungueltige Eingabe — geben eine
 * Meldung zurueck, die das Modell lesen und daraus lernen kann. Deshalb wird
 * bei ungueltiger Eingabe der Pfad des fehlerhaften Feldes genannt: Ein
 * "IATA-Code besteht aus drei Grossbuchstaben" ist eine Anweisung, ein
 * "Validation failed" ist es nicht.
 */
export function validateCall(
  registry: ToolRegistry,
  toolName: string,
  rawInput: unknown,
): Result<ValidatedCall> {
  const tool = registry.get(toolName);

  if (tool === undefined) {
    const available = [...registry.keys()].join(', ');

    return fail(
      'validation_error',
      `Unbekanntes Werkzeug „${toolName}". Verfügbar sind: ${available}`,
      { toolName },
    );
  }

  const parsed = tool.inputSchema.safeParse(rawInput);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path === '' ? issue.message : `${path}: ${issue.message}`;
      })
      .join('; ');

    return fail('validation_error', `Ungültige Eingabe für ${toolName} — ${details}`, {
      toolName,
      issues: parsed.error.issues,
    });
  }

  return { ok: true, value: { tool, input: parsed.data } };
}
