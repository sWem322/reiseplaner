import type { ContentBlock, Message } from '@/domain/conversation';
import { readToolPayload } from '@/lib/tool-results';
import { OfferCards } from './offer-cards';

/**
 * Eine gespeicherte Nachricht mit ihren Bloecken.
 *
 * Ein Modellzug besteht aus Text, Werkzeugaufrufen und deren Ergebnissen.
 * Angezeigt werden der Text und die Ergebnisse, die sich als Angebote lesen
 * lassen — die Aufrufe selbst stehen als Verlauf im Kopf der Nachricht.
 */

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Verknuepft ein Ergebnis mit dem Aufruf, zu dem es gehoert. */
function toolNameFor(blocks: readonly ContentBlock[], toolCallId: string): string | null {
  for (const block of blocks) {
    if (block.type === 'tool_use' && block.toolCallId === toolCallId) {
      return block.toolName;
    }
  }

  return null;
}

export interface MessageViewProps {
  readonly message: Message;
  /**
   * Alle Bloecke des Dialogs — ein Ergebnis steht in einer anderen Nachricht
   * als sein Aufruf, und ohne den Aufruf ist der Werkzeugname unbekannt.
   */
  readonly allBlocks: readonly ContentBlock[];
}

export function MessageView({ message, allBlocks }: MessageViewProps) {
  const text = textOf(message.blocks);

  const payloads = message.blocks
    .filter((block) => block.type === 'tool_result')
    .filter((block) => !block.isError)
    .map((block) => {
      const name = toolNameFor(allBlocks, block.toolCallId);

      return name === null ? null : readToolPayload(name, block.content);
    })
    .filter((payload) => payload !== null);

  if (text === '' && payloads.length === 0) {
    return null;
  }

  /*
   * Werkzeugergebnisse tragen die Rolle „user", weil das Modell sie als
   * Eingabe bekommt — geschrieben hat sie aber niemand. Sie gehoeren deshalb
   * auf die Seite des Assistenten, nicht in eine eigene Sprechblase rechts.
   */
  const eigen = message.role === 'user' && text !== '';

  return (
    <li
      data-testid="message"
      data-role={message.role}
      className={eigen ? 'flex justify-end' : 'flex justify-start'}
    >
      <div className={eigen ? 'max-w-[85%]' : 'w-full max-w-[85%]'}>
        {text !== '' && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              eigen
                ? 'bg-brand-600 rounded-br-sm text-white'
                : 'rounded-bl-sm border border-slate-200 bg-white'
            }`}
          >
            {text}
          </div>
        )}

        {payloads.map((payload, index) => (
          <OfferCards key={`${payload.kind}-${String(index)}`} payload={payload} />
        ))}
      </div>
    </li>
  );
}
