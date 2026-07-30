import '../eval/load-env';

import { CATALOG } from '@/server/adapters/seed/catalog';
import {
  createOpenMeteoGeocoding,
  createOpenMeteoWeather,
} from '@/server/adapters/http/open-meteo';
import { createOverpassHotelSearch, OVERPASS_ENDPOINTS } from '@/server/adapters/http/overpass';
import { createDuffelFlightSearch } from '@/server/adapters/http/duffel';
import type { Place } from '@/domain/trip/trip';
import type { Result } from '@/domain/result';

/**
 * Ein echter Aufruf gegen jeden fremden Dienst.
 *
 *   npm run providers:check
 *
 * Entstanden aus einer Frage, die sich anders nicht beantworten liess: „Die
 * Hotelsuche hat noch nie funktioniert — liegt das an meinem Code?" Die
 * Unit-Tests sagen dazu nichts, denn sie schieben dem Adapter eine Antwort
 * unter; sie pruefen die Uebersetzung, nicht die Erreichbarkeit. Und die
 * Oberflaeche sagte bis dahin nur „Anbieter nicht erreichbar", ohne zu
 * verraten, welcher Status oder welche Ursache dahintersteckte.
 *
 * Deshalb laufen hier die **echten** Adapter — nicht nachgebaute Anfragen.
 * Was das Skript meldet, meldet auch die Anwendung.
 *
 * Der Ausgabecode ist 1, sobald ein Dienst, der erreichbar sein sollte, es
 * nicht ist. So taugt der Aufruf auch fuer eine spaetere Ueberwachung.
 */

const ZIEL = 'Palma de Mallorca';
const MONAT = 10;

/** Ein Ort aus dem Katalog — unabhaengig davon, ob die Ortssuche gerade geht. */
function ort(iataCode: string): Place {
  const eintrag = CATALOG.find((platz) => platz.iataCode === iataCode);

  if (eintrag === undefined) {
    throw new Error(`Der Seed-Katalog kennt ${iataCode} nicht`);
  }

  return {
    name: eintrag.name,
    iataCode: eintrag.iataCode,
    latitude: eintrag.latitude,
    longitude: eintrag.longitude,
  };
}

interface Befund {
  readonly dienst: string;
  readonly zustand: 'ok' | 'fehler' | 'uebersprungen';
  readonly dauerMs: number;
  readonly text: string;
}

