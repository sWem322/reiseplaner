'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stopReasonMessage, type StopReason } from '@/domain/agent';
import type { ToolCallOutcome } from '@/domain/conversation';
import type { TripDraft } from '@/domain/trip/trip';
import { readEventStream } from '@/lib/stream-events';

/**
 * Ein Agentenlauf als Zustand.
 *
 * Getrennt von der Darstellung, weil hier die eigentliche Logik liegt: Text
 * waechst zeichenweise, Werkzeuge laufen nebenlaeufig und melden sich in
 * beliebiger Reihenfolge zurueck, und am Ende steht ein Abbruchgrund, der
 * kein Fehler ist.
 */

export interface RunningTool {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly outcome: ToolCallOutcome | null;
  readonly durationMs: number | null;
}

export interface AgentRunState {
  readonly text: string;
  readonly tools: readonly RunningTool[];
  readonly running: boolean;
  /** Hinweis zum Abbruchgrund, sobald der Lauf endet — leer bei `completed`. */
  readonly notice: string | null;
  readonly error: string | null;
}

const IDLE: AgentRunState = {
  text: '',
  tools: [],
  running: false,
  notice: null,
  error: null,
};

export interface AgentRunResult {
  readonly text: string;
  readonly tools: readonly RunningTool[];
  readonly stopReason: StopReason | null;
}

export interface UseAgentRun {
  readonly state: AgentRunState;
  readonly send: (message: string) => Promise<AgentRunResult>;
  readonly reset: () => void;
}

export interface UseAgentRunOptions {
  readonly conversationId: string;
  /** Wird bei jedem `draft_updated` gerufen — die Leiste haengt daran. */
  readonly onDraft?: (draft: TripDraft) => void;
}

export function useAgentRun({ conversationId, onDraft }: UseAgentRunOptions): UseAgentRun {
  const [state, setState] = useState<AgentRunState>(IDLE);

  /*
   * Der Callback darf sich aendern, ohne dass `send` neu erzeugt wird — sonst
   * haengt an jedem Rendern der Seite eine neue Funktionsidentitaet, und jeder
   * Effekt, der auf `send` hoert, liefe erneut.
   */
  const draftRef = useRef(onDraft);

  useEffect(() => {
    draftRef.current = onDraft;
  }, [onDraft]);

  const reset = useCallback(() => {
    setState(IDLE);
  }, []);

  const send = useCallback(
    async (message: string): Promise<AgentRunResult> => {
      setState({ ...IDLE, running: true });

      let text = '';
      let tools: RunningTool[] = [];
      let stopReason: StopReason | null = null;

      try {
        const response = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId, message }),
        });

        if (!response.ok || response.body === null) {
          const grund = await readErrorMessage(response);

          setState({ ...IDLE, error: grund });

          return { text: '', tools: [], stopReason: null };
        }

        for await (const event of readEventStream(response.body)) {
          switch (event.type) {
            case 'text_delta':
              text += event.text;
              break;

            case 'tool_started':
              tools = [
                ...tools,
                {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: event.input,
                  outcome: null,
                  durationMs: null,
                },
              ];
              break;

            case 'tool_finished':
              tools = tools.map((tool) =>
                tool.toolCallId === event.toolCallId
                  ? { ...tool, outcome: event.outcome, durationMs: event.durationMs }
                  : tool,
              );
              break;

            case 'draft_updated':
              draftRef.current?.(event.draft);
              break;

            case 'finished':
              stopReason = event.stopReason;
              break;

            case 'quota_exceeded':
            case 'stream_error':
              setState((vorher) => ({ ...vorher, error: event.message }));
              break;
          }

          // Der Zustand wird je Ereignis gesetzt, damit der Text waehrend des
          // Laufs sichtbar waechst.
          setState((vorher) => ({ ...vorher, text, tools }));
        }
      } catch (error) {
        setState({
          ...IDLE,
          error: error instanceof Error ? error.message : 'Die Verbindung wurde unterbrochen',
        });

        return { text, tools, stopReason: null };
      }

      /*
       * Der Loop haengt den Satz zum Abbruchgrund bereits an die Antwort an.
       * Ein zweites Mal darunter waere derselbe Satz doppelt auf dem
       * Bildschirm — deshalb nur, wenn er nicht ohnehin schon dasteht.
       */
      const satz = stopReason === null ? '' : stopReasonMessage(stopReason);
      const doppelt = satz !== '' && text.includes(satz);

      setState((vorher) => ({
        ...vorher,
        running: false,
        notice: satz === '' || doppelt ? null : satz,
      }));

      return { text, tools, stopReason };
    },
    [conversationId],
  );

  return { state, send, reset };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const koerper: unknown = await response.json();

    if (
      typeof koerper === 'object' &&
      koerper !== null &&
      'error' in koerper &&
      typeof koerper.error === 'string'
    ) {
      return koerper.error;
    }
  } catch {
    // Antwort ohne JSON — der Statuscode muss reichen.
  }

  return `Der Server hat mit Status ${String(response.status)} geantwortet`;
}
