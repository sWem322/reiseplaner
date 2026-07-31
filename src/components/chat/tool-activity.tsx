'use client';

import type { ToolCallOutcome } from '@/domain/conversation';
import type { ModelTurn, RunningTool } from './use-agent-run';

/**
 * Was der Agent gerade tut.
 *
 * Der sichtbarste Unterschied zu einem gewoehnlichen Chat: Hier steht, welches
 * Werkzeug laeuft, wie lange es gebraucht hat und ob es geklappt hat. Ein
 * fehlgeschlagener Aufruf wird nicht versteckt — der Agent bekommt ihn als
 * Ergebnis zurueck und versucht es anders, und genau das soll man sehen.
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

function outcomeLabel(outcome: ToolCallOutcome): string {
  switch (outcome) {
    case 'ok':
      return 'erledigt';
    case 'validation_error':
      return 'Eingabe abgelehnt';
    case 'upstream_error':
      return 'Anbieter nicht erreichbar';
  }
}

function outcomeClass(outcome: ToolCallOutcome | null): string {
  if (outcome === null) {
    return 'border-brand-100 bg-brand-50 text-brand-700';
  }

  return outcome === 'ok'
    ? 'border-slate-200 bg-white text-slate-600'
    : 'border-amber-200 bg-amber-50 text-amber-800';
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
    <ul className="flex flex-wrap gap-2" aria-label="Werkzeuge dieses Laufs">
      {/*
        Die Denkzeit zuerst, denn zeitlich kommt sie zuerst: Das Modell
        entscheidet, dann laufen die Werkzeuge. Ein Zug je Plakette macht
        ausserdem sichtbar, wie viele Runden eine Frage gekostet hat — die
        eigentliche Antwort auf „warum dauert das so lange?".
      */}
      {modelTurns.map((turn) => (
        <li
          key={`turn-${String(turn.iteration)}`}
          data-testid="model-turn"
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500"
        >
          <span className="font-medium">Modell</span>
          <span className="tabular-nums opacity-70">{formatMillis(turn.durationMs)}</span>
        </li>
      ))}

      {tools.map((tool) => (
        <li
          key={tool.toolCallId}
          data-testid="tool-activity"
          data-tool={tool.toolName}
          data-outcome={tool.outcome ?? 'running'}
          className={`flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${outcomeClass(tool.outcome)}`}
        >
          {tool.outcome === null && (
            <span
              aria-hidden
              className="bg-brand-500 size-1.5 animate-pulse rounded-full"
              /* Ein Punkt statt eines Spinners: Es laufen mehrere Werkzeuge
                 gleichzeitig, und rotierende Ringe nebeneinander sind Unruhe
                 ohne Information. */
            />
          )}

          <span className="font-medium">{toolLabel(tool.toolName)}</span>

          {tool.outcome !== null && (
            <span className="text-[0.7rem] tracking-wide uppercase opacity-70">
              {outcomeLabel(tool.outcome)}
            </span>
          )}

          {/*
            Die Meldung des Anbieters im Klartext.

            „Anbieter nicht erreichbar" beantwortet die naechste Frage nicht:
            welcher, und woran lag es? Die Antwort lag schon im Ereignis, sie
            wurde nur verschwiegen — und damit war jeder Ausfall eine Frage an
            das Serverprotokoll statt an den Bildschirm.
          */}
          {tool.errorMessage !== null && (
            <span data-testid="tool-error" className="opacity-90">
              {tool.errorMessage}
            </span>
          )}

          {tool.durationMs !== null && (
            <span className="tabular-nums opacity-60">{formatMillis(tool.durationMs)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function formatMillis(millis: number): string {
  return millis < 1_000 ? `${String(millis)} ms` : `${(millis / 1_000).toFixed(1)} s`;
}
