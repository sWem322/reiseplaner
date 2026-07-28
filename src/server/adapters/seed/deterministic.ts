/**
 * Deterministische Hilfsfunktionen fuer die Seed-Adapter.
 *
 * Kein Math.random(): Dieselbe Anfrage muss immer dasselbe Ergebnis liefern.
 * Andernfalls wuerde jeder E2E-Lauf andere Preise sehen, und die Demo zeigte
 * bei jedem Neuladen andere Angebote — beides waere nicht nachvollziehbar.
 *
 * Stattdessen wird aus den Eingabewerten ein Hash gebildet und daraus alles
 * Weitere abgeleitet. Gleiche Eingabe, gleicher Hash, gleiche Ausgabe.
 */

/**
 * FNV-1a, 32 Bit. Klein, schnell, gut gestreut — kryptografische Eignung ist
 * hier ausdruecklich nicht gefragt.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Wert aus dem Bereich [min, max), abgeleitet aus dem Seed. */
export function seededInt(seed: string, min: number, max: number): number {
  if (max <= min) {
    throw new Error('max muss groesser als min sein');
  }

  return min + (hashString(seed) % (max - min));
}

/** Bruchteil zwischen 0 (einschliesslich) und 1 (ausschliesslich). */
export function seededFraction(seed: string): number {
  return hashString(seed) / 0x1_0000_0000;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Luftlinie zwischen zwei Punkten in Metern. */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;

  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Grobe Flugzeit in Minuten aus der Entfernung, inklusive Rollzeiten. */
export function flightMinutes(meters: number): number {
  const cruiseSpeedMetersPerMinute = 13_000;
  const groundTimeMinutes = 35;

  return Math.round(meters / cruiseSpeedMetersPerMinute) + groundTimeMinutes;
}

/** Zeitstempel im Format ISO 8601 mit fester Zeitzone. */
export function isoDateTime(
  date: string,
  hour: number,
  minute: number,
  offsetHours: number,
): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '-';
  const offset = String(Math.abs(offsetHours)).padStart(2, '0');

  return `${date}T${hh}:${mm}:00${sign}${offset}:00`;
}

/** Addiert Minuten auf einen Zeitpunkt und behaelt die Zeitzone bei. */
export function addMinutes(isoTimestamp: string, minutes: number): string {
  const parsed = Date.parse(isoTimestamp);
  const zoneMatch = /([+-]\d{2}):(\d{2})$/.exec(isoTimestamp);
  const offsetHours = zoneMatch?.[1] === undefined ? 0 : Number.parseInt(zoneMatch[1], 10);

  const shifted = new Date(parsed + minutes * 60_000 + offsetHours * 3_600_000);
  const date = shifted.toISOString().slice(0, 10);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  return isoDateTime(date, hour, minute, offsetHours);
}
