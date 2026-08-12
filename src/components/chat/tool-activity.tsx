'use client';

import { formatMillis } from '@/lib/format';
import type { ModelTurn, RunningTool } from './use-agent-run';

/**
 * Was der Agent getan hat, als schmale Zeile.
 *
 * Der sichtbarste Unterschied zu einem gewoehnlichen Chat: Hier steht, welches
 * Werkzeug lief, wie lange es brauchte und wie lange das Modell dachte. Ein
 * fehlgeschlagener Aufruf wird nicht versteckt.
 *
 * Die erste Fassung setzte jeden Eintrag als Plakette mit Rahmen, Hintergrund
 * und einem Wort fuer den Ausgang („ERLEDIGT"). Zusammen ergab das mehr
 * Aufmerksamkeit als die Antwort darunter — und „erledigt" sagte nichts, was
 * die Zahl daneben nicht schon sagte. Ein Werkzeug, das eine Dauer meldet, ist
 * fertig.
 *
 * Jetzt: eine Zeile, grau, klein, ohne Rahmen. Wer hinsieht, liest sie; wer
 * nicht hinsieht, wird nicht gestoert. Farbe bekommt nur noch der Fehlerfall,
 * denn der ist die einzige Abweichung, die eine Frage aufwirft.
 */

const TOOL_LABELS: Record<string, string> = {
  resolve_destination: 'Ziel bestimmen',
  search_flights: 'Flüge suchen',
  search_hotels: 'Unterkünfte suchen',
  get_weather_outlook: 'Wetter abrufen',
  get_trip_draft: 'Entwurf lesen',
  update_trip_draft: 'Entwurf aktualisieren',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export interface ToolActivityProps {
  readonly tools: readonly RunningTool[];
  /** Abgeschlossene Züge des Modells — die Denkzeit gehört daneben. */
  readonly modelTurns?: readonly ModelTurn[];
}

export function ToolActivity({ tools, modelTurns = [] }: ToolActivityProps) {
  if (tools.length === 0 && modelTurns.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Werkzeuge dieses Laufs"
      /*
       * Umbruch statt einer festen Zeile.
       *
       * Die erste Fassung hielt alles nebeneinander und liess den Rest
       * seitlich wegschieben. Bei einem langen Lauf — fünf Züge, dazu die
       * Werkzeuge — entstand daraus eine waagerechte Bildlaufleiste mitten im
       * Gespräch, und das ist schlimmer als zwei Zeilen: Ein Chat scrollt
       * senkrecht, alles andere ist eine Falle.
       *
       * Der enge Zeilenabstand (`gap-y-1`) hält den Umbruch trotzdem ruhig.
       */
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-slate-400"
    >
      {/* Die Denkzeit zuerst: Das Modell entscheidet, dann laufen die Werkzeuge. */}
      {modelTurns.map((turn) => (
        <li
          key={`turn-${String(turn.iteration)}`}
          data-testid="model-turn"
          className="flex max-w-full shrink-0 items-center gap-1"
        >
          <span>Modell</span>
          <span className="tabular-nums">{formatMillis(turn.durationMs)}</span>
        </li>
      ))}

      {tools.map((tool) => (
        <li
          key={tool.toolCallId}
          data-testid="tool-activity"
          data-tool={tool.toolName}
          data-outcome={tool.outcome ?? 'running'}
          className={`flex max-w-full shrink-0 items-center gap-1 ${
            tool.outcome !== null && tool.outcome !== 'ok' ? 'text-amber-700' : ''
          }`}
        >
          {tool.outcome === null && (
            <span
              aria-hidden
              className="bg-brand-400 size-1.5 animate-pulse rounded-full"
              /* Ein Punkt statt eines Spinners: Es laufen mehrere Werkzeuge
                 gleichzeitig, und rotierende Ringe nebeneinander sind Unruhe
                 ohne Information. */
            />
          )}

          <span>{toolLabel(tool.toolName)}</span>

          {/*
            Nur die Meldung eines **fremden** Dienstes wird angezeigt.

            Ein `validation_error` stammt aus diesem Projekt selbst und ist an
            das Modell gerichtet: „Frage zuerst, wie viele Erwachsene
            mitreisen, halte die Antwort mit update_trip_draft fest." Das ist
            eine Anweisung, keine Auskunft — auf dem Bildschirm sah sie aus wie
            eine vergessene Debug-Ausgabe. Sichtbar bleibt, dass der Aufruf
            scheiterte; was daraus folgte, steht als nächste Frage im Chat.

            Ein `upstream_error` dagegen gehört hin: Dass Overpass mit 406
            abweist, kann die reisende Person sonst nirgends erfahren.
          */}
          {tool.outcome === 'upstream_error' && tool.errorMessage !== null && (
            <span data-testid="tool-error" title={tool.errorMessage} className="min-w-0 truncate">
              {tool.errorMessage}
            </span>
          )}

          {tool.durationMs !== null && (
            <span className="tabular-nums">{formatMillis(tool.durationMs)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
