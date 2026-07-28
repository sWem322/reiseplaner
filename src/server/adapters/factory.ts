import type { Providers } from '@/domain/ports/providers';
import { createDuffelFlightSearch } from './http/duffel';
import { createOpenMeteoGeocoding, createOpenMeteoWeather } from './http/open-meteo';
import { createOverpassHotelSearch } from './http/overpass';
import { createSeedFlightSearch } from './seed/flights';
import { createSeedHotelSearch } from './seed/hotels';
import { createSeedGeocoding, createSeedWeather } from './seed/places';

/**
 * Auswahl der Anbieter-Implementierungen.
 *
 * Die Fabrik ist die einzige Stelle im Projekt, die beide Welten kennt: die
 * Ports der Domaene und die konkreten Adapter. Alles darueber — Werkzeuge,
 * Agenten-Loop, Oberflaeche — sieht nur noch Interfaces.
 *
 * Regel: Fehlt ein Schluessel, wird nicht abgebrochen, sondern die
 * Seed-Implementierung gewaehlt. Ein Projekt, das ohne fremde Zugangsdaten
 * gar nicht startet, kann niemand ausprobieren.
 */

export interface ProviderConfig {
  readonly duffelAccessToken?: string | undefined;
  readonly travelpayoutsToken?: string | undefined;
  /**
   * Netzwerkfreie Anbieter (Open-Meteo, Overpass) brauchen keinen Schluessel,
   * sollen in Tests und E2E-Laeufen aber trotzdem abschaltbar sein.
   */
  readonly useNetworkProviders?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export type AdapterName = 'seed' | 'duffel' | 'travelpayouts' | 'open-meteo' | 'overpass';

export interface ProviderSelection {
  readonly providers: Providers;
  /** Welche Implementierung je Port aktiv ist — wird beim Start protokolliert. */
  readonly active: {
    readonly flights: AdapterName;
    readonly hotels: AdapterName;
    readonly geocoding: AdapterName;
    readonly weather: AdapterName;
  };
}

export function createProviders(config: ProviderConfig = {}): ProviderSelection {
  const fetchImpl = config.fetchImpl ?? fetch;
  const useNetwork = config.useNetworkProviders ?? true;

  const hasDuffel = config.duffelAccessToken !== undefined && config.duffelAccessToken.length > 0;

  const flights = hasDuffel
    ? createDuffelFlightSearch(config.duffelAccessToken ?? '', fetchImpl)
    : createSeedFlightSearch();

  const hotels = useNetwork ? createOverpassHotelSearch(fetchImpl) : createSeedHotelSearch();
  const geocoding = useNetwork ? createOpenMeteoGeocoding(fetchImpl) : createSeedGeocoding();
  const weather = useNetwork ? createOpenMeteoWeather(fetchImpl) : createSeedWeather();

  return {
    providers: { flights, hotels, geocoding, weather },
    active: {
      flights: hasDuffel ? 'duffel' : 'seed',
      hotels: useNetwork ? 'overpass' : 'seed',
      geocoding: useNetwork ? 'open-meteo' : 'seed',
      weather: useNetwork ? 'open-meteo' : 'seed',
    },
  };
}

/** Ausschliesslich Seed-Implementierungen — fuer Tests und den Offline-Betrieb. */
export function createSeedProviders(): Providers {
  return {
    flights: createSeedFlightSearch(),
    hotels: createSeedHotelSearch(),
    geocoding: createSeedGeocoding(),
    weather: createSeedWeather(),
  };
}

export function describeSelection(selection: ProviderSelection): string {
  const { active } = selection;

  return [
    `Flüge: ${active.flights}`,
    `Unterkünfte: ${active.hotels}`,
    `Orte: ${active.geocoding}`,
    `Wetter: ${active.weather}`,
  ].join(' · ');
}
