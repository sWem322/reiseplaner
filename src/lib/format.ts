/**
 * Darstellung von Preisen, Zeiten und Daten.
 *
 * Bewusst ohne `Intl` fuer Datum und Uhrzeit: `Intl` richtet sich nach der
 * Zeitzone und Sprache der ausfuehrenden Umgebung. Server und Browser stehen
 * hier nicht zwangslaeufig gleich — die Folge waere ein Hydration-Fehler und,
 * schlimmer, eine andere angezeigte Uhrzeit als die tatsaechliche Abflugzeit.
 * Die Zeitangaben der Anbieter sind bereits Ortszeit des Flughafens; sie
 * werden deshalb aus der Zeichenkette gelesen, nicht umgerechnet.
 */

/** Preis in Cent als „1.234,00 €". */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** „2026-09-05T07:35:00" wird zu „07:35". */
export function formatTime(isoTimestamp: string): string {
  return isoTimestamp.slice(11, 16);
}

/** „2026-09-05" wird zu „05.09.". */
export function formatDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.`;
}

/** „2026-09-05" wird zu „05.09.2026" — fuer die Entwurfsleiste. */
export function formatDateLong(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
}

/** Dauer zwischen zwei Zeitstempeln als „2 h 05 min". */
export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);

  if (!Number.isFinite(minutes) || minutes < 0) {
    return '';
  }

  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, '0')} min`;
}
