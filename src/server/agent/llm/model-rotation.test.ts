import { describe, expect, it } from 'vitest';
import {
  buildModelChain,
  DEFAULT_MODEL_CHAIN,
  ModelRotation,
  nextDailyResetAt,
  suspensionFor,
} from './model-rotation';

/**
 * Von Hand ist das kaum zu pruefen: Ein aufgebrauchtes Tageskontingent
 * wiederholt sich einmal taeglich, und die Rueckkehr zur staerkeren Variante
 * geschieht mitten in der Nacht. Deshalb eine gestellte Uhr.
 */

const MINUTE = 60_000;
const STUNDE = 60 * MINUTE;

function rotationMitUhr(models: readonly string[]) {
  const uhr = { jetzt: Date.parse('2026-07-29T12:00:00Z') };
  const rotation = new ModelRotation({ models, now: () => uhr.jetzt });

  return {
    rotation,
    vorspulen: (ms: number) => {
      uhr.jetzt += ms;
    },
  };
}

describe('Modellkette', () => {
  it('stellt das Wunschmodell voran', () => {
    expect(buildModelChain('gemini-2.0-flash')[0]).toBe('gemini-2.0-flash');
  });

  it('nennt kein Modell doppelt', () => {
    const kette = buildModelChain('gemini-flash-lite-latest');

    expect(new Set(kette).size).toBe(kette.length);
  });

  it('behält die übrigen Modelle als Rückfallebene', () => {
    // Der Wunsch ersetzt die Kette nicht — sonst stünde die Demo still,
    // sobald ausgerechnet dieses Modell ausgelastet ist.
    expect(buildModelChain('gemini-2.0-flash')).toHaveLength(DEFAULT_MODEL_CHAIN.length);
  });

  it('nimmt ohne Wunsch die Voreinstellung', () => {
    expect(buildModelChain()).toEqual(DEFAULT_MODEL_CHAIN);
    expect(buildModelChain('')).toEqual(DEFAULT_MODEL_CHAIN);
  });
});

describe('Rotation', () => {
  it('beginnt beim stärksten Modell', () => {
    const { rotation } = rotationMitUhr(['stark', 'mittel', 'schwach']);

    expect(rotation.current()).toBe('stark');
  });

  it('geht nach einer Sperre zum nächsten', () => {
    const { rotation } = rotationMitUhr(['stark', 'mittel', 'schwach']);

    rotation.suspend('stark', STUNDE);

    expect(rotation.current()).toBe('mittel');
  });

  it('kehrt nach Ablauf der Sperre von selbst zurück', () => {
    const { rotation, vorspulen } = rotationMitUhr(['stark', 'mittel']);

    rotation.suspend('stark', STUNDE);
    expect(rotation.current()).toBe('mittel');

    vorspulen(STUNDE + 1);

    // Kein Zuruecksetzen noetig: Gewaehlt wird immer das erste freie Modell.
    expect(rotation.current()).toBe('stark');
  });

  it('meldet null, wenn alle ruhen', () => {
    const { rotation } = rotationMitUhr(['stark', 'mittel']);

    rotation.suspend('stark', STUNDE);
    rotation.suspend('mittel', STUNDE);

    expect(rotation.current()).toBeNull();
  });

  it('verkürzt eine bestehende Sperre nicht', () => {
    const { rotation, vorspulen } = rotationMitUhr(['stark', 'mittel']);

    rotation.suspend('stark', 4 * STUNDE);
    rotation.suspend('stark', MINUTE);

    vorspulen(2 * STUNDE);

    // Zwei gleichzeitige Anfragen bekommen dieselbe Absage; die zweite darf
    // die laengere Sperre der ersten nicht entwerten.
    expect(rotation.current()).toBe('mittel');
  });

  it('nennt den nächsten freien Zeitpunkt', () => {
    const { rotation } = rotationMitUhr(['stark', 'mittel']);

    rotation.suspend('stark', 4 * STUNDE);
    rotation.suspend('mittel', STUNDE);

    expect(rotation.nextFreeAt()).toBe(Date.parse('2026-07-29T13:00:00Z'));
  });

  it('vergisst abgelaufene Sperren', () => {
    const { rotation, vorspulen } = rotationMitUhr(['stark']);

    rotation.suspend('stark', MINUTE);
    vorspulen(2 * MINUTE);
    rotation.current();

    expect(rotation.suspended()).toEqual([]);
  });

  it('lehnt eine leere Kette ab', () => {
    expect(() => new ModelRotation({ models: [] })).toThrow();
  });
});

describe('Dauer einer Sperre', () => {
  const jetzt = Date.parse('2026-07-29T12:00:00Z');

  it('übernimmt die vom Dienst genannte Wartezeit', () => {
    const meldung = '{"error":{"code":429,"details":[{"retryDelay":"37s"}]}}';

    // 37 Sekunden plus ein Sicherheitszuschlag.
    expect(suspensionFor(meldung, jetzt)).toBe(38_000);
  });

  it('kommt mit Nachkommastellen zurecht', () => {
    expect(suspensionFor('retryDelay: "7.5s"', jetzt)).toBe(8_500);
  });

  it('sperrt ohne genannte Wartezeit bis zum Tageswechsel', () => {
    const dauer = suspensionFor('{"error":{"code":429,"message":"quota exceeded"}}', jetzt);

    expect(dauer).toBe(nextDailyResetAt(jetzt) - jetzt);
    expect(dauer).toBeGreaterThan(0);
  });
});

describe('Zurücksetzen des Tageskontingents', () => {
  it('liegt höchstens 24 Stunden voraus', () => {
    const jetzt = Date.now();
    const reset = nextDailyResetAt(jetzt);

    expect(reset).toBeGreaterThan(jetzt);
    expect(reset - jetzt).toBeLessThanOrEqual(86_400_000);
  });

  it('trifft Mitternacht in Kalifornien', () => {
    // 29.07.2026, 12:00 UTC ist 05:00 Ortszeit (Sommerzeit, UTC-7).
    // Bis Mitternacht sind es also 19 Stunden.
    const jetzt = Date.parse('2026-07-29T12:00:00Z');

    expect(nextDailyResetAt(jetzt) - jetzt).toBe(19 * STUNDE);
  });

  it('rechnet auch im Winter richtig', () => {
    // Im Januar gilt UTC-8: 12:00 UTC ist 04:00 Ortszeit, 20 Stunden bis
    // Mitternacht. Ohne Zeitzonenwissen waere hier eine Stunde daneben.
    const jetzt = Date.parse('2026-01-15T12:00:00Z');

    expect(nextDailyResetAt(jetzt) - jetzt).toBe(20 * STUNDE);
  });
});
