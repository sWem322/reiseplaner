'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentBlock, Message } from '@/domain/conversation';
import type { TripDraft } from '@/domain/trip/trip';
import { formatMillis } from '@/lib/format';
import type { ToolPayload } from '@/lib/tool-results';
import { MessageView } from './message-view';
import { OfferCards } from './offer-cards';
import { ToolActivity } from './tool-activity';
import { TripDraftPanel } from './trip-draft-panel';
import { useAgentRun, type ModelTurn, type RunningTool } from './use-agent-run';

/**
 * Der Chat.
 *
 * Nach einem Lauf wird der Verlauf bewusst nicht neu geladen: Die Antwort
 * steht bereits vollstaendig auf dem Bildschirm. Ein Nachladen wuerde sie
 * gegen dieselbe Antwort austauschen und dabei flackern. Neu geladen wird
 * erst beim naechsten Seitenaufruf.
 */

export interface ChatViewProps {
  readonly conversationId: string;
  readonly initialMessages: readonly Message[];
  readonly initialDraft: TripDraft;
  /** Laeuft die Anwendung ohne Sprachmodell? Dann wird das offen gesagt. */
  readonly ruleBasedOnly: boolean;
}

interface LocalMessage {
  readonly key: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** Angebote dieses Zuges — sie bleiben stehen, wenn der Lauf endet. */
  readonly payloads: readonly ToolPayload[];
  /**
   * Werkzeuge und Denkzeiten dieses Laufs.
   *
   * Sie verschwanden bisher in dem Augenblick, in dem die Antwort fertig war
   * — sichtbar waren sie also genau so lange, wie man nicht hinsehen konnte.
   * Damit war die Frage „warum hat das so lange gedauert?" nachträglich nicht
   * mehr zu beantworten, obwohl die Zahlen dafür da waren.
   */
  readonly tools: readonly RunningTool[];
  readonly modelTurns: readonly ModelTurn[];
}

/**
 * Die Wartezeit als eigene Komponente — und genau darin liegt die Lösung.
 *
 * Zwei Anläufe zuvor scheiterten am Linter, beide zu Recht: Der erste setzte
 * den Zähler im Rumpf eines Effekts zurück, der zweite las während des
 * Renderns aus einer Ref. Beide Male ging es um dieselbe Frage — wie setzt man
 * den Zähler bei einem neuen Lauf auf null?
 *
 * React beantwortet sie ohne Zutun: Diese Komponente wird nur gerendert,
 * solange ein Lauf läuft. Sie entsteht mit ihm und vergeht mit ihm, und ihr
 * Zustand beginnt jedes Mal bei null. Der Lebenszyklus **ist** das
 * Zurücksetzen; jede Mechanik dafür wäre die Wiederholung von etwas, das
 * das Framework schon kann.
 */
function Wartezeit() {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const start = Date.now();

    // Viermal je Sekunde: fein genug, dass die Zahl lebt, grob genug, dass
    // sie sich lesen laesst.
    const ticker = setInterval(() => {
      setMs(Date.now() - start);
    }, 250);

    return () => {
      clearInterval(ticker);
    };
  }, []);

  return (
    <p className="text-sm text-slate-400">
      Der Assistent überlegt … <span className="tabular-nums">{formatMillis(ms)}</span>
    </p>
  );
}

const BEISPIELE = [
  'Ich möchte im September eine Woche nach Mallorca, zu zweit.',
  'Wir fliegen ab Düsseldorf, Budget 1500 Euro.',
  'Wie warm ist es dort im Oktober?',
];

