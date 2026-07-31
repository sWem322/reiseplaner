import type { ContentBlock } from '@/domain/conversation';
import type { LlmMessage, LlmPort, LlmRequest, LlmResponse } from '@/domain/ports/llm';
import { ok, type Result } from '@/domain/result';
import { MISSING_SLOT_ORDER, type TripSlot } from '@/domain/trip/trip';
import { findByIata, findExact, searchCatalog } from '@/server/adapters/seed/catalog';

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

    /*
     * Ein Wort aus drei Buchstaben gilt nur als IATA-Code, wenn es auch wie
     * einer geschrieben ist. Sonst wird aus „Wie ist das Rezept fuer
     * Tiramisu?" eine Reise nach Istanbul — das deutsche „ist" trifft auf den
     * Code IST. Der Eval hat genau diesen Fall gefunden.
     */
    if (word.length === 3 && word !== word.toUpperCase()) {
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

/** Was frühere `update_trip_draft`-Aufrufe bereits festgehalten haben. */
function ausVerlauf(request: LlmRequest): ExtractedTripParameters {
  let stand = leereParameter();

  for (const message of request.messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && block.toolName === 'update_trip_draft') {
        const teil = fromDraftPatch(block.input);

        stand = {
          originIata: teil.originIata ?? stand.originIata,
          destinationIata: teil.destinationIata ?? stand.destinationIata,
          departureDate: teil.departureDate ?? stand.departureDate,
          returnDate: teil.returnDate ?? stand.returnDate,
          adults: teil.adults ?? stand.adults,
          budgetEuros: teil.budgetEuros ?? stand.budgetEuros,
          nights: stand.nights,
        };
      }
    }
  }

  return stand;
}

/** Nur die Felder, die sich gegenüber dem bisherigen Stand geändert haben. */
function nurNeues(
  erkannt: ExtractedTripParameters,
  bekannt: ExtractedTripParameters,
): ExtractedTripParameters {
  const neuOder = <T>(wert: T | null, alt: T | null): T | null =>
    wert === null || wert === alt ? null : wert;

  return {
    originIata: neuOder(erkannt.originIata, bekannt.originIata),
    destinationIata: neuOder(erkannt.destinationIata, bekannt.destinationIata),
    departureDate: neuOder(erkannt.departureDate, bekannt.departureDate),
    returnDate: neuOder(erkannt.returnDate, bekannt.returnDate),
    adults: neuOder(erkannt.adults, bekannt.adults),
    budgetEuros: neuOder(erkannt.budgetEuros, bekannt.budgetEuros),
    nights: erkannt.nights,
  };
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

/**
 * Der Entwurf, wie ihn zuletzt ein Werkzeug zurueckgemeldet hat.
 *
 * Das ist die eigentliche Wahrheit ueber das Gespraech — und dieser Extraktor
 * hat sie bisher nie gelesen. Er leitete alles aus dem Text ab, und wenn der
 * Verlauf verdichtet wurde oder die Angabe aus einem Zug mit Sprachmodell
 * stammte, war sie fuer ihn verschwunden. In der Abnahme fragte er deshalb
 * „Von welchem Flughafen moechtest du starten?", waehrend „Duesseldorf (DUS)"
 * in der Leiste danebenstand.
 *
 * Sowohl `update_trip_draft` als auch `get_trip_draft` liefern den Entwurf
 * zurueck; beide Ergebnisse stehen als `tool_result` im Verlauf. Gesucht wird
 * rueckwaerts, damit der juengste Stand gewinnt.
 */
function entwurfAusVerlauf(request: LlmRequest): ExtractedTripParameters | null {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];

    if (message === undefined) {
      continue;
    }

    for (const block of message.blocks) {
      if (block.type !== 'tool_result' || block.isError) {
        continue;
      }

      const inhalt = block.content;

      if (typeof inhalt !== 'object' || inhalt === null || !('draft' in inhalt)) {
        continue;
      }

      return fromDraftPatch(inhalt.draft);
    }
  }

  return null;
}

/** Die Fragen zu den Pflichtangaben — in derselben Reihenfolge wie die Domaene. */
const FRAGEN: Readonly<Record<TripSlot, string>> = {
  destination: 'Wohin soll die Reise gehen?',
  origin: 'Von welchem Flughafen möchtest du starten?',
  departureDate: 'An welchem Datum möchtest du hinfliegen?',
  returnDate: 'Wie lange soll die Reise dauern?',
  adults: 'Mit wie vielen Erwachsenen reist du?',
};

/** Welche Pflichtangabe fehlt noch — nach `MISSING_SLOT_ORDER`. */
function fehlendeSlots(params: ExtractedTripParameters): readonly TripSlot[] {
  return MISSING_SLOT_ORDER.filter((slot) => {
    switch (slot) {
      case 'destination':
        return params.destinationIata === null;
      case 'origin':
        return params.originIata === null;
      case 'departureDate':
        return params.departureDate === null;
      case 'returnDate':
        return params.returnDate === null;
      case 'adults':
        return params.adults === null;
    }
  });
}

