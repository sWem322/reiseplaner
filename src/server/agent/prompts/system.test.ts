import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildSystemPromptForDate, SYSTEM_PROMPT_VERSION } from './system';

/**
 * Der Prompt ist das Verhalten des Agenten — deshalb wird er geprueft wie
 * Code, wenn auch sparsam.
 *
 * Bewusst **nicht** Wort fuer Wort: Ein Test, der den vollstaendigen Text
 * festschreibt, bricht bei jeder Formulierungsaenderung und sagt trotzdem
 * nichts ueber das Verhalten. Geprueft wird nur, was aus einem konkreten
 * Fehler entstanden ist. Jede dieser Zusicherungen hat eine Vorgeschichte.
 */

describe('Systemprompt', () => {
  it('traegt eine Fassungsnummer, an der sich Eval-Ergebnisse festmachen lassen', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('nennt das heutige Datum', () => {
    // Ohne dieses Datum kann das Modell „naechsten Sommer" nicht ausrechnen —
    // es kennt den Tag nicht, an dem es laeuft.
    expect(buildSystemPrompt({ today: '2026-07-31' })).toContain('2026-07-31');
  });

  it('liefert fuer dasselbe Datum denselben Text', () => {
    // Der Eval waere sonst nicht reproduzierbar.
    expect(buildSystemPromptForDate('2026-07-29')).toBe(buildSystemPromptForDate('2026-07-29'));
  });

  const prompt = buildSystemPromptForDate('2026-07-29');

  it('verbietet erfundene Angaben im Entwurf', () => {
    // 1.1.0: Aus „im Oktober" wurden der 1. bis 8. Oktober.
    expect(prompt).toContain('Trage nur ein, was gesagt wurde');
  });

  it('verlangt die Bestaetigung eines Ortes durch das Werkzeug', () => {
    // 1.2.0: „Ulan-Bator" wurde zu ULN samt ausgedachter Koordinaten.
    expect(prompt).toContain('resolve_destination');
  });

  it('benennt die Grenze des Angebots, statt den Ort zu leugnen', () => {
    // 1.4.0: „Miami konnte ich leider nicht finden. Meinten Sie Miami (USA)?"
    expect(prompt).toContain('europäische Ziele');
  });

  it('untersagt zwei Fragen in einem Satz', () => {
    // 1.5.0: „Wann moechten Sie reisen und fuer wie viele Personen?"
    expect(prompt).toContain('ein Thema');
  });

  it('verlangt, eine halb beantwortete Frage erneut zu stellen', () => {
    // 1.5.0, zweiter Teil: Auf die Doppelfrage kam nur das Datum zurueck.
    expect(prompt).toContain('nicht** beantwortet');
  });

  it('verpflichtet dazu, Unterkuenfte als Beispieldaten zu benennen', () => {
    // 1.6.0: Seit Overpass ausfaellt, ist der Beispielfall der Regelfall.
    expect(prompt).toContain('Unterkünfte sind derzeit immer Beispieldaten');
  });

  it('sagt offen, dass nicht gebucht werden kann', () => {
    expect(prompt.toLowerCase()).toContain('buchen kannst du nicht');
  });
});
