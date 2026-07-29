import { describe, expect, it } from 'vitest';
import { emptyTripDraft } from '@/domain/trip/trip';
import { readEventStream, type StreamEvent } from './stream-events';

/**
 * Der Strom ist die einzige Stelle, an der die Oberflaeche Daten von aussen
 * annimmt. Faellt hier etwas leise durch, wartet die Seite auf eine Antwort,
 * die nie erscheint — deshalb wird auch der unangenehme Fall geprueft, dass
 * ein Block mitten im JSON zerschnitten ankommt.
 */

/** Baut einen Strom aus vorgegebenen Bruchstuecken — so wie das Netz liefert. */
function streamOf(...chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of readEventStream(stream)) {
    events.push(event);
  }

  return events;
}

describe('Ereignisstrom lesen', () => {
  it('liest ein einzelnes Ereignis', async () => {
    const events = await collect(streamOf(sse({ type: 'text_delta', text: 'Hallo' })));

    expect(events).toEqual([{ type: 'text_delta', text: 'Hallo' }]);
  });

  it('liest mehrere Ereignisse aus einem einzigen Paket', async () => {
    const events = await collect(
      streamOf(sse({ type: 'text_delta', text: 'a' }) + sse({ type: 'text_delta', text: 'b' })),
    );

    expect(events).toHaveLength(2);
  });

  it('setzt ein Ereignis zusammen, das über zwei Pakete verteilt ankommt', async () => {
    const vollstaendig = sse({ type: 'text_delta', text: 'Mallorca' });
    const schnitt = 12;

    const events = await collect(
      streamOf(vollstaendig.slice(0, schnitt), vollstaendig.slice(schnitt)),
    );

    expect(events).toEqual([{ type: 'text_delta', text: 'Mallorca' }]);
  });

  it('übergeht ein unbekanntes Ereignis, statt abzubrechen', async () => {
    // Ein neuerer Server darf eine aeltere, offene Seite nicht lahmlegen.
    const events = await collect(
      streamOf(
        sse({ type: 'etwas_neues', payload: 42 }) + sse({ type: 'text_delta', text: 'weiter' }),
      ),
    );

    expect(events).toEqual([{ type: 'text_delta', text: 'weiter' }]);
  });

  it('übergeht beschädigtes JSON', async () => {
    const events = await collect(
      streamOf('data: {kaputt\n\n' + sse({ type: 'text_delta', text: 'weiter' })),
    );

    expect(events).toEqual([{ type: 'text_delta', text: 'weiter' }]);
  });

  it('übergeht ein Ereignis mit falschem Feldtyp', async () => {
    const events = await collect(streamOf(sse({ type: 'text_delta', text: 42 })));

    expect(events).toEqual([]);
  });

  it('liest das Suchergebnis mit, damit Karten sofort erscheinen', async () => {
    const events = await collect(
      streamOf(
        sse({
          type: 'tool_finished',
          toolCallId: 'call_1',
          toolName: 'search_flights',
          outcome: 'ok',
          durationMs: 812,
          content: { offers: [{ id: 'f1', priceEuros: 278 }] },
        }),
      ),
    );

    expect(events[0]).toMatchObject({ content: { offers: [{ id: 'f1', priceEuros: 278 }] } });
  });

  it('liest den Werkzeuglauf mit Ergebnis und Dauer', async () => {
    const events = await collect(
      streamOf(
        sse({
          type: 'tool_finished',
          toolCallId: 'call_1',
          toolName: 'search_flights',
          outcome: 'ok',
          durationMs: 812,
        }),
      ),
    );

    expect(events[0]).toMatchObject({ toolName: 'search_flights', outcome: 'ok' });
  });

  it('liest einen Entwurf mit Abflugdatum in der Vergangenheit', async () => {
    // Die Regel „nicht in der Vergangenheit" gilt fuer Eingaben. Ein Entwurf,
    // den es bereits gibt, muss lesbar bleiben.
    const draft = { ...emptyTripDraft(), departureDate: '2020-01-01' };

    const events = await collect(streamOf(sse({ type: 'draft_updated', draft })));

    expect(events).toHaveLength(1);
  });

  it('liest die Ereignisse des Handlers, die nicht aus dem Loop stammen', async () => {
    const events = await collect(
      streamOf(
        sse({ type: 'quota_exceeded', message: 'Kontingent aufgebraucht' }) +
          sse({ type: 'stream_error', message: 'Abbruch' }),
      ),
    );

    expect(events.map((event) => event.type)).toEqual(['quota_exceeded', 'stream_error']);
  });

  it('verwirft einen unvollständigen Block am Ende', async () => {
    // Reisst die Verbindung mitten im letzten Block ab, darf kein halbes
    // Ereignis in den Zustand geraten.
    const events = await collect(streamOf('data: {"type":"text_delta","text":"abg'));

    expect(events).toEqual([]);
  });

  it('übergeht Kommentarzeilen ohne Datenfeld', async () => {
    const events = await collect(
      streamOf(': heartbeat\n\n' + sse({ type: 'text_delta', text: 'da' })),
    );

    expect(events).toEqual([{ type: 'text_delta', text: 'da' }]);
  });
});