/** Zu welcher Angabe wurde zuletzt gefragt? */
function zuletztGefragt(request: LlmRequest): TripSlot | null {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];

    if (message?.role !== 'assistant') {
      continue;
    }

    const text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ');

    if (text.trim().length === 0) {
      continue;
    }

    return MISSING_SLOT_ORDER.find((slot) => text.includes(FRAGEN[slot])) ?? null;
  }

  return null;
}

/**
 * Eine knappe Antwort im Licht der zuletzt gestellten Frage lesen.
 *
 * Auf „Mit wie vielen Erwachsenen reist du?" antwortet niemand „zwei
 * Erwachsene" — man schreibt „2". Der Extraktor sucht nach Wortmustern und
 * ging deshalb leer aus; die Antwort verfiel, die Frage kam wieder, und das
 * Gespraech drehte sich. Nur fuer die Reisendenzahl noetig: Orte und Daten
 * erkennt der Extraktor auch ohne Satz drumherum.
 */
function alsAntwortAuf(slot: TripSlot | null, text: string): ExtractedTripParameters {
  const leer = leereParameter();

  if (slot !== 'adults') {
    return leer;
  }

  const knapp = text.trim();

  if (!/^\d{1,2}$/.test(knapp)) {
    return leer;
  }

  const anzahl = Number.parseInt(knapp, 10);

  return anzahl >= 1 && anzahl <= 9 ? { ...leer, adults: anzahl } : leer;
}

/**
 * Die Nachrichten des laufenden Zuges — alles nach der letzten Nutzereingabe.
 *
 * „Wurde schon gesucht?" ueber das ganze Gespraech zu fragen, war falsch in
 * beide Richtungen: Nach der ersten Suche wurde nie wieder gesucht, auch wenn
 * die reisende Person das Ziel wechselte — und der Schlusssatz behauptete in
 * jedem weiteren Zug, er habe Verbindungen herausgesucht. Ein Zug beginnt mit
 * dem, was gesagt wurde, und endet mit der Antwort darauf.
 */
function zugNachrichten(request: LlmRequest): readonly LlmMessage[] {
  let letzterNutzer = -1;

  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    if (request.messages[index]?.role === 'user') {
      letzterNutzer = index;
      break;
    }
  }

  return letzterNutzer < 0 ? request.messages : request.messages.slice(letzterNutzer + 1);
}

/** Wie ist die Flugsuche in diesem Zug ausgegangen? */
function sucheImZug(request: LlmRequest): 'ok' | 'fehler' | 'keine' {
  const zug = zugNachrichten(request);

  const bloecke = zug.flatMap((message) => message.blocks);

  const aufruf = bloecke.find(
    (block) => block.type === 'tool_use' && block.toolName === 'search_flights',
  );

  if (aufruf?.type !== 'tool_use') {
    return 'keine';
  }

  const ergebnis = bloecke.find(
    (block) => block.type === 'tool_result' && block.toolCallId === aufruf.toolCallId,
  );

  if (ergebnis?.type !== 'tool_result') {
    // Der Aufruf steht, das Ergebnis noch nicht — dieser Zug ist mitten drin.
    return 'ok';
  }

  return ergebnis.isError ? 'fehler' : 'ok';
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
      const letzterText = lastUserText(request);
      const gefragt = zuletztGefragt(request);

      const neu = zusammen(
        extractTripParameters(letzterText, heute),
        alsAntwortAuf(gefragt, letzterText),
      );

      /*
       * Der Entwurf schlaegt den Text. Was ein Werkzeug zurueckgemeldet hat,
       * steht so in der Datenbank; was aus Saetzen abgeleitet wurde, ist eine
       * Vermutung — und faellt weg, sobald der Verlauf verdichtet wird.
       */
      const entwurf = entwurfAusVerlauf(request);
      const params = zusammen(accumulate(request, heute), entwurf ?? leereParameter());

      const usage = { inputTokens: 0, outputTokens: 0 };

      /*
       * Schritt 1: Neu Erkanntes in den Entwurf schreiben.
       *
       * Frueher galt: hoechstens ein Schreibvorgang je Gespraech. Damit blieb
       * alles unberuecksichtigt, was nach der ersten Nachricht kam — „nach
       * Barcelona", „vom 12. bis 19." und „zu zweit" landeten nirgends. Jetzt
       * entscheidet, ob die Angabe schon im Verlauf steht.
       */
      const bereitsGeschrieben = zusammen(ausVerlauf(request), entwurf ?? leereParameter());
      const zuSchreiben = nurNeues(neu, bereitsGeschrieben);

      if (hasAnything(zuSchreiben)) {
        const blocks: ContentBlock[] = [
          {
            type: 'tool_use',
            toolCallId: `rb_${String(callCounter)}`,
            toolName: 'update_trip_draft',
            input: buildDraftPatch(zuSchreiben),
          },
        ];

        return Promise.resolve(ok({ blocks, usage }));
      }

      /*
       * Schritt 2: Sind Ziel, Zeitraum **und Reisendenzahl** bekannt, nach
       * Flügen suchen.
       *
       * Hier stand einmal `adults: params.adults ?? 1` — dieselbe stille
       * Erfindung, die dem Sprachmodell vorgeworfen wurde, nur in meinem
       * eigenen Code. Ein `??` an einer Stelle, an der niemand etwas gesagt
       * hat, ist geraten und nicht gewusst.
       */
      if (
        sucheImZug(request) === 'keine' &&
        params.originIata !== null &&
        params.destinationIata !== null &&
        params.departureDate !== null &&
        params.returnDate !== null &&
        params.adults !== null
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
              adults: params.adults,
              childAges: [],
            },
          },
        ];

        return Promise.resolve(ok({ blocks, usage }));
      }

      // Schritt 3: Antworten — entweder mit Rückfrage oder mit dem Ergebnis.
      return Promise.resolve(
        ok({ blocks: [{ type: 'text', text: reply(params, sucheImZug(request)) }], usage }),
      );
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

