import { describe, expect, it } from 'vitest';
import type { TripDraftRepository } from '@/domain/ports/repositories';
import { emptyTripDraft, tripDraftSchema, type TripDraft } from '@/domain/trip/trip';
import { ok, unwrap, type Result } from '@/domain/result';
import { createSeedProviders } from '@/server/adapters/factory';
import { createToolRegistry } from './index';
import { describeTools, validateCall } from './registry';

const CONTEXT = { conversationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' };

function createDrafts(initial: TripDraft = emptyTripDraft()): TripDraftRepository {
  let draft = initial;

  return {
    createForConversation: () => Promise.resolve(draft),
    findByConversation: () => Promise.resolve(draft),
    save: (_id, next): Promise<Result<TripDraft>> => {
      const parsed = tripDraftSchema.safeParse(next);

      if (!parsed.success) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'validation_error', message: 'ungültig' },
        });
      }

      draft = parsed.data;
      return Promise.resolve(ok(draft));
    },
  };
}

function registry(drafts: TripDraftRepository = createDrafts()) {
  return createToolRegistry({ providers: createSeedProviders(), tripDrafts: drafts });
}

async function call(toolName: string, input: unknown, drafts?: TripDraftRepository) {
  const reg = registry(drafts);
  const validated = validateCall(reg, toolName, input);

  if (!validated.ok) {
    return validated;
  }

  return validated.value.tool.execute(validated.value.input, CONTEXT);
}

