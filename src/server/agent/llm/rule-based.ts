import type { ContentBlock } from '@/domain/conversation';
import type { LlmPort, LlmRequest, LlmResponse } from '@/domain/ports/llm';
import { ok, type Result } from '@/domain/result';
import { findExact, searchCatalog } from '@/server/adapters/seed/catalog';

/**
 * Regelbasierter Ersatz fuer ein Sprachmodell.
 *
 * Zweck: Das Projekt soll ohne einen einzigen Schluessel bedienbar sein. Wer
 * das Repository klont und `npm run dev` aufruft, bekommt einen Assistenten,
 * der antwortet — keinen Hinweis, dass erst ein Konto anzulegen sei.
 *
 * Was das hier ist: eine Mustererkennung ueber deutschen Text, die dieselbe
 * Schnittstelle bedient wie ein echtes Modell und dieselben Werkzeuge aufruft.
 * Was es nicht ist: ein Sprachmodell. Es versteht keine Umschreibungen, keine
 * Rueckbezuege, keine Ironie.
 *
 * Der Vergleich beider Wege auf demselben Eval-Datensatz ist Teil des
 * Projekts: Er zeigt in Zahlen, was das Sprachmodell tatsaechlich beitraegt.
 */

const MONTHS: Readonly<Record<string, number>> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

const TRAVELER_WORDS: Readonly<Record<string, number>> = {
  alleine: 1,
  allein: 1,
  solo: 1,
  zweit: 2,
  zweien: 2,
  paar: 2,
  dritt: 3,
  viert: 4,
  fuenft: 5,
  fünft: 5,
};

export interface ExtractedTripParameters {
  readonly originIata: string | null;
  readonly destinationIata: string | null;
  readonly departureDate: string | null;
  readonly returnDate: string | null;
  readonly adults: number | null;
  readonly budgetEuros: number | null;
  readonly nights: number | null;
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue');
}

/** Budget: „bis 2000 €", „unter 1.500 Euro", „max. 800€". */
function extractBudget(text: string): number | null {
  const match =
    /(?:bis|unter|max(?:imal)?\.?|hoechstens|höchstens)\s*(\d[\d.\s]*)\s*(?:€|eur|euro)/i.exec(
      text,
    );

  if (match?.[1] === undefined) {
    return null;
  }

  const amount = Number.parseInt(match[1].replaceAll('.', '').replaceAll(' ', ''), 10);

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Reisendenzahl: „zu zweit", „mit 3 Personen", „alleine". */
function extractAdults(text: string): number | null {
  const normalized = normalize(text);

  const numeric = /(\d+)\s*(?:personen|erwachsene|leute)/.exec(normalized);

  if (numeric?.[1] !== undefined) {
    const count = Number.parseInt(numeric[1], 10);
    return count >= 1 && count <= 9 ? count : null;
  }

  for (const [word, count] of Object.entries(TRAVELER_WORDS)) {
    if (normalized.includes(word)) {
      return count;
    }
  }

  return null;
}

/** Dauer: „eine Woche", „10 Tage", „zwei Wochen". */
function extractNights(text: string): number | null {
  const normalized = normalize(text);

  if (/\beine woche\b/.test(normalized)) {
    return 7;
  }
  if (/\bzwei wochen\b/.test(normalized)) {
    return 14;
  }
  if (/\bdrei wochen\b/.test(normalized)) {
    return 21;
  }

  const days = /(\d+)\s*(?:tage|naechte|nächte)/.exec(normalized);

  if (days?.[1] !== undefined) {
    const count = Number.parseInt(days[1], 10);
    return count >= 1 && count <= 365 ? count : null;
  }

  const weeks = /(\d+)\s*wochen/.exec(normalized);

  if (weeks?.[1] !== undefined) {
    return Number.parseInt(weeks[1], 10) * 7;
  }

  return null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

/**
 * Datum: explizites JJJJ-MM-TT, TT.MM.JJJJ oder ein Monatsname.
 *
 * Beim blossen Monatsnamen wird der 15. genommen und, falls der Monat im
 * laufenden Jahr vorbei ist, das Folgejahr. Das ist eine Annahme — ein echtes
 * Modell wuerde hier besser nachfragen, und genau solche Faelle unterscheiden
 * die beiden Wege im Eval.
 */
function extractDeparture(text: string, today: Date): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);

  if (iso?.[1] !== undefined) {
    return iso[1];
  }

  const german = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text);

  if (german?.[1] !== undefined && german[2] !== undefined && german[3] !== undefined) {
    return `${german[3]}-${german[2].padStart(2, '0')}-${german[1].padStart(2, '0')}`;
  }

  const normalized = normalize(text);

  for (const [name, month] of Object.entries(MONTHS)) {
    if (!normalized.includes(name)) {
      continue;
    }

    const currentYear = today.getUTCFullYear();
    const currentMonth = today.getUTCMonth() + 1;
    const year = month < currentMonth ? currentYear + 1 : currentYear;

    return `${String(year)}-${String(month).padStart(2, '0')}-15`;
  }

  return null;
}

