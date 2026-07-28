import type { ContentBlock, MessageRole } from '../conversation';
import type { Result } from '../result';

/**
 * Port des Sprachmodells.
 *
 * Bewusst schmal: eine Methode, die eine Unterhaltung plus Werkzeugbeschreibungen
 * entgegennimmt und einen Zug des Modells zurueckgibt. Alles, was Anbieter
 * unterschiedlich loesen — Streaming-Format, Tool-Schema-Dialekt, Zaehlweise der
 * Tokens — wird im Adapter uebersetzt.
 *
 * Der Loop kennt weder Gemini noch OpenAI. Deshalb laesst er sich mit einem
 * skriptgesteuerten Ersatzmodell vollstaendig deterministisch testen, und ein
 * Anbieterwechsel ist eine zusaetzliche Implementierung statt eines Umbaus.
 */

export interface LlmMessage {
  readonly role: MessageRole;
  readonly blocks: readonly ContentBlock[];
}

/** Beschreibung eines Werkzeugs, wie sie das Modell zu sehen bekommt. */
export interface LlmToolDescription {
  readonly name: string;
  readonly description: string;
  /** JSON-Schema der Eingabe, aus der Zod-Definition abgeleitet. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface LlmRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolDescription[];
  /** Obergrenze der Ausgabelaenge je Zug. */
  readonly maxOutputTokens?: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResponse {
  /** Ein Zug kann Text, Werkzeugaufrufe oder beides enthalten. */
  readonly blocks: readonly ContentBlock[];
  readonly usage: TokenUsage;
}

export interface LlmPort {
  /** Name der Implementierung — erscheint im Startprotokoll und in Evals. */
  readonly name: string;

  complete(request: LlmRequest): Promise<Result<LlmResponse>>;
}
