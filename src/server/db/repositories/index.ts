import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type {
  ConversationRepository,
  ConversationSummary,
  MessageRepository,
  Repositories,
  ToolCallLogRepository,
  TripDraftRepository,
} from '@/domain/ports/repositories';
import type { Conversation, Message, ToolCallLog } from '@/domain/conversation';
import { emptyTripDraft, tripDraftSchema, type TripDraft } from '@/domain/trip/trip';
import { fail, ok, type Result } from '@/domain/result';
import type { Database } from '../client';
import { conversation, message, toolCallLog, tripDraft } from '../schema';
import {
  toConversation,
  toMessage,
  toToolCallLog,
  toTripDraft,
  toTripDraftColumns,
} from './mappers';

/**
 * Drizzle-Implementierungen der Persistenz-Ports.
 *
 * Jede Funktion nimmt die Datenbank als Parameter statt sie zu importieren —
 * so laesst sich dieselbe Implementierung im Test gegen eine Wegwerf-Instanz
 * und im Betrieb gegen den Verbindungspool betreiben.
 */

function createConversationRepository(db: Database): ConversationRepository {
  return {
    async create(userId?: string): Promise<Conversation> {
      const [row] = await db
        .insert(conversation)
        .values(userId === undefined ? {} : { userId })
        .returning();

      if (row === undefined) {
        throw new Error('Dialog konnte nicht angelegt werden');
      }

      return toConversation(row);
    },

    async findById(id: string): Promise<Conversation | null> {
      const [row] = await db.select().from(conversation).where(eq(conversation.id, id)).limit(1);

      return row === undefined ? null : toConversation(row);
    },

    async listByUser(userId: string): Promise<ConversationSummary[]> {
      const rows = await db
        .select({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        })
        .from(conversation)
        .where(eq(conversation.userId, userId))
        .orderBy(desc(conversation.updatedAt));

      return rows;
    },

    async belongsTo(conversationId: string, userId: string): Promise<boolean> {
      const [row] = await db
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
        .limit(1);

      return row !== undefined;
    },

    async setTitle(id: string, title: string): Promise<void> {
      await db
        .update(conversation)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversation.id, id));
    },

    async remove(id: string): Promise<void> {
      await db.delete(conversation).where(eq(conversation.id, id));
    },

    async addTokenUsage(id, usage): Promise<void> {
      // Additiv in SQL statt Lesen-Rechnen-Schreiben: Zwei gleichzeitige
      // Laeufe wuerden sich sonst gegenseitig ueberschreiben.
      await db
        .update(conversation)
        .set({
          inputTokens: sql`${conversation.inputTokens} + ${usage.inputTokens}`,
          outputTokens: sql`${conversation.outputTokens} + ${usage.outputTokens}`,
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, id));
    },

    async saveSummary(id, summary, summarizedUntilSeq): Promise<void> {
      await db
        .update(conversation)
        .set({ summary, summarizedUntilSeq, updatedAt: new Date() })
        .where(eq(conversation.id, id));
    },
  };
}

function createMessageRepository(db: Database): MessageRepository {
  return {
    async append(newMessage): Promise<Message> {
      const [row] = await db
        .insert(message)
        .values({
          conversationId: newMessage.conversationId,
          role: newMessage.role,
          blocks: newMessage.blocks,
        })
        .returning();

      if (row === undefined) {
        throw new Error('Nachricht konnte nicht gespeichert werden');
      }

      return toMessage(row);
    },

    async listByConversation(conversationId, options): Promise<Message[]> {
      const afterSeq = options?.afterSeq;
      const condition =
        afterSeq === undefined
          ? eq(message.conversationId, conversationId)
          : and(eq(message.conversationId, conversationId), gt(message.seq, afterSeq));

      const rows = await db.select().from(message).where(condition).orderBy(asc(message.seq));

      return rows.map(toMessage);
    },
  };
}

function createTripDraftRepository(db: Database): TripDraftRepository {
  return {
    async createForConversation(conversationId): Promise<TripDraft> {
      const [row] = await db.insert(tripDraft).values({ conversationId }).returning();

      if (row === undefined) {
        throw new Error('Reise-Entwurf konnte nicht angelegt werden');
      }

      return toTripDraft(row);
    },

    async findByConversation(conversationId): Promise<TripDraft | null> {
      const [row] = await db
        .select()
        .from(tripDraft)
        .where(eq(tripDraft.conversationId, conversationId))
        .limit(1);

      return row === undefined ? null : toTripDraft(row);
    },

    async save(conversationId, draft): Promise<Result<TripDraft>> {
      // Validierung vor dem Schreiben: Der Entwurf kann von einem Werkzeug
      // stammen, das das Modell mit unsinnigen Werten aufgerufen hat.
      const parsed = tripDraftSchema.safeParse(draft);

      if (!parsed.success) {
        return fail('validation_error', 'Der Reise-Entwurf ist ungueltig', {
          issues: parsed.error.issues,
        });
      }

      const [row] = await db
        .update(tripDraft)
        .set({ ...toTripDraftColumns(parsed.data), updatedAt: new Date() })
        .where(eq(tripDraft.conversationId, conversationId))
        .returning();

      if (row === undefined) {
        return fail('not_found', 'Zu diesem Dialog existiert kein Reise-Entwurf', {
          conversationId,
        });
      }

      return ok(toTripDraft(row));
    },
  };
}

function createToolCallLogRepository(db: Database): ToolCallLogRepository {
  return {
    async record(entry): Promise<ToolCallLog> {
      const [row] = await db
        .insert(toolCallLog)
        .values({
          conversationId: entry.conversationId,
          toolName: entry.toolName,
          input: entry.input,
          outcome: entry.outcome,
          errorMessage: entry.errorMessage,
          durationMs: entry.durationMs,
        })
        .returning();

      if (row === undefined) {
        throw new Error('Werkzeugaufruf konnte nicht protokolliert werden');
      }

      return toToolCallLog(row);
    },

    async listByConversation(conversationId): Promise<ToolCallLog[]> {
      const rows = await db
        .select()
        .from(toolCallLog)
        .where(eq(toolCallLog.conversationId, conversationId))
        .orderBy(asc(toolCallLog.createdAt), asc(toolCallLog.id));

      return rows.map(toToolCallLog);
    },
  };
}

export function createRepositories(db: Database): Repositories {
  return {
    conversations: createConversationRepository(db),
    messages: createMessageRepository(db),
    tripDrafts: createTripDraftRepository(db),
    toolCallLogs: createToolCallLogRepository(db),
  };
}

export { emptyTripDraft };
