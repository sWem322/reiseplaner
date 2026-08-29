import type { Result } from '../result';

/**
 * Port der Sprachausgabe.
 *
 * Eine Antwort des Assistenten laesst sich anhoeren statt lesen. Der Port
 * beschreibt nur das Was — Text hinein, Ton heraus. Welcher Dienst spricht,
 * entscheidet die Fabrik anhand der vorhandenen Zugangsdaten.
 *
 * Zwei Eigenheiten gegenueber den Anbieter-Ports in `providers.ts`:
 *
 * 1. **Der Agent kennt diesen Port nicht.** Er gehoert keinem Werkzeug: Ob
 *    etwas vorgelesen wird, entscheidet die reisende Person, nicht das Modell
 *    — und ein Werkzeugergebnis, das aus Audiobytes besteht, koennte das
 *    Modell ohnehin nicht lesen. Der Port haengt an einer eigenen Route.
 * 2. **Es gibt keine sprechende Seed-Implementierung.** Deterministische
 *    Flugpreise lassen sich ausrechnen, deterministische Sprache nicht. Fuer
 *    Tests gibt es feste Bytes; ohne Schluessel spricht im Betrieb der
 *    Browser, und der kommt an diesem Port gar nicht vorbei.
 */

export interface SpeechRequest {
  readonly text: string;
  /** Stimme des Anbieters. Ohne Angabe waehlt der Adapter seine eigene. */
  readonly voiceId?: string;
}

export interface SpokenAudio {
  /**
   * Der Typparameter ist Absicht.
   *
   * Seit TypeScript 5.7 ist `Uint8Array` ueber seinen Puffer generisch, und
   * die Voreinstellung `ArrayBufferLike` schliesst `SharedArrayBuffer` ein.
   * Eine `Response` nimmt den nicht an — mit dem blossen `Uint8Array` scheitert
   * also ausgerechnet die Stelle, an der die Bytes den Server verlassen.
   */
  readonly data: Uint8Array<ArrayBuffer>;
  /** Etwa `audio/mpeg` — die Route reicht ihn unveraendert an den Browser. */
  readonly mimeType: string;
}

/**
 * Obergrenze der Textlaenge.
 *
 * Dieselbe Zahl wie bei der Nachricht der reisenden Person, und zwar aus
 * demselben Grund: Was laenger ist, ist kein Gespraechsbeitrag mehr. Der
 * Adapter prueft sie, bevor er den Anbieter ruft — ein Fehlschlag, den man
 * ohne Netzaufruf erkennen kann, soll auch ohne Netzaufruf erkannt werden.
 */
export const MAX_SPEECH_CHARS = 2_000;

export interface TextToSpeechPort {
  /** Name der Implementierung — erscheint im Startprotokoll. */
  readonly name: string;

  speak(request: SpeechRequest): Promise<Result<SpokenAudio>>;
}
