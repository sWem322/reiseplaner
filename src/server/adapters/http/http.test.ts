import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { TripQuery } from '@/domain/trip/trip';
import { flightOfferSchema, hotelOfferSchema } from '@/domain/offers';
import { unwrap } from '@/domain/result';
import { createDuffelFlightSearch } from './duffel';
import { fetchJson } from './fetch-json';
import { createOpenMeteoGeocoding, createOpenMeteoWeather } from './open-meteo';
import { createOverpassHotelSearch } from './overpass';

/**
 * Kein Test dieser Datei geht ins Netz. Jeder Adapter bekommt eine eigene
 * fetch-Implementierung — das ist der Grund, warum sie ueberhaupt als
 * Parameter existiert.
 */

function jsonResponse(payload: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

function statusResponse(status: number): typeof fetch {
  return () => Promise.resolve(new Response('{}', { status }));
}

function failingFetch(error: Error): typeof fetch {
  return () => Promise.reject(error);
}

const duesseldorf = { name: 'Düsseldorf', iataCode: 'DUS', latitude: 51.2895, longitude: 6.7668 };
const palma = { name: 'Palma de Mallorca', iataCode: 'PMI', latitude: 39.5517, longitude: 2.7388 };

function query(overrides: Partial<TripQuery> = {}): TripQuery {
  return {
    origin: duesseldorf,
    destination: palma,
    departureDate: '2026-09-05',
    returnDate: '2026-09-12',
    adults: 2,
    childAges: [],
    budgetEuros: null,
    preferences: [],
    ...overrides,
  };
}

describe('fetchJson', () => {
  const schema = z.object({ value: z.number() });

  it('gibt eine gueltige Antwort zurueck', async () => {
    const result = await fetchJson(
      { url: 'https://example.test', provider: 'Test' },
      schema,
      jsonResponse({ value: 42 }),
    );

    expect(unwrap(result)).toEqual({ value: 42 });
  });

  it.each([
    [500, 'upstream_error'],
    [503, 'upstream_error'],
    [429, 'rate_limited'],
    [404, 'not_found'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
  ])('uebersetzt Status %i in %s', async (status, expectedKind) => {
    const result = await fetchJson(
      { url: 'https://example.test', provider: 'Test' },
      schema,
      statusResponse(status),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(expectedKind);
    }
  });

  it('meldet ein unerwartetes Antwortformat als upstream_error', async () => {
    const result = await fetchJson(
      { url: 'https://example.test', provider: 'Test' },
      schema,
      jsonResponse({ etwasAnderes: true }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('upstream_error');
      expect(result.error.message).toContain('unerwartetes Format');
    }
  });

  it('meldet einen nicht erreichbaren Anbieter, statt zu werfen', async () => {
    const result = await fetchJson(
      { url: 'https://example.test', provider: 'Test' },
      schema,
      failingFetch(new Error('ECONNREFUSED')),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('upstream_error');
      expect(result.error.message).toContain('nicht erreichbar');
    }
  });

  it('bricht nach der Zeitvorgabe ab', async () => {
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });

    const result = await fetchJson(
      { url: 'https://example.test', provider: 'Test', timeoutMs: 30 },
      schema,
      hangingFetch,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('antwortete nicht');
    }
  });
});

describe('Open-Meteo Ortsaufloesung', () => {
  it('ordnet einen Treffer dem naechsten Flughafen zu', async () => {
    const geocoding = createOpenMeteoGeocoding(
      jsonResponse({
        results: [{ name: 'Palma', latitude: 39.5696, longitude: 2.6502, country_code: 'ES' }],
      }),
    );

    const places = unwrap(await geocoding.resolve('Palma'));

    expect(places[0]?.iataCode).toBe('PMI');
    expect(places[0]?.name).toBe('Palma');
  });

  it('verwirft Treffer ohne Flughafen in der Naehe', async () => {
    const geocoding = createOpenMeteoGeocoding(
      // Mitten im Pazifik.
      jsonResponse({ results: [{ name: 'Nirgendwo', latitude: 0, longitude: -160 }] }),
    );

    const result = await geocoding.resolve('Nirgendwo');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });

  it('behandelt eine leere Trefferliste als not_found', async () => {
    const geocoding = createOpenMeteoGeocoding(jsonResponse({}));

    const result = await geocoding.resolve('Atlantis');

    expect(result.ok).toBe(false);
  });

  it('lehnt einen leeren Suchbegriff ab, ohne den Anbieter zu fragen', async () => {
    let called = false;
    const geocoding = createOpenMeteoGeocoding(() => {
      called = true;
      return Promise.resolve(new Response('{}'));
    });

    const result = await geocoding.resolve('  ');

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('Open-Meteo Klimawerte', () => {
  const archivePayload = {
    daily: {
      time: ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04'],
      temperature_2m_max: [28, 30, 26, null],
      temperature_2m_min: [19, 21, 18, null],
      precipitation_sum: [0, 3.4, 0, 1.2],
    },
  };

  /**
   * Das Archiv liefert einen durchgehenden Zeitraum. Wer ueber alles mittelt,
   * mittelt die Winter mit — in der Abnahme meldete der Assistent fuer Rom im
   * August 22 Grad und neun Regentage. Dieser Datensatz enthaelt deshalb
   * bewusst Tage aus anderen Monaten.
   */
  const mehrjahresPayload = {
    daily: {
      time: [
        '2023-08-01',
        '2023-08-02',
        '2024-01-15', // Winter — darf das Ergebnis nicht beruehren
        '2024-02-20',
        '2024-08-01',
        '2024-08-02',
        '2025-08-01',
        '2025-08-02',
      ],
      temperature_2m_max: [32, 30, 8, 10, 31, 33, 30, 34],
      temperature_2m_min: [20, 19, 1, 2, 21, 20, 19, 21],
      precipitation_sum: [0, 2.5, 12, 8, 0, 0, 3.1, 0],
    },
  };

  it('mittelt nur die Tage des gefragten Monats', async () => {
    const weather = createOpenMeteoWeather(jsonResponse(mehrjahresPayload));

    const outlook = unwrap(await weather.outlook(palma, 8));

    // Nur die sechs August-Tage: (32+30+31+33+30+34)/6 = 31,7
    expect(outlook.averageHighCelsius).toBeCloseTo(31.7, 1);
    expect(outlook.averageLowCelsius).toBeCloseTo(20, 1);
  });

  it('rechnet Regentage auf ein Jahr herunter', async () => {
    const weather = createOpenMeteoWeather(jsonResponse(mehrjahresPayload));

    const outlook = unwrap(await weather.outlook(palma, 8));

    // Zwei Regentage im August, verteilt auf drei Jahrgaenge: aufgerundet 1.
    expect(outlook.rainyDays).toBe(1);
  });

  it('meldet not_found, wenn der Monat gar nicht enthalten ist', async () => {
    const weather = createOpenMeteoWeather(jsonResponse(mehrjahresPayload));

    const result = await weather.outlook(palma, 11);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });

  it('mittelt Hoechst- und Tiefstwerte', async () => {
    const weather = createOpenMeteoWeather(jsonResponse(archivePayload));

    const outlook = unwrap(await weather.outlook(palma, 9));

    expect(outlook.averageHighCelsius).toBe(28);
    expect(outlook.averageLowCelsius).toBeCloseTo(19.3, 1);
    expect(outlook.isDemoData).toBe(false);
  });

  it('zaehlt Tage mit nennenswertem Niederschlag als Regentage', async () => {
    const weather = createOpenMeteoWeather(jsonResponse(archivePayload));

    const outlook = unwrap(await weather.outlook(palma, 9));

    expect(outlook.rainyDays).toBe(2);
  });

  it('meldet fehlende Daten als not_found', async () => {
    const weather = createOpenMeteoWeather(
      jsonResponse({
        daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [] },
      }),
    );

    const result = await weather.outlook(palma, 9);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });

  it.each([0, 13])('lehnt Monat %i ab, ohne den Anbieter zu fragen', async (month) => {
    let called = false;
    const weather = createOpenMeteoWeather(() => {
      called = true;
      return Promise.resolve(new Response('{}'));
    });

    const result = await weather.outlook(palma, month);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('Overpass Unterkunftssuche', () => {
  const overpassPayload = {
    elements: [
      {
        id: 1,
        lat: 39.5617,
        lon: 2.6499,
        tags: { name: 'Hotel Playa', stars: '4', tourism: 'hotel' },
      },
      {
        id: 2,
        center: { lat: 39.57, lon: 2.65 },
        tags: { name: 'Casa Central', tourism: 'hotel' },
      },
      // Ohne Namen — wird uebersprungen.
      { id: 3, lat: 39.58, lon: 2.66, tags: { tourism: 'hotel' } },
      // Ohne Koordinaten — wird uebersprungen.
      { id: 4, tags: { name: 'Geisterhotel', tourism: 'hotel' } },
    ],
  };

  const input = {
    destination: palma,
    checkIn: '2026-09-05',
    checkOut: '2026-09-12',
    guests: 2,
  };

  it('bildet OSM-Objekte auf Angebote ab', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const offers = unwrap(await hotels.search(input, 10));

    expect(offers).toHaveLength(2);
    for (const offer of offers) {
      expect(hotelOfferSchema.safeParse(offer).success).toBe(true);
    }
  });

  it('uebernimmt Sterne, wenn OSM sie kennt', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const offers = unwrap(await hotels.search(input, 10));
    const playa = offers.find((offer) => offer.name === 'Hotel Playa');

    expect(playa?.stars).toBe(4);
  });

  it('laesst Sterne offen, wenn OSM sie nicht kennt', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const offers = unwrap(await hotels.search(input, 10));
    const central = offers.find((offer) => offer.name === 'Casa Central');

    expect(central?.stars).toBeNull();
  });

  it('kennzeichnet Preise als Demo-Daten', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const offers = unwrap(await hotels.search(input, 10));

    expect(offers.every((offer) => offer.isDemoData)).toBe(true);
  });

  it('liefert bei gleicher Anfrage dieselben Preise', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const ersteSuche = unwrap(await hotels.search(input, 10));
    const zweiteSuche = unwrap(await hotels.search(input, 10));

    expect(zweiteSuche).toEqual(ersteSuche);
  });

  it('reicht einen Anbieterfehler als upstream_error weiter', async () => {
    const hotels = createOverpassHotelSearch(statusResponse(504));

    const result = await hotels.search(input, 10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('upstream_error');
    }
  });

  /*
   * Der Hauptserver antwortet seit Fruehjahr 2026 haeufig mit 406 — nicht
   * wegen der Abfrage, sondern gegen automatisierte Zugriffe. Ohne diesen
   * Wechsel hat die Hotelsuche nie ein Ergebnis geliefert.
   */
  it('geht zur naechsten Instanz, wenn die erste mit 406 abweist', async () => {
    const angefragt: string[] = [];

    const fetchImpl: typeof fetch = (url) => {
      const adresse = String(url);
      angefragt.push(adresse);

      return Promise.resolve(
        adresse.includes('erste')
          ? new Response('{}', { status: 406 })
          : new Response(JSON.stringify(overpassPayload), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
      );
    };

    const hotels = createOverpassHotelSearch(fetchImpl, [
      'https://erste.example/api/interpreter',
      'https://zweite.example/api/interpreter',
    ]);

    const offers = unwrap(await hotels.search(input, 10));

    expect(angefragt).toHaveLength(2);
    expect(offers).toHaveLength(2);
  });

  it('nennt die zuletzt gescheiterte Instanz, wenn keine antwortet', async () => {
    const hotels = createOverpassHotelSearch(statusResponse(406), [
      'https://erste.example/api/interpreter',
      'https://zweite.example/api/interpreter',
    ]);

    const result = await hotels.search(input, 10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('zweite.example');
    }
  });

  it('gibt sich gegenueber Overpass zu erkennen', async () => {
    const kopfzeilen: Headers[] = [];

    const fetchImpl: typeof fetch = (_url, init) => {
      kopfzeilen.push(new Headers(init?.headers));

      return Promise.resolve(
        new Response(JSON.stringify(overpassPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    await createOverpassHotelSearch(fetchImpl).search(input, 10);

    expect(kopfzeilen[0]?.get('user-agent')).toContain('ai-reiseplaner');
  });

  it('lehnt einen Aufenthalt ohne Uebernachtung ab', async () => {
    const hotels = createOverpassHotelSearch(jsonResponse(overpassPayload));

    const result = await hotels.search({ ...input, checkOut: input.checkIn }, 10);

    expect(result.ok).toBe(false);
  });
});

describe('Duffel Flugsuche', () => {
  const duffelPayload = {
    data: {
      offers: [
        {
          id: 'off_0001',
          total_amount: '312.45',
          total_currency: 'EUR',
          slices: [
            {
              segments: [
                {
                  origin: { iata_code: 'DUS', name: 'Düsseldorf' },
                  destination: { iata_code: 'PMI', name: 'Palma' },
                  departing_at: '2026-09-05T08:00:00+02:00',
                  arriving_at: '2026-09-05T10:30:00+02:00',
                  marketing_carrier: { name: 'Duffel Airways', iata_code: 'ZZ' },
                  marketing_carrier_flight_number: '1234',
                },
              ],
            },
            {
              segments: [
                {
                  origin: { iata_code: 'PMI', name: 'Palma' },
                  destination: { iata_code: 'DUS', name: 'Düsseldorf' },
                  departing_at: '2026-09-12T11:00:00+02:00',
                  arriving_at: '2026-09-12T13:30:00+02:00',
                  marketing_carrier: { name: 'Duffel Airways', iata_code: 'ZZ' },
                  marketing_carrier_flight_number: '4321',
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it('bildet ein Angebot auf das Domaenenschema ab', async () => {
    const flights = createDuffelFlightSearch('duffel_test_x', jsonResponse(duffelPayload));

    const offers = unwrap(await flights.search(query(), 5));

    expect(offers).toHaveLength(1);
    expect(flightOfferSchema.safeParse(offers[0]).success).toBe(true);
    expect(offers[0]?.totalPriceCents).toBe(31_245);
    expect(offers[0]?.outbound[0]?.flightNumber).toBe('ZZ1234');
  });

  it('kennzeichnet Testmodus-Angebote als Demo-Daten', async () => {
    const flights = createDuffelFlightSearch('duffel_test_x', jsonResponse(duffelPayload));

    const offers = unwrap(await flights.search(query(), 5));

    expect(offers[0]?.isDemoData).toBe(true);
  });

  it('ueberspringt Angebote in fremder Waehrung', async () => {
    const inDollar = {
      data: {
        offers: [{ ...duffelPayload.data.offers[0], id: 'off_usd', total_currency: 'USD' }],
      },
    };
    const flights = createDuffelFlightSearch('duffel_test_x', jsonResponse(inDollar));

    const result = await flights.search(query(), 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('upstream_error');
    }
  });

  it('gibt eine leere Liste zurueck, wenn der Anbieter nichts findet', async () => {
    const flights = createDuffelFlightSearch(
      'duffel_test_x',
      jsonResponse({ data: { offers: [] } }),
    );

    expect(unwrap(await flights.search(query(), 5))).toEqual([]);
  });

  it('uebersetzt einen abgelehnten Schluessel in unauthorized', async () => {
    const flights = createDuffelFlightSearch('falsch', statusResponse(401));

    const result = await flights.search(query(), 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unauthorized');
    }
  });

  it('uebersetzt eine Drosselung in rate_limited', async () => {
    const flights = createDuffelFlightSearch('duffel_test_x', statusResponse(429));

    const result = await flights.search(query(), 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('rate_limited');
    }
  });

  it('sendet je Kind ein Alter mit', async () => {
    let gesendeteAnfrage: unknown = null;
    const spyFetch: typeof fetch = (_url, init) => {
      const body = init?.body;
      gesendeteAnfrage = typeof body === 'string' ? JSON.parse(body) : null;
      return Promise.resolve(
        new Response(JSON.stringify(duffelPayload), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const flights = createDuffelFlightSearch('duffel_test_x', spyFetch);
    await flights.search(query({ adults: 2, childAges: [4, 9] }), 5);

    expect(gesendeteAnfrage).toMatchObject({
      data: {
        passengers: [{ type: 'adult' }, { type: 'adult' }, { age: 4 }, { age: 9 }],
      },
    });
  });
});
