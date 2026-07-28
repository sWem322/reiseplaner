import { z } from 'zod';

/**
 * Dialogmodell.
 *
 * Nachrichten werden mit ihren Inhaltsbloecken gespeichert, nicht als flacher
 * Text. Der Grund: Ein Modellzug besteht aus Text, Werkzeugaufrufen und deren
 * Ergebnissen. Wer das zu einem String zusammenfaltet, kann den Dialog spaeter
 * nicht mehr originalgetreu an das Modell zurueckgeben — und genau das braucht
 * der Agenten-Loop bei jeder Iteration.
 */

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;

export const messageRoleSchema = z.enum(MESSAGE_ROLES);

export type MessageRole = z.infer<typeof messageRoleSchema>;

// --- Inhaltsbloecke ----------------------------------------------------

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  /** Verknuepft den Aufruf mit seinem Ergebnis. */
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
});

const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string().min(1),
  /** Auch Fehler sind Ergebnisse — sie gehen als Daten zurueck an das Modell. */
  isError: z.boolean(),
  content: z.unknown(),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>;

// --- Nachricht ---------------------------------------------------------

export const messageSchema = z.object({
  id: z.uuid(),
  /**
   * Position im Gesamtverlauf, streng monoton wachsend.
   *
   * Die Reihenfolge und die Verdichtungsgrenze haengen an dieser Zahl, nicht
   * am Zeitstempel: Zeitstempel verlieren auf dem Weg aus der Datenbank
   * Genauigkeit (Mikrosekunden gegen Millisekunden) und taugen deshalb nicht
   * als exakte Grenze.
   */
  seq: z.number().int().positive(),
  conversationId: z.uuid(),
  role: messageRoleSchema,
  blocks: z.array(contentBlockSchema).min(1, 'Eine Nachricht braucht mindestens einen Block'),
  createdAt: z.date(),
});

export type Message = z.infer<typeof messageSchema>;

export const newMessageSchema = messageSchema.omit({ id: true, seq: true, createdAt: true });

export type NewMessage = z.infer<typeof newMessageSchema>;

// --- Dialog ------------------------------------------------------------

export const conversationSchema = z.object({
  id: z.uuid(),
  /**
   * Verdichtete Zusammenfassung aelterer Nachrichten. Waechst der Kontext,
   * wird der Anfang des Dialogs zusammengefasst statt abgeschnitten — sonst
   * verliert der Agent die frueh genannten Reisewuensche.
   */
  summary: z.string().nullable(),
  /** Bis zu welcher Nachrichten-Folgenummer bereits verdichtet wurde. */
  summarizedUntilSeq: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Conversation = z.infer<typeof conversationSchema>;

export function totalTokens(conversation: Conversation): number {
  return conversation.inputTokens + conversation.outputTokens;
}

/** Ist das Token-Budget des Dialogs aufgebraucht? */
export function isBudgetExceeded(conversation: Conversation, budget: number): boolean {
  return totalTokens(conversation) >= budget;
}

// --- Werkzeug-Protokoll ------------------------------------------------

export const TOOL_CALL_OUTCOMES = ['ok', 'validation_error', 'upstream_error'] as const;

export const toolCallOutcomeSchema = z.enum(TOOL_CALL_OUTCOMES);

export type ToolCallOutcome = z.infer<typeof toolCallOutcomeSchema>;

/**
 * Protokolleintrag je Werkzeugaufruf.
 *
 * Daraus entsteht die Kennzahl, mit der sich im Betrieb beantworten laesst,
 * ob der Agent korrekt arbeitet: Anteil erfolgreicher Aufrufe je Werkzeug,
 * getrennt nach Validierungs- und Anbieterfehlern.
 */
export const toolCallLogSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  toolName: z.string().min(1),
  input: z.unknown(),
  outcome: toolCallOutcomeSchema,
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.date(),
});

export type ToolCallLog = z.infer<typeof toolCallLogSchema>;

export const newToolCallLogSchema = toolCallLogSchema.omit({ id: true, createdAt: true });

export type NewToolCallLog = z.infer<typeof newToolCallLogSchema>;

/** Anteil erfolgreicher Aufrufe. Ohne Aufrufe: 1, damit leere Dialoge nicht als Ausfall zaehlen. */
export function toolSuccessRate(logs: readonly ToolCallLog[]): number {
  if (logs.length === 0) {
    return 1;
  }

  const successful = logs.filter((log) => log.outcome === 'ok').length;
  return successful / logs.length;
}
