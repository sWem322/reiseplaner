import { z } from 'zod';
import { env } from '@/env';
import { DEFAULT_AGENT_LIMITS } from '@/domain/agent';
import { createAuthService, SESSION_COOKIE } from '@/server/auth/session';
import { createProviders } from '@/server/adapters/factory';
import { createRuleBasedLlm } from '@/server/agent/llm/rule-based';
import { runConversationTurn } from '@/server/agent/run-conversation';
import { db } from '@/server/db/client';
import { createRepositories } from '@/server/db/repositories';
import { readCookie } from '@/server/trpc/context';

/**
 * Ereignisstrom des Agenten.
 *
 * Bewusst ein eigener Route-Handler statt einer tRPC-Subscription: Dieser
 * Aufruf ist kein Datenabruf, sondern ein Vorgang mit Nebenwirkungen —
 * Nachrichten werden gespeichert, Werkzeuge ausgeführt, Kontingent verbraucht.
 * Ein eigener Handler lässt sich zudem unabhängig von der tRPC-Version auf
 * jeder Plattform betreiben.
 *
 * Die Ereignisse selbst bleiben typsicher: Sie stammen aus demselben
 * `AgentEvent`-Typ, den auch der Loop erzeugt.
 */

export const runtime = 'nodejs';
/**
 * Ein Zug ist kein Datenabruf, sondern Arbeit: Auf „welche Daten im Oktober
 * sind am günstigsten?" folgen drei Flugsuchen und ebenso viele Modellzüge.
 * Mit 60 Sekunden brach Vercel genau diesen Fall mit einem 504 ab — dem
 * interessantesten Fall der ganzen Anwendung. 300 Sekunden sind das Maximum
 * des kostenlosen Tarifs mit Fluid Compute.
 */
export const maxDuration = 300;

/**
 * Abstand der Herzschläge.
 *
 * Zwischen zwei Ereignissen kann eine Minute liegen — ein Modellzug samt
 * Werkzeugen. Eine Verbindung, über die nichts fliesst, halten Proxys für
 * verwaist und schliessen sie. Kommentarzeilen (`: …`) sind gültige
 * SSE-Nutzlast ohne Ereignis; der Leser im Browser überspringt sie.
 */
const HERZSCHLAG_MS = 15_000;

const requestSchema = z.object({
  conversationId: z.uuid(),
  message: z.string().min(1, 'Die Nachricht darf nicht leer sein').max(2_000),
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

  const repositories = createRepositories(db);
  const gehoert = await repositories.conversations.belongsTo(parsed.data.conversationId, user.id);

  if (!gehoert) {
    return errorResponse(404, 'Dieses Gespräch gibt es nicht');
  }

  /*
   * Kontingent als Teil der Guardrails: Ist es erschoepft, laeuft das Gespraech
   * regelbasiert weiter statt abzubrechen. Die Demo bleibt bedienbar, nur ohne
   * Sprachmodell — und der Schluessel des Autors bleibt geschuetzt.
   */
  const selection = createProviders({
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    duffelAccessToken: env.DUFFEL_ACCESS_TOKEN,
    useNetworkProviders: env.USE_NETWORK_PROVIDERS,
  });

  const quota = user.isGuest
    ? await auth.consumeQuota(user.id, env.GUEST_DAILY_MESSAGE_LIMIT)
    : { allowed: true, used: 0 };

  const llm = quota.allowed ? selection.llm : createRuleBasedLlm();

  const limits = {
    ...DEFAULT_AGENT_LIMITS,
    maxIterations: env.AGENT_MAX_ITERATIONS,
    maxToolCalls: env.AGENT_MAX_TOOL_CALLS,
    tokenBudget: env.AGENT_TOKEN_BUDGET,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /*
       * Nach `close()` wirft jedes weitere `enqueue`. Der Herzschlag laeuft
       * nebenher und weiss davon nichts — also merkt sich der Strom selbst,
       * ob er noch offen ist.
       */
      let offen = true;

      const schreibe = (zeile: string): void => {
        if (offen) {
          controller.enqueue(encoder.encode(zeile));
        }
      };

      const send = (data: unknown): void => {
        schreibe(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Das erste Byte sofort, noch vor dem ersten Modellaufruf: Damit steht
      // die Antwort, und kein Proxy wartet auf einen Kopf, der noch kommt.
      schreibe(': lauf gestartet\n\n');

      const herzschlag = setInterval(() => {
        schreibe(': warten\n\n');
      }, HERZSCHLAG_MS);

      if (!quota.allowed) {
        send({
          type: 'quota_exceeded',
          message:
            'Das Tageskontingent für Gäste ist aufgebraucht. Die Suche läuft weiter, aber ohne Sprachmodell.',
        });
      }

      try {
        for await (const event of runConversationTurn({
          conversationId: parsed.data.conversationId,
          userMessage: parsed.data.message,
          llm,
          providers: selection.providers,
          repositories,
          limits,
        })) {
          send(event);
        }
      } catch (error) {
        // Ein Fehler im Strom darf die Verbindung nicht stumm abreissen — die
        // Oberflaeche wartet sonst ewig auf ein Ereignis, das nie kommt.
        send({
          type: 'stream_error',
          message: error instanceof Error ? error.message : 'Unerwarteter Fehler',
        });
      } finally {
        clearInterval(herzschlag);
        offen = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Verhindert, dass ein Proxy den Strom puffert und damit das Streamen
      // wirkungslos macht.
      'x-accel-buffering': 'no',
    },
  });
}
