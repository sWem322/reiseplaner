import type { HotelSearchInput, HotelSearchPort } from '@/domain/ports/providers';
import type { HotelOffer } from '@/domain/offers';
import type { Result } from '@/domain/result';

/**
 * Unterkunftssuche mit Rueckfallebene.
 *
 * Die Vorgeschichte gehoert dazu, sonst wirkt diese Datei wie Feigheit vor
 * einem Fehler: Die Hotelsuche hat monatelang **kein einziges Mal**
 * funktioniert. `overpass-api.de` weist seit Fruehjahr 2026 einen grossen Teil
 * der Anfragen mit 406 ab, und die drei Spiegel antworten unzuverlaessig. Ein
 * Werkzeug, das nie ein Ergebnis liefert, ist kein Werkzeug.
 *
 * Also dasselbe Verhalten wie bei den Fluegen: Ist der echte Anbieter nicht
 * zu erreichen, uebernimmt der Seed-Katalog — und **jede** so entstandene
 * Unterkunft traegt `isDemoData: true`. Die Oberflaeche zeigt daraufhin
 * „Beispieldaten", und der Systemprompt verpflichtet den Assistenten, es auch
 * auszusprechen. Ausgedachte Daten sind in Ordnung, solange sie als solche
 * benannt werden; stillschweigend echte vorzutaeuschen waere es nicht.
 *
 * Eine Ausnahme, und sie ist wichtig: `validation_error` wird **nicht**
 * aufgefangen. War die Anfrage selbst falsch — null Naechte, null Gaeste —,
 * dann scheiterte auch der Ersatz daran, und ein Rueckfall wuerde nur die
 * Meldung verschlucken, die den Fehler erklaert. Aufgefangen wird, was am
 * Anbieter liegt, nicht, was am Aufrufer liegt.
 */
export function createHotelSearchWithFallback(
  primary: HotelSearchPort,
  fallback: HotelSearchPort,
): HotelSearchPort {
  return {
    async search(input: HotelSearchInput, limit: number): Promise<Result<HotelOffer[]>> {
      const ergebnis = await primary.search(input, limit);

      if (ergebnis.ok || ergebnis.error.kind === 'validation_error') {
        return ergebnis;
      }

      return fallback.search(input, limit);
    },
  };
}
