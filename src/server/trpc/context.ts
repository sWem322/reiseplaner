import type { Repositories } from '@/domain/ports/repositories';
import {
  createAuthService,
  SESSION_COOKIE,
  type AuthService,
  type SessionUser,
} from '../auth/session';
import type { Database } from '../db/client';
import { createRepositories } from '../db/repositories';

/**
 * Kontext jeder tRPC-Anfrage.
 *
 * Enthält alles, was Prozeduren brauchen, und nichts darüber hinaus: die
 * angemeldete Person, die Repositories und den Anmeldedienst. Die Datenbank
 * selbst wird bewusst nicht durchgereicht — Prozeduren sollen über
 * Repositories gehen, nicht eigene Abfragen schreiben.
 */

export interface AppContext {
  readonly user: SessionUser | null;
  readonly repositories: Repositories;
  readonly auth: AuthService;
  /** Rohes Sitzungstoken — nur die Abmeldung braucht es. */
  readonly sessionToken: string | undefined;
}

export interface ContextInput {
  readonly db: Database;
  readonly headers: Headers;
}

/** Liest ein Cookie aus dem Kopfzeilenfeld, ohne fremde Bibliothek. */
export function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie');

  if (raw === null) {
    return undefined;
  }

  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');

    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return undefined;
}

export async function createContext({ db, headers }: ContextInput): Promise<AppContext> {
  const auth = createAuthService(db);
  const sessionToken = readCookie(headers, SESSION_COOKIE);
  const user = await auth.resolveSession(sessionToken);

  return {
    user,
    repositories: createRepositories(db),
    auth,
    sessionToken,
  };
}
