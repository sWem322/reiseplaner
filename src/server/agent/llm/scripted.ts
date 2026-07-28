import type { ContentBlock } from '@/domain/conversation';
import type { LlmPort, LlmRequest, LlmResponse } from '@/domain/ports/llm';
import { fail, ok, type Result } from '@/domain/result';

/**
 * Skriptgesteuertes Ersatzmodell.
 *
 * Der Loop soll geprueft werden, nicht das Sprachmodell. Ein echtes Modell im
 * Test haette drei Nachteile: Es kostet Geld, es antwortet nicht zweimal
 * gleich, und es braucht Netz. Ein Skript aus vorgegebenen Zuegen loest alle
 * drei Probleme auf einmal.
 *
 * Genau dieser Schnitt macht die Aussage moeglich, die auf einem Gespraech
 * ueber Tests von KI-Systemen zaehlt: Die Orchestrierung wird deterministisch
 * geprueft, die Modellqualitaet getrennt davon im Eval-Pfad.
 */

export interface ScriptedTurn {
  readonly blocks: readonly ContentBlock[];
  readonly usage?: { inputTokens: number; outputTokens: number };
}

export interface ScriptedLlmOptions {
  /** Zuege in der Reihenfolge, in der sie geliefert werden. */
  readonly turns: readonly ScriptedTurn[];
  /**
   * Verhalten, wenn das Skript aufgebraucht ist. `stop` liefert eine
   * Textantwort ohne Werkzeugaufruf — der Normalfall. `error` simuliert ein
   * nicht erreichbares Modell.
   */
  readonly onExhausted?: 'stop' | 'error';
}

export interface ScriptedLlm extends LlmPort {
  /** Alle Anfragen, die der Loop gestellt hat — fuer Zusicherungen im Test. */
  readonly requests: readonly LlmRequest[];
  readonly callCount: number;
}

export function createScriptedLlm(options: ScriptedLlmOptions): ScriptedLlm {
  const requests: LlmRequest[] = [];
  let index = 0;

  return {
    name: 'scripted',

    get requests() {
      return requests;
    },

    get callCount() {
      return index;
    },

    complete(request: LlmRequest): Promise<Result<LlmResponse>> {
      requests.push(request);
      const turn = options.turns[index];
      index += 1;

      if (turn === undefined) {
        if (options.onExhausted === 'error') {
          return Promise.resolve(fail('upstream_error', 'Skript aufgebraucht'));
        }

        return Promise.resolve(
          ok({
            blocks: [{ type: 'text', text: 'Fertig.' }],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        );
      }

      return Promise.resolve(
        ok({
          blocks: turn.blocks,
          usage: turn.usage ?? { inputTokens: 100, outputTokens: 50 },
        }),
      );
    },
  };
}

/** Ein Modell, das immer dasselbe Werkzeug verlangt — fuer Grenzwerttests. */
export function createLoopingLlm(toolName: string, input: unknown): LlmPort {
  let counter = 0;

  return {
    name: 'looping',
    complete(): Promise<Result<LlmResponse>> {
      counter += 1;

      return Promise.resolve(
        ok({
          blocks: [
            {
              type: 'tool_use',
              toolCallId: `call_${String(counter)}`,
              toolName,
              input,
            },
          ],
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      );
    },
  };
}

/** Ein Modell, das nicht erreichbar ist. */
export function createFailingLlm(message = 'Modell nicht erreichbar'): LlmPort {
  return {
    name: 'failing',
    complete(): Promise<Result<LlmResponse>> {
      return Promise.resolve(fail('upstream_error', message));
    },
  };
}
