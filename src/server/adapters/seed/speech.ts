import {
  MAX_SPEECH_CHARS,
  type SpeechRequest,
  type SpokenAudio,
  type TextToSpeechPort,
} from '@/domain/ports/speech';
import { fail, ok, type Result } from '@/domain/result';

/**
 * Sprachausgabe ohne Anbieter — feste Bytes statt Ton.
 *
 * Die uebrigen Seed-Adapter rechnen echte Ergebnisse aus: Ein Flugpreis laesst
 * sich aus Strecke, Datum und Reisendenzahl deterministisch herleiten, und was
 * dabei herauskommt, ist eine brauchbare Auskunft. Sprache laesst sich so
 * nicht herleiten. Diese Implementierung erzeugt deshalb **keinen hoerbaren
 * Ton** und gibt sich auch nicht als solcher aus.
 *
 * Wofuer sie da ist: Tests. Der Weg von der Route ueber den Port bis zur
 * Antwort laesst sich damit vollstaendig pruefen, ohne Netz und ohne
 * Schluessel — die Bedingung aus AGENTS.md § 2.2.
 *
 * Wofuer sie **nicht** da ist: den Betrieb ohne Schluessel. Dort spricht der
 * Browser selbst (`speechSynthesis`), und der kommt an diesem Port gar nicht
 * vorbei. Eine Attrappe, die im Betrieb stumme Dateien ausliefert, waere ein
 * Knopf, der nichts tut.
 */

/** Der Kopf eines MP3-Rahmens. Genug, damit die Bytes erkennbar sind. */
const FESTE_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

export function createFixedSpeech(): TextToSpeechPort {
  return {
    name: 'fixed',

    speak(request: SpeechRequest): Promise<Result<SpokenAudio>> {
      // Dieselben Vorpruefungen wie beim echten Anbieter: Eine Attrappe, die
      // mehr annimmt als das Original, verbirgt genau die Fehler, die ein Test
      // finden soll.
      const text = request.text.trim();

      if (text === '') {
        return Promise.resolve(fail('validation_error', 'Ohne Text gibt es nichts vorzulesen'));
      }

      if (text.length > MAX_SPEECH_CHARS) {
        return Promise.resolve(
          fail(
            'validation_error',
            `Der Text ist mit ${String(text.length)} Zeichen laenger als die erlaubten ${String(MAX_SPEECH_CHARS)}`,
            { length: text.length },
          ),
        );
      }

      return Promise.resolve(ok({ data: FESTE_BYTES, mimeType: 'audio/mpeg' }));
    },
  };
}
