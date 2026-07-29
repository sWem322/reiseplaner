import type { TripDraftRepository } from '@/domain/ports/repositories';
import { emptyTripDraft, tripDraftSchema, type TripDraft } from '@/domain/trip/trip';
import { fail, ok, type Result } from '@/domain/result';

/**
 * Entwürfe im Arbeitsspeicher — für den Eval-Lauf.
 *
 * Der Eval misst das Verhalten des Agenten, nicht das der Datenbank. Eine
 * echte PostgreSQL-Instanz je Fall wäre langsamer und würde am Ergebnis
 * nichts ändern.
 *
 * Wichtig: Geprüft wird trotzdem mit **demselben** Schema wie in Produktion.
 * Ein Entwurf, der dort abgelehnt würde, muss auch hier abgelehnt werden —
 * sonst misst der Eval eine Nachsicht, die es im Betrieb nicht gibt.
 */
export function createInMemoryTripDrafts(): TripDraftRepository {
  const entwuerfe = new Map<string, TripDraft>();

  return {
    createForConversation(conversationId: string): Promise<TripDraft> {
      const leer = emptyTripDraft();
      entwuerfe.set(conversationId, leer);

      return Promise.resolve(leer);
    },

    findByConversation(conversationId: string): Promise<TripDraft | null> {
      return Promise.resolve(entwuerfe.get(conversationId) ?? null);
    },

    save(conversationId: string, draft: TripDraft): Promise<Result<TripDraft>> {
      const geprueft = tripDraftSchema.safeParse(draft);

      if (!geprueft.success) {
        return Promise.resolve(
          fail('validation_error', geprueft.error.issues[0]?.message ?? 'Ungültiger Entwurf', {
            conversationId,
          }),
        );
      }

      entwuerfe.set(conversationId, geprueft.data);

      return Promise.resolve(ok(geprueft.data));
    },
  };
}
