import type { TripSlot } from '@/domain/trip/trip';

/**
 * Zwanzig Gespräche als Daten.
 *
 * Sie beschreiben, wie sich der Assistent verhalten **soll** — nicht, wie er
 * sich heute verhält. Mehrere Fälle stammen unmittelbar aus der Abnahme und
 * scheitern beim ersten Lauf; das ist beabsichtigt. Sie sind die Arbeitsliste
 * für die Überarbeitung der Regeln und danach der Beleg, dass sie gewirkt hat.
 *
 * Alle Ziele stammen aus dem Seed-Katalog, damit der Lauf ohne fremde Dienste
 * auskommt und auf jedem Rechner dasselbe Ergebnis liefert.
 */

/** Was nach dem Gespräch im Entwurf stehen muss. */
export interface ErwarteterEntwurf {
  /** IATA-Code oder `null` — `null` heisst: darf nicht gesetzt sein. */
  readonly destination?: string | null;
  readonly origin?: string | null;
  readonly departureDate?: string | null;
  readonly returnDate?: string | null;
  readonly adults?: number | null;
  readonly childAges?: readonly number[] | null;
  readonly budgetEuros?: number | null;
}

export interface EvalFall {
  readonly id: string;
  readonly beschreibung: string;
  /** Nacheinander gesendete Nachrichten der reisenden Person. */
  readonly nachrichten: readonly string[];
  readonly erwartet: ErwarteterEntwurf;
  /**
   * Zu welchem Feld eine Rückfrage kommen muss. `null`: keine Rückfrage
   * erwartet, weil alles vorliegt.
   */
  readonly erwarteteRueckfrage?: TripSlot | null;
  /** Muss der Agent nach Flügen gesucht haben? */
  readonly erwarteteSuche?: boolean;
  /**
   * Fälle, die das gewünschte Verhalten beschreiben, bevor es der Prompt
   * leistet. Sie zählen mit und werden gesondert ausgewiesen.
   *
   * Vier Fälle trugen diese Marke: die Frage nach Kindern, eine Rückfrage
   * statt einer Antwort, das Vergleichen mehrerer Zeiträume und das
   * Verschieben einer Reise. Alle vier sind seit Prompt 1.3.0 erfüllt, die
   * Marke ist deshalb nirgends mehr gesetzt. Sie bleibt im Typ, weil der
   * nächste Wunsch denselben Weg gehen soll: erst als roter Fall
   * aufschreiben, dann erfüllen.
   */
  readonly nochOffen?: boolean;
}

const HEUTE = '2026-07-29';

export const EVAL_HEUTE = HEUTE;

