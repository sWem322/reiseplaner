import { describe, expect, it } from 'vitest';
import { flightOfferSchema, hotelOfferSchema, weatherOutlookSchema } from '@/domain/offers';
import type { TripQuery } from '@/domain/trip/trip';
import { unwrap } from '@/domain/result';
import { findByIata, normalizeSearchTerm, searchCatalog } from './catalog';
import { addMinutes, distanceMeters, hashString, seededInt } from './deterministic';
import { createSeedFlightSearch } from './flights';
import { createSeedHotelSearch } from './hotels';
import { createSeedGeocoding, createSeedWeather } from './places';

function place(iataCode: string) {
  const entry = findByIata(iataCode);

  if (entry === undefined) {
    throw new Error(`Katalogeintrag ${iataCode} fehlt`);
  }

  return {
    name: entry.name,
    iataCode: entry.iataCode,
    latitude: entry.latitude,
    longitude: entry.longitude,
  };
}

function query(overrides: Partial<TripQuery> = {}): TripQuery {
  return {
    origin: place('DUS'),
    destination: place('PMI'),
    departureDate: '2026-09-05',
    returnDate: '2026-09-12',
    adults: 2,
    childAges: [],
    budgetEuros: null,
    preferences: [],
    ...overrides,
  };
}

describe('Katalog', () => {
  it('findet einen Ort ueber den IATA-Code', () => {
    expect(findByIata('PMI')?.name).toBe('Palma de Mallorca');
  });

  it('ist beim IATA-Code unabhaengig von der Schreibweise', () => {
    expect(findByIata('pmi')?.iataCode).toBe('PMI');
  });

  it('loest Umlaute beim Normalisieren auf', () => {
    expect(normalizeSearchTerm(' Düsseldorf ')).toBe('duesseldorf');
    expect(normalizeSearchTerm('Straße')).toBe('strasse');
  });

  it.each([
    ['Mallorca', 'PMI'],
    ['mallorca', 'PMI'],
    ['Malle', 'PMI'],
    ['duesseldorf', 'DUS'],
    ['Düsseldorf', 'DUS'],
    ['dus', 'DUS'],
    ['kreta', 'HER'],
    ['Türkei', 'AYT'],
  ])('findet %s als %s', (term, expectedIata) => {
    expect(searchCatalog(term)[0]?.iataCode).toBe(expectedIata);
  });

  it('gibt bei unbekanntem Begriff nichts zurueck', () => {
    expect(searchCatalog('Atlantis')).toEqual([]);
  });

  it('liefert eine stabile Reihenfolge', () => {
    expect(searchCatalog('a').map((e) => e.iataCode)).toEqual(
      searchCatalog('a').map((e) => e.iataCode),
    );
  });
});

describe('Deterministische Hilfen', () => {
  it('erzeugt fuer gleiche Eingabe denselben Hash', () => {
    expect(hashString('DUS-PMI')).toBe(hashString('DUS-PMI'));
  });

  it('erzeugt fuer unterschiedliche Eingaben unterschiedliche Hashes', () => {
    expect(hashString('DUS-PMI')).not.toBe(hashString('DUS-PMJ'));
  });

  it('haelt seededInt im gewuenschten Bereich', () => {
    for (let index = 0; index < 50; index += 1) {
      const value = seededInt(`seed-${String(index)}`, 10, 20);

      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
    }
  });

  it('weist einen leeren Bereich zurueck', () => {
    expect(() => seededInt('x', 5, 5)).toThrow(/max muss groesser/);
  });

  it('berechnet eine plausible Entfernung DUS nach PMI', () => {
    const meters = distanceMeters(place('DUS'), place('PMI'));

    // Luftlinie betraegt rund 1 400 km.
    expect(meters).toBeGreaterThan(1_300_000);
    expect(meters).toBeLessThan(1_500_000);
  });

  it('addiert Minuten unter Beibehaltung der Zeitzone', () => {
    expect(addMinutes('2026-09-05T08:00:00+02:00', 150)).toBe('2026-09-05T10:30:00+02:00');
  });

  it('rechnet ueber Mitternacht korrekt', () => {
    expect(addMinutes('2026-09-05T23:30:00+02:00', 60)).toBe('2026-09-06T00:30:00+02:00');
  });
});