describe('Registry', () => {
  it('beschreibt alle sechs Werkzeuge fuer das Modell', () => {
    const descriptions = describeTools(registry());

    expect(descriptions).toHaveLength(6);
    for (const description of descriptions) {
      expect(description.description.length).toBeGreaterThan(40);
      expect(description.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('lehnt doppelte Werkzeugnamen beim Aufbau ab', () => {
    const drafts = createDrafts();

    expect(() => {
      const reg = registry(drafts);
      // Zweite Registrierung desselben Namens ueber den oeffentlichen Weg.
      const tools = [...reg.values(), ...reg.values()];
      const map = new Map<string, unknown>();

      for (const tool of tools) {
        if (map.has(tool.name)) {
          throw new Error(`Werkzeugname doppelt vergeben: ${tool.name}`);
        }
        map.set(tool.name, tool);
      }
    }).toThrow(/doppelt vergeben/);
  });

  it('nennt bei unbekanntem Werkzeug die verfuegbaren Namen', () => {
    const result = validateCall(registry(), 'nicht_vorhanden', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('resolve_destination');
    }
  });
});

describe('resolve_destination', () => {
  it('loest einen Ortsnamen auf', async () => {
    const result = await call('resolve_destination', { query: 'Mallorca' });
    const value = unwrap(result) as { matches: { iataCode: string }[] };

    expect(value.matches[0]?.iataCode).toBe('PMI');
  });

  it('lehnt einen zu kurzen Suchbegriff ab', async () => {
    const result = await call('resolve_destination', { query: 'M' });

    expect(result.ok).toBe(false);
  });

  it('meldet einen unbekannten Ort', async () => {
    const result = await call('resolve_destination', { query: 'Atlantis' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });
});

describe('search_flights', () => {
  const gueltig = {
    originIata: 'DUS',
    destinationIata: 'PMI',
    departureDate: '2026-09-05',
    returnDate: '2026-09-12',
    adults: 2,
    childAges: [],
  };

  it('liefert Angebote in verkuerzter Form', async () => {
    const result = await call('search_flights', gueltig);
    const value = unwrap(result) as { offers: { priceEuros: number; stops: number }[] };

    expect(value.offers.length).toBeGreaterThan(0);
    expect(value.offers[0]?.priceEuros).toBeGreaterThan(0);
    expect(value.offers[0]?.stops).toBe(0);
  });

  it('setzt childAges auf eine leere Liste, wenn nichts angegeben wurde', async () => {
    const { childAges: _unused, ...ohneKinder } = gueltig;
    const result = await call('search_flights', ohneKinder);

    expect(result.ok).toBe(true);
  });

  it.each([
    ['kleingeschriebener IATA-Code', { ...gueltig, originIata: 'dus' }],
    ['zu langer IATA-Code', { ...gueltig, destinationIata: 'PMIX' }],
    ['Datum im falschen Format', { ...gueltig, departureDate: '05.09.2026' }],
    ['null Erwachsene', { ...gueltig, adults: 0 }],
    ['Kind mit Alter 20', { ...gueltig, childAges: [20] }],
  ])('lehnt %s ab', async (_beschreibung, input) => {
    const result = await call('search_flights', input);

    expect(result.ok).toBe(false);
  });

  it('meldet einen unbekannten Flughafen', async () => {
    const result = await call('search_flights', { ...gueltig, originIata: 'XXX' });

    expect(result.ok).toBe(false);
  });
});

describe('search_hotels', () => {
  const gueltig = {
    destinationIata: 'PMI',
    checkIn: '2026-09-05',
    checkOut: '2026-09-12',
    guests: 2,
  };

  it('liefert Angebote samt Gesamtpreis fuer den Aufenthalt', async () => {
    const result = await call('search_hotels', gueltig);
    const value = unwrap(result) as {
      nights: number;
      offers: { pricePerNightEuros: number; totalEuros: number }[];
    };

    expect(value.nights).toBe(7);
    const erstes = value.offers[0];
    expect(erstes?.totalEuros).toBe((erstes?.pricePerNightEuros ?? 0) * 7);
  });

  it('lehnt einen Aufenthalt ohne Uebernachtung ab', async () => {
    const result = await call('search_hotels', { ...gueltig, checkOut: gueltig.checkIn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_error');
    }
  });

  it('meldet einen unbekannten Zielort', async () => {
    const result = await call('search_hotels', { ...gueltig, destinationIata: 'XXX' });

    expect(result.ok).toBe(false);
  });
});

describe('get_weather_outlook', () => {
  it('liefert Normalwerte fuer den Monat', async () => {
    const result = await call('get_weather_outlook', { destinationIata: 'PMI', month: 9 });
    const value = unwrap(result) as { month: number; averageHighCelsius: number };

    expect(value.month).toBe(9);
    expect(value.averageHighCelsius).toBeGreaterThan(0);
  });

  it.each([0, 13])('lehnt Monat %i ab', async (month) => {
    const result = await call('get_weather_outlook', { destinationIata: 'PMI', month });

    expect(result.ok).toBe(false);
  });

  it('meldet einen unbekannten Ort', async () => {
    const result = await call('get_weather_outlook', { destinationIata: 'XXX', month: 9 });

    expect(result.ok).toBe(false);
  });
});

describe('update_trip_draft und get_trip_draft', () => {
  it('schreibt Angaben und meldet die fehlenden', async () => {
    const drafts = createDrafts();

    const result = await call('update_trip_draft', { adults: 2, budgetEuros: 1500 }, drafts);
    const value = unwrap(result) as { missing: string[]; readyToSearch: boolean };

    expect(value.readyToSearch).toBe(false);
    expect(value.missing).toContain('destination');
  });

  it('meldet einen vollstaendigen Entwurf als suchbereit', async () => {
    const drafts = createDrafts({
      ...emptyTripDraft(),
      origin: { name: 'Düsseldorf', iataCode: 'DUS', latitude: 51.2895, longitude: 6.7668 },
      destination: { name: 'Palma', iataCode: 'PMI', latitude: 39.5517, longitude: 2.7388 },
      departureDate: '2027-09-05',
      returnDate: '2027-09-12',
      adults: 2,
    });

    const result = await call('get_trip_draft', {}, drafts);
    const value = unwrap(result) as { readyToSearch: boolean; missing: string[] };

    expect(value.readyToSearch).toBe(true);
    expect(value.missing).toEqual([]);
  });

  it('laesst nicht genannte Felder unveraendert', async () => {
    const drafts = createDrafts({ ...emptyTripDraft(), adults: 4 });

    await call('update_trip_draft', { budgetEuros: 900 }, drafts);
    const result = await call('get_trip_draft', {}, drafts);
    const value = unwrap(result) as { draft: { adults: number; budgetEuros: number } };

    expect(value.draft.adults).toBe(4);
    expect(value.draft.budgetEuros).toBe(900);
  });

  /**
   * Eine beanstandete Angabe reisst die uebrigen nicht mit.
   *
   * Der Eval fand den Fall: „von Bremen nach Malaga am 2020-05-01" verlor mit
   * dem vergangenen Datum auch Abflugort und Ziel, weil die Pruefung den
   * ganzen Entwurf ablehnte. Verworfen wird jetzt nur das beanstandete Feld —
   * und es wird benannt, damit das Modell es ansprechen kann.
   */
  it('behaelt gueltige Angaben, wenn eine einzelne beanstandet wird', async () => {
    const drafts = createDrafts();

    const result = await call(
      'update_trip_draft',
      {
        origin: { name: 'Bremen', iataCode: 'BRE', latitude: 53.05, longitude: 8.79 },
        destination: { name: 'Malaga', iataCode: 'AGP', latitude: 36.67, longitude: -4.5 },
        departureDate: '2020-05-01',
      },
      drafts,
    );

    const value = unwrap(result) as {
      draft: TripDraft;
      abgelehnt?: { feld: string; grund: string }[];
    };

    expect(value.draft.origin?.iataCode).toBe('BRE');
    expect(value.draft.destination?.iataCode).toBe('AGP');
    expect(value.draft.departureDate).toBeNull();
    expect(value.abgelehnt?.[0]?.feld).toBe('departureDate');
  });

  it('nennt den Grund der Ablehnung im Klartext', async () => {
    const drafts = createDrafts();

    const result = await call(
      'update_trip_draft',
      { departureDate: '2020-01-01', returnDate: '2020-01-08' },
      drafts,
    );

    const value = unwrap(result) as { abgelehnt?: { feld: string; grund: string }[] };

    // Kein Fehler mehr, aber auch kein Schweigen: Der Satz steht im Ergebnis.
    expect(result.ok).toBe(true);
    expect(value.abgelehnt?.[0]?.grund).toContain('Vergangenheit');
  });

  it('meldet einen fehlenden Entwurf statt still zu scheitern', async () => {
    const ohneEntwurf: TripDraftRepository = {
      createForConversation: () => Promise.resolve(emptyTripDraft()),
      findByConversation: () => Promise.resolve(null),
      save: (_id, draft) => Promise.resolve(ok(draft)),
    };

    const result = await call('get_trip_draft', {}, ohneEntwurf);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
    }
  });
});
