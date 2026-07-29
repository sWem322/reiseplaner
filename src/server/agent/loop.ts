import type { AgentEvent, AgentLimits, StopReason } from '@/domain/agent';
import { stopReasonMessage } from '@/domain/agent';
import type { ContentBlock, ToolCallOutcome, ToolUseBlock } from '@/domain/conversation';
import type { LlmMessage, LlmPort } from '@/domain/ports/llm';
import type { ToolCallLogRepository, TripDraftRepository } from '@/domain/ports/repositories';
import { Guardrails } from './guardrails';
import { describeTools, validateCall, type ToolRegistry } from './tools/registry';

/**
 * Der Agenten-Loop.
 *
 * Warum ein Loop und keine feste Kette: Die Zahl der Schritte ist vorab
 * unbekannt. „Mallorca im September" braucht eine Ortsauflösung und eine
 * Flugsuche; „irgendwo warm im Herbst unter 800 €" braucht mehrere Auflösungen,
 * mehrere Suchen und einen Wettervergleich. Eine feste Kette müsste immer den
 * ungünstigsten Fall durchlaufen und wäre für den nächsten Anfragetyp trotzdem
 * falsch geschnitten.
 *
 * Ablauf je Iteration:
 * 1. Guardrails fragen, ob weitergemacht werden darf.
 * 2. Modell mit bisherigem Verlauf und Werkzeugbeschreibungen aufrufen.
 * 3. Enthält die Antwort keinen Werkzeugaufruf → fertig.
 * 4. Sonst: alle Aufrufe validieren, parallel ausführen, Ergebnisse als
 *    tool_result an den Verlauf hängen und zurück zu Schritt 1.
 */

export interface AgentRunInput {
  readonly conversationId: string;
  readonly systemPrompt: string;
  /** Bisheriger Verlauf einschliesslich der neuen Nutzernachricht. */
  readonly messages: readonly LlmMessage[];
  readonly llm: LlmPort;
  readonly tools: ToolRegistry;
  readonly limits: AgentLimits;
  readonly toolCallLogs?: ToolCallLogRepository;
  readonly tripDrafts?: TripDraftRepository;
  /**
   * Wird zu jedem Zug gerufen — Modellantwort wie Werkzeugergebnis — mit genau
   * der Nachricht, die auch in den Verlauf des Laufs wandert.
   *
   * Aus den Ereignissen laesst sich der Verlauf nicht zurueckbauen. Sie
   * beschreiben, was geschieht, und lassen zweierlei weg: begleitende Angaben
   * eines Anbieters (etwa die Signatur, die Gemini zurueckverlangt) und die
   * Werkzeugergebnisse selbst. Wer nur die Ereignisse speichert, legt ein
   * Gespraech ab, in dem Aufrufe ohne Antwort stehen — und genau das weist das
   * Modell beim naechsten Mal zurueck.
   *
   * Ueber den Ereignisstrom gehen diese Nachrichten bewusst nicht: Im Browser
   * waeren Signaturen und Rohergebnisse nutzloser Ballast.
   */
  readonly onTurn?: (message: LlmMessage) => void;
}

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

interface ExecutedCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly outcome: ToolCallOutcome;
  readonly durationMs: number;
  readonly content: unknown;
  readonly isError: boolean;
  readonly errorMessage: string | null;
  readonly input: unknown;
}

/**
 * Fuehrt einen einzelnen Werkzeugaufruf aus.
 *
 * Wirft nie. Jeder Ausgang — ungueltige Eingabe, Anbieterfehler, unerwartete
 * Ausnahme — wird zu einem Ergebnis, das an das Modell zurueckgeht. Genau das
 * ermoeglicht die Selbstkorrektur: Das Modell liest den Fehler und versucht es
 * im naechsten Zug anders.
 */
async function executeCall(
  registry: ToolRegistry,
  block: ToolUseBlock,
  conversationId: string,
): Promise<ExecutedCall> {
  const startedAt = Date.now();
  const validation = validateCall(registry, block.toolName, block.input);

  if (!validation.ok) {
    return {
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      outcome: 'validation_error',
      durationMs: Date.now() - startedAt,
      content: { error: validation.error.message },
      isError: true,
      errorMessage: validation.error.message,
      input: block.input,
    };
  }

  const { tool, input } = validation.value;

  try {
    const result = await tool.execute(input, { conversationId });

    if (!result.ok) {
      return {
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        outcome: result.error.kind === 'validation_error' ? 'validation_error' : 'upstream_error',
        durationMs: Date.now() - startedAt,
        content: { error: result.error.message },
        isError: true,
        errorMessage: result.error.message,
        input,
      };
    }

    return {
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
      content: result.value,
      isError: false,
      errorMessage: null,
      input,
    };
  } catch (error) {
    // Ein Werkzeug sollte nicht werfen. Tut es doch, darf das nicht den
    // gesamten Lauf beenden — das Modell bekommt den Fehler als Ergebnis.
    const message = error instanceof Error ? error.message : String(error);

    return {
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      outcome: 'upstream_error',
      durationMs: Date.now() - startedAt,
      content: { error: `Unerwarteter Fehler im Werkzeug: ${message}` },
      isError: true,
      errorMessage: message,
      input,
    };
  }
}

