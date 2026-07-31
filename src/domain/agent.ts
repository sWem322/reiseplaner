import { z } from 'zod';
import type { ToolCallOutcome } from './conversation';
import type { TripDraft } from './trip/trip';

/**
 * Vokabular des Agenten-Loops: Grenzen, Abbruchgruende, Ereignisse.
 *
 * Diese Datei liegt in der Domaene, weil der Loop selbst zwar Infrastruktur
 * orchestriert, seine Begriffe aber fachlich sind — „das Budget ist
 * aufgebraucht" ist eine Aussage ueber die Reiseplanung, nicht ueber HTTP.
 */

// --- Grenzen -----------------------------------------------------------

export const agentLimitsSchema = z.object({
  /** Wie oft das Modell hoechstens gefragt wird. */
  maxIterations: z.number().int().min(1).max(20),
  /** Wie viele Werkzeugaufrufe der gesamte Lauf hoechstens ausfuehrt. */
  maxToolCalls: z.number().int().min(1).max(60),
  /** Token-Budget des gesamten Dialogs, Ein- und Ausgabe zusammen. */
  tokenBudget: z.number().int().min(1_000),
});

export type AgentLimits = z.infer<typeof agentLimitsSchema>;

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxIterations: 8,
  maxToolCalls: 20,
  tokenBudget: 120_000,
};

// --- Abbruchgruende ----------------------------------------------------

export const STOP_REASONS = [
  /** Das Modell hat geantwortet, ohne ein weiteres Werkzeug zu verlangen. */
  'completed',
  'max_iterations',
  'max_tool_calls',
  'budget_exceeded',
  /** Das Modell selbst war nicht erreichbar — der einzige echte Fehlerfall. */
  'llm_error',
] as const;

export const stopReasonSchema = z.enum(STOP_REASONS);

export type StopReason = z.infer<typeof stopReasonSchema>;

/**
 * Ein Abbruch ist ein Ergebnis, kein Fehler. Zu jedem Grund gehoert deshalb
 * ein Satz, den die reisende Person lesen kann — nicht nur ein Code fuers Log.
 */
export function stopReasonMessage(reason: StopReason): string {
  switch (reason) {
    case 'completed':
      return '';
    case 'max_iterations':
      return 'Ich habe die Suche nach mehreren Schritten angehalten. Hier ist der Stand bisher — sag mir gern, woran ich weitersuchen soll.';
    case 'max_tool_calls':
      return 'Ich habe für diese Anfrage sehr viele Suchen ausgeführt und stoppe hier. Magst du die Anfrage etwas eingrenzen?';
    case 'budget_exceeded':
      return 'Dieses Gespräch hat den vorgesehenen Umfang erreicht. Starte gern ein neues, dann suche ich weiter.';
    case 'llm_error':
      return 'Ich kann gerade nicht auf den Sprachdienst zugreifen. Bitte versuche es in einem Moment noch einmal.';
  }
}

// --- Ereignisse --------------------------------------------------------

export interface TextDeltaEvent {
  readonly type: 'text_delta';
  readonly text: string;
}

export interface ToolStartedEvent {
  readonly type: 'tool_started';
  readonly toolCallId: string;
  readonly toolName: string;
  /** Bereits validierte Eingabe — ungueltige Aufrufe erreichen dieses Ereignis nie. */
  readonly input: unknown;
}

export interface ToolFinishedEvent {
  readonly type: 'tool_finished';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly outcome: ToolCallOutcome;
  readonly durationMs: number;
  /**
   * Das Ergebnis selbst.
   *
   * Ohne dieses Feld erfaehrt die Oberflaeche zwar, dass eine Suche gelaufen
   * ist, aber nicht, was sie gefunden hat — die Angebotskarten erschienen
   * deshalb erst nach dem Neuladen der Seite. Ein Suchergebnis waehrend des
   * Laufs zu zeigen, ist der Sinn des Stroms.
   */
  readonly content: unknown;
}

/**
 * Ein Zug des Modells ist zu Ende.
 *
 * Die Oberflaeche zeigte bisher, wie lange jedes Werkzeug brauchte — und
 * verschwieg, wie lange das Modell dachte. Damit liess sich die haeufigste
 * Frage nicht beantworten: Woran haengt es eigentlich? Ein Lauf mit drei
 * Zuegen zu je vier Sekunden sieht auf dem Bildschirm genauso aus wie einer
 * mit einer langsamen Datenbank.
 */
export interface ModelTurnEvent {
  readonly type: 'model_turn';
  /** Der wievielte Zug dieses Laufs, bei 1 beginnend. */
  readonly iteration: number;
  readonly durationMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DraftUpdatedEvent {
  readonly type: 'draft_updated';
  readonly draft: TripDraft;
}

export interface FinishedEvent {
  readonly type: 'finished';
  readonly stopReason: StopReason;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type AgentEvent =
  | TextDeltaEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | ModelTurnEvent
  | DraftUpdatedEvent
  | FinishedEvent;

// --- Auswertung --------------------------------------------------------

export interface AgentRunSummary {
  readonly stopReason: StopReason;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly text: string;
}

/** Fasst einen Ereignisstrom zusammen — vor allem fuer Tests und Evals. */
export function summarize(events: readonly AgentEvent[]): AgentRunSummary {
  let text = '';
  let toolCalls = 0;
  let iterations = 0;
  let stopReason: StopReason = 'completed';

  for (const event of events) {
    switch (event.type) {
      case 'text_delta':
        text += event.text;
        break;
      case 'tool_started':
        toolCalls += 1;
        break;
      case 'finished':
        stopReason = event.stopReason;
        iterations = event.iterations;
        break;
      case 'tool_finished':
      case 'model_turn':
      case 'draft_updated':
        break;
    }
  }

  return { stopReason, iterations, toolCalls, text };
}
