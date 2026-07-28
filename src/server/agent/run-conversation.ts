import type { AgentEvent, AgentLimits } from '@/domain/agent';
import { DEFAULT_AGENT_LIMITS } from '@/domain/agent';
import type { ContentBlock } from '@/domain/conversation';
import type { LlmPort } from '@/domain/ports/llm';
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

  const antwortBlöcke: ContentBlock[] = [];
  let text = '';

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
  })) {
    if (event.type === 'text_delta') {
      text += event.text;
    }

    if (event.type === 'tool_started') {
      antwortBlöcke.push({
        type: 'tool_use',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
    }

    if (event.type === 'finished') {
      await repositories.conversations.addTokenUsage(conversationId, {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      });
    }

    yield event;
  }

  if (text.length > 0) {
    antwortBlöcke.unshift({ type: 'text', text });
  }

  if (antwortBlöcke.length > 0) {
    await repositories.messages.append({
      conversationId,
      role: 'assistant',
      blocks: antwortBlöcke,
    });
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
