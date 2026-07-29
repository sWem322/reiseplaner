import { z } from 'zod';
import type { Providers } from '@/domain/ports/providers';
import type { TripDraftRepository } from '@/domain/ports/repositories';
import {
  iataCodeSchema,
  isoDateSchema,
  missingSlots,
  tripDraftSchema,
  type TripDraft,
} from '@/domain/trip/trip';
import { nightsBetween } from '@/domain/offers';
import { fail, ok, type Result } from '@/domain/result';
import { createRegistry, type Tool, type ToolRegistry } from './registry';

/**
 * Die sechs Werkzeuge des Reiseplaners.
 *
 * Die Beschreibungen sind auf Deutsch und ausfuehrlich — sie sind der einzige
 * Weg, auf dem das Modell erfaehrt, wann welches Werkzeug sinnvoll ist. Eine
 * knappe Beschreibung fuehrt zuverlaessig zu Werkzeugen, die nie oder immer
 * aufgerufen werden.
 */

export interface ToolDependencies {
  readonly providers: Providers;
  readonly tripDrafts: TripDraftRepository;
}

// --- Ortsaufloesung ----------------------------------------------------

const resolveDestinationInput = z.object({
  query: z
    .string()
    .min(2, 'Der Suchbegriff braucht mindestens zwei Zeichen')
    .max(80)
    .describe('Ortsname aus der Nutzereingabe, zum Beispiel „Mallorca" oder „Düsseldorf"'),
});

function resolveDestinationTool(
  deps: ToolDependencies,
): Tool<z.infer<typeof resolveDestinationInput>> {
  return {
    name: 'resolve_destination',
    description: [
      'Wandelt einen Ortsnamen aus freiem Text in einen Ort mit IATA-Code und Koordinaten um.',
      'Immer zuerst aufrufen, bevor nach Flügen, Unterkünften oder Wetter gesucht wird —',
      'die Suchwerkzeuge brauchen IATA-Codes, keine Ortsnamen.',
      'Liefert mehrere Treffer, wenn die Eingabe mehrdeutig ist; dann bei der reisenden Person nachfragen.',
    ].join(' '),
    inputSchema: resolveDestinationInput,
    async execute(input) {
      const result = await deps.providers.geocoding.resolve(input.query);

      if (!result.ok) {
        return result;
      }

      return ok({
        matches: result.value.map((place) => ({
          name: place.name,
          iataCode: place.iataCode,
          latitude: place.latitude,
          longitude: place.longitude,
        })),
      });
    },
  };
}

// --- Flugsuche ---------------------------------------------------------

const searchFlightsInput = z.object({
  originIata: iataCodeSchema.describe('IATA-Code des Abflughafens, drei Großbuchstaben'),
  destinationIata: iataCodeSchema.describe('IATA-Code des Zielflughafens'),
  departureDate: isoDateSchema.describe('Hinreisedatum im Format JJJJ-MM-TT'),
  returnDate: isoDateSchema.describe('Rückreisedatum im Format JJJJ-MM-TT'),
  adults: z.number().int().min(1).max(9).describe('Anzahl erwachsener Reisender'),
  childAges: z
    .array(z.number().int().min(0).max(17))
    .max(9)
    .default([])
    .describe('Alter der mitreisenden Kinder in Jahren'),
});

