import { describe, expect, it } from 'vitest';
import {
  dateRangeSchema,
  flightOfferSchema,
  hotelOfferSchema,
  isDirectFlight,
  nightsBetween,
  outboundDurationMinutes,
  pricePerPerson,
  totalStayPriceCents,
  weatherOutlookSchema,
  type FlightOffer,
  type HotelOffer,
} from './offers';

const duesseldorf = { name: 'Düsseldorf', iataCode: 'DUS', latitude: 51.2895, longitude: 6.7668 };
const palma = { name: 'Palma', iataCode: 'PMI', latitude: 39.5517, longitude: 2.7388 };
const barcelona = { name: 'Barcelona', iataCode: 'BCN', latitude: 41.2971, longitude: 2.0785 };

function directFlight(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    id: 'seed-DUS-PMI-1',
    outbound: [
      {
        from: duesseldorf,
        to: palma,
        departureAt: '2026-09-05T08:00:00+02:00',
        arrivalAt: '2026-09-05T10:30:00+02:00',
        carrier: 'Demo Air',
        flightNumber: 'DA1201',
      },
    ],
    inbound: [
      {
        from: palma,
        to: duesseldorf,
        departureAt: '2026-09-12T11:00:00+02:00',
        arrivalAt: '2026-09-12T13:30:00+02:00',
        carrier: 'Demo Air',
        flightNumber: 'DA1202',
      },
    ],
    totalPriceCents: 39_800,
    currency: 'EUR',
    isDemoData: true,
    ...overrides,
  };
}

function hotel(overrides: Partial<HotelOffer> = {}): HotelOffer {
  return {
    id: 'seed-hotel-1',
    name: 'Hotel Playa',
    latitude: 39.5617,
    longitude: 2.6499,
    stars: 4,
    pricePerNightCents: 12_500,
    currency: 'EUR',
    distanceToCenterMeters: 850,
    isDemoData: true,
    ...overrides,
  };
}

describe('Flugangebot', () => {
  it('akzeptiert ein vollstaendiges Angebot', () => {
    expect(flightOfferSchema.safeParse(directFlight()).success).toBe(true);
  });

  it('verlangt mindestens einen Abschnitt je Richtung', () => {
    expect(flightOfferSchema.safeParse(directFlight({ outbound: [] })).success).toBe(false);
  });

  it('lehnt einen negativen Preis ab', () => {
    expect(flightOfferSchema.safeParse(directFlight({ totalPriceCents: -1 })).success).toBe(false);
  });

  it('lehnt Preise in Bruchteilen von Cent ab', () => {
    expect(flightOfferSchema.safeParse(directFlight({ totalPriceCents: 199.5 })).success).toBe(
      false,
    );
  });

  it('lehnt einen Zeitpunkt ohne Zeitzone ab', () => {
    const ohneZone = directFlight();
    const segment = ohneZone.outbound[0];

    expect(segment).toBeDefined();
    if (segment !== undefined) {
      const kaputt = {
        ...ohneZone,
        outbound: [{ ...segment, departureAt: '2026-09-05T08:00:00' }],
      };

      expect(flightOfferSchema.safeParse(kaputt).success).toBe(false);
    }
  });

  it('rechnet den Preis je Person', () => {
    expect(pricePerPerson(directFlight(), 2)).toBe(19_900);
  });

  it('weist eine Personenzahl unter eins zurueck', () => {
    expect(() => pricePerPerson(directFlight(), 0)).toThrow(/Mindestens eine reisende Person/);
  });

  it('erkennt einen Direktflug', () => {
    expect(isDirectFlight(directFlight())).toBe(true);
  });

  it('erkennt einen Flug mit Umstieg', () => {
    const segment = directFlight().outbound[0];

    expect(segment).toBeDefined();
    if (segment !== undefined) {
      const mitUmstieg = directFlight({
        outbound: [
          { ...segment, to: barcelona, arrivalAt: '2026-09-05T09:30:00+02:00' },
          {
            ...segment,
            from: barcelona,
            departureAt: '2026-09-05T10:30:00+02:00',
            arrivalAt: '2026-09-05T11:45:00+02:00',
          },
        ],
      });

      expect(isDirectFlight(mitUmstieg)).toBe(false);
      // 08:00 bis 11:45 — Umsteigezeit zaehlt mit.
      expect(outboundDurationMinutes(mitUmstieg)).toBe(225);
    }
  });

  it('berechnet die Reisedauer der Hinreise', () => {
    expect(outboundDurationMinutes(directFlight())).toBe(150);
  });
});

