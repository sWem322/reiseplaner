import { env } from '@/env';
import { protectedProcedure, router } from './trpc';
import { authRouter } from './routers/auth';
import { conversationRouter, draftRouter } from './routers/conversation';

/**
 * Wurzel aller Prozeduren.
 *
 * Aus diesem Typ leitet der Browser seine Typen ab — eine Änderung an einer
 * Prozedur bricht die Oberfläche beim Kompilieren, nicht erst zur Laufzeit.
 */

const usageRouter = router({
  remaining: protectedProcedure.query(async ({ ctx }) => {
    const limit = env.GUEST_DAILY_MESSAGE_LIMIT;
    const remaining = await ctx.auth.remainingQuota(ctx.user.id, limit);

    return {
      limit,
      remaining,
      /*
       * Angemeldete Konten haben kein Kontingent — es schuetzt den Schluessel
       * in der oeffentlichen Demo, nicht die Anwendung als solche.
       */
      unlimited: !ctx.user.isGuest,
    };
  }),
});

export const appRouter = router({
  auth: authRouter,
  conversation: conversationRouter,
  draft: draftRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
