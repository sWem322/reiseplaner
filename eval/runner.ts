import type { AgentEvent } from '@/domain/agent';
import { DEFAULT_AGENT_LIMITS } from '@/domain/agent';
import type { ContentBlock } from '@/domain/conversation';
import type { LlmMessage, LlmPort } from '@/domain/ports/llm';
import type { Providers } from '@/domain/ports/providers';
import { emptyTripDraft, type TripDraft, type TripSlot } from '@/domain/trip/trip';
import { runAgent } from '@/server/agent/loop';
import { buildSystemPromptForDate } from '@/server/agent/prompts/system';
import { createToolRegistry } from '@/server/agent/tools';
import { createInMemoryTripDrafts } from './in-memory-drafts';
import { EVAL_HEUTE, type ErwarteterEntwurf, type EvalFall } from './faelle';

/**
 * Führt die Fälle aus und zählt aus, was dabei herauskam.
 *
 * Bewusst gegen den Loop und nicht gegen die HTTP-Schnittstelle: Gemessen
 * werden soll das Verhalten des Agenten, nicht das der Weboberfläche. Der
 * Systemprompt bekommt ein festes Datum, damit „nächstes Jahr" nicht vom
 * Kalender des Tages abhängt.
 */

export interface SlotBefund {
  readonly slot: string;
  readonly erwartet: unknown;
  readonly tatsaechlich: unknown;
  readonly urteil: 'richtig' | 'falsch' | 'erfunden' | 'fehlt';
}

export interface FallErgebnis {
  readonly id: string;
  readonly beschreibung: string;
  readonly nochOffen: boolean;
  readonly befunde: readonly SlotBefund[];
  readonly werkzeugaufrufe: number;
  readonly misslungeneAufrufe: number;
  readonly hatGesucht: boolean;
  readonly antwort: string;
  readonly entwurf: TripDraft;
  readonly bestanden: boolean;
}

export interface EvalBericht {
  readonly llm: string;
  readonly zeitpunkt: string;
  readonly faelle: readonly FallErgebnis[];
  readonly kennzahlen: {
    readonly slotsGesamt: number;
    readonly richtig: number;
    readonly falsch: number;
    readonly erfunden: number;
    readonly fehlt: number;
    /** Anteil richtiger Slots — die Leitzahl. */
    readonly genauigkeit: number;
    readonly werkzeugaufrufeJeFall: number;
    readonly anteilMisslungenerAufrufe: number;
    readonly bestandeneFaelle: number;
    readonly offeneFaelle: number;
  };
}

/** Welchen IATA-Code oder Wert hat ein Slot im Entwurf? */
function wertVon(draft: TripDraft, slot: keyof ErwarteterEntwurf): unknown {
  switch (slot) {
    case 'destination':
      return draft.destination?.iataCode ?? null;
    case 'origin':
      return draft.origin?.iataCode ?? null;
    case 'childAges':
      // Eine leere Liste bedeutet „keine Kinder genannt" und wird wie ein
      // leeres Feld behandelt — sonst zaehlte jeder Fall ohne Kinder als
      // gefuellt.
      return draft.childAges.length === 0 ? null : [...draft.childAges];
    case 'departureDate':
    case 'returnDate':
    case 'adults':
    case 'budgetEuros':
      return draft[slot];
  }
}

