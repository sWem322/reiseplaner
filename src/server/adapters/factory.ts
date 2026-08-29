import type { LlmPort } from '@/domain/ports/llm';
import type { Providers } from '@/domain/ports/providers';
import type { TextToSpeechPort } from '@/domain/ports/speech';
import { createGeminiLlm } from '../agent/llm/gemini';
import { createElevenLabsSpeech } from './http/elevenlabs';
import { buildModelChain, sharedRotation } from '../agent/llm/model-rotation';
import { createRuleBasedLlm } from '../agent/llm/rule-based';
import { createDuffelFlightSearch } from './http/duffel';
import { createOpenMeteoGeocoding, createOpenMeteoWeather } from './http/open-meteo';
import { createOverpassHotelSearch } from './http/overpass';
import { createSeedFlightSearch } from './seed/flights';
import { createSeedHotelSearch } from './seed/hotels';
import { createSeedGeocoding, createSeedWeather } from './seed/places';
import { createHotelSearchWithFallback } from './hotel-fallback';

/**
 * Auswahl der Anbieter-Implementierungen.
 *
 * Die Fabrik ist die einzige Stelle im Projekt, die beide Welten kennt: die
 * Ports der Domaene und die konkreten Adapter. Alles darueber — Werkzeuge,
 * Agenten-Loop, Oberflaeche — sieht nur noch Interfaces.
 *
 * Regel: Fehlt ein Schluessel, wird nicht abgebrochen, sondern die
 * Seed-Implementierung gewaehlt. Ein Projekt, das ohne fremde Zugangsdaten
 * gar nicht startet, kann niemand ausprobieren.
 */