/**
 * Woerter, an denen eine Ortsangabe endet.
 *
 * Ohne diese Grenze verschluckt „von Düsseldorf nach Mallorca" beim Abflugort
 * den halben Satz, und die Katalogsuche findet nichts mehr.
 */
const STOP_WORDS = new Set([
  'nach',
  'auf',
  'von',
  'ab',
  'im',
  'am',
  'in',
  'fuer',
  'für',
  'bis',
  'mit',
  'zu',
  'und',
  'oder',
  'eine',
  'einen',
  'zwei',
  'drei',
]);

/** Nimmt bis zu drei Woerter, bricht am ersten Stoppwort ab. */
function takePlaceWords(rest: string): string {
  const words: string[] = [];

  for (const word of rest.split(/[\s,.;!?]+/)) {
    if (word.length === 0) {
      continue;
    }
    if (STOP_WORDS.has(word.toLowerCase()) || /^\d/.test(word)) {
      break;
    }

    words.push(word);

    if (words.length === 3) {
      break;
    }
  }

  return words.join(' ');
}

/**
 * Orte: Abflugort steht nach „von/ab", Ziel nach „nach/auf".
 * Ohne Praeposition gilt der erste Katalogtreffer als Ziel.
 */
function extractPlaces(text: string): { origin: string | null; destination: string | null } {
  const originMatch = /\b(?:von|ab)\s+(.{3,60})/i.exec(text);
  const destinationMatch = /\b(?:nach|auf)\s+(.{3,60})/i.exec(text);

  const originTerm = originMatch?.[1] === undefined ? '' : takePlaceWords(originMatch[1]);
  const destinationTerm =
    destinationMatch?.[1] === undefined ? '' : takePlaceWords(destinationMatch[1]);

  const origin = originTerm === '' ? null : (searchCatalog(originTerm)[0]?.iataCode ?? null);
  const destination =
    destinationTerm === '' ? null : (searchCatalog(destinationTerm)[0]?.iataCode ?? null);

  if (destination !== null) {
    return { origin, destination };
  }

  /*
   * Kein „nach": jedes Wort gegen den Katalog halten — aber nur exakt.
   * Ein Praefixtreffer waere hier fatal, weil „wie" auf „Wien" passt und aus
   * „wie geht es dir" eine Reise nach Österreich würde.
   */
  for (const word of text.split(/[\s,.;!?]+/)) {
    if (word.length < 3) {
      continue;
    }

    const hit = findExact(word);

    if (hit !== undefined && hit.iataCode !== origin) {
      return { origin, destination: hit.iataCode };
    }
  }

  return { origin, destination: null };
}

