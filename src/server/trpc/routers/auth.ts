import { TRPCError } from '@trpc/server';
import { credentialsSchema } from '@/server/auth/session';
import { protectedProcedure, publicProcedure, router } from '../trpc';

/**
 * Anmeldung, Registrierung, Gastzugang.
 *
 * Die Prozeduren geben das Sitzungstoken zurück, setzen aber selbst kein
 * Cookie — tRPC kennt die Antwort-Kopfzeilen nicht. Das übernimmt der
 * Route-Handler, der die Prozedur aufruft.
 */

export const authRouter = router({
  /** Wer bin ich? `null`, solange keine Sitzung besteht. */
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure.input(credentialsSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.auth.register(input);

    if (!result.ok) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
    }

    return result.value;
  }),

  login: publicProcedure.input(credentialsSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.auth.login(input);

    if (!result.ok) {
      // Bewusst immer dieselbe Meldung: Sonst liesse sich abfragen, welche
      // Adressen registriert sind.
      throw new TRPCError({ code: 'UNAUTHORIZED', message: result.error.message });
    }

    return result.value;
  }),

  /** Ein Klick, ein anonymes Konto — ohne diesen Weg bliebe die Demo verschlossen. */
  guest: publicProcedure.mutation(async ({ ctx }) => ctx.auth.createGuest()),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken !== undefined) {
      await ctx.auth.logout(ctx.sessionToken);
    }

    return { ok: true };
  }),
});
