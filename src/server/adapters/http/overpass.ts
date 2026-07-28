import { z } from 'zod';
import type { HotelSearchInput, HotelSearchPort } from '@/domain/ports/providers';
import type { HotelOffer } from '@/domain/offers';
import { nightsBetween } from '@/domain/offers';
import { fail, ok, type Result } from '@/domain/result';
import { distanceMeters, seededFraction, seededInt } from '../seed/deterministic';
import { fetchJson } from './fetch-json';

/**
 * Unterkuenfte aus OpenStreetMap ueber die Overpass-Schnittstelle.
 *
 * Ohne Schluessel, ohne Registrierung, weltweit. Der Haken: OpenStreetMap
 * kennt Haeuser, aber keine Preise. Die Namen, Sterne und Koordinaten sind
 * damit echt, der Preis ist es nicht.
 *
 * Deshalb bleibt `isDemoData` auf true, und die Preise werden deterministisch
 * aus Objekt und Zeitraum abgeleitet. Erfundene Preise als echte auszugeben
 * waere irrefuehrend — insbesondere in einer Demo, die jemand als
 * Arbeitsprobe liest.
 */

const PROVIDER = 'Overpass';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Overpass ist ein geteilter, freiwillig betriebener Dienst — grosszuegiger Zeitrahmen. */
const TIMEOUT_MS = 25_000;
const SEARCH_RADIUS_METERS = 12_000;

const overpassResponseSchema = z.object({
  elements: z.array(
    z.object({
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

function parseStars(tags: Record<string, string> | undefined): number | null {
  const raw = tags?.stars;

  if (raw === undefined) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

export function createOverpassHotelSearch(fetchImpl: typeof fetch = fetch): HotelSearchPort {
  return {
    async search(input: HotelSearchInput, limit: number): Promise<Result<HotelOffer[]>> {
      if (nightsBetween(input.checkIn, input.checkOut) < 1) {
        return fail('validation_error', 'Der Aufenthalt muss mindestens eine Nacht umfassen', {
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        });
      }

      if (input.guests < 1) {
        return fail('validation_error', 'Mindestens eine reisende Person erwartet', {
          guests: input.guests,
        });
      }

      const { latitude, longitude } = input.destination;
      const query = `
        [out:json][timeout:20];
        (
          node["tourism"="hotel"]["name"](around:${String(SEARCH_RADIUS_METERS)},${String(latitude)},${String(longitude)});
          way["tourism"="hotel"]["name"](around:${String(SEARCH_RADIUS_METERS)},${String(latitude)},${String(longitude)});
        );
        out center ${String(Math.max(limit * 3, 30))};
      `;

      const response = await fetchJson(
        {
          url: OVERPASS_URL,
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: undefined,
          timeoutMs: TIMEOUT_MS,
          provider: PROVIDER,
        },
        overpassResponseSchema,
        // Overpass erwartet die Abfrage als Formularfeld, nicht als JSON.
        async (url, init) =>
          fetchImpl(url, {
            ...init,
            body: new URLSearchParams({ data: query }).toString(),
          }),
      );

      if (!response.ok) {
        return response;
      }

      const month = Number.parseInt(input.checkIn.slice(5, 7), 10);
      const highSeason = month >= 6 && month <= 9;

      const offers: HotelOffer[] = [];

      for (const element of response.value.elements) {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        const name = element.tags?.name;

        if (lat === undefined || lon === undefined || name === undefined) {
          continue;
        }

        const stars = parseStars(element.tags);
        const seed = `osm-${String(element.id)}|${input.checkIn}`;

        // Preis aus Sternen, Saison und Gruppengroesse — deterministisch, aber
        // ausdruecklich als Demo-Wert gekennzeichnet.
        const basePerNight = 3_500 + (stars ?? seededInt(`${seed}|stars`, 2, 5)) * 2_200;
        const seasonFactor = highSeason ? 1.4 : 1;
        const guestFactor = 1 + (input.guests - 1) * 0.35;
        const spread = 0.9 + seededFraction(`${seed}|price`) * 0.5;

        offers.push({
          id: `osm-${String(element.id)}`,
          name,
          latitude: lat,
          longitude: lon,
          stars,
          pricePerNightCents: Math.round(basePerNight * seasonFactor * guestFactor * spread),
          currency: 'EUR',
          distanceToCenterMeters: distanceMeters(input.destination, {
            latitude: lat,
            longitude: lon,
          }),
          // Haus und Lage sind echt, der Preis ist es nicht.
          isDemoData: true,
        });
      }

      const sorted = offers
        .sort((a, b) => a.pricePerNightCents - b.pricePerNightCents || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, limit));

      return ok(sorted);
    },
  };
}
