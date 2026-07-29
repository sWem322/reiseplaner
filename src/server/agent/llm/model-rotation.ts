/**
 * Reihum durch mehrere Modelle, wenn eines sein Kontingent aufgebraucht hat.
 *
 * Das kostenlose Kontingent gilt je Modell. Steht die staerkste Flash-Variante
 * still, ist die Lite-Variante meist noch offen — und beide reichen fuer diese
 * Aufgabe, denn der Agent schreibt keine Essays, er fuellt Felder und ruft
 * Werkzeuge auf.
 *
 * Zwei Eigenschaften sind wichtig:
 *
 * 1. **Immer von oben.** Gewaehlt wird stets das erste nicht gesperrte Modell
 *    der Liste. Nach Ablauf einer Sperre kehrt der Betrieb also von selbst zur
 *    staerkeren Variante zurueck, ohne dass etwas zurueckgesetzt werden muss.
 * 2. **Die Sperre kennt ihr Ende.** Nennt der Dienst eine Wartezeit, gilt sie.
 *    Sonst wird bis zum naechsten Zuruecksetzen des Tageskontingents gesperrt —
 *    Mitternacht in Kalifornien, so steht es in der Dokumentation.
 *
 * Der Zustand liegt im Arbeitsspeicher des Prozesses. Bei mehreren Instanzen
 * lernt jede fuer sich; das kostet je Instanz einen abgewiesenen Aufruf und
 * waere der einzige Grund, das spaeter in die Datenbank zu legen.
 */

/**
 * Ausdauerndste zuerst — nicht staerkste.
 *
 * Das war urspruenglich andersherum und lief sich fest. Die Konsole von AI
 * Studio nennt die Zahlen: Die volle Flash-Variante erlaubt **20** Anfragen am
 * Tag, die Lite-Variante **500**. Fuenfundzwanzigfach — und ein einziges
 * Gespraech verbraucht schon fuenf bis zehn.
 *
 * Fuer diese Aufgabe wiegt Ausdauer schwerer als Sprachgewalt: Der Agent fuellt
 * Felder und ruft Werkzeuge auf, er schreibt keine Essays. Eine Demo, die nach
 * zwei Gespraechen taeglich verstummt, ist keine Demo.
 *
 * Wer das anders sieht, setzt GEMINI_MODEL — der Wunsch steht dann vorn.
 */
export const DEFAULT_MODEL_CHAIN = [
  'gemini-flash-lite-latest',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-2.0-flash',
] as const;

/**
 * Kette aus einem Wunschmodell und der Voreinstellung.
 *
 * Der Wunsch steht vorn, verdraengt die Kette aber nicht: Ist auch sein
 * Kontingent aufgebraucht, laeuft die Demo mit dem naechsten weiter.
 */
export function buildModelChain(wunsch?: string): readonly string[] {
  if (wunsch === undefined || wunsch === '') {
    return DEFAULT_MODEL_CHAIN;
  }

  return [wunsch, ...DEFAULT_MODEL_CHAIN.filter((name) => name !== wunsch)];
}

/*
 * Ein Zustand je Kette und Prozess.
 *
 * Die Fabrik baut den Adapter je Anfrage neu. Eine Sperre, die mit dem Adapter
 * verschwindet, waere wertlos — sie soll gerade die naechste Anfrage vor
 * demselben Fehlschlag bewahren. Tests bekommen ihre eigene Rotation und
 * fassen diese Karte nicht an.
 */
const geteilt = new Map<string, ModelRotation>();

export function sharedRotation(models: readonly string[]): ModelRotation {
  const schluessel = models.join('|');
  const vorhanden = geteilt.get(schluessel);

  if (vorhanden !== undefined) {
    return vorhanden;
  }

  const neu = new ModelRotation({ models });
  geteilt.set(schluessel, neu);

  return neu;
}

export interface SuspendedModel {
  readonly model: string;
  readonly until: number;
}

export interface ModelRotationOptions {
  readonly models: readonly string[];
  /** Fuer Tests: eine Uhr, die sich stellen laesst. */
  readonly now?: () => number;
}

export class ModelRotation {
  readonly #models: readonly string[];
  readonly #now: () => number;
  readonly #gesperrt = new Map<string, number>();

  constructor({ models, now = Date.now }: ModelRotationOptions) {
    if (models.length === 0) {
      throw new Error('Die Modellkette darf nicht leer sein');
    }

    this.#models = models;
    this.#now = now;
  }

  /** Das staerkste gerade verfuegbare Modell, oder `null`, wenn alle ruhen. */
  current(): string | null {
    const jetzt = this.#now();

    for (const model of this.#models) {
      const bis = this.#gesperrt.get(model);

      if (bis === undefined || bis <= jetzt) {
        // Abgelaufene Sperren werden entfernt, damit die Karte nicht waechst.
        this.#gesperrt.delete(model);

        return model;
      }
    }

    return null;
  }

  /**
   * Sperrt ein Modell.
   *
   * Eine bestehende Sperre wird nur verlaengert, nie verkuerzt: Zwei parallele
   * Anfragen koennen dieselbe Absage bekommen, und die zweite darf die erste
   * nicht entwerten.
   */
  suspend(model: string, forMs: number): void {
    const bis = this.#now() + Math.max(forMs, 0);
    const bisher = this.#gesperrt.get(model) ?? 0;

    this.#gesperrt.set(model, Math.max(bis, bisher));
  }

  /** Wann wird das naechste Modell wieder frei? `null`, wenn keines ruht. */
  nextFreeAt(): number | null {
    const zeiten = [...this.#gesperrt.values()];

    return zeiten.length === 0 ? null : Math.min(...zeiten);
  }

  /** Nur zur Anzeige und fuer Tests. */
  suspended(): readonly SuspendedModel[] {
    return [...this.#gesperrt].map(([model, until]) => ({ model, until }));
  }
}

/**
 * Wie lange gesperrt wird.
 *
 * Google legt bei einem Minutenlimit eine Wartezeit bei („retryDelay":"37s").
 * Fehlt sie, ist es das Tageslimit — und das faellt erst um Mitternacht in
 * Kalifornien.
 */
export function suspensionFor(message: string, now: number): number {
  const genannt = /"?retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(message);

  if (genannt?.[1] !== undefined) {
    // Eine Sekunde Zuschlag: Genau an der Grenze zu klopfen, gibt dieselbe
    // Absage noch einmal.
    return Number.parseFloat(genannt[1]) * 1_000 + 1_000;
  }

  return nextDailyResetAt(now) - now;
}

const PACIFIC = 'America/Los_Angeles';

/**
 * Naechste Mitternacht in Kalifornien, als Zeitstempel.
 *
 * Ohne Bibliothek: `Intl` kennt die Zeitzone samt Sommerzeit. Gefragt wird,
 * wie spaet es dort gerade ist; der Rest ist Subtraktion.
 */
export function nextDailyResetAt(now: number): number {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(now));

  const zahl = (typ: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(teile.find((teil) => teil.type === typ)?.value ?? '0', 10);

  // Um Mitternacht meldet `hour12: false` je nach Umgebung 24 statt 0.
  const stunde = zahl('hour') % 24;
  const seitMitternacht = (stunde * 3_600 + zahl('minute') * 60 + zahl('second')) * 1_000;

  return now + (86_400_000 - seitMitternacht);
}