function searchFlightsTool(deps: ToolDependencies): Tool<z.infer<typeof searchFlightsInput>> {
  return {
    name: 'search_flights',
    description: [
      'Sucht Hin- und Rückflüge für eine Strecke und liefert die fünf günstigsten Angebote.',
      'Setzt IATA-Codes voraus — vorher resolve_destination aufrufen.',
      'Eine leere Ergebnisliste bedeutet, dass auf dieser Strecke an diesen Tagen nichts fliegt;',
      'das ist kein Fehler, sondern eine Auskunft, die weitergegeben werden soll.',
    ].join(' '),
    inputSchema: searchFlightsInput,
    async execute(input) {
      const originResult = await deps.providers.geocoding.resolve(input.originIata);
      const destinationResult = await deps.providers.geocoding.resolve(input.destinationIata);

      if (!originResult.ok) {
        return originResult;
      }
      if (!destinationResult.ok) {
        return destinationResult;
      }

      const origin = originResult.value.find((p) => p.iataCode === input.originIata);
      const destination = destinationResult.value.find((p) => p.iataCode === input.destinationIata);

      if (origin === undefined || destination === undefined) {
        return fail('not_found', 'Einer der IATA-Codes ist nicht bekannt', {
          originIata: input.originIata,
          destinationIata: input.destinationIata,
        });
      }

      const result = await deps.providers.flights.search(
        {
          origin,
          destination,
          departureDate: input.departureDate,
          returnDate: input.returnDate,
          adults: input.adults,
          childAges: input.childAges,
          budgetEuros: null,
          preferences: [],
        },
        5,
      );

      if (!result.ok) {
        return result;
      }

      // Bewusst verkuerzt: Das Modell braucht Preis, Zeiten und Fluggesellschaft,
      // nicht jedes Feld des Angebots. Weniger Kontext, weniger Tokens.
      return ok({
        offers: result.value.map((offer) => ({
          id: offer.id,
          priceEuros: Math.round(offer.totalPriceCents / 100),
          carrier: offer.outbound[0]?.carrier ?? 'unbekannt',
          outboundDeparture: offer.outbound[0]?.departureAt ?? null,
          outboundArrival: offer.outbound.at(-1)?.arrivalAt ?? null,
          inboundDeparture: offer.inbound[0]?.departureAt ?? null,
          stops: offer.outbound.length - 1,
          isDemoData: offer.isDemoData,
        })),
      });
    },
  };
}

// --- Unterkunftssuche --------------------------------------------------

const searchHotelsInput = z.object({
  destinationIata: iataCodeSchema.describe('IATA-Code des Zielorts'),
  checkIn: isoDateSchema.describe('Anreisedatum im Format JJJJ-MM-TT'),
  checkOut: isoDateSchema.describe('Abreisedatum im Format JJJJ-MM-TT'),
  guests: z.number().int().min(1).max(12).describe('Gesamtzahl der Gäste'),
});

function searchHotelsTool(deps: ToolDependencies): Tool<z.infer<typeof searchHotelsInput>> {
  return {
    name: 'search_hotels',
    description: [
      'Sucht Unterkünfte am Zielort für einen Zeitraum und liefert die fünf günstigsten.',
      'Preise sind Demo-Werte und müssen als solche benannt werden, wenn sie genannt werden.',
    ].join(' '),
    inputSchema: searchHotelsInput,
    async execute(input) {
      const nights = nightsBetween(input.checkIn, input.checkOut);

      if (nights < 1) {
        return fail('validation_error', 'Das Abreisedatum muss nach dem Anreisedatum liegen', {
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        });
      }

      const placeResult = await deps.providers.geocoding.resolve(input.destinationIata);

      if (!placeResult.ok) {
        return placeResult;
      }

      const destination = placeResult.value.find((p) => p.iataCode === input.destinationIata);

      if (destination === undefined) {
        return fail('not_found', `Unbekannter IATA-Code: ${input.destinationIata}`, {
          destinationIata: input.destinationIata,
        });
      }

      const result = await deps.providers.hotels.search(
        {
          destination,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guests: input.guests,
        },
        5,
      );

      if (!result.ok) {
        return result;
      }

      return ok({
        nights,
        offers: result.value.map((offer) => ({
          id: offer.id,
          name: offer.name,
          stars: offer.stars,
          pricePerNightEuros: Math.round(offer.pricePerNightCents / 100),
          totalEuros: Math.round((offer.pricePerNightCents * nights) / 100),
          distanceToCenterMeters: offer.distanceToCenterMeters,
          isDemoData: offer.isDemoData,
        })),
      });
    },
  };
}

// --- Wetter ------------------------------------------------------------