function gleich(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function bewerte(draft: TripDraft, erwartet: ErwarteterEntwurf): SlotBefund[] {
  const befunde: SlotBefund[] = [];

  for (const [slot, sollwert] of Object.entries(erwartet)) {
    const istwert = wertVon(draft, slot as keyof ErwarteterEntwurf);

    /*
     * Die drei Urteile sind fachlich verschieden:
     * — „erfunden" ist der gefaehrlichste Fall, weil niemand ihn bemerkt;
     * — „fehlt" ist nur unvollstaendig;
     * — „falsch" ist ein Missverstaendnis.
     */
    let urteil: SlotBefund['urteil'];

    if (gleich(istwert, sollwert)) {
      urteil = 'richtig';
    } else if (sollwert === null) {
      urteil = 'erfunden';
    } else if (istwert === null) {
      urteil = 'fehlt';
    } else {
      urteil = 'falsch';
    }

    befunde.push({ slot, erwartet: sollwert, tatsaechlich: istwert, urteil });
  }

  return befunde;
}

/** Nennt die Antwort das fehlende Feld? Grobe, aber nachvollziehbare Pruefung. */
const RUECKFRAGE_WOERTER: Record<TripSlot, readonly string[]> = {
  destination: ['wohin', 'ziel', 'stadt', 'welche stadt', 'wo genau'],
  origin: ['abflug', 'flughafen', 'von wo', 'startest', 'starten'],
  departureDate: ['datum', 'wann', 'zeitraum', 'tag', 'termin'],
  returnDate: ['rückreise', 'rückflug', 'zurück'],
  adults: ['personen', 'erwachsene', 'wie viele', 'reist'],
};

function enthaeltRueckfrage(antwort: string, slot: TripSlot): boolean {
  const text = antwort.toLowerCase();

  return RUECKFRAGE_WOERTER[slot].some((wort) => text.includes(wort));
}

export interface RunOptions {
  readonly llm: LlmPort;
  readonly providers: Providers;
  readonly faelle: readonly EvalFall[];
}

export async function runEval({ llm, providers, faelle }: RunOptions): Promise<EvalBericht> {
  const ergebnisse: FallErgebnis[] = [];

  for (const fall of faelle) {
    ergebnisse.push(await runFall(fall, llm, providers));
  }

  const alleBefunde = ergebnisse.flatMap((ergebnis) => ergebnis.befunde);
  const zaehle = (urteil: SlotBefund['urteil']): number =>
    alleBefunde.filter((befund) => befund.urteil === urteil).length;

  const aufrufe = ergebnisse.reduce((summe, e) => summe + e.werkzeugaufrufe, 0);
  const misslungen = ergebnisse.reduce((summe, e) => summe + e.misslungeneAufrufe, 0);

  return {
    llm: llm.name,
    zeitpunkt: new Date().toISOString(),
    faelle: ergebnisse,
    kennzahlen: {
      slotsGesamt: alleBefunde.length,
      richtig: zaehle('richtig'),
      falsch: zaehle('falsch'),
      erfunden: zaehle('erfunden'),
      fehlt: zaehle('fehlt'),
      genauigkeit: alleBefunde.length === 0 ? 0 : zaehle('richtig') / alleBefunde.length,
      werkzeugaufrufeJeFall: ergebnisse.length === 0 ? 0 : aufrufe / ergebnisse.length,
      anteilMisslungenerAufrufe: aufrufe === 0 ? 0 : misslungen / aufrufe,
      bestandeneFaelle: ergebnisse.filter((e) => e.bestanden).length,
      offeneFaelle: ergebnisse.filter((e) => e.nochOffen).length,
    },
  };
}

async function runFall(fall: EvalFall, llm: LlmPort, providers: Providers): Promise<FallErgebnis> {
  const tripDrafts = createInMemoryTripDrafts();
  const conversationId = `00000000-0000-4000-8000-${fall.id.slice(0, 12).padEnd(12, '0')}`;

  await tripDrafts.createForConversation(conversationId);

  const tools = createToolRegistry({ providers, tripDrafts });
  const verlauf: LlmMessage[] = [];

  let werkzeugaufrufe = 0;
  let misslungeneAufrufe = 0;
  let hatGesucht = false;
  let letzteAntwort = '';

  for (const nachricht of fall.nachrichten) {
    verlauf.push({ role: 'user', blocks: [{ type: 'text', text: nachricht }] });

    let text = '';

    const events: AgentEvent[] = [];

    for await (const event of runAgent({
      conversationId,
      systemPrompt: buildSystemPromptForDate(EVAL_HEUTE),
      messages: verlauf,
      llm,
      tools,
      limits: DEFAULT_AGENT_LIMITS,
      tripDrafts,
      onTurn: (message) => {
        // Der Verlauf des naechsten Zuges muss den vorigen enthalten.
        verlauf.push({ role: message.role, blocks: [...message.blocks] as ContentBlock[] });
      },
    })) {
      events.push(event);

      if (event.type === 'text_delta') {
        text += event.text;
      }

      if (event.type === 'tool_started') {
        werkzeugaufrufe += 1;

        if (event.toolName === 'search_flights') {
          hatGesucht = true;
        }
      }

      if (event.type === 'tool_finished' && event.outcome !== 'ok') {
        misslungeneAufrufe += 1;
      }
    }

    letzteAntwort = text;
  }

  const entwurf = (await tripDrafts.findByConversation(conversationId)) ?? emptyTripDraft();
  const befunde = bewerte(entwurf, fall.erwartet);

  const rueckfrageStimmt =
    fall.erwarteteRueckfrage === undefined || fall.erwarteteRueckfrage === null
      ? true
      : enthaeltRueckfrage(letzteAntwort, fall.erwarteteRueckfrage);

  const sucheStimmt = fall.erwarteteSuche === undefined || fall.erwarteteSuche === hatGesucht;

  return {
    id: fall.id,
    beschreibung: fall.beschreibung,
    nochOffen: fall.nochOffen === true,
    befunde,
    werkzeugaufrufe,
    misslungeneAufrufe,
    hatGesucht,
    antwort: letzteAntwort,
    entwurf,
    bestanden:
      befunde.every((befund) => befund.urteil === 'richtig') && rueckfrageStimmt && sucheStimmt,
  };
}
