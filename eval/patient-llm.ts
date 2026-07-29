import type { LlmPort, LlmRequest, LlmResponse } from '@/domain/ports/llm';
import type { Result } from '@/domain/result';

/**
 * Ein LlmPort, der auf ein erschöpftes Kontingent wartet, statt aufzugeben.
 *
 * Warum nicht im Adapter selbst: Im Betrieb wartet niemand eine Minute auf
 * eine Antwort — dort ist der Wechsel zum nächsten Modell richtig und danach
 * die ehrliche Absage. Der Eval ist aber ein Stapellauf ohne wartenden
 * Menschen; hier ist Geduld die richtige Antwort.
 *
 * Der Anlass: Der erste Lauf gegen Gemini feuerte fünfzig Anfragen in
 * Sekunden, lief nach drei Fällen ins Minutenlimit und lieferte für die
 * restlichen siebzehn leere Entwürfe. Das Ergebnis sah aus wie eine Messung,
 * war aber nur ein Abbild der Drosselung.
 */

export interface PatientOptions {
  /** Mindestabstand zwischen zwei Aufrufen — hält unter dem Minutenlimit. */
  readonly abstandMs?: number;
  /** Wie lange insgesamt höchstens gewartet wird, bevor aufgegeben wird. */
  readonly maxWartezeitMs?: number;
  readonly melde?: (text: string) => void;
}

const STANDARD_ABSTAND_MS = 6_500;
const STANDARD_MAX_WARTEZEIT_MS = 10 * 60_000;

function schlafe(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wann wird wieder ein Modell frei? Der Adapter legt es in die Details. */
function naechsteFreigabe(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('nextFreeAt' in details)) {
    return null;
  }

  const { nextFreeAt } = details;

  return typeof nextFreeAt === 'number' ? nextFreeAt : null;
}

export function withPatience(inner: LlmPort, options: PatientOptions = {}): LlmPort {
  const abstand = options.abstandMs ?? STANDARD_ABSTAND_MS;
  const maxWartezeit = options.maxWartezeitMs ?? STANDARD_MAX_WARTEZEIT_MS;
  const melde =
    options.melde ??
    ((text: string) => {
      console.log(text);
    });

  let letzterAufruf = 0;

  return {
    name: inner.name,

    async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
      let gewartet = 0;

      for (;;) {
        // Gleichmaessig statt stossweise: das Minutenlimit gilt je Minute.
        const seitLetztem = Date.now() - letzterAufruf;

        if (seitLetztem < abstand) {
          await schlafe(abstand - seitLetztem);
        }

        letzterAufruf = Date.now();

        const antwort = await inner.complete(request);

        if (antwort.ok || antwort.error.kind !== 'rate_limited') {
          return antwort;
        }

        const frei = naechsteFreigabe(antwort.error.details);
        const pause = Math.min(
          Math.max((frei ?? Date.now() + 60_000) - Date.now() + 2_000, 5_000),
          90_000,
        );

        if (gewartet + pause > maxWartezeit) {
          return antwort;
        }

        gewartet += pause;
        melde(`  … Kontingent erschöpft, warte ${String(Math.round(pause / 1000))} s`);
        await schlafe(pause);
      }
    },
  };
}
