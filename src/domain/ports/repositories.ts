import type {
  Conversation,
  Message,
  NewMessage,
  NewToolCallLog,
  ToolCallLog,
} from '../conversation';
import type { TripDraft } from '../trip/trip';
import type { Result } from '../result';

/**
 * Ports der Persistenz.
 *
 * Diese Datei beschreibt, *was* gespeichert wird — nicht *wie*. Kein Drizzle,
 * kein SQL, keine Verbindung. Die Implementierung liegt in src/server/db/.
 *
 * Zwei Konsequenzen:
 * 1. Der Agenten-Loop laesst sich mit In-Memory-Implementierungen testen.
 * 2. Ein Wechsel der Persistenzschicht ist eine zusaetzliche Implementierung
 *    dieser Schnittstellen, kein Umbau der Fachlogik.
 */

export interface ConversationRepository {
  create(): Promise<Conversation>;

  findById(id: string): Promise<Conversation | null>;

  /** Zaehlt verbrauchte Tokens hoch. Additiv, damit parallele Laeufe nichts ueberschreiben. */
  addTokenUsage(id: string, usage: { inputTokens: number; outputTokens: number }): Promise<void>;

  /** Speichert die Zusammenfassung samt Folgenummer, bis zu der verdichtet wurde. */
  saveSummary(id: string, summary: string, summarizedUntilSeq: number): Promise<void>;
}

export interface MessageRepository {
  append(message: NewMessage): Promise<Message>;

  /**
   * Nachrichten eines Dialogs, aelteste zuerst.
   *
   * `afterSeq` grenzt exakt ab — im Gegensatz zu einem Zeitstempel, der beim
   * Weg aus der Datenbank an Genauigkeit verliert.
   */
  listByConversation(conversationId: string, options?: { afterSeq?: number }): Promise<Message[]>;
}

export interface TripDraftRepository {
  /** Legt einen leeren Entwurf an. Ein Dialog hat genau einen. */
  createForConversation(conversationId: string): Promise<TripDraft>;

  findByConversation(conversationId: string): Promise<TripDraft | null>;

  /**
   * Schreibt den Entwurf zurueck. Gibt ein Result zurueck, weil ein
   * ungueltiger Entwurf hier ein erwarteter Fall ist: Das Modell kann ihn
   * ueber ein Werkzeug mit unsinnigen Werten gefuellt haben.
   */
  save(conversationId: string, draft: TripDraft): Promise<Result<TripDraft>>;
}

export interface ToolCallLogRepository {
  record(entry: NewToolCallLog): Promise<ToolCallLog>;

  listByConversation(conversationId: string): Promise<ToolCallLog[]>;
}

/** Alle Repositories gebuendelt — so wird nur ein Objekt durchgereicht. */
export interface Repositories {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly tripDrafts: TripDraftRepository;
  readonly toolCallLogs: ToolCallLogRepository;
}