async function messen<T>(
  dienst: string,
  aufruf: () => Promise<Result<T>>,
  beschreiben: (wert: T) => string,
): Promise<Befund> {
  const start = Date.now();

  try {
    const ergebnis = await aufruf();
    const dauerMs = Date.now() - start;

    if (ergebnis.ok) {
      return { dienst, zustand: 'ok', dauerMs, text: beschreiben(ergebnis.value) };
    }

    /*
     * Die Ursache steht in `details.cause` — dort landet die Meldung der
     * Laufzeit, etwa `fetch failed` oder ein abgebrochener Abruf. Genau die
     * fehlte bisher, wenn jemand wissen wollte, warum ein Dienst schweigt.
     */
    const ursache = ergebnis.error.details?.cause;

    return {
      dienst,
      zustand: 'fehler',
      dauerMs,
      text:
        `[${ergebnis.error.kind}] ${ergebnis.error.message}` +
        (typeof ursache === 'string' ? `\n    Ursache: ${ursache}` : ''),
    };
  } catch (error) {
    // Ein Adapter, der wirft statt ein Result zu liefern, ist selbst ein Fund.
    return {
      dienst,
      zustand: 'fehler',
      dauerMs: Date.now() - start,
      text: `Ausnahme statt Result: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main(): Promise<void> {
  const palma = ort('PMI');
  const duesseldorf = ort('DUS');
  const duffelToken = process.env.DUFFEL_ACCESS_TOKEN ?? '';

  console.log('Anbieter-Prüfung — echte Aufrufe, keine untergeschobenen Antworten\n');

  const befunde: Befund[] = [];

  befunde.push(
    await messen(
      'Open-Meteo · Orte',
      () => createOpenMeteoGeocoding().resolve(ZIEL),
      (orte) =>
        `${String(orte.length)} Treffer, erster: ${orte[0]?.name ?? '—'} (${orte[0]?.iataCode ?? '—'})`,
    ),
  );

  befunde.push(
    await messen(
      'Open-Meteo · Klima',
      () => createOpenMeteoWeather().outlook(palma, MONAT),
      (klima) =>
        `Monat ${String(MONAT)}: ${klima.averageHighCelsius.toFixed(1)} °C / ` +
        `${klima.averageLowCelsius.toFixed(1)} °C, ${String(klima.rainyDays)} Regentage`,
    ),
  );

  /*
   * Jede Instanz einzeln, nicht die Kette als Ganzes.
   *
   * „Overpass antwortet nicht" ist keine brauchbare Auskunft, wenn drei
   * Server dahinterstehen. Die Zeile je Instanz sagt, welche noch lebt — und
   * ob die Reihenfolge in `OVERPASS_ENDPOINTS` noch die richtige ist.
   */
  for (const endpoint of OVERPASS_ENDPOINTS) {
    befunde.push(
      await messen(
        `Overpass · ${new URL(endpoint).host}`,
        () =>
          createOverpassHotelSearch(fetch, [endpoint]).search(
            { destination: palma, checkIn: '2026-10-07', checkOut: '2026-10-14', guests: 2 },
            5,
          ),
        (hotels) => `${String(hotels.length)} Häuser, erstes: ${hotels[0]?.name ?? '—'}`,
      ),
    );
  }

  if (duffelToken.length === 0) {
    befunde.push({
      dienst: 'Duffel · Flüge',
      zustand: 'uebersprungen',
      dauerMs: 0,
      text: 'kein DUFFEL_ACCESS_TOKEN — die Anwendung nutzt hier Seed-Daten',
    });
  } else {
    befunde.push(
      await messen(
        'Duffel · Flüge',
        () =>
          createDuffelFlightSearch(duffelToken).search(
            {
              origin: duesseldorf,
              destination: palma,
              departureDate: '2026-10-07',
              returnDate: '2026-10-14',
              adults: 2,
              childAges: [],
              budgetEuros: null,
              preferences: [],
            },
            5,
          ),
        (fluege) =>
          `${String(fluege.length)} Angebote, günstigstes: ${
            fluege[0] === undefined
              ? '—'
              : `${String(Math.round(fluege[0].totalPriceCents / 100))} €`
          }`,
      ),
    );
  }

  const breite = Math.max(...befunde.map((befund) => befund.dienst.length));

  for (const befund of befunde) {
    const zeichen = { ok: '✓', fehler: '✗', uebersprungen: '–' }[befund.zustand];
    const dauer = befund.zustand === 'uebersprungen' ? '' : `${String(befund.dauerMs)} ms`;

    console.log(`${zeichen} ${befund.dienst.padEnd(breite)}  ${dauer.padStart(8)}  ${befund.text}`);
  }

  /*
   * Eine tote Overpass-Instanz ist kein Ausfall, solange eine andere
   * antwortet — genau dafuer ist die Kette da. Erst wenn keine mehr geht,
   * fehlt die Hotelsuche wirklich.
   */
  const overpass = befunde.filter((befund) => befund.dienst.startsWith('Overpass'));
  const overpassLebt = overpass.some((befund) => befund.zustand === 'ok');

  const gescheitert = befunde.filter(
    (befund) =>
      befund.zustand === 'fehler' && !(overpassLebt && befund.dienst.startsWith('Overpass')),
  );

  console.log('');

  if (gescheitert.length === 0) {
    console.log(
      overpassLebt && overpass.some((befund) => befund.zustand === 'fehler')
        ? 'Alle Dienste antworten — bei Overpass nicht jede Instanz, aber genug.'
        : 'Alle erreichbaren Dienste antworten.',
    );

    return;
  }

  console.log(
    `${String(gescheitert.length)} Dienst(e) antworten nicht. ` +
      'Läuft die Prüfung hier durch, aber im Betrieb nicht, liegt es an der ' +
      'Plattform — dann trifft der Ausfall die IP-Adresse des Hosters, nicht den Code.',
  );

  process.exitCode = 1;
}

await main();
