import { z } from 'zod';
import { env } from '@/env';
import { createProviders } from '@/server/adapters/factory';
import { createAuthService, SESSION_COOKIE } from '@/server/auth/session';
import { db } from '@/server/db/client';
import { createRepositories } from '@/server/db/repositories';
import { readAloud } from '@/server/speech/read-aloud';
import { readCookie } from '@/server/trpc/context';

/**
 * Sprachausgabe einer Antwort.
 *
 * Die Route nimmt eine **Kennung**, keinen Text. Das ist die wesentliche
 * Entscheidung: Eine Route, die `{ text }` entgegennaehme, waere ein offener
 * Sprachdienst auf fremde Rechnung — einen Gastzugang bekommt jeder mit einem
 * Klick. So vertont sie ausschliesslich das, was der Assistent tatsaechlich
 * gesagt hat.
 *
 * Die Gespraechskennung steht bewusst **nicht** im Rumpf, obwohl specs/009 sie
 * zunaechst vorsah: Die Nachricht traegt sie bei sich. Zwei Angaben, die
 * dasselbe meinen, koennen auseinanderlaufen — und dann muesste diese Datei
 * entscheiden, welche gilt.
 *
 * Alles darueber hinaus steht in `read-aloud.ts`. Hier bleiben Sitzung, Rumpf
 * und Kopfzeilen.
 */

export const runtime = 'nodejs';

const requestSchema = z.object({
  messageId: z.uuid(),
});

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = createAuthService(db);
  const token = readCookie(request.headers, SESSION_COOKIE);
  const user = await auth.resolveSession(token);

  if (user === null) {
    return errorResponse(401, 'Für diese Aktion ist eine Sitzung nötig');
  }

  const payload: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return errorResponse(400, parsed.error.issues[0]?.message ?? 'Ungültige Anfrage');
  }

  const selection = createProviders({
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID,
    elevenLabsModel: env.ELEVENLABS_MODEL,
    useNetworkProviders: env.USE_NETWORK_PROVIDERS,
  });

  const ergebnis = await readAloud({
    messageId: parsed.data.messageId,
    userId: user.id,
    repositories: createRepositories(db),
    speech: selection.speech,
  });

  if (!ergebnis.ok) {
    return errorResponse(ergebnis.status, ergebnis.message);
  }

  return new Response(ergebnis.audio.data, {
    headers: {
      'content-type': ergebnis.audio.mimeType,
      'content-length': String(ergebnis.audio.data.byteLength),
      // Nichts wird zwischengespeichert — weder hier noch unterwegs. Was der
      // Browser bereits geladen hat, behaelt er von sich aus.
      'cache-control': 'no-store',
    },
  });
}
