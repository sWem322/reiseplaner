import { readFileSync } from 'node:fs';

/**
 * Füllt `process.env` aus `.env` und `.env.local`.
 *
 * Muss **vor** `@/env` importiert werden — ES-Module werden in der
 * Reihenfolge ihrer Import-Anweisungen ausgewertet, und `@/env` liest
 * `process.env` beim Laden.
 *
 * Warum überhaupt: Innerhalb von Next.js füllt das Framework `process.env`
 * selbst. Der Eval läuft aber als eigenes Programm, und dort ist die Datei
 * einfach eine Datei. Ohne dieses Modul meldete `npm run eval -- --llm`, der
 * Schlüssel fehle — obwohl er in `.env` steht.
 *
 * Bewusst keine Bibliothek und bewusst nicht mit `scripts/read-env.mjs`
 * geteilt: Die Skripte dort laufen unter Node ohne TypeScript, und eine
 * gemeinsame Datei über diese Grenze hinweg kostet mehr, als die zwölf Zeilen
 * hier wert sind.
 */
function laden(datei: string): void {
  try {
    const raw = readFileSync(new URL(datei, new URL('../', import.meta.url)), 'utf8');

    for (const zeile of raw.split('\n')) {
      const treffer = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]*)"?\s*$/.exec(zeile);
      const name = treffer?.[1];

      // Die echte Umgebung gewinnt: Wer die Variable beim Aufruf setzt, meint
      // sie auch.
      if (name !== undefined && process.env[name] === undefined) {
        process.env[name] = (treffer?.[2] ?? '').trim();
      }
    }
  } catch {
    // Keine Datei — dann eben nicht.
  }
}

laden('.env');
laden('.env.local');
