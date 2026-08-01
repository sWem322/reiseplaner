import { describe, expect, it } from 'vitest';
import {
  MISSING_SLOT_ORDER,
  canStartSearch,
  emptyTripDraft,
  iataCodeSchema,
  missingSlots,
  placeSchema,
  toTripQuery,
  tripDraftSchema,
  type TripDraft,
} from './trip';

/** Ein Datum, das zuverlaessig in der Zukunft liegt. */
function futureDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const duesseldorf = {
  name: 'Düsseldorf',
  iataCode: 'DUS',
  latitude: 51.2895,
  longitude: 6.7668,
};

const palma = {
  name: 'Palma de Mallorca',
  iataCode: 'PMI',
  latitude: 39.5517,
  longitude: 2.7388,
};

function completeDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    ...emptyTripDraft(),
    origin: duesseldorf,
    destination: palma,
    departureDate: futureDate(30),
    returnDate: futureDate(37),
    adults: 2,
    ...overrides,
  };
}

describe('IATA-Code', () => {
  it('akzeptiert genau drei Grossbuchstaben', () => {
    expect(iataCodeSchema.safeParse('DUS').success).toBe(true);
  });

  it.each(['dus', 'DUSS', 'DU', 'D1S', '', '  DUS  '])('lehnt %o ab', (input) => {
    expect(iataCodeSchema.safeParse(input).success).toBe(false);
  });
});

describe('Ort', () => {
  it('akzeptiert einen vollstaendigen Ort', () => {
    expect(placeSchema.safeParse(duesseldorf).success).toBe(true);
  });

  it.each([
    ['Breitengrad ausserhalb des Bereichs', { ...duesseldorf, latitude: 91 }],
    ['Laengengrad ausserhalb des Bereichs', { ...duesseldorf, longitude: -181 }],
    ['leerer Name', { ...duesseldorf, name: '' }],
  ])('lehnt %s ab', (_beschreibung, input) => {
    expect(placeSchema.safeParse(input).success).toBe(false);
  });
});

describe('Fehlende Angaben', () => {
  it('meldet bei leerem Entwurf alle Pflichtangaben', () => {
    const missing = missingSlots(emptyTripDraft());

    expect(missing).toHaveLength(MISSING_SLOT_ORDER.length);
    expect(missing).toEqual(expect.arrayContaining([...MISSING_SLOT_ORDER]));
  });

  it('meldet bei vollstaendigem Entwurf nichts', () => {
    expect(missingSlots(completeDraft())).toEqual([]);
  });

  it('haelt eine stabile Reihenfolge ein', () => {
    const missing = missingSlots(emptyTripDraft());

    expect(missing).toEqual(MISSING_SLOT_ORDER.filter((slot) => missing.includes(slot)));
  });

  it('meldet gezielt die eine fehlende Angabe', () => {
    const draft = completeDraft();
    const ohneRueckflug: TripDraft = { ...draft, returnDate: null };

    expect(missingSlots(ohneRueckflug)).toEqual(['returnDate']);
  });

  it('behandelt Kinder, Budget und Praeferenzen nicht als Pflicht', () => {
    const draft = completeDraft({ childAges: [], budgetEuros: null, preferences: [] });

    expect(missingSlots(draft)).toEqual([]);
  });
});

describe('Suchbereitschaft', () => {
  it('erlaubt die Suche bei vollstaendigem Entwurf', () => {
    expect(canStartSearch(completeDraft())).toBe(true);
  });

  it('verweigert die Suche bei fehlender Angabe', () => {
    expect(canStartSearch({ ...completeDraft(), adults: null })).toBe(false);
  });
});

describe('Ueberfuehrung in eine Suchanfrage', () => {
  it('uebernimmt alle Angaben verlustfrei', () => {
    const draft = completeDraft({ childAges: [4, 9], budgetEuros: 2000 });
    const result = toTripQuery(draft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.origin.iataCode).toBe('DUS');
      expect(result.value.destination.iataCode).toBe('PMI');
      expect(result.value.childAges).toEqual([4, 9]);
      expect(result.value.budgetEuros).toBe(2000);
    }
  });

  it('scheitert mit Angabe der fehlenden Slots', () => {
    const result = toTripQuery(emptyTripDraft());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_error');
      expect(result.error.message).toContain('destination');
    }
  });

  it('scheitert, wenn eine optionale Angabe ungueltig ist', () => {
    // Alle Pflichtslots sind gefuellt, aber ein Kindesalter ist unmoeglich.
    // Dieser Pfad schuetzt davor, dass ungeprueft Daten an einen Anbieter gehen.
    const draft = completeDraft({ childAges: [42] });
    const result = toTripQuery(draft);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_error');
      expect(result.error.details).toHaveProperty('issues');
    }
  });
});

describe('Teilweise gefuellte Angaben', () => {
  it('prueft die Datumsreihenfolge erst, wenn beide Daten vorliegen', () => {
    const nurHinreise = { ...emptyTripDraft(), departureDate: futureDate(30) };
    const nurRueckreise = { ...emptyTripDraft(), returnDate: futureDate(10) };

    expect(tripDraftSchema.safeParse(nurHinreise).success).toBe(true);
    expect(tripDraftSchema.safeParse(nurRueckreise).success).toBe(true);
  });

  it('prueft die Ortsgleichheit erst, wenn beide Orte vorliegen', () => {
    const nurZiel = { ...emptyTripDraft(), destination: palma };

    expect(tripDraftSchema.safeParse(nurZiel).success).toBe(true);
  });
});

describe('Validierung des Entwurfs', () => {
  it('akzeptiert einen plausiblen Entwurf', () => {
    expect(tripDraftSchema.safeParse(completeDraft()).success).toBe(true);
  });

  it('lehnt eine Rueckreise vor der Hinreise ab', () => {
    const draft = completeDraft({ departureDate: futureDate(30), returnDate: futureDate(20) });

    expect(tripDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('lehnt ein Abflugdatum in der Vergangenheit ab', () => {
    const draft = completeDraft({ departureDate: futureDate(-1), returnDate: futureDate(10) });

    expect(tripDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('erlaubt eine Reise, die heute beginnt', () => {
    const draft = completeDraft({ departureDate: futureDate(0), returnDate: futureDate(5) });

    expect(tripDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('lehnt eine Reise ueber einem Jahr Dauer ab', () => {
    const draft = completeDraft({ departureDate: futureDate(10), returnDate: futureDate(400) });

    expect(tripDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('lehnt identischen Abflug- und Zielort ab', () => {
    const draft = completeDraft({ destination: duesseldorf });

    expect(tripDraftSchema.safeParse(draft).success).toBe(false);
  });

  it.each([0, -1, 10])('lehnt %i Erwachsene ab', (adults) => {
    expect(tripDraftSchema.safeParse(completeDraft({ adults })).success).toBe(false);
  });

  it.each([[-1], [18], [2.5]])('lehnt Kindesalter %o ab', (age) => {
    expect(tripDraftSchema.safeParse(completeDraft({ childAges: [age] })).success).toBe(false);
  });

  it.each([0, -100, 1.5])('lehnt Budget %o ab', (budgetEuros) => {
    expect(tripDraftSchema.safeParse(completeDraft({ budgetEuros })).success).toBe(false);
  });

  it('lehnt ein Datum im falschen Format ab', () => {
    expect(tripDraftSchema.safeParse(completeDraft({ departureDate: '01.09.2026' })).success).toBe(
      false,
    );
  });
});
