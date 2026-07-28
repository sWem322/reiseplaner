import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { ContentBlock } from '@/domain/conversation';
import { MESSAGE_ROLES, TOOL_CALL_OUTCOMES } from '@/domain/conversation';
import { TRIP_DRAFT_STATUS } from '@/domain/trip/trip';

/**
 * Datenbankschema.
 *
 * Die Aufzaehlungen stammen aus der Domaene, nicht aus Zeichenketten an dieser
 * Stelle. Kommt ein Status hinzu, meldet der Compiler jede Stelle, die
 * angepasst werden muss — statt dass eine Migration und ein Zod-Schema
 * stillschweigend auseinanderlaufen.
 */

export const messageRoleEnum = pgEnum('message_role', MESSAGE_ROLES);
export const toolCallOutcomeEnum = pgEnum('tool_call_outcome', TOOL_CALL_OUTCOMES);
export const tripDraftStatusEnum = pgEnum('trip_draft_status', TRIP_DRAFT_STATUS);

export const conversation = pgTable('conversation', {
  id: uuid('id').primaryKey().defaultRandom(),
  summary: text('summary'),
  /** Bis zu welcher Nachrichten-Folgenummer der Verlauf verdichtet wurde. */
  summarizedUntilSeq: integer('summarized_until_seq'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Streng monoton wachsende Position im Gesamtverlauf.
     *
     * Warum nicht nach created_at sortieren und filtern? PostgreSQL speichert
     * Zeitstempel mikrosekundengenau, JavaScript kennt nur Millisekunden. Beim
     * Weg durch den Treiber wird abgeschnitten, und ein Filter „alles nach
     * diesem Zeitpunkt" liefert die Grenznachricht erneut mit. Fuer die
     * Verdichtung der Historie hiesse das: dieselben Nachrichten mehrfach
     * zusammenfassen. Eine Folgenummer ist exakt und ordnet auch Nachrichten,
     * die in derselben Mikrosekunde entstehen.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    /**
     * Inhaltsbloecke im Originalformat: Text, Werkzeugaufrufe, Ergebnisse.
     * Bewusst als JSON und nicht normalisiert — der Loop gibt den Verlauf
     * unveraendert an das Modell zurueck, eine Zerlegung in Tabellen brauchte
     * fuer jede Iteration einen verlustfreien Zusammenbau.
     */
    blocks: jsonb('blocks').$type<ContentBlock[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('message_conversation_seq_idx').on(table.conversationId, table.seq)],
);

export const tripDraft = pgTable(
  'trip_draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Ein Dialog hat genau einen Entwurf. */
    conversationId: uuid('conversation_id')
      .notNull()
      .unique()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    status: tripDraftStatusEnum('status').notNull().default('collecting'),

    originName: text('origin_name'),
    originIata: text('origin_iata'),
    originLatitude: doublePrecision('origin_latitude'),
    originLongitude: doublePrecision('origin_longitude'),

    destinationName: text('destination_name'),
    destinationIata: text('destination_iata'),
    destinationLatitude: doublePrecision('destination_latitude'),
    destinationLongitude: doublePrecision('destination_longitude'),

    /**
     * Datum als Text im Format JJJJ-MM-TT statt als date-Spalte: Die Domaene
     * arbeitet mit reinen Kalendertagen ohne Zeitzone. Ein date-Typ wuerde beim
     * Weg durch den Treiber zu einem Date-Objekt und damit wieder zu einer
     * Zeitzonenfrage, die es fachlich nicht gibt.
     */
    departureDate: text('departure_date'),
    returnDate: text('return_date'),

    adults: integer('adults'),
    childAges: jsonb('child_ages').$type<number[]>().notNull().default([]),
    budgetEuros: integer('budget_euros'),
    preferences: jsonb('preferences').$type<string[]>().notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('trip_draft_status_idx').on(table.status)],
);

export const toolCallLog = pgTable(
  'tool_call_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').notNull(),
    outcome: toolCallOutcomeEnum('outcome').notNull(),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tool_call_log_conversation_idx').on(table.conversationId, table.createdAt),
    // Fuer die Kennzahl "Erfolgsquote je Werkzeug" im Betrieb.
    index('tool_call_log_tool_outcome_idx').on(table.toolName, table.outcome),
  ],
);

// --- Beziehungen -------------------------------------------------------

export const conversationRelations = relations(conversation, ({ many, one }) => ({
  messages: many(message),
  toolCallLogs: many(toolCallLog),
  tripDraft: one(tripDraft),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
}));

export const tripDraftRelations = relations(tripDraft, ({ one }) => ({
  conversation: one(conversation, {
    fields: [tripDraft.conversationId],
    references: [conversation.id],
  }),
}));

export const toolCallLogRelations = relations(toolCallLog, ({ one }) => ({
  conversation: one(conversation, {
    fields: [toolCallLog.conversationId],
    references: [conversation.id],
  }),
}));
