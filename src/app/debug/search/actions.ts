'use server';

import { z } from 'zod';
import type { FlightOffer, HotelOffer, WeatherOutlook } from '@/domain/offers';
import { createSeedProviders } from '@/server/adapters/factory';

/**
 * Server-Aktionen der Schaufensterseite.
 *
 * Bewusst gegen die Seed-Implementierungen: Die Seite soll ohne Netzwerk und
 * ohne Zugangsdaten funktionieren. Sie ist ein Werkzeug zum Anschauen des
 * Etappenergebnisses, kein Teil des spaeteren Produkts — mit Etappe 5
 * verschwindet sie wieder.
 */

const searchInputSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(9),
});

export interface SearchResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly originName?: string;
  readonly destinationName?: string;
  readonly flights?: FlightOffer[];
  readonly hotels?: HotelOffer[];
  readonly weather?: WeatherOutlook;
}

export async function runSearch(formData: FormData): Promise<SearchResult> {
  const parsed = searchInputSchema.safeParse({
    origin: formData.get('origin'),
    destination: formData.get('destination'),
    departureDate: formData.get('departureDate'),
    returnDate: formData.get('returnDate'),
    adults: formData.get('adults'),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Bitte alle Felder ausfüllen.' };
  }

  const providers = createSeedProviders();
  const input = parsed.data;

  const originResult = await providers.geocoding.resolve(input.origin);

  if (!originResult.ok) {
    return { ok: false, message: `Abflugort: ${originResult.error.message}` };
  }

  const destinationResult = await providers.geocoding.resolve(input.destination);

  if (!destinationResult.ok) {
    return { ok: false, message: `Ziel: ${destinationResult.error.message}` };
  }

  const origin = originResult.value[0];
  const destination = destinationResult.value[0];

  if (origin === undefined || destination === undefined) {
    return { ok: false, message: 'Orte konnten nicht aufgelöst werden.' };
  }

  if (origin.iataCode === destination.iataCode) {
    return { ok: false, message: 'Abflug- und Zielort müssen sich unterscheiden.' };
  }

  const query = {
    origin,
    destination,
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.adults,
    childAges: [],
    budgetEuros: null,
    preferences: [],
  };

  const [flightsResult, hotelsResult, weatherResult] = await Promise.all([
    providers.flights.search(query, 5),
    providers.hotels.search(
      {
        destination,
        checkIn: input.departureDate,
        checkOut: input.returnDate,
        guests: input.adults,
      },
      5,
    ),
    providers.weather.outlook(destination, Number.parseInt(input.departureDate.slice(5, 7), 10)),
  ]);

  if (!flightsResult.ok) {
    return { ok: false, message: `Flugsuche: ${flightsResult.error.message}` };
  }

  return {
    ok: true,
    originName: origin.name,
    destinationName: destination.name,
    flights: flightsResult.value,
    hotels: hotelsResult.ok ? hotelsResult.value : [],
    ...(weatherResult.ok ? { weather: weatherResult.value } : {}),
  };
}
