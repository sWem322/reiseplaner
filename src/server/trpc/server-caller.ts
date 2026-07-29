import { cookies } from 'next/headers';
import { db } from '@/server/db/client';
import { SESSION_COOKIE, type SessionUser } from '@/server/auth/session';
import { appRouter } from './root';
import { createCallerFactory } from './trpc';
import { createContext, type AppContext } from './context';

/**
 * Zugriff auf dieselben Prozeduren aus einer Server-Komponente — ohne HTTP.
 *
 * Der Umweg ueber das eigene Netzwerk waere hier Verschwendung: Der Aufruf
 * findet im selben Prozess statt. Wichtig ist allein, dass es dieselben
 * Prozeduren sind, samt Besitzpruefung. Zwei Wege in dieselben Daten mit zwei
 * Rechtepruefungen waeren ein Angebot an genau den Fehler, den man spaeter
 * nicht mehr findet.
 */
const createCaller = createCallerFactory(appRouter);

async function contextFromCookies(): Promise<AppContext> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const headers = new Headers();

  if (token !== undefined) {
    headers.set('cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  }

  return createContext({ db, headers });
}

export async function serverApi(): Promise<ReturnType<typeof createCaller>> {
  return createCaller(await contextFromCookies());
}

/** Fuer Weichen in Server-Komponenten: Gibt es eine gueltige Sitzung? */
export async function currentUser(): Promise<SessionUser | null> {
  const { user } = await contextFromCookies();

  return user;
}