export const EVAL_FAELLE: readonly EvalFall[] = [
  // --- Der gerade Weg -------------------------------------------------
  {
    id: 'vollstaendig-in-einem-satz',
    beschreibung: 'Alle Pflichtangaben in einer einzigen Nachricht',
    nachrichten: [
      'Ich möchte am 2026-10-08 von Düsseldorf nach Mallorca fliegen, eine Woche, zu zweit.',
    ],
    erwartet: {
      origin: 'DUS',
      destination: 'PMI',
      departureDate: '2026-10-08',
      returnDate: '2026-10-15',
      adults: 2,
    },
    erwarteteRueckfrage: null,
    erwarteteSuche: true,
  },
  {
    id: 'schrittweise',
    beschreibung: 'Angaben über mehrere Nachrichten verteilt',
    nachrichten: [
      'Wir fliegen ab Düsseldorf',
      'nach Barcelona',
      'vom 12.09.2026 bis 19.09.2026',
      'zu zweit',
    ],
    erwartet: {
      origin: 'DUS',
      destination: 'BCN',
      departureDate: '2026-09-12',
      returnDate: '2026-09-19',
      adults: 2,
    },
    erwarteteSuche: true,
  },
  {
    id: 'deutsches-datumsformat',
    beschreibung: 'TT.MM.JJJJ statt ISO',
    nachrichten: ['Von Frankfurt nach Lissabon, 05.11.2026 bis 12.11.2026, 2 Personen'],
    erwartet: {
      origin: 'FRA',
      destination: 'LIS',
      departureDate: '2026-11-05',
      returnDate: '2026-11-12',
      adults: 2,
    },
  },

  // --- Nichts erfinden ------------------------------------------------
  {
    id: 'monat-ohne-datum',
    beschreibung: 'Ein Monat ist kein Zeitraum — es muss nachgefragt werden',
    nachrichten: ['Ich will im Oktober nach Mallorca, zu zweit'],
    erwartet: {
      destination: 'PMI',
      adults: 2,
      // Der Kern dieses Falls: kein erfundenes Datum.
      departureDate: null,
      returnDate: null,
    },
    /*
     * Nach dem Abflugort, nicht nach dem Datum: `MISSING_SLOT_ORDER` stellt
     * `origin` voran, und der ist hier ebenfalls unbekannt. Die erste Fassung
     * dieses Falls erwartete das Datum — der Agent hielt sich an die
     * abgesprochene Reihenfolge, die Erwartung war falsch.
     */
    erwarteteRueckfrage: 'origin',
  },
  {
    id: 'land-statt-stadt',
    beschreibung: 'Ein Land ist kein Ziel',
    nachrichten: ['Wir wollen nach Italien'],
    erwartet: { destination: null },
    erwarteteRueckfrage: 'destination',
  },
  {
    id: 'reisende-nicht-genannt',
    beschreibung: 'Ohne Angabe keine Zahl im Entwurf',
    nachrichten: ['Von Hamburg nach Wien vom 2026-09-03 bis 2026-09-08'],
    erwartet: {
      origin: 'HAM',
      destination: 'VIE',
      departureDate: '2026-09-03',
      adults: null,
    },
    erwarteteRueckfrage: 'adults',
  },
  {
    id: 'irgendwann-naechstes-jahr',
    beschreibung: 'Sehr vage Zeitangabe',
    nachrichten: ['Wir wollen irgendwann nächstes Jahr nach Kreta'],
    erwartet: { destination: 'HER', departureDate: null, returnDate: null },
    // Auch hier fehlt der Abflugort und wird zuerst erfragt.
    erwarteteRueckfrage: 'origin',
  },

  // --- Kinder ---------------------------------------------------------
  {
    id: 'kinder-mit-alter',
    beschreibung: 'Kinder samt Alter werden übernommen',
    nachrichten: [
      'Von München nach Antalya, 2026-08-15 bis 2026-08-29, 2 Erwachsene und zwei Kinder (6 und 9)',
    ],
    erwartet: {
      origin: 'MUC',
      destination: 'AYT',
      adults: 2,
      childAges: [6, 9],
    },
  },
  {
    id: 'nach-kindern-fragen',
    beschreibung: 'Nach der Zahl der Erwachsenen kommt genau eine Frage nach Kindern',
    nachrichten: ['Von Berlin nach Rhodos vom 2026-09-05 bis 2026-09-12', '2 Erwachsene'],
    erwartet: { origin: 'BER', destination: 'RHO', adults: 2 },
  },

  // --- Fragen der reisenden Person -------------------------------------
  {
    id: 'frage-statt-antwort',
    beschreibung: 'Eine Frage wird beantwortet, nicht übergangen',
    nachrichten: [
      'Von Düsseldorf nach Mallorca, 2026-10-08 bis 2026-10-15, zu zweit',
      'Kannst du die Daten flexibel machen?',
    ],
    erwartet: { destination: 'PMI', adults: 2 },
  },
  {
    id: 'beste-daten-im-monat',
    beschreibung: 'Mehrere Zeiträume prüfen und mit Preisen gegenüberstellen',
    nachrichten: [
      'Ich fahre irgendwann im Oktober in Urlaub nach Mallorca, ab Düsseldorf, zu zweit.',
      'Welche Daten sind am günstigsten?',
    ],
    erwartet: { destination: 'PMI', origin: 'DUS', adults: 2 },
    erwarteteSuche: true,
  },
  {
    id: 'wetterfrage',
    beschreibung: 'Klimafrage ist noch keine Reiseabsicht',
    nachrichten: ['Wie warm ist es im Oktober auf Teneriffa?'],
    /*
     * Wer nach dem Wetter fragt, hat noch nichts gebucht. Der Ort gehoert
     * deshalb nicht in den Entwurf — dieselbe Regel wie ueberall: nur
     * eintragen, was gesagt wurde.
     */
    erwartet: { destination: null },
  },
  {
    id: 'buchung-nicht-moeglich',
    beschreibung: 'Der Assistent bucht nicht und sagt das offen',
    nachrichten: [
      'Von Köln nach Faro, 2026-09-10 bis 2026-09-17, zu zweit',
      'Bitte buche den günstigsten Flug.',
    ],
    erwartet: { origin: 'CGN', destination: 'FAO' },
  },

  // --- Änderungen im Gespräch ------------------------------------------
  {
    id: 'ziel-geaendert',
    beschreibung: 'Ein späterer Wunsch ersetzt den früheren',
    nachrichten: ['Wir wollen nach Ibiza', 'Doch lieber nach Neapel'],
    erwartet: { destination: 'NAP' },
  },
  {
    id: 'datum-verschoben',
    beschreibung: 'Verschiebung der Reise wird übernommen',
    nachrichten: [
      'Von Stuttgart nach Athen, 2026-09-04 bis 2026-09-11, zu zweit',
      'Wir müssen eine Woche später fliegen.',
    ],
    erwartet: { origin: 'STR', destination: 'ATH', adults: 2 },
  },

  // --- Grenzfälle ------------------------------------------------------
  {
    id: 'rueckflug-vor-hinflug',
    beschreibung: 'Unmögliche Reihenfolge wird nicht stillschweigend gespeichert',
    nachrichten: ['Von Hannover nach Venedig, Hinflug 2026-10-20, Rückflug 2026-09-12, zu zweit'],
    erwartet: { origin: 'HAJ', destination: 'VCE', returnDate: null },
  },
  {
    id: 'datum-in-der-vergangenheit',
    beschreibung: 'Ein vergangenes Datum wird zurückgewiesen',
    nachrichten: ['Von Bremen nach Malaga am 2020-05-01, zu zweit'],
    erwartet: { origin: 'BRE', destination: 'AGP', departureDate: null },
  },
  {
    id: 'unbekanntes-ziel',
    beschreibung: 'Ein Ort ausserhalb des Katalogs wird nicht erfunden',
    nachrichten: ['Ich möchte nach Ulan-Bator fliegen'],
    /*
     * Im ersten Lauf trug das Modell hier „ULN" samt ausgedachter Koordinaten
     * ein, obwohl kein Werkzeug den Ort bestaetigt hatte. Genau dafuer gibt es
     * diesen Fall.
     */
    erwartet: { destination: null },
  },
  {
    id: 'ausser-thema',
    beschreibung: 'Kein Reisethema — der Entwurf bleibt leer',
    nachrichten: ['Wie ist das Rezept für Tiramisu?'],
    erwartet: { destination: null, origin: null, departureDate: null, adults: null },
  },
  {
    id: 'budget-und-praeferenz',
    beschreibung: 'Budget und Wunsch werden festgehalten',
    nachrichten: [
      'Von Nürnberg nach Palma, 2026-09-19 bis 2026-09-26, zu zweit, Budget 1200 Euro, gerne strandnah',
    ],
    erwartet: {
      origin: 'NUE',
      destination: 'PMI',
      adults: 2,
      budgetEuros: 1200,
    },
  },
];
