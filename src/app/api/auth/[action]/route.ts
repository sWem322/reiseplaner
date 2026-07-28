import { z } from 'zod';
import { createAuthService, credentialsSchema, SESSION_COOKIE } from '@/server/auth/session';
import { db } from '@/server/db/client';
import { readCookie } from '@/server/trpc/context';

/**
 * Anmeldung, Registrierung, Gastzugang und Abmeldung.
 *
 * Eigene Route-Handler statt tRPC-Prozeduren, weil hier ein Cookie gesetzt
 * werden muss — tRPC kennt die Antwort-Kopfzeilen nicht. Die Prüflogik selbst
 * liegt im Anmeldedienst und wird von beiden Wegen geteilt.
 */

export const runtime = 'nodejs';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const actionSchema = z.enum(['register', 'login', 'guest', 'logout']);

function sessionCookie(token: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    // Lax statt Strict: Bei Strict fehlt das Cookie nach einem Klick von
    // ausserhalb, und die Person landet abgemeldet auf der Startseite.
    'SameSite=Lax',
    `Max-Age=${String(maxAge)}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

function withCookie(body: unknown, cookie: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'set-cookie': cookie },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action: rawAction } = await context.params;
  const action = actionSchema.safeParse(rawAction);

  if (!action.success) {
    return Response.json({ error: 'Unbekannte Aktion' }, { status: 404 });
  }

  const auth = createAuthService(db);

  if (action.data === 'guest') {
    const { user, token } = await auth.createGuest();

    return withCookie({ user }, sessionCookie(token, SESSION_MAX_AGE_SECONDS));
  }

  if (action.data === 'logout') {
    const token = readCookie(request.headers, SESSION_COOKIE);

    if (token !== undefined) {
      await auth.logout(token);
    }

    return withCookie({ ok: true }, sessionCookie('', 0));
  }

  const payload: unknown = await request.json().catch(() => null);
  const credentials = credentialsSchema.safeParse(payload);

  if (!credentials.success) {
    return Response.json(
      { error: credentials.error.issues[0]?.message ?? 'Ungültige Angaben' },
      { status: 400 },
    );
  }

  const result =
    action.data === 'register'
      ? await auth.register(credentials.data)
      : await auth.login(credentials.data);

  if (!result.ok) {
    return Response.json(
      { error: result.error.message },
      { status: result.error.kind === 'unauthorized' ? 401 : 400 },
    );
  }

  return withCookie(
    { user: result.value.user },
    sessionCookie(result.value.token, SESSION_MAX_AGE_SECONDS),
  );
}
