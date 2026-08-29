import {
  MAX_SPEECH_CHARS,
  type SpeechRequest,
  type SpokenAudio,
  type TextToSpeechPort,
} from '@/domain/ports/speech';
import { fail, type Result } from '@/domain/result';
import { fetchBytes } from './fetch-json';

/**
 * ElevenLabs hinter dem TextToSpeechPort.
 *
 * Ein einziger POST: Text hinein, MP3 heraus. Deshalb steht hier auch kein
 * SDK — `@elevenlabs/elevenlabs-js` braechte `node-fetch@2`, `ws` und
 * `command-exists` mit, die vor allem den Helfer `play()` tragen. Der gibt Ton
 * auf den Lautsprechern des **Servers** aus; gebraucht wird er im Browser der
 * reisenden Person. Ausfuehrlich in specs/009.
 *
 * Beim Sprachmodell fiel dieselbe Entscheidung umgekehrt aus, und das aus
 * einem konkreten Grund: Neue Google-Schluessel im Format `AQ.` funktionieren
 * mit einem einfachen `?key=`-Aufruf nicht. Hier gibt es keinen solchen Grund.
 */

const PROVIDER = 'ElevenLabs';
const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * Ton dauert. Zwanzig Sekunden wie bei Duffel, nicht die zehn der
 * Voreinstellung: Ein Absatz will erst erzeugt und dann als MP3 uebertragen
 * werden, und beides geschieht, bevor das erste Byte hier ankommt.
 */
const TIMEOUT_MS = 20_000;

/**
 * Mehrsprachig, weil die Oberflaeche deutsch ist.
 *
 * Die schnelleren Modelle sprechen guenstiger, aber hoerbar flacher. Fuer ein
 * Vorlesen von wenigen Saetzen faellt der Unterschied ins Gewicht, der Preis
 * hier nicht.
 */
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/**
 * Voreingestellte Stimme aus der Kurzanleitung des Anbieters.
 *
 * Sie ist nur ein Anfang: Wem sie auf Deutsch nicht gefaellt, setzt
 * `ELEVENLABS_VOICE_ID` und braucht dafuer keine Zeile Code zu aendern.
 */
export const DEFAULT_ELEVENLABS_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

/** MP3, 44,1 kHz, 128 kbit/s — im kostenlosen Zugang die hoechste Stufe. */
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface ElevenLabsOptions {
  readonly apiKey: string;
  /** Stimme; die Anfrage darf sie ueberstimmen. */
  readonly voiceId?: string | undefined;
  readonly model?: string | undefined;
  /** Untergeschobene Implementierung fuer Tests — ohne Netz, ohne Schluessel. */
  readonly fetchImpl?: typeof fetch;
}

export function createElevenLabsSpeech(options: ElevenLabsOptions): TextToSpeechPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? DEFAULT_ELEVENLABS_MODEL;
  const stimme = options.voiceId ?? DEFAULT_ELEVENLABS_VOICE;

  return {
    name: `elevenlabs:${model}`,

    async speak(request: SpeechRequest): Promise<Result<SpokenAudio>> {
      const text = request.text.trim();

      /*
       * Beide Pruefungen vor dem Aufruf. Ein leerer Text ergibt keinen Ton,
       * ein zu langer kostet Kontingent fuer etwas, das ohnehin abgelehnt
       * wuerde — und in beiden Faellen war die Eingabe falsch, nicht der
       * Anbieter. Daher `validation_error`.
       */
      if (text === '') {
        return fail('validation_error', 'Ohne Text gibt es nichts vorzulesen');
      }

      if (text.length > MAX_SPEECH_CHARS) {
        return fail(
          'validation_error',
          `Der Text ist mit ${String(text.length)} Zeichen laenger als die erlaubten ${String(MAX_SPEECH_CHARS)}`,
          { length: text.length },
        );
      }

      return fetchBytes(
        {
          url: `${API_URL}/${encodeURIComponent(request.voiceId ?? stimme)}?output_format=${OUTPUT_FORMAT}`,
          method: 'POST',
          headers: { 'xi-api-key': options.apiKey },
          body: { text, model_id: model },
          timeoutMs: TIMEOUT_MS,
          expects: 'audio/',
          provider: PROVIDER,
        },
        fetchImpl,
      );
    },
  };
}
