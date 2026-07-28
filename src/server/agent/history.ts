import type { Conversation, Message } from '@/domain/conversation';
import type { LlmMessage, LlmPort } from '@/domain/ports/llm';
import type { ConversationRepository, MessageRepository } from '@/domain/ports/repositories';
import type { TripDraft } from '@/domain/trip/trip';

/**
 * Verdichtung des Gesprächsverlaufs.
 *
 * Wächst ein Dialog, passt er irgendwann nicht mehr in den Kontext des
 * Modells. Zwei Auswege:
 *
 * - **Abschneiden** — die ältesten Nachrichten wegwerfen. Einfach, aber
 *   fachlich falsch: Reisewünsche werden fast immer zu Beginn genannt. Wer
 *   den Anfang wegwirft, verliert genau die Angaben, um die es geht.
 * - **Verdichten** — den Anfang zusammenfassen und die Zusammenfassung
 *   mitführen. Kostet einen Modellaufruf, erhält aber den Inhalt.
 *
 * Dieses Projekt verdichtet. Ohne Sprachmodell entsteht die Zusammenfassung
 * deterministisch aus dem Reise-Entwurf — er enthält ohnehin alles fachlich
 * Wesentliche.
 */

/** Ab wie vielen Nachrichten verdichtet wird. */
export const COMPACTION_THRESHOLD = 20;

/** Wie viele der jüngsten Nachrichten unverdichtet bleiben. */
export const KEEP_RECENT = 8;

export interface CompactionInput {
  readonly conversation: Conversation;
  readonly messages: readonly Message[];
  readonly draft: TripDraft | null;
  readonly llm: LlmPort;
  readonly conversations: ConversationRepository;
}

function toPlainText(message: Message): string {
  const text = message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');

  const werkzeuge = message.blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.toolName);

  const werkzeugteil = werkzeuge.length === 0 ? '' : ` [Werkzeuge: ${werkzeuge.join(', ')}]`;

  return `${message.role === 'user' ? 'Reisende Person' : 'Assistent'}: ${text}${werkzeugteil}`;
}

/**
 * Deterministische Zusammenfassung ohne Modellaufruf.
 *
 * Der Reise-Entwurf ist die verdichtete Form des Gesprächs — er wurde ja
 * gerade dafür gebaut. Diese Fassung greift, wenn kein Sprachmodell zur
 * Verfügung steht oder der Aufruf scheitert.
 */
export function summarizeFromDraft(draft: TripDraft | null): string {
  if (draft === null) {
    return 'Bisher wurden keine Reiseparameter genannt.';
  }

  const teile: string[] = [];

  if (draft.origin !== null) {
    teile.push(`Abflug ab ${draft.origin.name} (${draft.origin.iataCode})`);
  }
  if (draft.destination !== null) {
    teile.push(`Ziel ${draft.destination.name} (${draft.destination.iataCode})`);
  }
  if (draft.departureDate !== null) {
    teile.push(`Hinreise am ${draft.departureDate}`);
  }
  if (draft.returnDate !== null) {
    teile.push(`Rückreise am ${draft.returnDate}`);
  }
  if (draft.adults !== null) {
    const kinder = draft.childAges.length;
    teile.push(
      kinder === 0
        ? `${String(draft.adults)} Erwachsene`
        : `${String(draft.adults)} Erwachsene und ${String(kinder)} Kinder (${draft.childAges.join(', ')} Jahre)`,
    );
  }
  if (draft.budgetEuros !== null) {
    teile.push(`Budget ${String(draft.budgetEuros)} €`);
  }
  if (draft.preferences.length > 0) {
    teile.push(`Wünsche: ${draft.preferences.join(', ')}`);
  }

  return teile.length === 0
    ? 'Bisher wurden keine Reiseparameter genannt.'
    : `Bisheriger Stand der Planung: ${teile.join('; ')}.`;
}

/**
 * Verdichtet, falls nötig. Gibt zurück, ob etwas geschehen ist.
 *
 * Schlägt der Modellaufruf fehl, wird auf die deterministische Fassung
 * ausgewichen statt abzubrechen: Eine misslungene Zusammenfassung darf das
 * Gespräch nicht beenden.
 */
export async function compactIfNeeded(input: CompactionInput): Promise<boolean> {
  if (input.messages.length < COMPACTION_THRESHOLD) {
    return false;
  }

  const zuVerdichten = input.messages.slice(0, input.messages.length - KEEP_RECENT);
  const grenze = zuVerdichten.at(-1)?.seq;

  if (grenze === undefined || zuVerdichten.length === 0) {
    return false;
  }

  const verlauf = zuVerdichten.map(toPlainText).join('\n');
  const bisher = input.conversation.summary;

  const anfrage: LlmMessage[] = [
    {
      role: 'user',
      blocks: [
        {
          type: 'text',
          text: [
            bisher === null ? '' : `Bisherige Zusammenfassung:\n${bisher}\n`,
            'Fasse den folgenden Gesprächsverlauf in höchstens acht Sätzen zusammen.',
            'Behalte alle genannten Reiseparameter, Wünsche und Absagen bei.',
            'Schreibe Fließtext auf Deutsch, keine Aufzählung.',
            '',
            verlauf,
          ].join('\n'),
        },
      ],
    },
  ];

  const antwort = await input.llm.complete({
    systemPrompt: 'Du fasst Gespräche über Reiseplanung sachlich und knapp zusammen.',
    messages: anfrage,
    tools: [],
    maxOutputTokens: 512,
  });

  const zusammenfassung =
    antwort.ok && antwort.value.blocks.some((block) => block.type === 'text')
      ? antwort.value.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(' ')
          .trim()
      : summarizeFromDraft(input.draft);

  await input.conversations.saveSummary(input.conversation.id, zusammenfassung, grenze);

  return true;
}

export interface BuildHistoryInput {
  readonly conversation: Conversation;
  readonly messages: MessageRepository;
}

/**
 * Baut den Verlauf für die nächste Modellanfrage.
 *
 * Liegt eine Zusammenfassung vor, ersetzt sie alles bis zur Verdichtungsgrenze
 * und wird als erste Nachricht mitgegeben.
 */
export async function buildHistory(input: BuildHistoryInput): Promise<LlmMessage[]> {
  const { conversation, messages } = input;
  const grenze = conversation.summarizedUntilSeq;

  const jüngere = await messages.listByConversation(
    conversation.id,
    grenze === null ? undefined : { afterSeq: grenze },
  );

  const verlauf: LlmMessage[] = jüngere.map((nachricht) => ({
    role: nachricht.role,
    blocks: nachricht.blocks,
  }));

  if (conversation.summary === null) {
    return verlauf;
  }

  return [
    {
      role: 'user',
      blocks: [
        {
          type: 'text',
          text: `Zusammenfassung des bisherigen Gesprächs:\n${conversation.summary}`,
        },
      ],
    },
    ...verlauf,
  ];
}