const weatherInput = z.object({
  destinationIata: iataCodeSchema.describe('IATA-Code des Zielorts'),
  month: z.number().int().min(1).max(12).describe('Reisemonat als Zahl von 1 bis 12'),
});

function weatherTool(deps: ToolDependencies): Tool<z.infer<typeof weatherInput>> {
  return {
    name: 'get_weather_outlook',
    description: [
      'Liefert klimatische Normalwerte für einen Reisemonat: mittlere Höchst- und Tiefstwerte,',
      'Regentage und, an der Küste, die Wassertemperatur.',
      'Keine Tagesvorhersage — beantwortet die Frage „ist es dann dort warm genug?".',
    ].join(' '),
    inputSchema: weatherInput,
    async execute(input) {
      const placeResult = await deps.providers.geocoding.resolve(input.destinationIata);

      if (!placeResult.ok) {
        return placeResult;
      }

      const place = placeResult.value.find((p) => p.iataCode === input.destinationIata);

      if (place === undefined) {
        return fail('not_found', `Unbekannter IATA-Code: ${input.destinationIata}`, {
          destinationIata: input.destinationIata,
        });
      }

      const result = await deps.providers.weather.outlook(place, input.month);

      if (!result.ok) {
        return result;
      }

      return ok({
        month: result.value.month,
        averageHighCelsius: result.value.averageHighCelsius,
        averageLowCelsius: result.value.averageLowCelsius,
        rainyDays: result.value.rainyDays,
        seaTemperatureCelsius: result.value.seaTemperatureCelsius,
        // Damit die Oberflaeche die Quelle nennen kann — und das Modell weiss,
        // ob es von Messwerten oder von Beispielwerten spricht.
        isDemoData: result.value.isDemoData,
      });
    },
  };
}

// --- Zustand lesen und schreiben ---------------------------------------

