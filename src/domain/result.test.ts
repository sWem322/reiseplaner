import { describe, expect, it } from 'vitest';
import { err, fail, isErr, isOk, mapResult, ok, unwrap, type Result } from './result';

describe('Result', () => {
  it('kennzeichnet Erfolg und traegt den Wert', () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    expect(unwrap(result)).toBe(42);
  });

  it('kennzeichnet Fehler und traegt die Fehlerbeschreibung', () => {
    const result = fail('upstream_error', 'Anbieter nicht erreichbar');

    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.kind).toBe('upstream_error');
      expect(result.error.message).toBe('Anbieter nicht erreichbar');
    }
  });

  it('nimmt optionalen Kontext nur auf, wenn er uebergeben wurde', () => {
    const ohneKontext = fail('not_found', 'Kein Treffer');
    const mitKontext = fail('not_found', 'Kein Treffer', { iata: 'XXX' });

    expect(isErr(ohneKontext) && 'details' in ohneKontext.error).toBe(false);
    expect(isErr(mitKontext) && mitKontext.error.details).toEqual({ iata: 'XXX' });
  });

  it('mapResult transformiert nur den Erfolgsfall', () => {
    const erfolg: Result<number> = ok(2);
    const fehler: Result<number> = fail('validation_error', 'ungueltig');

    expect(unwrap(mapResult(erfolg, (n) => n * 10))).toBe(20);
    expect(mapResult(fehler, (n) => n * 10)).toBe(fehler);
  });

  it('unwrap wirft bei fehlgeschlagenem Result', () => {
    expect(() => unwrap(err({ kind: 'validation_error', message: 'kaputt' }))).toThrow(
      /unwrap auf fehlgeschlagenem Result/,
    );
  });

  it('erlaubt erschoepfende Fallunterscheidung ohne Typ-Fluchtwege', () => {
    const beschreibe = (result: Result<string>): string =>
      result.ok ? `ok:${result.value}` : `fehler:${result.error.kind}`;

    expect(beschreibe(ok('Palma'))).toBe('ok:Palma');
    expect(beschreibe(fail('rate_limited', 'zu viele Anfragen'))).toBe('fehler:rate_limited');
  });
});