export function ChatView({
  conversationId,
  initialMessages,
  initialDraft,
  ruleBasedOnly,
}: ChatViewProps) {
  const [draft, setDraft] = useState<TripDraft>(initialDraft);
  const [eingabe, setEingabe] = useState('');
  const [lokal, setLokal] = useState<readonly LocalMessage[]>([]);
  const ende = useRef<HTMLDivElement>(null);

  const { state, send } = useAgentRun({ conversationId, onDraft: setDraft });

  const alleBloecke = useMemo<readonly ContentBlock[]>(
    () => initialMessages.flatMap((nachricht) => nachricht.blocks),
    [initialMessages],
  );

  useEffect(() => {
    ende.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lokal, state.text, state.tools]);

  const laeuft = state.running;

  async function absenden(event: React.SyntheticEvent): Promise<void> {
    event.preventDefault();

    const nachricht = eingabe.trim();

    if (nachricht === '' || laeuft) {
      return;
    }

    setEingabe('');
    setLokal((vorher) => [
      ...vorher,
      {
        key: `user-${String(vorher.length)}`,
        role: 'user',
        text: nachricht,
        payloads: [],
        tools: [],
        modelTurns: [],
      },
    ]);

    const ergebnis = await send(nachricht);

    const gefunden = ergebnis.tools
      .map((werkzeug) => werkzeug.payload)
      .filter((payload) => payload !== null);

    if (ergebnis.text !== '' || gefunden.length > 0) {
      setLokal((vorher) => [
        ...vorher,
        {
          key: `assistant-${String(vorher.length)}`,
          role: 'assistant',
          text: ergebnis.text,
          payloads: gefunden,
          tools: ergebnis.tools,
          modelTurns: ergebnis.modelTurns,
        },
      ]);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="flex min-h-[70vh] flex-col">
        <ul className="flex flex-1 flex-col gap-3">
          {initialMessages.map((nachricht) => (
            <MessageView key={nachricht.id} message={nachricht} allBlocks={alleBloecke} />
          ))}

          {lokal.map((nachricht) => (
            <li
              key={nachricht.key}
              data-testid="message"
              data-role={nachricht.role}
              className={nachricht.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div className="w-full max-w-[85%]">
                {/*
                  Die Arbeit bleibt bei der Antwort stehen, zu der sie gehört:
                  wie viele Züge das Modell gebraucht hat, wie lange jeder
                  dauerte, welche Werkzeuge liefen. Vorher war das nur während
                  des Laufs zu sehen — also genau dann nicht, wenn man es
                  nachlesen wollte.
                */}
                {nachricht.role === 'assistant' && (
                  <div className="mb-2">
                    <ToolActivity tools={nachricht.tools} modelTurns={nachricht.modelTurns} />
                  </div>
                )}

                {nachricht.text !== '' && (
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      nachricht.role === 'user'
                        ? 'bg-brand-600 rounded-br-sm text-white'
                        : 'rounded-bl-sm border border-slate-200 bg-white'
                    }`}
                  >
                    {nachricht.text}
                  </div>
                )}

                {nachricht.payloads.map((payload, index) => (
                  <OfferCards key={`${payload.kind}-${String(index)}`} payload={payload} />
                ))}
              </div>
            </li>
          ))}

          {laeuft && (
            <li className="flex flex-col gap-2">
              <ToolActivity tools={state.tools} modelTurns={state.modelTurns} />

              {/* Angebote erscheinen, sobald das Werkzeug fertig ist — nicht
                  erst mit dem Schlusstext des Modells. */}
              {state.tools.map((werkzeug) =>
                werkzeug.payload === null ? null : (
                  <OfferCards key={`live-${werkzeug.toolCallId}`} payload={werkzeug.payload} />
                ),
              )}

              {state.text !== '' && (
                <div
                  data-testid="streaming-text"
                  className="max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm whitespace-pre-wrap"
                >
                  {state.text}
                </div>
              )}

              {/*
                Der Zähler läuft, solange der Zug läuft — auch dann, wenn
                schon Werkzeuge zu sehen sind. Ohne ihn ist „überlegt …" nach
                fünf Sekunden von „überlegt …" nach dreissig nicht zu
                unterscheiden, und genau das war die Beschwerde.
              */}
              <Wartezeit />
            </li>
          )}
        </ul>

        {state.notice !== null && (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            {state.notice}
          </p>
        )}

        {state.error !== null && (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {state.error}
          </p>
        )}

        {initialMessages.length === 0 && lokal.length === 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {BEISPIELE.map((beispiel) => (
              <li key={beispiel}>
                <button
                  type="button"
                  onClick={() => {
                    setEingabe(beispiel);
                  }}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300"
                >
                  {beispiel}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          Direkt über dem Eingabefeld, nicht am Kopf der Seite.
          Der Hinweis erklärt, warum die nächste Antwort knapper ausfällt —
          gelesen wird er nur dort, wo die nächste Nachricht entsteht. Ganz
          oben stand er ausserhalb des Blickfelds, sobald das Gespräch ein
          paar Nachrichten lang war.
        */}
        {state.quotaNotice !== null && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {state.quotaNotice}
          </p>
        )}

        <form onSubmit={(event) => void absenden(event)} className="mt-4 flex gap-2">
          <label htmlFor="nachricht" className="sr-only">
            Nachricht
          </label>

          <input
            id="nachricht"
            name="nachricht"
            value={eingabe}
            onChange={(event) => {
              setEingabe(event.target.value);
            }}
            disabled={laeuft}
            autoComplete="off"
            maxLength={2000}
            placeholder="Wohin in Europa soll es gehen?"
            className="focus:border-brand-500 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:bg-slate-50"
          />

          <button
            type="submit"
            disabled={laeuft || eingabe.trim() === ''}
            className="bg-brand-600 hover:bg-brand-700 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Senden
          </button>
        </form>

        <div ref={ende} />
      </section>

      <div className="flex flex-col gap-3">
        <TripDraftPanel draft={draft} />

        {ruleBasedOnly && (
          <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
            Ohne <code>GEMINI_API_KEY</code> läuft ein regelbasierter Extraktor statt eines
            Sprachmodells. Er versteht Ziele, Daten und Reisendenzahl, formuliert aber nicht frei.
          </p>
        )}
      </div>
    </div>
  );
}