const placeInput = z.object({
  name: z.string().min(1),
  iataCode: iataCodeSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const updateDraftInput = z.object({
  origin: placeInput.nullish().describe('Abflugort, sobald bekannt'),
  destination: placeInput.nullish().describe('Zielort, sobald bekannt'),
  departureDate: isoDateSchema.nullish().describe('Hinreisedatum JJJJ-MM-TT'),
  returnDate: isoDateSchema.nullish().describe('Rückreisedatum JJJJ-MM-TT'),
  adults: z.number().int().min(1).max(9).nullish(),
  childAges: z.array(z.number().int().min(0).max(17)).max(9).nullish(),
  budgetEuros: z.number().int().positive().nullish().describe('Gesamtbudget der Reise in Euro'),
  preferences: z
    .array(z.string().min(1))
    .max(20)
    .nullish()
    .describe('Wünsche im Klartext, etwa „Strandnähe" oder „ruhige Lage"'),
});

/** Uebernimmt nur die Felder, die der Aufruf tatsaechlich genannt hat. */
/** Entfernt beanstandete Felder aus der Eingabe; der Rest bleibt erhalten. */
function ohneFelder(
  patch: z.infer<typeof updateDraftInput>,
  felder: ReadonlySet<string>,
): z.infer<typeof updateDraftInput> {
  return Object.fromEntries(Object.entries(patch).filter(([feld]) => !felder.has(feld)));
}

function mergeDraft(current: TripDraft, patch: z.infer<typeof updateDraftInput>): TripDraft {
  return {
    ...current,
    ...(patch.origin === undefined || patch.origin === null ? {} : { origin: patch.origin }),
    ...(patch.destination === undefined || patch.destination === null
      ? {}
      : { destination: patch.destination }),
    ...(patch.departureDate === undefined || patch.departureDate === null
      ? {}
      : { departureDate: patch.departureDate }),
    ...(patch.returnDate === undefined || patch.returnDate === null
      ? {}
      : { returnDate: patch.returnDate }),
    ...(patch.adults === undefined || patch.adults === null ? {} : { adults: patch.adults }),
    ...(patch.childAges === undefined || patch.childAges === null
      ? {}
      : { childAges: patch.childAges }),
    ...(patch.budgetEuros === undefined || patch.budgetEuros === null
      ? {}
      : { budgetEuros: patch.budgetEuros }),
    ...(patch.preferences === undefined || patch.preferences === null
      ? {}
      : { preferences: patch.preferences }),
  };
}

function updateDraftTool(deps: ToolDependencies): Tool<z.infer<typeof updateDraftInput>> {
  return {
    name: 'update_trip_draft',
    description: [
      'Schreibt bekannte Reiseparameter in den Reise-Entwurf.',
      'Sobald aus dem Gespräch eine Angabe hervorgeht — Ziel, Datum, Reisendenzahl, Budget —',
      'sofort hier festhalten, auch wenn noch andere Angaben fehlen.',
      'Nur die Felder angeben, die wirklich bekannt sind; nicht genannte Felder bleiben unverändert.',
      'Die Antwort nennt, welche Pflichtangaben noch fehlen.',
    ].join(' '),
    inputSchema: updateDraftInput,
    async execute(input, context) {
      const current = await deps.tripDrafts.findByConversation(context.conversationId);

      if (current === null) {
        return fail('not_found', 'Zu diesem Gespräch existiert kein Reise-Entwurf', {
          conversationId: context.conversationId,
        });
      }

      /*
       * Eine beanstandete Angabe darf die uebrigen nicht mitreissen.
       *
       * Vorher lehnte die Pruefung den ganzen Entwurf ab, sobald ein Feld
       * nicht passte: Wer „von Bremen nach Malaga am 2020-05-01" sagte,
       * verlor mit dem vergangenen Datum auch Abflugort und Ziel. Jetzt wird
       * nur das beanstandete Feld verworfen — und ausdruecklich benannt,
       * damit das Modell es ansprechen kann, statt es zu verschweigen.
       */
      const geprueft = tripDraftSchema.safeParse(mergeDraft(current, input));

      const abgelehnt = geprueft.success
        ? []
        : geprueft.error.issues.map((issue) => ({
            feld: String(issue.path[0] ?? 'unbekannt'),
            grund: issue.message,
          }));

      const bereinigt = geprueft.success
        ? geprueft.data
        : mergeDraft(current, ohneFelder(input, new Set(abgelehnt.map((eintrag) => eintrag.feld))));

      const saved = await deps.tripDrafts.save(context.conversationId, bereinigt);

      if (!saved.ok) {
        return saved;
      }

      const missing = missingSlots(saved.value);

      return ok({
        draft: saved.value,
        missing,
        readyToSearch: missing.length === 0,
        ...(abgelehnt.length === 0 ? {} : { abgelehnt }),
      });
    },
  };
}

function getDraftTool(deps: ToolDependencies): Tool<Record<string, never>> {
  return {
    name: 'get_trip_draft',
    description: [
      'Liest den aktuellen Reise-Entwurf samt der noch fehlenden Pflichtangaben.',
      'Nützlich, um vor einer Suche zu prüfen, ob alle nötigen Angaben vorliegen.',
    ].join(' '),
    inputSchema: z.object({}),
    async execute(_input, context) {
      const draft = await deps.tripDrafts.findByConversation(context.conversationId);

      if (draft === null) {
        return fail('not_found', 'Zu diesem Gespräch existiert kein Reise-Entwurf', {
          conversationId: context.conversationId,
        });
      }

      const missing = missingSlots(draft);

      return ok({ draft, missing, readyToSearch: missing.length === 0 });
    },
  };
}

// --- Registry ----------------------------------------------------------

export function createToolRegistry(deps: ToolDependencies): ToolRegistry {
  return createRegistry([
    resolveDestinationTool(deps),
    searchFlightsTool(deps),
    searchHotelsTool(deps),
    weatherTool(deps),
    updateDraftTool(deps),
    getDraftTool(deps),
  ] as Tool[]);
}

export type { Result };
