import { describe, expect, it, vi } from 'vitest';
import { MAX_SPEECH_CHARS } from '@/domain/ports/speech';
import { unwrap } from '@/domain/result';
import { createElevenLabsSpeech, DEFAULT_ELEVENLABS_MODEL } from './elevenlabs';

/**
 * Kein Test dieser Datei geht ins Netz und keiner braucht einen Schluessel.
 * Der Adapter bekommt seine fetch-Implementierung als Parameter — genau dafuer
 * gibt es sie.
 */

function audioResponse(bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
}

function statusResponse(status: number): typeof fetch {
  return () => Promise.resolve(new Response('{"detail":"…"}', { status }));
}

/**
 * Der Rumpf einer Anfrage als geparstes JSON.
 *
 * `String(init.body)` waere kuerzer und falsch: `BodyInit` ist unter anderem
 * ein `Blob` oder ein Strom, und daraus wuerde „[object Object]". Der Test
 * pruefte dann, ob diese Zeichenkette das Erwartete enthaelt.
 */
function rumpfVon(init: RequestInit | undefined): unknown {
  const rumpf = init?.body;

  return typeof rumpf === 'string' ? JSON.parse(rumpf) : null;
}

function adresseVon(url: RequestInfo | URL): string {
  if (typeof url === 'string') {
    return url;
  }

  return url instanceof URL ? url.href : url.url;
}

function speech(fetchImpl: typeof fetch, options: { voiceId?: string; model?: string } = {}) {
  return createElevenLabsSpeech({ apiKey: 'schluessel', fetchImpl, ...options });
}

describe('ElevenLabs-Adapter', () => {
  it('gibt die Audiobytes und ihren Typ zurueck', async () => {
    const result = await speech(audioResponse()).speak({ text: 'Guten Tag.' });

    const audio = unwrap(result);

    expect(audio.mimeType).toBe('audio/mpeg');
    expect(audio.data).toEqual(new Uint8Array([0xff, 0xfb, 0x90, 0x00]));
  });

  it('schickt Schluessel, Text und Modell an die Stimme', async () => {
    const fetchImpl = vi.fn<typeof fetch>(audioResponse());

    await speech(fetchImpl, { voiceId: 'stimme-1' }).speak({ text: 'Guten Tag.' });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];

    expect(adresseVon(url ?? '')).toContain('/text-to-speech/stimme-1');
    expect(new Headers(init?.headers).get('xi-api-key')).toBe('schluessel');
    expect(rumpfVon(init)).toMatchObject({
      text: 'Guten Tag.',
      model_id: DEFAULT_ELEVENLABS_MODEL,
    });
  });

  it('laesst die Stimme der Anfrage die eingestellte ueberstimmen', async () => {
    const fetchImpl = vi.fn<typeof fetch>(audioResponse());

    await speech(fetchImpl, { voiceId: 'eingestellt' }).speak({
      text: 'Guten Tag.',
      voiceId: 'aus-der-anfrage',
    });

    expect(adresseVon(fetchImpl.mock.calls[0]?.[0] ?? '')).toContain(
      '/text-to-speech/aus-der-anfrage',
    );
  });

  it.each([
    [500, 'upstream_error'],
    [503, 'upstream_error'],
    [429, 'rate_limited'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
  ])('uebersetzt Status %i in %s', async (status, erwartet) => {
    const result = await speech(statusResponse(status)).speak({ text: 'Guten Tag.' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe(erwartet);
  });

  it('meldet upstream_error, wenn der Anbieter kein Audio schickt', async () => {
    /*
     * Der eigentlich gefaehrliche Fall: Status 200, aber eine Fehlermeldung als
     * JSON im Rumpf. Ohne Pruefung des Inhaltstyps landete die im
     * Abspielgeraet, und auf dem Bildschirm stuende ein Knopf, der schweigt.
     */
    const jsonMitZweihundert: typeof fetch = () =>
      Promise.resolve(
        new Response('{"detail":"quota_exceeded"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const result = await speech(jsonMitZweihundert).speak({ text: 'Guten Tag.' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('upstream_error');
  });

  it('meldet upstream_error bei einer leeren Antwort', async () => {
    const leer: typeof fetch = () =>
      Promise.resolve(
        new Response(new Uint8Array(), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
      );

    const result = await speech(leer).speak({ text: 'Guten Tag.' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('upstream_error');
  });

  it('meldet upstream_error, wenn der Anbieter nicht erreichbar ist', async () => {
    const kaputt: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

    const result = await speech(kaputt).speak({ text: 'Guten Tag.' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('upstream_error');
  });

  it('meldet upstream_error bei Zeitueberschreitung', async () => {
    const zuSpaet: typeof fetch = () => {
      const abbruch = new Error('The operation was aborted');
      abbruch.name = 'AbortError';

      return Promise.reject(abbruch);
    };

    const result = await speech(zuSpaet).speak({ text: 'Guten Tag.' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('upstream_error');
  });

  /*
   * Die beiden folgenden Faelle sind der Grund, warum der Adapter ueberhaupt
   * selbst prueft: Ein Fehlschlag, den man ohne Netzaufruf erkennen kann, soll
   * auch ohne Netzaufruf erkannt werden — und ohne Kontingent zu verbrauchen.
   */
  it.each([
    ['leerem Text', ''],
    ['Text aus lauter Leerzeichen', '   \n  '],
  ])('meldet validation_error bei %s, ohne den Anbieter zu rufen', async (_name, text) => {
    const fetchImpl = vi.fn<typeof fetch>(audioResponse());

    const result = await speech(fetchImpl).speak({ text });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('validation_error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('meldet validation_error bei zu langem Text, ohne den Anbieter zu rufen', async () => {
    const fetchImpl = vi.fn<typeof fetch>(audioResponse());

    const result = await speech(fetchImpl).speak({ text: 'a'.repeat(MAX_SPEECH_CHARS + 1) });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('validation_error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nennt sich mit Namen — das Startprotokoll liest ihn', () => {
    expect(speech(audioResponse()).name).toContain('elevenlabs');
  });
});