describe('Unterkunftsangebot', () => {
  it('akzeptiert ein vollstaendiges Angebot', () => {
    expect(hotelOfferSchema.safeParse(hotel()).success).toBe(true);
  });

  it('erlaubt unbekannte Sterne und unbekannte Entfernung', () => {
    const ohneAngaben = hotel({ stars: null, distanceToCenterMeters: null });

    expect(hotelOfferSchema.safeParse(ohneAngaben).success).toBe(true);
  });

  it.each([0, 6, 3.5])('lehnt %o Sterne ab', (stars) => {
    expect(hotelOfferSchema.safeParse(hotel({ stars })).success).toBe(false);
  });

  it('rechnet den Gesamtpreis des Aufenthalts', () => {
    expect(totalStayPriceCents(hotel(), 7)).toBe(87_500);
  });

  it('weist null Naechte zurueck', () => {
    expect(() => totalStayPriceCents(hotel(), 0)).toThrow(/Mindestens eine Uebernachtung/);
  });
});

describe('Wetteraussicht', () => {
  it('akzeptiert Normalwerte mit Wassertemperatur', () => {
    const outlook = {
      place: palma,
      month: 9,
      averageHighCelsius: 27.5,
      averageLowCelsius: 19.1,
      rainyDays: 5,
      seaTemperatureCelsius: 25.4,
      isDemoData: true,
    };

    expect(weatherOutlookSchema.safeParse(outlook).success).toBe(true);
  });

  it('erlaubt Binnenorte ohne Wassertemperatur', () => {
    const outlook = {
      place: duesseldorf,
      month: 1,
      averageHighCelsius: 6.2,
      averageLowCelsius: 1.4,
      rainyDays: 18,
      seaTemperatureCelsius: null,
      isDemoData: true,
    };

    expect(weatherOutlookSchema.safeParse(outlook).success).toBe(true);
  });

  it.each([0, 13])('lehnt Monat %i ab', (month) => {
    const outlook = {
      place: palma,
      month,
      averageHighCelsius: 20,
      averageLowCelsius: 10,
      rainyDays: 5,
      seaTemperatureCelsius: null,
      isDemoData: true,
    };

    expect(weatherOutlookSchema.safeParse(outlook).success).toBe(false);
  });

  it('lehnt mehr als 31 Regentage ab', () => {
    const outlook = {
      place: palma,
      month: 9,
      averageHighCelsius: 20,
      averageLowCelsius: 10,
      rainyDays: 32,
      seaTemperatureCelsius: null,
      isDemoData: true,
    };

    expect(weatherOutlookSchema.safeParse(outlook).success).toBe(false);
  });
});

describe('Zeitraum', () => {
  it('zaehlt die Naechte', () => {
    expect(nightsBetween('2026-09-05', '2026-09-12')).toBe(7);
  });

  it('gibt bei umgekehrter Reihenfolge null zurueck', () => {
    expect(nightsBetween('2026-09-12', '2026-09-05')).toBe(0);
  });

  it('verlangt mindestens eine Nacht', () => {
    expect(
      dateRangeSchema.safeParse({ checkIn: '2026-09-05', checkOut: '2026-09-05' }).success,
    ).toBe(false);
    expect(
      dateRangeSchema.safeParse({ checkIn: '2026-09-05', checkOut: '2026-09-06' }).success,
    ).toBe(true);
  });
});
