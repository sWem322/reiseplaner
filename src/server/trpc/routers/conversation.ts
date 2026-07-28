import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { emptyTripDraft, missingSlots, tripDraftSchema } from '@/domain/trip/trip';
import { protectedProcedure, router } from '../trpc';
import type { AppContext } from '../context';

/**
 * Dialoge und Reise-Entwürfe.
 *
 * Jede Prozedur prüft zuerst den Besitz. Die Prüfung steht bewusst in einer
 * eigenen Funktion statt in einer Middleware: Eine Middleware bekäme die
 * Dialog-Kennung erst nach der Eingabevalidierung, und ein vergessener Aufruf
 * fiele nicht auf. So ist der Aufruf sichtbar und lässt sich testen.
 */

async function assertOwnership(
  ctx: AppContext & { user: NonNullable<AppContext['user']> },
  conversationId: string,
): Promise<void> {
  const gehoert = await ctx.repositories.conversations.belongsTo(conversationId, ctx.user.id);

  if (!gehoert) {
    /*
     * NOT_FOUND statt FORBIDDEN: Ein „verboten" verrät, dass es diesen Dialog
     * gibt. Für fremde Kennungen soll nicht unterscheidbar sein, ob sie
     * existieren.
     */
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Dieses Gespräch gibt es nicht' });
  }
}

const conversationIdInput = z.object({ conversationId: z.uuid() });

export const conversationRouter = router({
  create: protectedProcedure.mutation(async ({ ctx }) => {
    const dialog = await ctx.repositories.conversations.create(ctx.user.id);
    await ctx.repositories.tripDrafts.createForConversation(dialog.id);

    return dialog;
  }),

  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.repositories.conversations.listByUser(ctx.user.id),
  ),

  byId: protectedProcedure.input(conversationIdInput).query(async ({ ctx, input }) => {
    await assertOwnership(ctx, input.conversationId);

    const [dialog, messages, draft] = await Promise.all([
      ctx.repositories.conversations.findById(input.conversationId),
      ctx.repositories.messages.listByConversation(input.conversationId),
      ctx.repositories.tripDrafts.findByConversation(input.conversationId),
    ]);

    if (dialog === null) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Dieses Gespräch gibt es nicht' });
    }

    return {
      conversation: dialog,
      messages,
      draft: draft ?? emptyTripDraft(),
      missing: missingSlots(draft ?? emptyTripDraft()),
    };
  }),

  remove: protectedProcedure.input(conversationIdInput).mutation(async ({ ctx, input }) => {
    await assertOwnership(ctx, input.conversationId);
    await ctx.repositories.conversations.remove(input.conversationId);

    return { ok: true };
  }),
});

export const draftRouter = router({
  byConversation: protectedProcedure.input(conversationIdInput).query(async ({ ctx, input }) => {
    await assertOwnership(ctx, input.conversationId);

    const draft = await ctx.repositories.tripDrafts.findByConversation(input.conversationId);
    const aktuell = draft ?? emptyTripDraft();

    return { draft: aktuell, missing: missingSlots(aktuell) };
  }),

  update: protectedProcedure
    .input(conversationIdInput.extend({ draft: tripDraftSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx, input.conversationId);

      const result = await ctx.repositories.tripDrafts.save(input.conversationId, input.draft);

      if (!result.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
      }

      return { draft: result.value, missing: missingSlots(result.value) };
    }),
});
