/**
 * Liest `.env` und `.env.local`, ohne fremde Bibliothek.
 *
 * Next.js macht das im laufenden Server selbst; die Skripte hier laufen aber
 * ausserhalb davon. Ohne diese Funktion sah `npm run db:migrate` nur die
 * Voreinstellung im Code und nie den Eintrag in der `.env` — das faellt
 * erst auf, wenn die beiden auseinanderlaufen.
 *
 * Reihenfolge: `.env` zuerst, dann `.env.local` (gewinnt), dann die echte
 * Prozessumgebung (gewinnt immer). Beide Dateien stehen in `.gitignore`.
 */
import { readFileSync } from 'node:fs';

function readFile(url) {
  try {
    const raw = readFileSync(url, 'utf8');
    const values = {};

    for (const line of raw.split('\n')) {
      // KEY="wert", KEY=wert, mit optionalen Leerzeichen; Kommentare fallen weg.
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]*)"?\s*$/.exec(line);

      if (match?.[1] !== undefined) {
        values[match[1]] = (match[2] ?? '').trim();
      }
    }

    return values;
  } catch {
    return {};
  }
}

/** @param {URL} projectRoot */
export function readEnv(projectRoot) {
  return {
    ...readFile(new URL('.env', projectRoot)),
    ...readFile(new URL('.env.local', projectRoot)),
    ...process.env,
  };
}