export interface ProviderConfig {
  readonly duffelAccessToken?: string | undefined;
  readonly geminiApiKey?: string | undefined;
  /** Wunschmodell; es steht am Anfang der Kette, ersetzt sie aber nicht. */
  readonly geminiModel?: string | undefined;
  readonly elevenLabsApiKey?: string | undefined;
  /** Stimme der Sprachausgabe. Ohne Angabe waehlt der Adapter seine eigene. */
  readonly elevenLabsVoiceId?: string | undefined;
  readonly elevenLabsModel?: string | undefined;
  /**
   * Schalter fuer alles, was ueber das Netz geht — auch fuer Gemini und
   * Duffel, nicht nur fuer die schluessellosen Dienste. Auf `false` laeuft
   * das Programm vollstaendig gegen Seed-Daten und den regelbasierten
   * Extraktor: deterministisch, ohne Kontingent, ohne fremde Ausfaelle.
   */
  readonly useNetworkProviders?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export type AdapterName =
  | 'seed'
  | 'duffel'
  | 'open-meteo'
  /** Overpass zuerst, Seed-Katalog als Rueckfallebene. */
  | 'overpass+seed'
  | 'rule-based'
  | 'gemini'
  | 'elevenlabs'
  /** Kein Serverdienst: Die Sprachausgabe uebernimmt der Browser. */
  | 'browser';

export interface ProviderSelection {
  readonly providers: Providers;
  readonly llm: LlmPort;
  /**
   * Sprachausgabe — oder `null`, wenn keine auf dem Server stattfindet.
   *
   * `null` ist hier keine fehlende Implementierung, sondern eine Aussage:
   * Ohne Schluessel spricht der Browser, und der braucht keinen Port. Eine
   * stille Attrappe an dieser Stelle waere ein Knopf, der nichts tut.
   */
  readonly speech: TextToSpeechPort | null;
  /** Welche Implementierung je Port aktiv ist — wird beim Start protokolliert. */
  readonly active: {
    readonly flights: AdapterName;
    readonly hotels: AdapterName;
    readonly geocoding: AdapterName;
    readonly weather: AdapterName;
    readonly llm: AdapterName;
    readonly speech: AdapterName;
  };
}

export function createProviders(config: ProviderConfig = {}): ProviderSelection {
  const fetchImpl = config.fetchImpl ?? fetch;
  const useNetwork = config.useNetworkProviders ?? true;

  /*
   * `useNetworkProviders: false` schaltet **jeden** fremden Dienst ab, nicht
   * nur die schluessellosen. Sonst waere der E2E-Lauf nicht das, was er sein
   * soll: Er lief mit dem echten Sprachmodell, verbrauchte dessen Kontingent
   * und scheiterte, sobald es aufgebraucht war — an einer Ursache, die mit dem
   * geprueften Code nichts zu tun hatte.
   */
  const hasDuffel =
    useNetwork && config.duffelAccessToken !== undefined && config.duffelAccessToken.length > 0;

  const flights = hasDuffel
    ? createDuffelFlightSearch(config.duffelAccessToken ?? '', fetchImpl)
    : createSeedFlightSearch();

  /*
   * Unterkuenfte haben als einziger Port keinen Schluessel — und trotzdem
   * keine Garantie: Overpass ist ein freiwillig betriebener Dienst und weist
   * derzeit einen grossen Teil der Anfragen ab. Deshalb steht der
   * Seed-Katalog dahinter, wie bei den Fluegen. Gekennzeichnet wird beides.
   */
  const hotels = useNetwork
    ? createHotelSearchWithFallback(createOverpassHotelSearch(fetchImpl), createSeedHotelSearch())
    : createSeedHotelSearch();
  const geocoding = useNetwork ? createOpenMeteoGeocoding(fetchImpl) : createSeedGeocoding();
  const weather = useNetwork ? createOpenMeteoWeather(fetchImpl) : createSeedWeather();

  /*
   * Ohne Gemini-Schluessel uebernimmt der regelbasierte Extraktor. Er ist kein
   * Ersatz fuer ein Sprachmodell, aber er haelt die Demo bedienbar — und
   * liefert im Eval die Vergleichslinie, an der sich zeigt, was das Modell
   * tatsaechlich beitraegt.
   */
  const hasGemini =
    useNetwork && config.geminiApiKey !== undefined && config.geminiApiKey.length > 0;

  /*
   * Die Sperren der Modelle gehoeren nicht zum Adapter, sondern zum Prozess:
   * Die Fabrik baut den Adapter je Anfrage neu, und ein aufgebrauchtes
   * Kontingent bleibt es auch fuer die naechste.
   */
  const kette = buildModelChain(config.geminiModel);

  const llm = hasGemini
    ? createGeminiLlm({
        apiKey: config.geminiApiKey ?? '',
        models: kette,
        rotation: sharedRotation(kette),
      })
    : createRuleBasedLlm();

  /*
   * Die Sprachausgabe folgt derselben Regel wie jeder Anbieter: ohne
   * Schluessel kein Dienst. Sie faellt aber nicht auf eine Attrappe zurueck,
   * sondern auf den Browser — deshalb `null` statt einer Implementierung.
   */
  const hasElevenLabs =
    useNetwork && config.elevenLabsApiKey !== undefined && config.elevenLabsApiKey.length > 0;

  const speech = hasElevenLabs
    ? createElevenLabsSpeech({
        apiKey: config.elevenLabsApiKey ?? '',
        voiceId: config.elevenLabsVoiceId,
        model: config.elevenLabsModel,
        fetchImpl,
      })
    : null;

  return {
    providers: { flights, hotels, geocoding, weather },
    llm,
    speech,
    active: {
      flights: hasDuffel ? 'duffel' : 'seed',
      hotels: useNetwork ? 'overpass+seed' : 'seed',
      geocoding: useNetwork ? 'open-meteo' : 'seed',
      weather: useNetwork ? 'open-meteo' : 'seed',
      llm: hasGemini ? 'gemini' : 'rule-based',
      speech: hasElevenLabs ? 'elevenlabs' : 'browser',
    },
  };
}

/** Ausschliesslich Seed-Implementierungen — fuer Tests und den Offline-Betrieb. */
export function createSeedProviders(): Providers {
  return {
    flights: createSeedFlightSearch(),
    hotels: createSeedHotelSearch(),
    geocoding: createSeedGeocoding(),
    weather: createSeedWeather(),
  };
}
