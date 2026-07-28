import type { FlightSearchPort } from '@/domain/ports/providers';
import type { FlightOffer, FlightSegment } from '@/domain/offers';
import type { Place, TripQuery } from '@/domain/trip/trip';
import { ok, type Result } from '@/domain/result';
import { findByIata } from './catalog';
import { addMinutes, distanceMeters, flightMinutes, isoDateTime, seededInt } from './deterministic';

/**
 * Flugsuche auf Seed-Daten.
 *
 * Alle Werte werden aus Strecke, Datum und Reisendenzahl abgeleitet — nie
 * zufaellig gezogen. Dieselbe Anfrage ergibt damit immer dieselben Angebote,
 * was E2E-Tests und die Demo reproduzierbar macht.
 */

const CARRIERS = [
  { name: 'Demo Air', code: 'DA' },
  { name: 'Musterflug', code: 'MF' },
  { name: 'Beispiel Airways', code: 'BA' },
  { name: 'Testjet', code: 'TJ' },
] as const;

/** Strecken, auf denen bewusst nichts fliegt — fuer den Testfall "keine Verbindung". */
const ROUTES_WITHOUT_SERVICE: readonly string[] = ['DRS-TFS', 'FMO-RHO', 'FKB-IST'];

const OFFERS_PER_ROUTE = 5;

function routeKey(origin: Place, destination: Place): string {
  return `${origin.iataCode}-${destination.iataCode}`;
}

function hasService(origin: Place, destination: Place): boolean {
  return !ROUTES_WITHOUT_SERVICE.includes(routeKey(origin, destination));
}

/**
 * Preis in Cent, abgeleitet aus Entfernung, Reisezeitpunkt und Angebotsindex.
 *
 * Die Formel bildet grob nach, was reale Preise ausmacht: Grundpreis nach
 * Entfernung, Aufschlag in der Hauptsaison, Aufschlag fuer kurzfristige
 * Buchung, Streuung zwischen den Angeboten.
 */
function priceCents(query: TripQuery, meters: number, index: number): number {
  const base = 4_500 + Math.round(meters / 1_000) * 22;

  const month = Number.parseInt(query.departureDate.slice(5, 7), 10);
  const highSeason = month >= 6 && month <= 9;
  const seasonFactor = highSeason ? 1.35 : 1;

  const daysUntilDeparture = Math.round(
    (Date.parse(`${query.departureDate}T00:00:00Z`) - Date.now()) / 86_400_000,
  );
  const shortNoticeFactor = daysUntilDeparture < 21 ? 1.25 : 1;

  const seed = `${routeKey(query.origin, query.destination)}|${query.departureDate}|${String(index)}`;
  const spread = 0.85 + (seededInt(seed, 0, 45) / 100) * 1.4;

  const perPerson = Math.round(base * seasonFactor * shortNoticeFactor * spread);
  const travelers = query.adults + query.childAges.length;
  const childDiscount = query.childAges.reduce(
    (sum, age) => sum + (age < 12 ? Math.round(perPerson * 0.25) : 0),
    0,
  );

  return Math.max(2_900, perPerson * travelers - childDiscount);
}

function buildSegment(
  from: Place,
  to: Place,
  date: string,
  departureHour: number,
  index: number,
): FlightSegment {
  const meters = distanceMeters(from, to);
  const duration = flightMinutes(meters);
  const carrier = CARRIERS[index % CARRIERS.length] ?? CARRIERS[0];
  const departureAt = isoDateTime(date, departureHour, (index * 5) % 60, 2);
  const flightNumber = `${carrier.code}${String(1_000 + seededInt(`${from.iataCode}${to.iataCode}${String(index)}`, 0, 8_999))}`;

  return {
    from,
    to,
    departureAt,
    arrivalAt: addMinutes(departureAt, duration),
    carrier: carrier.name,
    flightNumber,
  };
}

export function createSeedFlightSearch(): FlightSearchPort {
  return {
    search(query: TripQuery, limit: number): Promise<Result<FlightOffer[]>> {
      if (!hasService(query.origin, query.destination)) {
        // Keine Verbindung ist ein gueltiges Ergebnis, kein Fehler.
        return Promise.resolve(ok([]));
      }

      const meters = distanceMeters(query.origin, query.destination);

      const offers: FlightOffer[] = Array.from({ length: OFFERS_PER_ROUTE }, (_unused, index) => {
        const outboundHour = 6 + ((index * 3) % 12);
        const inboundHour = 11 + ((index * 2) % 9);

        return {
          id: `seed-${routeKey(query.origin, query.destination)}-${query.departureDate}-${String(index)}`,
          outbound: [
            buildSegment(query.origin, query.destination, query.departureDate, outboundHour, index),
          ],
          inbound: [
            buildSegment(query.destination, query.origin, query.returnDate, inboundHour, index + 7),
          ],
          totalPriceCents: priceCents(query, meters, index),
          currency: 'EUR' as const,
          isDemoData: true,
        };
      });

      const sorted = offers
        .sort((a, b) => a.totalPriceCents - b.totalPriceCents || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, limit));

      return Promise.resolve(ok(sorted));
    },
  };
}

export { findByIata };
