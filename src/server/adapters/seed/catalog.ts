import type { Place } from '@/domain/trip/trip';

/**
 * Ortskatalog fuer den schluessellosen Betrieb.
 *
 * Bewusst klein und handgepflegt statt vollstaendig: Er deckt die Strecken ab,
 * die eine Demo aus Deutschland heraus plausibel macht. Ein vollstaendiger
 * Flughafendatensatz waere mehrere Megabyte gross und wuerde nichts
 * demonstrieren, was diese zwei Dutzend Eintraege nicht auch zeigen.
 */

export interface CatalogEntry extends Place {
  /** Suchbegriffe, unter denen der Ort gefunden werden soll — kleingeschrieben. */
  readonly aliases: readonly string[];
  readonly country: string;
  /** Liegt der Ort am Meer? Steuert die Wasertemperatur in der Wetterauskunft. */
  readonly coastal: boolean;
}

/** Deutsche Abflughaefen. */
export const GERMAN_AIRPORTS: readonly CatalogEntry[] = [
  {
    name: 'Düsseldorf',
    iataCode: 'DUS',
    latitude: 51.2895,
    longitude: 6.7668,
    aliases: ['duesseldorf', 'dusseldorf', 'düsseldorf', 'dus'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Köln/Bonn',
    iataCode: 'CGN',
    latitude: 50.8659,
    longitude: 7.1427,
    aliases: ['koeln', 'köln', 'cologne', 'bonn', 'cgn'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Frankfurt am Main',
    iataCode: 'FRA',
    latitude: 50.0379,
    longitude: 8.5622,
    aliases: ['frankfurt', 'fra'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'München',
    iataCode: 'MUC',
    latitude: 48.3538,
    longitude: 11.7861,
    aliases: ['muenchen', 'münchen', 'munich', 'muc'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Berlin Brandenburg',
    iataCode: 'BER',
    latitude: 52.3667,
    longitude: 13.5033,
    aliases: ['berlin', 'ber'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Hamburg',
    iataCode: 'HAM',
    latitude: 53.6304,
    longitude: 9.9882,
    aliases: ['hamburg', 'ham'],
    country: 'DE',
    coastal: true,
  },
  {
    name: 'Stuttgart',
    iataCode: 'STR',
    latitude: 48.6899,
    longitude: 9.2219,
    aliases: ['stuttgart', 'str'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Hannover',
    iataCode: 'HAJ',
    latitude: 52.4611,
    longitude: 9.6851,
    aliases: ['hannover', 'hanover', 'haj'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Nürnberg',
    iataCode: 'NUE',
    latitude: 49.4987,
    longitude: 11.0781,
    aliases: ['nuernberg', 'nürnberg', 'nuremberg', 'nue'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Bremen',
    iataCode: 'BRE',
    latitude: 53.0475,
    longitude: 8.7867,
    aliases: ['bremen', 'bre'],
    country: 'DE',
    coastal: true,
  },
  {
    name: 'Leipzig/Halle',
    iataCode: 'LEJ',
    latitude: 51.4239,
    longitude: 12.2364,
    aliases: ['leipzig', 'halle', 'lej'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Dresden',
    iataCode: 'DRS',
    latitude: 51.1328,
    longitude: 13.7672,
    aliases: ['dresden', 'drs'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Dortmund',
    iataCode: 'DTM',
    latitude: 51.5183,
    longitude: 7.6122,
    aliases: ['dortmund', 'dtm'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Münster/Osnabrück',
    iataCode: 'FMO',
    latitude: 52.1346,
    longitude: 7.6848,
    aliases: ['muenster', 'münster', 'osnabrueck', 'osnabrück', 'fmo'],
    country: 'DE',
    coastal: false,
  },
  {
    name: 'Karlsruhe/Baden-Baden',
    iataCode: 'FKB',
    latitude: 48.7794,
    longitude: 8.0805,
    aliases: ['karlsruhe', 'baden-baden', 'baden baden', 'fkb'],
    country: 'DE',
    coastal: false,
  },
];

/** Beliebte Reiseziele ab Deutschland. */
export const DESTINATIONS: readonly CatalogEntry[] = [
  {
    name: 'Palma de Mallorca',
    iataCode: 'PMI',
    latitude: 39.5517,
    longitude: 2.7388,
    aliases: ['mallorca', 'palma', 'palma de mallorca', 'malle', 'pmi'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Ibiza',
    iataCode: 'IBZ',
    latitude: 38.8729,
    longitude: 1.3731,
    aliases: ['ibiza', 'ibz'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Teneriffa Süd',
    iataCode: 'TFS',
    latitude: 28.0445,
    longitude: -16.5725,
    aliases: ['teneriffa', 'tenerife', 'kanaren', 'tfs'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Gran Canaria',
    iataCode: 'LPA',
    latitude: 27.9319,
    longitude: -15.3866,
    aliases: ['gran canaria', 'las palmas', 'lpa'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Barcelona',
    iataCode: 'BCN',
    latitude: 41.2971,
    longitude: 2.0785,
    aliases: ['barcelona', 'bcn'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Málaga',
    iataCode: 'AGP',
    latitude: 36.6749,
    longitude: -4.4991,
    aliases: ['malaga', 'málaga', 'andalusien', 'costa del sol', 'agp'],
    country: 'ES',
    coastal: true,
  },
  {
    name: 'Lissabon',
    iataCode: 'LIS',
    latitude: 38.7742,
    longitude: -9.1342,
    aliases: ['lissabon', 'lisbon', 'lisboa', 'portugal', 'lis'],
    country: 'PT',
    coastal: true,
  },
  {
    name: 'Faro',
    iataCode: 'FAO',
    latitude: 37.0144,
    longitude: -7.9659,
    aliases: ['faro', 'algarve', 'fao'],
    country: 'PT',
    coastal: true,
  },
  {
    name: 'Rom Fiumicino',
    iataCode: 'FCO',
    latitude: 41.8003,
    longitude: 12.2389,
    aliases: ['rom', 'rome', 'roma', 'fco'],
    country: 'IT',
    coastal: true,
  },
  {
    name: 'Neapel',
    iataCode: 'NAP',
    latitude: 40.886,
    longitude: 14.2908,
    aliases: ['neapel', 'naples', 'napoli', 'amalfi', 'nap'],
    country: 'IT',
    coastal: true,
  },
  {
    name: 'Catania',
    iataCode: 'CTA',
    latitude: 37.4668,
    longitude: 15.0664,
    aliases: ['catania', 'sizilien', 'sicily', 'cta'],
    country: 'IT',
    coastal: true,
  },
  {
    name: 'Venedig',
    iataCode: 'VCE',
    latitude: 45.5053,
    longitude: 12.3519,
    aliases: ['venedig', 'venice', 'venezia', 'vce'],
    country: 'IT',
    coastal: true,
  },
  {
    name: 'Athen',
    iataCode: 'ATH',
    latitude: 37.9364,
    longitude: 23.9445,
    aliases: ['athen', 'athens', 'griechenland', 'ath'],
    country: 'GR',
    coastal: true,
  },
  {
    name: 'Kreta Heraklion',
    iataCode: 'HER',
    latitude: 35.3397,
    longitude: 25.1803,
    aliases: ['kreta', 'crete', 'heraklion', 'her'],
    country: 'GR',
    coastal: true,
  },
  {
    name: 'Rhodos',
    iataCode: 'RHO',
    latitude: 36.4054,
    longitude: 28.0862,
    aliases: ['rhodos', 'rhodes', 'rho'],
    country: 'GR',
    coastal: true,
  },
  {
    name: 'Antalya',
    iataCode: 'AYT',
    latitude: 36.8987,
    longitude: 30.8005,
    aliases: ['antalya', 'tuerkei', 'türkei', 'turkey', 'ayt'],
    country: 'TR',
    coastal: true,
  },
  {
    name: 'Istanbul',
    iataCode: 'IST',
    latitude: 41.2753,
    longitude: 28.7519,
    aliases: ['istanbul', 'ist'],
    country: 'TR',
    coastal: true,
  },
  {
    name: 'Wien',
    iataCode: 'VIE',
    latitude: 48.1103,
    longitude: 16.5697,
    aliases: ['wien', 'vienna', 'oesterreich', 'österreich', 'vie'],
    country: 'AT',
    coastal: false,
  },
  {
    name: 'Zürich',
    iataCode: 'ZRH',
    latitude: 47.4647,
    longitude: 8.5492,
    aliases: ['zuerich', 'zürich', 'zurich', 'schweiz', 'zrh'],
    country: 'CH',
    coastal: false,
  },
  {
    name: 'Amsterdam',
    iataCode: 'AMS',
    latitude: 52.3105,
    longitude: 4.7683,
    aliases: ['amsterdam', 'niederlande', 'holland', 'ams'],
    country: 'NL',
    coastal: true,
  },
  {
    name: 'Paris Charles de Gaulle',
    iataCode: 'CDG',
    latitude: 49.0097,
    longitude: 2.5479,
    aliases: ['paris', 'frankreich', 'cdg'],
    country: 'FR',
    coastal: false,
  },
  {
    name: 'Nizza',
    iataCode: 'NCE',
    latitude: 43.6584,
    longitude: 7.2159,
    aliases: ['nizza', 'nice', 'cote dazur', 'côte dazur', 'nce'],
    country: 'FR',
    coastal: true,
  },
  {
    name: 'London Heathrow',
    iataCode: 'LHR',
    latitude: 51.47,
    longitude: -0.4543,
    aliases: ['london', 'england', 'lhr'],
    country: 'GB',
    coastal: false,
  },
  {
    name: 'Kopenhagen',
    iataCode: 'CPH',
    latitude: 55.6181,
    longitude: 12.656,
    aliases: ['kopenhagen', 'copenhagen', 'daenemark', 'dänemark', 'cph'],
    country: 'DK',
    coastal: true,
  },
];

export const CATALOG: readonly CatalogEntry[] = [...GERMAN_AIRPORTS, ...DESTINATIONS];

const BY_IATA = new Map(CATALOG.map((entry) => [entry.iataCode, entry]));

export function findByIata(iataCode: string): CatalogEntry | undefined {
  return BY_IATA.get(iataCode.toUpperCase());
}

/**
 * Normalisiert Suchtext: Kleinschreibung, Umlaute aufgeloest, Rand getrimmt.
 * So findet „Düsseldorf" auch, wer „duesseldorf" oder „Dusseldorf" tippt.
 */
export function normalizeSearchTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss');
}

function matchScore(entry: CatalogEntry, term: string): number {
  const normalizedTerm = normalizeSearchTerm(term);

  if (normalizedTerm.length === 0) {
    return 0;
  }

  for (const alias of entry.aliases) {
    const normalizedAlias = normalizeSearchTerm(alias);

    if (normalizedAlias === normalizedTerm) {
      return 3;
    }
    if (normalizedAlias.startsWith(normalizedTerm)) {
      return 2;
    }
    if (normalizedAlias.includes(normalizedTerm)) {
      return 1;
    }
  }

  return normalizeSearchTerm(entry.name).includes(normalizedTerm) ? 1 : 0;
}

/**
 * Nur exakte Treffer auf einen Alias.
 *
 * Gedacht fuer Stellen, an denen ohne Kontext geraten wuerde: Wer jedes Wort
 * eines Satzes gegen den Katalog haelt, findet in „wie geht es dir" das
 * Praefix von „Wien". Ein Praefixtreffer ist bei gezielter Ortssuche
 * hilfreich und beim Durchsuchen von Fliesstext irrefuehrend.
 */
export function findExact(term: string): CatalogEntry | undefined {
  const normalized = normalizeSearchTerm(term);

  return CATALOG.find((entry) =>
    entry.aliases.some((alias) => normalizeSearchTerm(alias) === normalized),
  );
}

/**
 * Orte zu einem Suchbegriff, beste Treffer zuerst.
 * Bei gleichem Rang entscheidet der IATA-Code — damit die Reihenfolge stabil
 * bleibt und Tests nicht von der Katalogreihenfolge abhaengen.
 */
export function searchCatalog(term: string): CatalogEntry[] {
  return CATALOG.map((entry) => ({ entry, score: matchScore(entry, term) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.iataCode.localeCompare(b.entry.iataCode))
    .map(({ entry }) => entry);
}
