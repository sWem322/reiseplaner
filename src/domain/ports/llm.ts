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

/**
 * Rueckmeldungen waehrend eines Zuges.
 *
 * Der Port bleibt eine Anfrage mit einer Antwort — das ist die Form, die der
 * Loop braucht. Was fehlte, war ein Weg, den Text schon **waehrend** der
 * Erzeugung nach aussen zu geben. Ohne ihn stand die Oberflaeche minutenlang
 * auf „Der Assistent ueberlegt …" und zeigte die fertige Antwort dann in einem
 * Stueck: Streaming, das keines war.
 *
 * Optional, weil nicht jedes Modell es kann. Der regelbasierte Extraktor
 * rechnet in Millisekunden, das skriptgesteuerte Ersatzmodell antwortet
 * sofort — beide rufen hier nichts, und das ist richtig so.
 */
export interface LlmHooks {
  /** Ein Stueck Text, sobald es vorliegt. Nie der vollstaendige Zug. */
  readonly onTextDelta?: (text: string) => void;
}

export interface LlmPort {
  /** Name der Implementierung — erscheint im Startprotokoll und in Evals. */
  readonly name: string;

  complete(request: LlmRequest, hooks?: LlmHooks): Promise<Result<LlmResponse>>;
}
