import type { GeocodingPort, WeatherPort } from '@/domain/ports/providers';
import type { WeatherOutlook } from '@/domain/offers';
import type { Place } from '@/domain/trip/trip';
import { fail, ok, type Result } from '@/domain/result';
import { findByIata, searchCatalog, type CatalogEntry } from './catalog';
import { seededInt } from './deterministic';

/** Ortsaufloesung und Klimawerte aus dem Seed-Katalog. */

function toPlace(entry: CatalogEntry): Place {
  return {
    name: entry.name,
    iataCode: entry.iataCode,
    latitude: entry.latitude,
    longitude: entry.longitude,
  };
}

export function createSeedGeocoding(): GeocodingPort {
  return {
    resolve(freeText: string): Promise<Result<Place[]>> {
      const trimmed = freeText.trim();

      if (trimmed.length === 0) {
        return Promise.resolve(
          fail('validation_error', 'Der Suchbegriff darf nicht leer sein', { freeText }),
        );
      }

      const matches = searchCatalog(trimmed);

      if (matches.length === 0) {
        return Promise.resolve(
          fail('not_found', `Kein Ort zu „${trimmed}" gefunden`, { freeText: trimmed }),
        );
      }

      return Promise.resolve(ok(matches.map(toPlace)));
    },
  };
}

/**
 * Klimawerte werden aus der geografischen Breite und dem Monat berechnet.
 *
 * Das ist kein Wettermodell, sondern eine bewusst einfache Naeherung: Je
 * noerdlicher, desto kuehler; Sommer waermer als Winter; Kuestenorte haben
 * eine Wassertemperatur. Sie genuegt, um die Frage „ist es dann dort warm
 * genug?" plausibel zu beantworten, und ist vollstaendig deterministisch.
 */
function climateFor(entry: CatalogEntry, month: number): WeatherOutlook {
  // Jahresgang: Maximum im Juli, Minimum im Januar.
  const seasonal = Math.cos(((month - 7) / 12) * 2 * Math.PI);
  const latitudePenalty = (entry.latitude - 35) * 0.75;

  const averageHigh = Math.round((30 - latitudePenalty + seasonal * 8) * 10) / 10;
  const averageLow = Math.round((averageHigh - 8 - (1 - seasonal) * 1.5) * 10) / 10;

  const rainSeed = `${entry.iataCode}|${String(month)}`;
  const baseRainyDays = entry.coastal ? 4 : 9;
  const rainyDays = Math.min(
    31,
    baseRainyDays + Math.round((1 - seasonal) * 4) + seededInt(rainSeed, 0, 4),
  );

  const seaTemperatureCelsius = entry.coastal
    ? Math.round((averageHigh - 4 - (1 - seasonal) * 2) * 10) / 10
    : null;

  return {
    place: toPlace(entry),
    month,
    averageHighCelsius: averageHigh,
    averageLowCelsius: averageLow,
    rainyDays,
    seaTemperatureCelsius,
    isDemoData: true,
  };
}

export function createSeedWeather(): WeatherPort {
  return {
    outlook(place: Place, month: number): Promise<Result<WeatherOutlook>> {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return Promise.resolve(
          fail('validation_error', 'Der Monat muss zwischen 1 und 12 liegen', { month }),
        );
      }

      const entry = findByIata(place.iataCode);

      if (entry === undefined) {
        return Promise.resolve(
          fail('not_found', `Für ${place.iataCode} liegen keine Klimawerte vor`, {
            iataCode: place.iataCode,
          }),
        );
      }

      return Promise.resolve(ok(climateFor(entry, month)));
    },
  };
}
