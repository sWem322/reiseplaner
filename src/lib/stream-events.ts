import { z } from 'zod';
import { stopReasonSchema } from '@/domain/agent';
import { toolCallOutcomeSchema } from '@/domain/conversation';
import { tripDraftShapeSchema } from '@/domain/trip/trip';

/**
 * Was ueber den Ereignisstrom im Browser ankommt.
 *
 * Die Ereignisse stammen aus dem eigenen Server, kommen hier aber als
 * `unknown` an — geprueft wird trotzdem. Der Grund ist nicht Misstrauen,
 * sondern Versionsdrift: Ein neuer Server und eine alte, noch offene Seite
 * sind ein realer Zustand.
 *
 * Deshalb wird ein unbekannter Ereignistyp uebersprungen statt geworfen.
 */

const textDelta = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

const toolStarted = z.object({
  type: z.literal('tool_started'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

const toolFinished = z.object({
  type: z.literal('tool_finished'),
  toolCallId: z.string(),
  toolName: z.string(),
  outcome: toolCallOutcomeSchema,
  durationMs: z.number(),
});

const draftUpdated = z.object({
  type: z.literal('draft_updated'),
  draft: tripDraftShapeSchema,
});

const finished = z.object({
  type: z.literal('finished'),
  stopReason: stopReasonSchema,
  iterations: z.number(),
  toolCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

/*
 * Diese beiden erzeugt der Route-Handler, nicht der Loop: das eine, wenn das
 * Gaestekontingent aufgebraucht ist, das andere, wenn der Strom selbst
 * abbricht. Sie gehoeren deshalb hier ins Schema und nicht in `AgentEvent`.
 */
const quotaExceeded = z.object({
  type: z.literal('quota_exceeded'),
  message: z.string(),
});

const streamError = z.object({
  type: z.literal('stream_error'),
  message: z.string(),
});

export const streamEventSchema = z.discriminatedUnion('type', [
  textDelta,
  toolStarted,
  toolFinished,
  draftUpdated,
  finished,
  quotaExceeded,
  streamError,
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

/**
 * Zerlegt einen Antwortstrom in Ereignisse.
 *
 * SSE trennt Nachrichten durch eine Leerzeile. Ein Datenblock kann ueber
 * mehrere Netzwerkpakete verteilt ankommen, deshalb wird gepuffert, bis die
 * Trennung tatsaechlich im Puffer steht — ein zeilenweises Lesen ohne Puffer
 * zerschneidet lange Nutzlasten mitten im JSON.
 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  /*
   * Eigener Decoder statt `pipeThrough(new TextDecoderStream())`: Der
   * Stream-Typ des Rumpfes und der Eingang des Decoders passen unter strengen
   * Typen nicht ohne Zutun zusammen. `stream: true` ist hier das Wesentliche
   * — ohne das zerbricht ein Umlaut, dessen Bytes auf zwei Pakete fallen.
   */
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let grenze = buffer.indexOf('\n\n');

      while (grenze !== -1) {
        const block = buffer.slice(0, grenze);
        buffer = buffer.slice(grenze + 2);
        grenze = buffer.indexOf('\n\n');

        const ereignis = parseBlock(block);

        if (ereignis !== null) {
          yield ereignis;
        }
      }
    }
  } finally {
    // Ohne Freigabe bleibt die Verbindung offen, wenn die Seite waehrend
    // eines Laufs verlassen wird.
    reader.releaseLock();
  }
}

function parseBlock(block: string): StreamEvent | null {
  const zeile = block.split('\n').find((eintrag) => eintrag.startsWith('data: '));

  if (zeile === undefined) {
    return null;
  }

  try {
    const geparst: unknown = JSON.parse(zeile.slice('data: '.length));
    const geprueft = streamEventSchema.safeParse(geparst);

    return geprueft.success ? geprueft.data : null;
  } catch {
    return null;
  }
}