export async function* runAgent(input: AgentRunInput): AsyncGenerator<AgentEvent> {
  const guardrails = new Guardrails(input.limits);
  const toolDescriptions = describeTools(input.tools);
  const history: LlmMessage[] = [...input.messages];

  let stopReason: StopReason = 'completed';

  for (;;) {
    const iterationCheck = guardrails.beforeIteration();

    if (!iterationCheck.allowed) {
      stopReason = iterationCheck.stopReason ?? 'max_iterations';
      break;
    }

    const response = await input.llm.complete({
      systemPrompt: input.systemPrompt,
      messages: history,
      tools: toolDescriptions,
      maxOutputTokens: Math.min(4_096, guardrails.remainingTokens),
    });

    if (!response.ok) {
      /*
       * Der Fehler wird protokolliert, bevor er zum Abbruchgrund wird. Sonst
       * bleibt von einem gescheiterten Modellaufruf nur der Satz „Ich kann
       * gerade nicht auf den Sprachdienst zugreifen" — und der sagt weder,
       * ob der Schluessel fehlt, das Kontingent erschoepft ist oder das Modell
       * einen anderen Namen bekommen hat.
       */
      console.error('LLM-Aufruf fehlgeschlagen:', {
        kind: response.error.kind,
        message: response.error.message,
        details: response.error.details,
      });

      stopReason = 'llm_error';
      break;
    }

    guardrails.recordUsage(response.value.usage);
    input.onTurn?.({ role: 'assistant', blocks: response.value.blocks });

    for (const block of response.value.blocks) {
      if (block.type === 'text' && block.text.length > 0) {
        yield { type: 'text_delta', text: block.text };
      }
    }

    const toolUses = response.value.blocks.filter(isToolUse);

    if (toolUses.length === 0) {
      stopReason = 'completed';
      break;
    }

    history.push({ role: 'assistant', blocks: response.value.blocks });

    const callCheck = guardrails.beforeToolCalls(toolUses.length);

    if (!callCheck.allowed) {
      stopReason = callCheck.stopReason ?? 'max_tool_calls';
      break;
    }

    for (const call of toolUses) {
      yield {
        type: 'tool_started',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      };
    }

    /*
     * Parallel statt nacheinander: Verlangt das Modell Flug- und Hotelsuche im
     * selben Zug, sind das unabhaengige Abfragen. Sequenziell auszufuehren
     * hiesse, die Wartezeiten zu addieren, ohne dass es fachlich noetig waere.
     */
    const executed = await Promise.all(
      toolUses.map((call) => executeCall(input.tools, call, input.conversationId)),
    );

    const resultBlocks: ContentBlock[] = [];

    for (const call of executed) {
      yield {
        type: 'tool_finished',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        outcome: call.outcome,
        durationMs: call.durationMs,
        content: call.content,
      };

      if (input.toolCallLogs !== undefined) {
        await input.toolCallLogs.record({
          conversationId: input.conversationId,
          toolName: call.toolName,
          input: call.input,
          outcome: call.outcome,
          errorMessage: call.errorMessage,
          durationMs: call.durationMs,
        });
      }

      resultBlocks.push({
        type: 'tool_result',
        toolCallId: call.toolCallId,
        isError: call.isError,
        content: call.content,
      });
    }

    history.push({ role: 'user', blocks: resultBlocks });
    input.onTurn?.({ role: 'user', blocks: resultBlocks });

    // Hat ein Werkzeug den Entwurf veraendert, sieht die Oberflaeche das sofort.
    const draftTouched = executed.some(
      (call) => call.toolName === 'update_trip_draft' && call.outcome === 'ok',
    );

    if (draftTouched && input.tripDrafts !== undefined) {
      const draft = await input.tripDrafts.findByConversation(input.conversationId);

      if (draft !== null) {
        yield { type: 'draft_updated', draft };
      }
    }
  }

  // Ein Abbruch ist ein Ergebnis: Die reisende Person bekommt einen Satz dazu,
  // keinen stillen Stillstand.
  const closingText = stopReasonMessage(stopReason);

  if (closingText.length > 0) {
    yield { type: 'text_delta', text: closingText };
    // Auch dieser Satz gehoert in den Verlauf — sonst steht nach einem Neuladen
    // ein Gespraech da, das ohne Erklaerung endet.
    input.onTurn?.({ role: 'assistant', blocks: [{ type: 'text', text: closingText }] });
  }

  const state = guardrails.state;

  yield {
    type: 'finished',
    stopReason,
    iterations: state.iterations,
    toolCalls: state.toolCalls,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
  };
}

/** Sammelt den gesamten Ereignisstrom — fuer Tests und nicht-streamende Aufrufer. */
export async function collectEvents(generator: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  for await (const event of generator) {
    events.push(event);
  }

  return events;
}
