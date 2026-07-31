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
       * `flex-nowrap` und `shrink-0` je Eintrag halten alles in einer Zeile;
       * was nicht hineinpasst, laesst sich seitlich schieben. Ein Umbruch
       * ueber drei Zeilen wog schwerer als die Nachricht, zu der er gehoert.
       */
      className="flex flex-nowrap items-center gap-x-3 overflow-x-auto text-[0.7rem] text-slate-400"
    >
      {/* Die Denkzeit zuerst: Das Modell entscheidet, dann laufen die Werkzeuge. */}
      {modelTurns.map((turn) => (
        <li
          key={`turn-${String(turn.iteration)}`}
          data-testid="model-turn"
          className="flex shrink-0 items-center gap-1"
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
          className={`flex shrink-0 items-center gap-1 ${
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
            Die Meldung des Anbieters im Klartext — gekürzt, damit sie die
            Zeile nicht sprengt, vollständig im Titel. Sie ersetzt das frühere
            „Anbieter nicht erreichbar": Welcher, und woran lag es, stand dort
            nie.
          */}
          {tool.errorMessage !== null && (
            <span data-testid="tool-error" title={tool.errorMessage} className="max-w-56 truncate">
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
