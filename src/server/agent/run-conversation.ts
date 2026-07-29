import type { AgentEvent, AgentLimits } from '@/domain/agent';
import { DEFAULT_AGENT_LIMITS } from '@/domain/agent';
import type { LlmMessage, LlmPort } from '@/domain/ports/llm';
import type { Providers } from '@/domain/ports/providers';
import type { Repositories } from '@/domain/ports/repositories';
import { buildHistory, compactIfNeeded } from './history';
import { runAgent } from './loop';
import { buildSystemPrompt } from './prompts/system';
import { createToolRegistry } from './tools';

/**
 * Ein Gesprächszug von Anfang bis Ende.
 *
 * Diese Datei ist die Naht zwischen Agenten-Loop und Anwendung: Sie lädt den
 * Verlauf, verdichtet ihn bei Bedarf, führt den Loop aus, sammelt die Antwort
 * und schreibt alles zurück.
 *
 * Bewusst getrennt vom Route-Handler: So lässt sich der vollständige Zug im
 * Test ausführen, ohne HTTP zu sprechen — und die Oberfläche könnte ihn später
 * auch ohne SSE aufrufen.
 */

export interface RunConversationInput {
  readonly conversationId: string;
  readonly userMessage: string;
  readonly llm: LlmPort;
  readonly providers: Providers;
  readonly repositories: Repositories;
  readonly limits?: AgentLimits;
  /** Festes Datum für reproduzierbare Tests. */
  readonly today?: string;
}

export async function* runConversationTurn(
  input: RunConversationInput,
): AsyncGenerator<AgentEvent> {
  const { conversationId, repositories } = input;

  const dialog = await repositories.conversations.findById(conversationId);

  if (dialog === null) {
    yield {
      type: 'finished',
      stopReason: 'llm_error',
      iterations: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    return;
  }

  // Die Nutzernachricht wird sofort gespeichert — auch wenn der Lauf danach
  // scheitert, soll sie im Verlauf stehen.
  await repositories.messages.append({
    conversationId,
    role: 'user',
    blocks: [{ type: 'text', text: input.userMessage }],
  });

  const alleNachrichten = await repositories.messages.listByConversation(conversationId);
  const entwurf = await repositories.tripDrafts.findByConversation(conversationId);

  const verdichtet = await compactIfNeeded({
    conversation: dialog,
    messages: alleNachrichten,
    draft: entwurf,
    llm: input.llm,
    conversations: repositories.conversations,
  });

  // Nach der Verdichtung muss der Dialog neu gelesen werden — Zusammenfassung
  // und Grenze haben sich geändert.
  const aktuellerDialog = verdichtet
    ? ((await repositories.conversations.findById(conversationId)) ?? dialog)
    : dialog;

  const verlauf = await buildHistory({
    conversation: aktuellerDialog,
    messages: repositories.messages,
  });

  const tools = createToolRegistry({
    providers: input.providers,
    tripDrafts: repositories.tripDrafts,
  });

  /*
   * Der Verlauf wird gespeichert, wie der Lauf ihn erzeugt — Zug fuer Zug,
   * einschliesslich der Werkzeugergebnisse.
   *
   * Vorher entstand die gespeicherte Antwort aus den Ereignissen. Das ergab
   * ein Gespraech, in dem Werkzeugaufrufe ohne Ergebnis dastanden und die
   * Signaturen des Modells fehlten. Beim naechsten Aufruf bekam Gemini damit
   * einen Verlauf, den es so nie erzeugt hatte — und lehnte ihn ab.
   */
  const zuege: LlmMessage[] = [];

  for await (const event of runAgent({
    conversationId,
    systemPrompt: buildSystemPrompt({
      today: input.today ?? new Date().toISOString().slice(0, 10),
    }),
    messages: verlauf,
    llm: input.llm,
    tools,
    limits: input.limits ?? DEFAULT_AGENT_LIMITS,
    toolCallLogs: repositories.toolCallLogs,
    tripDrafts: repositories.tripDrafts,
    onTurn: (message) => {
      zuege.push(message);
    },
  })) {
    if (event.type === 'finished') {
      await repositories.conversations.addTokenUsage(conversationId, {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      });
    }

    yield event;
  }

  /*
   * Nacheinander, nicht parallel: Die Reihenfolge der Nachrichten ist der
   * Verlauf. Ein `Promise.all` wuerde sie dem Zufall der Datenbank ueberlassen.
   */
  for (const zug of zuege) {
    if (zug.blocks.length > 0) {
      await repositories.messages.append({
        conversationId,
        role: zug.role,
        blocks: [...zug.blocks],
      });
    }
  }

  // Titel aus dem Ziel ableiten, sobald es feststeht — die Liste vergangener
  // Reisen braucht etwas Lesbares.
  if (aktuellerDialog.summary === null) {
    const entwurfDanach = await repositories.tripDrafts.findByConversation(conversationId);

    if (entwurfDanach?.destination != null) {
      await repositories.conversations.setTitle(conversationId, entwurfDanach.destination.name);
    }
  }
}
