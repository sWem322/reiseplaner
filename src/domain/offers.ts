import { z } from 'zod';
import { isoDateSchema, placeSchema } from './trip/trip';

/**
 * Was ein Anbieter zurueckliefert — in der Form, die dieses Projekt braucht.
 *
 * Bewusst schlanker als jede Anbieter-Antwort: Ein Duffel-Angebot hat ueber
 * hundert Felder. Alles davon durchzureichen wuerde die Domaene an die
 * Datenstruktur eines Anbieters binden, den es morgen nicht mehr geben muss.
 */

// --- Flug --------------------------------------------------------------

export const flightSegmentSchema = z.object({
  from: placeSchema,
  to: placeSchema,
  /** Abflug in lokaler Zeit des Startorts, ISO 8601 mit Zeitzone. */
  departureAt: z.iso.datetime({ offset: true }),
  arrivalAt: z.iso.datetime({ offset: true }),
  carrier: z.string().min(1),
  flightNumber: z.string().min(1),
});

export type FlightSegment = z.infer<typeof flightSegmentSchema>;

export const flightOfferSchema = z.object({
  id: z.string().min(1),
  outbound: z.array(flightSegmentSchema).min(1),
  inbound: z.array(flightSegmentSchema).min(1),
  /**
   * Gesamtpreis fuer alle Reisenden in Cent.
   *
   * Cent statt Euro als Kommazahl: Gleitkommazahlen addieren sich nicht exakt,
   * und Preise werden summiert und mit einem Budget verglichen.
   */
  totalPriceCents: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
  /** Kennzeichnet Angebote aus Seed-Daten, damit die Oberflaeche sie ausweisen kann. */
  isDemoData: z.boolean(),
});

export type FlightOffer = z.infer<typeof flightOfferSchema>;

export function pricePerPerson(offer: FlightOffer, travelers: number): number {
  if (travelers < 1) {
    throw new Error('Mindestens eine reisende Person erwartet');
  }

  return Math.round(offer.totalPriceCents / travelers);
}

/** Gesamtdauer der Hinreise in Minuten, inklusive Umsteigezeiten. */
export function outboundDurationMinutes(offer: FlightOffer): number {
  const first = offer.outbound[0];
  const last = offer.outbound[offer.outbound.length - 1];

  if (first === undefined || last === undefined) {
    return 0;
  }

  const start = Date.parse(first.departureAt);
  const end = Date.parse(last.arrivalAt);

  return Math.round((end - start) / 60_000);
}

export function isDirectFlight(offer: FlightOffer): boolean {
  return offer.outbound.length === 1 && offer.inbound.length === 1;
}

// --- Unterkunft --------------------------------------------------------

export const hotelOfferSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Sterne, sofern der Anbieter sie kennt. */
  stars: z.number().int().min(1).max(5).nullable(),
  /** Preis pro Nacht fuer die gesamte Gruppe, in Cent. */
  pricePerNightCents: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
  /** Luftlinie zum Ortszentrum in Metern, sofern berechenbar. */
  distanceToCenterMeters: z.number().int().nonnegative().nullable(),
  isDemoData: z.boolean(),
});

export type HotelOffer = z.infer<typeof hotelOfferSchema>;

export function totalStayPriceCents(offer: HotelOffer, nights: number): number {
  if (nights < 1) {
    throw new Error('Mindestens eine Uebernachtung erwartet');
  }

  return offer.pricePerNightCents * nights;
}

// --- Wetter ------------------------------------------------------------

export const weatherOutlookSchema = z.object({
  place: placeSchema,
  /** Monat der Reise, 1–12. */
  month: z.number().int().min(1).max(12),
  averageHighCelsius: z.number(),
  averageLowCelsius: z.number(),
  /** Mittlere Zahl der Regentage im Monat. */
  rainyDays: z.number().int().min(0).max(31),
  /** Wassertemperatur, sofern der Ort am Meer liegt. */
  seaTemperatureCelsius: z.number().nullable(),
  isDemoData: z.boolean(),
});

export type WeatherOutlook = z.infer<typeof weatherOutlookSchema>;

// --- Gemeinsames -------------------------------------------------------

export const nightsBetween = (checkIn: string, checkOut: string): number => {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  return Math.max(0, Math.round((end - start) / 86_400_000));
};

export const dateRangeSchema = z
  .object({
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
  })
  .refine(({ checkIn, checkOut }) => nightsBetween(checkIn, checkOut) >= 1, {
    message: 'Der Aufenthalt muss mindestens eine Nacht umfassen',
    path: ['checkOut'],
  });

export type DateRange = z.infer<typeof dateRangeSchema>;
