import type { HotelSearchInput, HotelSearchPort } from '@/domain/ports/providers';
import type { HotelOffer } from '@/domain/offers';
import { nightsBetween } from '@/domain/offers';
import { fail, ok, type Result } from '@/domain/result';
import { findByIata } from './catalog';
import { distanceMeters, seededFraction, seededInt } from './deterministic';

/** Unterkunftssuche auf Seed-Daten, deterministisch aus Ort und Zeitraum. */

const HOTEL_NAMES = [
  'Hotel Playa',
  'Residenz am Hafen',
  'Casa del Sol',
  'Strandhotel Aurora',
  'Villa Serena',
  'Hotel Central',
  'Parkhotel Miramar',
  'Aparthotel Brisa',
] as const;

const HOTELS_PER_DESTINATION = 6;

export function createSeedHotelSearch(): HotelSearchPort {
  return {
    search(input: HotelSearchInput, limit: number): Promise<Result<HotelOffer[]>> {
      const nights = nightsBetween(input.checkIn, input.checkOut);

      if (nights < 1) {
        return Promise.resolve(
          fail('validation_error', 'Der Aufenthalt muss mindestens eine Nacht umfassen', {
            checkIn: input.checkIn,
            checkOut: input.checkOut,
          }),
        );
      }

      if (input.guests < 1) {
        return Promise.resolve(
          fail('validation_error', 'Mindestens eine reisende Person erwartet', {
            guests: input.guests,
          }),
        );
      }

      const entry = findByIata(input.destination.iataCode);

      if (entry === undefined) {
        return Promise.resolve(
          fail('not_found', `Für ${input.destination.iataCode} liegen keine Unterkünfte vor`, {
            iataCode: input.destination.iataCode,
          }),
        );
      }

      const month = Number.parseInt(input.checkIn.slice(5, 7), 10);
      const highSeason = month >= 6 && month <= 9;

      const offers: HotelOffer[] = Array.from(
        { length: HOTELS_PER_DESTINATION },
        (_unused, index) => {
          const seed = `${entry.iataCode}|${input.checkIn}|${String(index)}`;
          const name = HOTEL_NAMES[index % HOTEL_NAMES.length] ?? HOTEL_NAMES[0];
          const stars = 2 + seededInt(`${seed}|stars`, 0, 4);

          // Lage im Umkreis des Ortszentrums, deterministisch gestreut.
          const angle = seededFraction(`${seed}|angle`) * 2 * Math.PI;
          const radiusMeters = 300 + seededInt(`${seed}|radius`, 0, 6_000);
          const latitude = entry.latitude + (radiusMeters / 111_000) * Math.cos(angle);
          const longitude =
            entry.longitude +
            (radiusMeters / (111_000 * Math.cos((entry.latitude * Math.PI) / 180))) *
              Math.sin(angle);

          const basePerNight = 3_500 + stars * 2_200;
          const seasonFactor = highSeason ? 1.4 : 1;
          const guestFactor = 1 + (input.guests - 1) * 0.35;
          const spread = 0.9 + seededFraction(`${seed}|price`) * 0.5;

          return {
            id: `seed-hotel-${entry.iataCode}-${String(index)}`,
            name: `${name} ${entry.name}`,
            latitude,
            longitude,
            stars,
            pricePerNightCents: Math.round(basePerNight * seasonFactor * guestFactor * spread),
            currency: 'EUR' as const,
            distanceToCenterMeters: distanceMeters(entry, { latitude, longitude }),
            isDemoData: true,
          };
        },
      );

      const sorted = offers
        .sort((a, b) => a.pricePerNightCents - b.pricePerNightCents || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, limit));

      return Promise.resolve(ok(sorted));
    },
  };
}