export function extractTripParameters(text: string, today = new Date()): ExtractedTripParameters {
  const places = extractPlaces(text);
  const departureDate = extractDeparture(text, today);
  const nights = extractNights(text);

  return {
    originIata: places.origin,
    destinationIata: places.destination,
    departureDate,
    returnDate: departureDate === null || nights === null ? null : addDays(departureDate, nights),
    adults: extractAdults(text),
    budgetEuros: extractBudget(text),
    nights,
  };
}

/** Letzte Nutzernachricht als reiner Text. */
function lastUserText(request: LlmRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];

    if (message?.role !== 'user') {
      continue;
    }

    const text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ');

    if (text.trim().length > 0) {
      return text;
    }
  }

  return '';
}

/**
 * Alles, was im Gespraech bisher gesagt wurde.
 *
 * Nur die letzte Nachricht zu lesen, reicht nicht: Wer zuerst „Italien" nennt
 * und drei Nachrichten spaeter „ja, 2 Kinder", bekaeme sonst wieder die Frage
 * „Wohin soll die Reise gehen?" — der Entwurf ist laengst gefuellt, aber
 * dieser Extraktor sah ihn nie. Genau so ist es in der Abnahme passiert,
 * nachdem das Gaestekontingent aufgebraucht war und dieser Ersatz uebernahm.
 */
function accumulate(request: LlmRequest, today: Date): ExtractedTripParameters {
  let gesammelt = leereParameter();

  // Spaeteres schlaegt Frueheres: Wer sein Ziel aendert, meint die Aenderung.
  const uebernehmen = (teil: ExtractedTripParameters): void => {
    gesammelt = {
      originIata: teil.originIata ?? gesammelt.originIata,
      destinationIata: teil.destinationIata ?? gesammelt.destinationIata,
      departureDate: teil.departureDate ?? gesammelt.departureDate,
      returnDate: teil.returnDate ?? gesammelt.returnDate,
      adults: teil.adults ?? gesammelt.adults,
      budgetEuros: teil.budgetEuros ?? gesammelt.budgetEuros,
      nights: teil.nights ?? gesammelt.nights,
    };
  };

  for (const message of request.messages) {
    if (message.role !== 'user') {
      continue;
    }

    const text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ');

    if (text.trim().length > 0) {
      uebernehmen(extractTripParameters(text, today));
    }
  }

  /*
   * Was ein frueherer Lauf — womoeglich noch mit Sprachmodell — bereits in den
   * Entwurf geschrieben hat, zaehlt ebenfalls. Es steht als Eingabe der
   * Werkzeugaufrufe im Verlauf.
   */
  for (const message of request.messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && block.toolName === 'update_trip_draft') {
        uebernehmen(fromDraftPatch(block.input));
      }
    }
  }

  return gesammelt;
}

function leereParameter(): ExtractedTripParameters {
  return {
    originIata: null,
    destinationIata: null,
    departureDate: null,
    returnDate: null,
    adults: null,
    budgetEuros: null,
    nights: null,
  };
}

/** Liest die Felder aus der Eingabe eines frueheren `update_trip_draft`. */
function fromDraftPatch(input: unknown): ExtractedTripParameters {
  const leer = leereParameter();

  if (typeof input !== 'object' || input === null) {
    return leer;
  }

  const patch = input as Record<string, unknown>;

  const iata = (wert: unknown): string | null => {
    if (typeof wert === 'string' && /^[A-Z]{3}$/.test(wert)) {
      return wert;
    }

    if (typeof wert === 'object' && wert !== null) {
      const code = (wert as { iataCode?: unknown }).iataCode;

      return typeof code === 'string' ? code : null;
    }

    return null;
  };

  const zahl = (wert: unknown): number | null => (typeof wert === 'number' ? wert : null);
  const datum = (wert: unknown): string | null =>
    typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert) ? wert : null;

  return {
    ...leer,
    originIata: iata(patch.origin ?? patch.originIata),
    destinationIata: iata(patch.destination ?? patch.destinationIata),
    departureDate: datum(patch.departureDate),
    returnDate: datum(patch.returnDate),
    adults: zahl(patch.adults),
    budgetEuros: zahl(patch.budgetEuros),
  };
}

