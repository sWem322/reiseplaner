import { describe, expect, it } from 'vitest';
import { readCookie } from './context';

/**
 * Cookie-Auswertung ohne fremde Bibliothek — deshalb hier geprueft.
 *
 * Der Fall ist unscheinbar und trotzdem heikel: Ein falsch gelesenes Cookie
 * bedeutet, dass niemand angemeldet bleibt.
 */

function headers(cookie: string | null): Headers {
  return new Headers(cookie === null ? {} : { cookie });
}

describe('readCookie', () => {
  it('liest ein einzelnes Cookie', () => {
    expect(readCookie(headers('reiseplaner_session=abc123'), 'reiseplaner_session')).toBe('abc123');
  });

  it('findet ein Cookie zwischen anderen', () => {
    const cookie = 'theme=dark; reiseplaner_session=abc123; locale=de';

    expect(readCookie(headers(cookie), 'reiseplaner_session')).toBe('abc123');
  });

  it('kommt mit Leerzeichen nach dem Semikolon zurecht', () => {
    expect(readCookie(headers('a=1;  reiseplaner_session=xyz'), 'reiseplaner_session')).toBe('xyz');
  });

  it('gibt nichts zurück, wenn das Cookie fehlt', () => {
    expect(readCookie(headers('theme=dark'), 'reiseplaner_session')).toBeUndefined();
  });

  it('gibt nichts zurück, wenn gar keine Cookies gesendet wurden', () => {
    expect(readCookie(headers(null), 'reiseplaner_session')).toBeUndefined();
  });

  it('dekodiert kodierte Werte', () => {
    expect(readCookie(headers('name=Hans%20M%C3%BCller'), 'name')).toBe('Hans Müller');
  });

  it('behält Gleichheitszeichen im Wert', () => {
    // Base64-Werte enden oft auf „=" — ein Split auf dem ersten Zeichen
    // wuerde den Rest abschneiden.
    expect(readCookie(headers('token=YWJjZA=='), 'token')).toBe('YWJjZA==');
  });

  it('verwechselt kein Cookie mit ähnlichem Namen', () => {
    const cookie = 'reiseplaner_session_alt=falsch; reiseplaner_session=richtig';

    expect(readCookie(headers(cookie), 'reiseplaner_session')).toBe('richtig');
  });

  it('gibt bei leerem Wert eine leere Zeichenkette zurück', () => {
    expect(readCookie(headers('reiseplaner_session='), 'reiseplaner_session')).toBe('');
  });
});
