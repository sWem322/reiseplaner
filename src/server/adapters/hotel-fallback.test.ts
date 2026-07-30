import { describe, expect, it } from 'vitest';
import type { HotelSearchInput, HotelSearchPort } from '@/domain/ports/providers';
import type { HotelOffer } from '@/domain/offers';
import { fail, ok, unwrap, type Result } from '@/domain/result';
import { createHotelSearchWithFallback } from './hotel-fallback';
import { createSeedHotelSearch } from './seed/hotels';

/**
 * Der Rueckfall ist die Antwort auf einen Dienst, der monatelang schwieg.
 * Geprueft wird deshalb nicht nur, **dass** er greift, sondern auch, wann er
 * es nicht darf: bei einem Fehler, der beim Aufrufer liegt.
 */

const palma = { name: 'Palma de Mallorca', iataCode: 'PMI', latitude: 39.5517, longitude: 2.7388 };

const eingabe: HotelSearchInput = {
  destination: palma,
  checkIn: '2026-09-05',
  checkOut: '2026-09-12',
  guests: 2,
};

function angebot(id: string): HotelOffer {
  return {
    id,
    name: 'Hotel Echt',
    latitude: palma.latitude,
    longitude: palma.longitude,
    stars: 4,
    pricePerNightCents: 9_900,
    currency: 'EUR',
    distanceToCenterMeters: 800,
    isDemoData: true,
  };
}

/** Ein Port, der zaehlt, wie oft er gefragt wurde. */
function port(antwort: Result<HotelOffer[]>): HotelSearchPort & { aufrufe: () => number } {
  let aufrufe = 0;

  return {
    search: (): Promise<Result<HotelOffer[]>> => {
      aufrufe += 1;

      return Promise.resolve(antwort);
    },
    aufrufe: () => aufrufe,
  };
}

describe('Unterkunftssuche mit Rueckfallebene', () => {
  it('nimmt das Ergebnis des echten Anbieters, wenn er antwortet', async () => {
    const echt = port(ok([angebot('osm-1')]));
    const ersatz = port(ok([angebot('seed-1')]));

    const offers = unwrap(await createHotelSearchWithFallback(echt, ersatz).search(eingabe, 5));

    expect(offers[0]?.id).toBe('osm-1');
    expect(ersatz.aufrufe()).toBe(0);
  });

  it('faellt auf den Seed-Katalog zurueck, wenn der Anbieter nicht erreichbar ist', async () => {
    const echt = port(fail('upstream_error', 'Overpass antwortete mit Status 406'));
    const ersatz = port(ok([angebot('seed-1')]));

    const offers = unwrap(await createHotelSearchWithFallback(echt, ersatz).search(eingabe, 5));

    expect(offers[0]?.id).toBe('seed-1');
    expect(ersatz.aufrufe()).toBe(1);
  });

  it('faellt auch bei einer Drosselung zurueck', async () => {
    const echt = port(fail('rate_limited', 'zu viele Anfragen'));
    const ersatz = port(ok([angebot('seed-1')]));

    const ergebnis = await createHotelSearchWithFallback(echt, ersatz).search(eingabe, 5);

    expect(ergebnis.ok).toBe(true);
  });

  /*
   * Der wichtigste Fall: Null Naechte sind kein Ausfall des Anbieters,
   * sondern ein Fehler der Anfrage. Wuerde der Ersatz einspringen, verschwaende
   * er die Meldung, die erklaert, was falsch war — und scheiterte danach
   * ohnehin an derselben Stelle.
   */
  it('reicht einen Eingabefehler durch, statt ihn zu verschlucken', async () => {
    const echt = port(
      fail('validation_error', 'Der Aufenthalt muss mindestens eine Nacht umfassen'),
    );
    const ersatz = port(ok([angebot('seed-1')]));

    const ergebnis = await createHotelSearchWithFallback(echt, ersatz).search(eingabe, 5);

    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) {
      expect(ergebnis.error.kind).toBe('validation_error');
    }
    expect(ersatz.aufrufe()).toBe(0);
  });

  it('liefert eine leere Liste des echten Anbieters, ohne den Ersatz zu fragen', async () => {
    // Keine Unterkunft gefunden ist eine Auskunft, kein Fehler — und sie darf
    // nicht durch erfundene Haeuser ersetzt werden.
    const echt = port(ok([]));
    const ersatz = port(ok([angebot('seed-1')]));

    const offers = unwrap(await createHotelSearchWithFallback(echt, ersatz).search(eingabe, 5));

    expect(offers).toHaveLength(0);
    expect(ersatz.aufrufe()).toBe(0);
  });

  it('kennzeichnet jede Unterkunft aus dem Ersatz als Beispieldaten', async () => {
    const echt = port(fail('upstream_error', 'nicht erreichbar'));

    const offers = unwrap(
      await createHotelSearchWithFallback(echt, createSeedHotelSearch()).search(eingabe, 5),
    );

    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((offer) => offer.isDemoData)).toBe(true);
  });
});
