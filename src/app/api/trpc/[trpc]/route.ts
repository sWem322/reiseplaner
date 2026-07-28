import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/root';
import { createContext } from '@/server/trpc/context';
import { db } from '@/server/db/client';

/**
 * Einstieg für alle tRPC-Aufrufe.
 *
 * Der Kontext wird je Anfrage neu gebaut: Er enthält die Sitzung, und die kann
 * sich zwischen zwei Aufrufen ändern.
 */

export const runtime = 'nodejs';

function handler(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: () => createContext({ db, headers: request.headers }),
    onError({ error, path }) {
      // Fehler der Anwendung sind erwartbar und stehen bereits in der Antwort.
      // Nur echte Programmfehler gehören ins Serverprotokoll.
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`tRPC-Fehler in ${path ?? 'unbekannt'}:`, error.cause ?? error.message);
      }
    },
  });
}

export { handler as GET, handler as POST };