/**
 * Ort als vollstaendige Angabe, wie das Werkzeug sie erwartet.
 *
 * Der Extraktor haelt nur den IATA-Code fest; `update_trip_draft` will Name,
 * Code und Koordinaten. Fehlte diese Umrechnung, blieben Ziel und Abflugort im
 * Entwurf leer, obwohl beide erkannt wurden — die Leiste zeigte 0 von 5, waehrend
 * die Flugsuche laengst lief.
 */
function placeFor(iataCode: string | null): Record<string, unknown> | null {
  if (iataCode === null) {
    return null;
  }

  const eintrag = findByIata(iataCode);

  return eintrag === undefined
    ? null
    : {
        name: eintrag.name,
        iataCode: eintrag.iataCode,
        latitude: eintrag.latitude,
        longitude: eintrag.longitude,
      };
}

function buildDraftPatch(params: ExtractedTripParameters): Record<string, unknown> {
  const origin = placeFor(params.originIata);
  const destination = placeFor(params.destinationIata);

  return {
    ...(origin === null ? {} : { origin }),
    ...(destination === null ? {} : { destination }),
    ...(params.departureDate === null ? {} : { departureDate: params.departureDate }),
    ...(params.returnDate === null ? {} : { returnDate: params.returnDate }),
    ...(params.adults === null ? {} : { adults: params.adults }),
    ...(params.budgetEuros === null ? {} : { budgetEuros: params.budgetEuros }),
  };
}

/** Zwei Staende zu einem verschmelzen — der zweite gewinnt, wo er etwas weiss. */
function zusammen(
  grund: ExtractedTripParameters,
  darueber: ExtractedTripParameters,
): ExtractedTripParameters {
  return {
    originIata: darueber.originIata ?? grund.originIata,
    destinationIata: darueber.destinationIata ?? grund.destinationIata,
    departureDate: darueber.departureDate ?? grund.departureDate,
    returnDate: darueber.returnDate ?? grund.returnDate,
    adults: darueber.adults ?? grund.adults,
    budgetEuros: darueber.budgetEuros ?? grund.budgetEuros,
    nights: darueber.nights ?? grund.nights,
  };
}

/**
 * Genau eine Rückfrage — zur ersten fehlenden Angabe.
 *
 * Zwei Fehler steckten in der früheren Fassung, und beide fielen erst auf,
 * als das Gästekontingent aufgebraucht war und dieser Ersatz das Gespräch
 * allein führte:
 *
 * 1. Nach der Reisendenzahl wurde **nie** gefragt. Sie ist eine Pflichtangabe,
 *    stand aber in keiner Verzweigung — das Gespräch sprang von den Daten
 *    direkt zum Schlusssatz.
 * 2. Der Schlusssatz behauptete „und passende Verbindungen herausgesucht",
 *    ohne dass eine Suche gelaufen wäre. Eine Zeile, die dasteht, egal was
 *    passiert ist, ist keine Antwort, sondern Dekoration.
 */
function reply(params: ExtractedTripParameters, suche: 'ok' | 'fehler' | 'keine'): string {
  const naechste = fehlendeSlots(params)[0];

  if (naechste !== undefined) {
    return FRAGEN[naechste];
  }

  switch (suche) {
    case 'ok':
      return 'Ich habe deine Angaben notiert und passende Verbindungen herausgesucht.';
    case 'fehler':
      return 'Die Suche nach Verbindungen hat nicht geklappt. Sag Bescheid, dann versuche ich es noch einmal.';
    case 'keine':
      return 'Deine Angaben sind vollständig. Sag Bescheid, dann suche ich nach Verbindungen.';
  }
}