describe('Flugsuche auf Seed-Daten', () => {
  const flights = createSeedFlightSearch();

  it('liefert Angebote, die dem Schema entsprechen', async () => {
    const offers = unwrap(await flights.search(query(), 5));

    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(flightOfferSchema.safeParse(offer).success).toBe(true);
    }
  });

  it('sortiert aufsteigend nach Preis', async () => {
    const offers = unwrap(await flights.search(query(), 5));
    const prices = offers.map((offer) => offer.totalPriceCents);

    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('beachtet die Obergrenze', async () => {
    expect(unwrap(await flights.search(query(), 2))).toHaveLength(2);
  });

  it('liefert bei gleicher Anfrage dasselbe Ergebnis', async () => {
    const ersteSuche = unwrap(await flights.search(query(), 5));
    const zweiteSuche = unwrap(await flights.search(query(), 5));

    expect(zweiteSuche).toEqual(ersteSuche);
  });

  it('liefert fuer eine andere Strecke andere Preise', async () => {
    const nachMallorca = unwrap(await flights.search(query(), 1))[0];
    const nachTeneriffa = unwrap(await flights.search(query({ destination: place('TFS') }), 1))[0];

    expect(nachTeneriffa?.totalPriceCents).not.toBe(nachMallorca?.totalPriceCents);
  });

  it('verlangt in der Hauptsaison mehr als im Winter', async () => {
    const september = unwrap(
      await flights.search(query({ departureDate: '2026-09-05', returnDate: '2026-09-12' }), 1),
    )[0];
    const november = unwrap(
      await flights.search(query({ departureDate: '2026-11-05', returnDate: '2026-11-12' }), 1),
    )[0];

    expect(september?.totalPriceCents).toBeGreaterThan(november?.totalPriceCents ?? 0);
  });

  it('rechnet Kinder unter zwoelf guenstiger', async () => {
    const nurErwachsene = unwrap(await flights.search(query({ adults: 2 }), 1))[0];
    const mitKind = unwrap(await flights.search(query({ adults: 2, childAges: [6] }), 1))[0];

    const aufschlagProKind =
      (mitKind?.totalPriceCents ?? 0) - (nurErwachsene?.totalPriceCents ?? 0);
    const preisProErwachsenem = (nurErwachsene?.totalPriceCents ?? 0) / 2;

    expect(aufschlagProKind).toBeGreaterThan(0);
    expect(aufschlagProKind).toBeLessThan(preisProErwachsenem);
  });

  it('gibt auf einer Strecke ohne Verbindung eine leere Liste zurueck, keinen Fehler', async () => {
    const result = await flights.search(
      query({ origin: place('DRS'), destination: place('TFS') }),
      5,
    );

    expect(result.ok).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });

  it('landet spaeter als es abfliegt', async () => {
    const offer = unwrap(await flights.search(query(), 1))[0];
    const segment = offer?.outbound[0];

    expect(segment).toBeDefined();
    if (segment !== undefined) {
      expect(Date.parse(segment.arrivalAt)).toBeGreaterThan(Date.parse(segment.departureAt));
    }
  });
});

describe('Unterkunftssuche auf Seed-Daten', () => {
  const hotels = createSeedHotelSearch();

  const input = {
    destination: place('PMI'),
    checkIn: '2026-09-05',
    checkOut: '2026-09-12',
    guests: 2,
  };

  it('liefert Angebote, die dem Schema entsprechen', async () => {
    const offers = unwrap(await hotels.search(input, 6));

    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(hotelOfferSchema.safeParse(offer).success).toBe(true);
    }
  });

  it('sortiert aufsteigend nach Preis', async () => {
    const prices = unwrap(await hotels.search(input, 6)).map((o) => o.pricePerNightCents);

    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('liefert bei gleicher Anfrage dasselbe Ergebnis', async () => {
    expect(unwrap(await hotels.search(input, 6))).toEqual(unwrap(await hotels.search(input, 6)));
  });

  it('platziert Unterkuenfte im Umkreis des Ortes', async () => {
    const offers = unwrap(await hotels.search(input, 6));

    for (const offer of offers) {
      expect(offer.distanceToCenterMeters).toBeLessThan(10_000);
    }
  });

  it('lehnt einen Aufenthalt ohne Uebernachtung ab', async () => {
    const result = await hotels.search({ ...input, checkOut: input.checkIn }, 6);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_error');
    }
  });

  it('lehnt null Gaeste ab', async () => {
    const result = await hotels.search({ ...input, guests: 0 }, 6);

    expect(result.ok).toBe(false);
  });

  it('meldet einen unbekannten Ort als nicht gefunden', async () => {
    const result = await hotels.search(
      { ...input, destination: { ...place('PMI'), iataCode: 'XXX' } },
      6,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });
});

describe('Ortsaufloesung auf Seed-Daten', () => {
  const geocoding = createSeedGeocoding();

  it('loest einen eindeutigen Ort auf', async () => {
    const places = unwrap(await geocoding.resolve('Mallorca'));

    expect(places[0]?.iataCode).toBe('PMI');
  });

  it('meldet einen unbekannten Ort', async () => {
    const result = await geocoding.resolve('Atlantis');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });

  it('lehnt einen leeren Suchbegriff ab', async () => {
    const result = await geocoding.resolve('   ');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_error');
    }
  });
});

describe('Wetteraussicht auf Seed-Daten', () => {
  const weather = createSeedWeather();

  it('liefert Werte, die dem Schema entsprechen', async () => {
    const outlook = unwrap(await weather.outlook(place('PMI'), 9));

    expect(weatherOutlookSchema.safeParse(outlook).success).toBe(true);
  });

  it('ist im Sommer waermer als im Winter', async () => {
    const juli = unwrap(await weather.outlook(place('PMI'), 7));
    const januar = unwrap(await weather.outlook(place('PMI'), 1));

    expect(juli.averageHighCelsius).toBeGreaterThan(januar.averageHighCelsius);
  });

  it('ist im Sueden waermer als im Norden', async () => {
    const teneriffa = unwrap(await weather.outlook(place('TFS'), 3));
    const hamburg = unwrap(await weather.outlook(place('HAM'), 3));

    expect(teneriffa.averageHighCelsius).toBeGreaterThan(hamburg.averageHighCelsius);
  });

  it('nennt fuer Kuestenorte eine Wassertemperatur', async () => {
    const outlook = unwrap(await weather.outlook(place('PMI'), 8));

    expect(outlook.seaTemperatureCelsius).not.toBeNull();
  });

  it('nennt fuer Binnenorte keine Wassertemperatur', async () => {
    const outlook = unwrap(await weather.outlook(place('MUC'), 8));

    expect(outlook.seaTemperatureCelsius).toBeNull();
  });

  it('haelt die Tiefstwerte unter den Hoechstwerten', async () => {
    for (let month = 1; month <= 12; month += 1) {
      const outlook = unwrap(await weather.outlook(place('PMI'), month));

      expect(outlook.averageLowCelsius).toBeLessThan(outlook.averageHighCelsius);
    }
  });

  it.each([0, 13, 1.5])('lehnt Monat %o ab', async (month) => {
    const result = await weather.outlook(place('PMI'), month);

    expect(result.ok).toBe(false);
  });

  it('meldet einen unbekannten Ort', async () => {
    const result = await weather.outlook({ ...place('PMI'), iataCode: 'XXX' }, 9);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });
});
