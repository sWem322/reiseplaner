import type { FlightOffer, HotelOffer, WeatherOutlook } from '../offers';
import type { Place, TripQuery } from '../trip/trip';
import type { Result } from '../result';

/**
 * Ports der externen Anbieter.
 *
 * Kein Port kennt einen Anbieternamen, kein Port wirft. Jede Operation gibt
 * ein Result zurueck, weil der Agenten-Loop Fehlschlaege als Daten an das
 * Modell zurueckgeben muss statt abzubrechen.
 */

export interface FlightSearchPort {
  /**
   * Angebote fuer die Strecke, aufsteigend nach Preis, hoechstens `limit`.
   *
   * Eine leere Liste ist ein gueltiges Ergebnis: Auf mancher Strecke fliegt
   * an manchem Tag nichts. Das ist kein Fehler, sondern eine Auskunft.
   */
  search(query: TripQuery, limit: number): Promise<Result<FlightOffer[]>>;
}

export interface HotelSearchInput {
  readonly destination: Place;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly guests: number;
}

export interface HotelSearchPort {
  search(input: HotelSearchInput, limit: number): Promise<Result<HotelOffer[]>>;
}

export interface GeocodingPort {
  /**
   * Freitext zu Orten aufloesen.
   *
   * Mehrdeutige Eingaben ergeben mehrere Treffer, sortiert nach Relevanz. Die
   * Auswahl trifft der Agent im Dialog mit der reisenden Person — ein Adapter
   * hat dafuer nicht genug Kontext.
   */
  resolve(freeText: string): Promise<Result<Place[]>>;
}

export interface WeatherPort {
  /**
   * Klimatische Normalwerte fuer einen Reisemonat.
   *
   * Bewusst keine Tagesvorhersage: Wer im Januar den September plant, kann
   * keine bekommen. Normalwerte beantworten die eigentliche Frage — "ist es
   * dann dort warm genug?".
   */
  outlook(place: Place, month: number): Promise<Result<WeatherOutlook>>;
}

/** Alle Anbieter-Ports gebuendelt. */
export interface Providers {
  readonly flights: FlightSearchPort;
  readonly hotels: HotelSearchPort;
  readonly geocoding: GeocodingPort;
  readonly weather: WeatherPort;
}
