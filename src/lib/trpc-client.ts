import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/server/trpc/root';

/**
 * tRPC-Client fuer den Browser.
 *
 * Bewusst der Vanilla-Client ohne React Query: Diese Oberflaeche haelt wenig
 * Zustand, und der wenige haengt am Ereignisstrom, nicht an Abfragen. Eine
 * Cache-Bibliothek wuerde hier vor allem Konfiguration hinzufuegen.
 *
 * `superjson` muss auf beiden Seiten stehen — sonst kommen die `Date`-Objekte
 * der Domaene als Zeichenketten an und der Typ luegt.
 */
export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      transformer: superjson,
    }),
  ],
});
