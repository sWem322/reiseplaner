import { textOfBlocks } from '@/domain/conversation';
import type { Repositories } from '@/domain/ports/repositories';
import type { SpokenAudio, TextToSpeechPort } from '@/domain/ports/speech';
import type { ErrorKind } from '@/domain/result';

/**
 * Eine gespeicherte Antwort vorlesen — die Entscheidungen, nicht das HTTP.
 *
 * Bewusst getrennt vom Route-Handler, aus demselben Grund wie bei
 * `run-conversation.ts`: So laesst sich der ganze Vorgang im Test gegen eine
 * Wegwerf-Datenbank ausfuehren, ohne HTTP zu sprechen. Der Handler daneben
 * besteht danach nur noch aus Sitzung, Rumpf und Kopfzeilen.
 *
 * Was hier **nicht** vorkommt: freier Text. Vertont wird eine Nachricht, die
 * im Verlauf steht, und nur, wenn sie der anfragenden Person gehoert.
 */

export interface ReadAloudInput {
  readonly messageId: string;
  readonly userId: string;
  readonly repositories: Repositories;
  /** `null`, wenn auf diesem Server keine Stimme eingerichtet ist. */
  readonly speech: TextToSpeechPort | null;
}

export type ReadAloud =
  | { readonly ok: true; readonly audio: SpokenAudio }
  | { readonly ok: false; readonly status: number; readonly message: string };

/**
 * Ein Fehler des Anbieters ist kein Fehler der anfragenden Person.
 *
 * Vor allem `unauthorized` darf nicht als 401 durchgereicht werden: Das hiesse
 * „deine Sitzung ist ungueltig", waehrend in Wahrheit der Schluessel dieses
 * Servers nicht taugt. Die Person kann daran nichts richten, und die Meldung
 * schickte sie auf die falsche Faehrte.
 */
export function statusFor(kind: ErrorKind): number {
  switch (kind) {
    case 'validation_error':
      return 400;
    case 'rate_limited':
      return 429;
    case 'not_found':
    case 'unauthorized':
    case 'upstream_error':
    case 'budget_exceeded':
      return 502;
  }
}

function abgelehnt(status: number, message: string): ReadAloud {
  return { ok: false, status, message };
}

export async function readAloud(input: ReadAloudInput): Promise<ReadAloud> {
  if (input.speech === null) {
    /*
     * Kein Fehler, sondern eine Auskunft: Auf diesem Server ist keine Stimme
     * eingerichtet. Die Oberflaeche weiss das und liest ohnehin selbst vor —
     * hier ankommen kann nur, wer die Route von Hand aufruft.
     */
    return abgelehnt(501, 'Auf diesem Server ist keine Sprachausgabe eingerichtet');
  }

  const nachricht = await input.repositories.messages.findById(input.messageId);

  /*
   * Eine fremde Nachricht und eine nicht vorhandene sind nach aussen dasselbe.
   * Alles andere verriete, welche Kennungen es gibt.
   */
  if (nachricht === null) {
    return abgelehnt(404, 'Diese Nachricht gibt es nicht');
  }

  const gehoert = await input.repositories.conversations.belongsTo(
    nachricht.conversationId,
    input.userId,
  );

  if (!gehoert) {
    return abgelehnt(404, 'Diese Nachricht gibt es nicht');
  }

  if (nachricht.role !== 'assistant') {
    // Vorgelesen wird, was der Assistent gesagt hat. Die eigenen Worte kennt
    // die reisende Person bereits.
    return abgelehnt(400, 'Vorgelesen werden nur Antworten des Assistenten');
  }

  const gesprochen = await input.speech.speak({ text: textOfBlocks(nachricht.blocks) });

  return gesprochen.ok
    ? { ok: true, audio: gesprochen.value }
    : abgelehnt(statusFor(gesprochen.error.kind), gesprochen.error.message);
}