/** Wurde in diesem Verlauf bereits ein bestimmtes Werkzeug aufgerufen? */
function alreadyCalled(request: LlmRequest, toolName: string): boolean {
  return request.messages.some((message) =>
    message.blocks.some((block) => block.type === 'tool_use' && block.toolName === toolName),
  );
}

export function createRuleBasedLlm(): LlmPort {
  let callCounter = 0;

  return {
    name: 'rule-based',

    complete(request: LlmRequest): Promise<Result<LlmResponse>> {
      callCounter += 1;
      const heute = new Date();

      /*
       * Zweierlei Sicht auf dasselbe Gespraech: `neu` ist die letzte Aussage
       * — nur sie darf in den Entwurf geschrieben werden. `params` ist der
       * gesammelte Stand und entscheidet, was noch fehlt.
       */
      const neu = extractTripParameters(lastUserText(request), heute);
      const params = accumulate(request, heute);

      const usage = { inputTokens: 0, outputTokens: 0 };

      // Schritt 1: Erkannte Angaben in den Entwurf schreiben.
      if (!alreadyCalled(request, 'update_trip_draft') && hasAnything(neu)) {
        const blocks: ContentBlock[] = [
          {
            type: 'tool_use',
            toolCallId: `rb_${String(callCounter)}`,
            toolName: 'update_trip_draft',
            input: buildDraftPatch(neu),
          },
        ];

        return Promise.resolve(ok({ blocks, usage }));
      }

      // Schritt 2: Sind Ziel und Zeitraum bekannt, nach Flügen suchen.
      if (
        !alreadyCalled(request, 'search_flights') &&
        params.originIata !== null &&
        params.destinationIata !== null &&
        params.departureDate !== null &&
        params.returnDate !== null
      ) {
        const blocks: ContentBlock[] = [
          {
            type: 'tool_use',
            toolCallId: `rb_${String(callCounter)}`,
            toolName: 'search_flights',
            input: {
              originIata: params.originIata,
              destinationIata: params.destinationIata,
              departureDate: params.departureDate,
              returnDate: params.returnDate,
              adults: params.adults ?? 1,
              childAges: [],
            },
          },
        ];

        return Promise.resolve(ok({ blocks, usage }));
      }

      // Schritt 3: Antworten — entweder mit Rückfrage oder mit dem Ergebnis.
      return Promise.resolve(ok({ blocks: [{ type: 'text', text: reply(params) }], usage }));
    },
  };
}

function hasAnything(params: ExtractedTripParameters): boolean {
  return (
    params.originIata !== null ||
    params.destinationIata !== null ||
    params.departureDate !== null ||
    params.adults !== null ||
    params.budgetEuros !== null
  );
}

function buildDraftPatch(params: ExtractedTripParameters): Record<string, unknown> {
  return {
    ...(params.departureDate === null ? {} : { departureDate: params.departureDate }),
    ...(params.returnDate === null ? {} : { returnDate: params.returnDate }),
    ...(params.adults === null ? {} : { adults: params.adults }),
    ...(params.budgetEuros === null ? {} : { budgetEuros: params.budgetEuros }),
  };
}

/** Genau eine Rückfrage — zur ersten fehlenden Angabe. */
function reply(params: ExtractedTripParameters): string {
  if (params.destinationIata === null) {
    return 'Wohin soll die Reise gehen?';
  }
  if (params.originIata === null) {
    return 'Von welchem Flughafen möchtest du starten?';
  }
  if (params.departureDate === null) {
    return 'An welchem Datum möchtest du hinfliegen?';
  }
  if (params.returnDate === null) {
    return 'Wie lange soll die Reise dauern?';
  }

  return 'Ich habe deine Angaben notiert und passende Verbindungen herausgesucht.';
}
