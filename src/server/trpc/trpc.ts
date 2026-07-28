import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { AppContext } from './context';

/**
 * tRPC-Grundgerüst.
 *
 * Zwei Entscheidungen:
 *
 * 1. **superjson als Transformer** — die Domäne arbeitet mit `Date`-Objekten
 *    (Zeitstempel von Nachrichten). Ohne Transformer kämen sie als
 *    Zeichenketten im Browser an, und der Typ auf beiden Seiten würde lügen.
 *
 * 2. **Zod-Fehler werden aufbereitet** — statt einer verschachtelten
 *    Fehlerstruktur bekommt die Oberfläche einen lesbaren Satz je Feld.
 */

const t = initTRPC.context<AppContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        fieldErrors:
          error.cause instanceof ZodError
            ? error.cause.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              }))
            : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Offen für alle — Anmeldung, Registrierung, Gastzugang. */
export const publicProcedure = t.procedure;

/**
 * Setzt eine Sitzung voraus.
 *
 * Nach dieser Middleware ist `ctx.user` nicht mehr nullable — der Compiler
 * erzwingt damit in jeder geschützten Prozedur, dass die Prüfung stattgefunden
 * hat. Eine vergessene Zugriffsprüfung wäre sonst ein stiller Fehler.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Für diese Aktion ist eine Sitzung nötig',
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});
