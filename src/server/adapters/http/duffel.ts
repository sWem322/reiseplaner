import { z } from 'zod';
import type { FlightSearchPort } from '@/domain/ports/providers';
import type { FlightOffer, FlightSegment } from '@/domain/offers';
import type { Place, TripQuery } from '@/domain/trip/trip';
import { fail, ok, type Result } from '@/domain/result';
import { fetchJson } from './fetch-json';

/**
 * Duffel im Testmodus.
 *
 * Der Ablauf ist zweistufig und damit ein gutes Beispiel dafuer, warum
 * Anbieter hinter einem Port verschwinden sollten: Erst wird eine
 * Angebotsanfrage erzeugt, dann liegen die Angebote vor. Die Domaene sieht
 * davon nichts — sie ruft `search` auf und bekommt eine sortierte Liste.
 *
 * Im Testmodus antwortet nur die Fluggesellschaft "Duffel Airways" mit
 * unrealistischen Preisen und Verbindungen. Deshalb bleibt `isDemoData` auf
 * true, obwohl die Schnittstelle echt ist.
 */

const PROVIDER = 'Duffel';
const API_URL = 'https://api.duffel.com/air/offer_requests';
const API_VERSION = 'v2';
const TIMEOUT_MS = 20_000;

const segmentSchema = z.object({
  origin: z.object({ iata_code: z.string().nullable(), name: z.string().nullable() }),
  destination: z.object({ iata_code: z.string().nullable(), name: z.string().nullable() }),
  departing_at: z.string(),
  arriving_at: z.string(),
  marketing_carrier: z.object({ name: z.string(), iata_code: z.string().nullable() }),
  marketing_carrier_flight_number: z.string().nullable(),
});

const sliceSchema = z.object({
  segments: z.array(segmentSchema),
});

const offerSchema = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  slices: z.array(sliceSchema),
});

const offerRequestResponseSchema = z.object({
  data: z.object({
    offers: z.array(offerSchema),
  }),
});

/** Duffel liefert Betraege als Zeichenkette wie "234.56". */
function toCents(amount: string): number | null {
  const parsed = Number.parseFloat(amount);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Duffel nennt Orte nur mit IATA-Code, ohne Koordinaten. Die Domaene verlangt
 * beides, deshalb werden die bekannten Orte der Anfrage wiederverwendet.
 */
function resolveSegmentPlace(iataCode: string | null, known: readonly Place[]): Place | null {
  if (iataCode === null) {
    return null;
  }

  return known.find((place) => place.iataCode === iataCode) ?? null;
}

function toSegments(
  slice: z.infer<typeof sliceSchema>,
  known: readonly Place[],
): FlightSegment[] | null {
  const segments: FlightSegment[] = [];

  for (const segment of slice.segments) {
    const from = resolveSegmentPlace(segment.origin.iata_code, known);
    const to = resolveSegmentPlace(segment.destination.iata_code, known);

    if (from === null || to === null) {
      // Ein Zwischenstopp an einem unbekannten Flughafen laesst sich nicht
      // vollstaendig abbilden — das Angebot wird uebersprungen statt mit
      // erfundenen Koordinaten gefuellt.
      return null;
    }

    segments.push({
      from,
      to,
      departureAt: segment.departing_at,
      arrivalAt: segment.arriving_at,
      carrier: segment.marketing_carrier.name,
      flightNumber: `${segment.marketing_carrier.iata_code ?? ''}${segment.marketing_carrier_flight_number ?? '000'}`,
    });
  }

  return segments.length > 0 ? segments : null;
}

export function createDuffelFlightSearch(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): FlightSearchPort {
  return {
    async search(query: TripQuery, limit: number): Promise<Result<FlightOffer[]>> {
      const passengers = [
        ...Array.from({ length: query.adults }, () => ({ type: 'adult' as const })),
        ...query.childAges.map((age) => ({ age })),
      ];

      const response = await fetchJson(
        {
          url: `${API_URL}?return_offers=true`,
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Duffel-Version': API_VERSION,
          },
          body: {
            data: {
              slices: [
                {
                  origin: query.origin.iataCode,
                  destination: query.destination.iataCode,
                  departure_date: query.departureDate,
                },
                {
                  origin: query.destination.iataCode,
                  destination: query.origin.iataCode,
                  departure_date: query.returnDate,
                },
              ],
              passengers,
              cabin_class: 'economy',
            },
          },
          timeoutMs: TIMEOUT_MS,
          provider: PROVIDER,
        },
        offerRequestResponseSchema,
        fetchImpl,
      );

      if (!response.ok) {
        return response;
      }

      const known: readonly Place[] = [query.origin, query.destination];
      const offers: FlightOffer[] = [];

      /*
       * Welche Waehrungen kamen zurueck, obwohl EUR erwartet wurde?
       *
       * Duffel richtet sich nach der Standardwaehrung des Kontos, und die
       * steht bei einem frischen Konto oft auf GBP. Ohne diese Sammlung
       * verschwaende jedes Angebot stillschweigend im `continue`, und die
       * Anwendung meldete nur „keine verwertbaren Angebote" — eine Aussage,
       * aus der niemand ableiten kann, dass eine Einstellung im Dashboard
       * fehlt.
       */
      const fremdeWaehrungen = new Set<string>();

      for (const raw of response.value.data.offers) {
        if (raw.total_currency !== 'EUR') {
          // Waehrungsumrechnung ist ausdruecklich nicht Teil dieses Projekts.
          fremdeWaehrungen.add(raw.total_currency);
          continue;
        }

        const cents = toCents(raw.total_amount);
        const outboundSlice = raw.slices[0];
        const inboundSlice = raw.slices[1];

        if (cents === null || outboundSlice === undefined || inboundSlice === undefined) {
          continue;
        }

        const outbound = toSegments(outboundSlice, known);
        const inbound = toSegments(inboundSlice, known);

        if (outbound === null || inbound === null) {
          continue;
        }

        offers.push({
          id: raw.id,
          outbound,
          inbound,
          totalPriceCents: cents,
          currency: 'EUR',
          // Der Testmodus liefert nur die fiktive Duffel Airways.
          isDemoData: true,
        });
      }

      if (offers.length === 0 && fremdeWaehrungen.size > 0) {
        const genannt = [...fremdeWaehrungen].sort().join(', ');

        return fail(
          'upstream_error',
          `${PROVIDER} lieferte Angebote in ${genannt} statt in EUR. ` +
            'Die Standardwährung des Duffel-Kontos steht nicht auf EUR — ' +
            'im Dashboard unter Settings umstellen. Umrechnung leistet dieses Projekt nicht.',
          { waehrungen: [...fremdeWaehrungen] },
        );
      }

      if (offers.length === 0 && response.value.data.offers.length > 0) {
        return fail('upstream_error', `${PROVIDER} lieferte keine verwertbaren Angebote`, {
          received: response.value.data.offers.length,
        });
      }

      const sorted = offers
        .sort((a, b) => a.totalPriceCents - b.totalPriceCents || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, limit));

      return ok(sorted);
    },
  };
}
