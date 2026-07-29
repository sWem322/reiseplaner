import { z } from 'zod';
import type { GeocodingPort, WeatherPort } from '@/domain/ports/providers';
import type { WeatherOutlook } from '@/domain/offers';
import type { Place } from '@/domain/trip/trip';
import { fail, ok, type Result } from '@/domain/result';
import { CATALOG } from '../seed/catalog';
import { distanceMeters } from '../seed/deterministic';
import { fetchJson } from './fetch-json';

/**
 * Open-Meteo: Ortssuche und Klimadaten, ohne Schluessel und ohne Registrierung.
 *
 * Zwei Eigenheiten, die den Adapter praegen:
 *
 * 1. Open-Meteo kennt keine IATA-Codes. Die Domaene braucht sie aber, weil
 *    Flugsuchen darauf laufen. Deshalb wird jeder Treffer dem naechstgelegenen
 *    Flughafen aus dem Katalog zugeordnet; ohne Flughafen in der Naehe faellt
 *    der Treffer weg.
 * 2. Die Archiv-Schnittstelle liefert Tageswerte. Klimatische Normalwerte
 *    entstehen daraus durch Mittelung ueber mehrere Jahre.
 */

const PROVIDER = 'Open-Meteo';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/** Ein Treffer zaehlt nur, wenn ein bekannter Flughafen in dieser Entfernung liegt. */
const MAX_AIRPORT_DISTANCE_METERS = 150_000;

const geocodingResponseSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country_code: z.string().optional(),
      }),
    )
    .optional(),
});

const archiveResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

/** Naechstgelegener Flughafen aus dem Katalog, sofern nah genug. */
function nearestAirport(latitude: number, longitude: number): string | null {
  let best: { iataCode: string; distance: number } | null = null;

  for (const entry of CATALOG) {
    const distance = distanceMeters({ latitude, longitude }, entry);

    if (best === null || distance < best.distance) {
      best = { iataCode: entry.iataCode, distance };
    }
  }

  return best !== null && best.distance <= MAX_AIRPORT_DISTANCE_METERS ? best.iataCode : null;
}

export function createOpenMeteoGeocoding(fetchImpl: typeof fetch = fetch): GeocodingPort {
  return {
    async resolve(freeText: string): Promise<Result<Place[]>> {
      const trimmed = freeText.trim();

      if (trimmed.length === 0) {
        return fail('validation_error', 'Der Suchbegriff darf nicht leer sein', { freeText });
      }

      const url = `${GEOCODING_URL}?name=${encodeURIComponent(trimmed)}&count=5&language=de&format=json`;
      const response = await fetchJson(
        { url, provider: PROVIDER },
        geocodingResponseSchema,
        fetchImpl,
      );

      if (!response.ok) {
        return response;
      }

      const results = response.value.results ?? [];
      const places: Place[] = [];

      for (const result of results) {
        const iataCode = nearestAirport(result.latitude, result.longitude);

        if (iataCode !== null) {
          places.push({
            name: result.name,
            iataCode,
            latitude: result.latitude,
            longitude: result.longitude,
          });
        }
      }

      if (places.length === 0) {
        return fail('not_found', `Kein Ort mit Flughafen zu „${trimmed}" gefunden`, {
          freeText: trimmed,
        });
      }

      return ok(places);
    },
  };
}

/** Mittelwert einer Liste, `null`-Werte werden uebersprungen. */
function average(values: readonly (number | null)[]): number {
  const present = values.filter((value): value is number => value !== null);

  if (present.length === 0) {
    return 0;
  }

  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function createOpenMeteoWeather(fetchImpl: typeof fetch = fetch): WeatherPort {
  return {
    async outlook(place: Place, month: number): Promise<Result<WeatherOutlook>> {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return fail('validation_error', 'Der Monat muss zwischen 1 und 12 liegen', { month });
      }

      // Drei abgeschlossene Jahre als Grundlage der Normalwerte.
      const referenceYear = new Date().getUTCFullYear() - 1;
      const monthPadded = String(month).padStart(2, '0');
      const start = `${String(referenceYear - 2)}-${monthPadded}-01`;
      const lastDay = new Date(Date.UTC(referenceYear, month, 0)).getUTCDate();
      const end = `${String(referenceYear)}-${monthPadded}-${String(lastDay)}`;

      const url =
        `${ARCHIVE_URL}?latitude=${String(place.latitude)}&longitude=${String(place.longitude)}` +
        `&start_date=${start}&end_date=${end}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=UTC`;

      const response = await fetchJson(
        { url, provider: PROVIDER },
        archiveResponseSchema,
        fetchImpl,
      );

      if (!response.ok) {
        return response;
      }

      const { daily } = response.value;

      /*
       * Nur die Tage des gefragten Monats.
       *
       * Das Archiv liefert einen durchgehenden Zeitraum — die Anfrage von
       * August bis August umfasst also auch alle Winter dazwischen. Wer
       * darueber mittelt, erhaelt das Jahresmittel: Rom im August kam so auf
       * 22 Grad und neun Regentage statt auf gut 30 Grad und zwei. Die
       * Schnittstelle kennt keinen Monatsfilter, also wird hier gefiltert.
       */
      const indizes = daily.time
        .map((tag, index) => ({ tag, index }))
        .filter(({ tag }) => tag.slice(5, 7) === monthPadded)
        .map(({ index }) => index);

      if (indizes.length === 0) {
        return fail('not_found', 'Für diesen Ort liegen keine Klimadaten vor', {
          latitude: place.latitude,
          longitude: place.longitude,
          month,
        });
      }

      const auswahl = (werte: readonly (number | null)[]): (number | null)[] =>
        indizes.map((index) => werte[index] ?? null);

      const niederschlag = auswahl(daily.precipitation_sum);
      const rainyDayCount = niederschlag.filter((value) => value !== null && value >= 1).length;

      // Wie viele Jahrgaenge desselben Monats stecken in der Antwort?
      const jahre = new Set(indizes.map((index) => daily.time[index]?.slice(0, 4))).size;

      return ok({
        place,
        month,
        averageHighCelsius: Math.round(average(auswahl(daily.temperature_2m_max)) * 10) / 10,
        averageLowCelsius: Math.round(average(auswahl(daily.temperature_2m_min)) * 10) / 10,
        rainyDays: Math.min(31, Math.round(rainyDayCount / Math.max(1, jahre))),
        // Open-Meteo liefert im Archiv keine Wassertemperatur; ohne belastbare
        // Quelle wird sie weggelassen statt geschaetzt.
        seaTemperatureCelsius: null,
        // Echte Messwerte, keine Seed-Daten.
        isDemoData: false,
      });
    },
  };
}
