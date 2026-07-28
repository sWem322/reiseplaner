import { describe, expect, it } from 'vitest';
import { unwrap } from '@/domain/result';
import { createProviders, createSeedProviders, describeSelection } from './factory';

const offlineFetch: typeof fetch = () =>
  Promise.reject(new Error('Im Test darf kein Netzwerkaufruf stattfinden'));

describe('Auswahl der Anbieter', () => {
  it('waehlt ohne Schluessel ueberall Seed-Daten', () => {
    const selection = createProviders({ useNetworkProviders: false });

    expect(selection.active).toEqual({
      flights: 'seed',
      hotels: 'seed',
      geocoding: 'seed',
      weather: 'seed',
    });
  });

  it('waehlt Duffel, sobald ein Zugangstoken vorliegt', () => {
    const selection = createProviders({
      duffelAccessToken: 'duffel_test_abc',
      useNetworkProviders: false,
      fetchImpl: offlineFetch,
    });

    expect(selection.active.flights).toBe('duffel');
  });

  it('behandelt ein leeres Token wie ein fehlendes', () => {
    const selection = createProviders({ duffelAccessToken: '', useNetworkProviders: false });

    expect(selection.active.flights).toBe('seed');
  });

  it('nutzt die schluessellosen Netzdienste, wenn Netzwerk erlaubt ist', () => {
    const selection = createProviders({ useNetworkProviders: true, fetchImpl: offlineFetch });

    expect(selection.active).toMatchObject({
      hotels: 'overpass',
      geocoding: 'open-meteo',
      weather: 'open-meteo',
    });
  });

  it('liefert einsatzbereite Ports ohne jede Konfiguration', async () => {
    const { providers } = createProviders({ useNetworkProviders: false });

    const places = unwrap(await providers.geocoding.resolve('Mallorca'));

    expect(places[0]?.iataCode).toBe('PMI');
  });

  it('beschreibt die aktive Auswahl lesbar', () => {
    const selection = createProviders({ useNetworkProviders: false });

    expect(describeSelection(selection)).toBe(
      'Flüge: seed · Unterkünfte: seed · Orte: seed · Wetter: seed',
    );
  });
});

describe('Reine Seed-Anbieter', () => {
  it('stellt alle vier Ports bereit', async () => {
    const providers = createSeedProviders();
    const places = unwrap(await providers.geocoding.resolve('Palma'));
    const destination = places[0];

    expect(destination).toBeDefined();
    if (destination === undefined) {
      return;
    }

    const flights = unwrap(
      await providers.flights.search(
        {
          origin: {
            name: 'Düsseldorf',
            iataCode: 'DUS',
            latitude: 51.2895,
            longitude: 6.7668,
          },
          destination,
          departureDate: '2026-09-05',
          returnDate: '2026-09-12',
          adults: 2,
          childAges: [],
          budgetEuros: null,
          preferences: [],
        },
        3,
      ),
    );

    const hotels = unwrap(
      await providers.hotels.search(
        { destination, checkIn: '2026-09-05', checkOut: '2026-09-12', guests: 2 },
        3,
      ),
    );

    const weather = unwrap(await providers.weather.outlook(destination, 9));

    expect(flights.length).toBeGreaterThan(0);
    expect(hotels.length).toBeGreaterThan(0);
    expect(weather.month).toBe(9);
  });
});
