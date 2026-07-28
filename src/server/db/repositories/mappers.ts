import type { InferSelectModel } from 'drizzle-orm';
import type { Conversation, Message, ToolCallLog } from '@/domain/conversation';
import type { Place, TripDraft } from '@/domain/trip/trip';
import type { conversation, message, toolCallLog, tripDraft } from '../schema';

/**
 * Uebersetzung zwischen Tabellenzeile und Domaenenobjekt.
 *
 * Die Domaene kennt einen `Place` mit vier Feldern, die Tabelle vier flache
 * Spalten. Diese Datei ist der einzige Ort, an dem beide Formen aufeinander
 * treffen — dadurch bleibt die Domaene von der Tabellenstruktur unberuehrt.
 */

type ConversationRow = InferSelectModel<typeof conversation>;
type MessageRow = InferSelectModel<typeof message>;
type TripDraftRow = InferSelectModel<typeof tripDraft>;
type ToolCallLogRow = InferSelectModel<typeof toolCallLog>;

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    summary: row.summary,
    summarizedUntilSeq: row.summarizedUntilSeq,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    seq: row.seq,
    conversationId: row.conversationId,
    role: row.role,
    blocks: row.blocks,
    createdAt: row.createdAt,
  };
}

export function toToolCallLog(row: ToolCallLogRow): ToolCallLog {
  return {
    id: row.id,
    conversationId: row.conversationId,
    toolName: row.toolName,
    input: row.input,
    outcome: row.outcome,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

/**
 * Ein Ort gilt nur als vorhanden, wenn alle vier Spalten gefuellt sind.
 * Eine halb gefuellte Zeile waere ein Datenfehler — sie als unvollstaendigen
 * Ort durchzureichen wuerde ihn nur weiter nach oben tragen.
 */
function toPlace(
  name: string | null,
  iataCode: string | null,
  latitude: number | null,
  longitude: number | null,
): Place | null {
  if (name === null || iataCode === null || latitude === null || longitude === null) {
    return null;
  }

  return { name, iataCode, latitude, longitude };
}

export function toTripDraft(row: TripDraftRow): TripDraft {
  return {
    origin: toPlace(row.originName, row.originIata, row.originLatitude, row.originLongitude),
    destination: toPlace(
      row.destinationName,
      row.destinationIata,
      row.destinationLatitude,
      row.destinationLongitude,
    ),
    departureDate: row.departureDate,
    returnDate: row.returnDate,
    adults: row.adults,
    childAges: row.childAges,
    budgetEuros: row.budgetEuros,
    preferences: row.preferences,
    status: row.status,
  };
}

/** Die Spaltenwerte eines Entwurfs, ohne Schluessel und Zeitstempel. */
export function toTripDraftColumns(draft: TripDraft) {
  return {
    status: draft.status,
    originName: draft.origin?.name ?? null,
    originIata: draft.origin?.iataCode ?? null,
    originLatitude: draft.origin?.latitude ?? null,
    originLongitude: draft.origin?.longitude ?? null,
    destinationName: draft.destination?.name ?? null,
    destinationIata: draft.destination?.iataCode ?? null,
    destinationLatitude: draft.destination?.latitude ?? null,
    destinationLongitude: draft.destination?.longitude ?? null,
    departureDate: draft.departureDate,
    returnDate: draft.returnDate,
    adults: draft.adults,
    childAges: draft.childAges,
    budgetEuros: draft.budgetEuros,
    preferences: draft.preferences,
  };
}
