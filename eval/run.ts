// Muss als Erstes stehen: füllt process.env, bevor `@/env` es liest.
import './load-env';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/env';
import { createGeminiLlm } from '@/server/agent/llm/gemini';
import { buildModelChain } from '@/server/agent/llm/model-rotation';
import { createRuleBasedLlm } from '@/server/agent/llm/rule-based';
import { createSeedProviders } from '@/server/adapters/factory';
import { EVAL_FAELLE } from './faelle';
import { withPatience } from './patient-llm';
import { neuBerechnet, runEval, type EvalBericht } from './runner';

/**
 * Einstiegspunkt des Eval-Laufs.
 *
 *   npm run eval            — regelbasiert, kostenlos, deterministisch
 *   npm run eval -- --llm   — gegen Gemini, verbraucht Kontingent
 *
 * Immer gegen Seed-Anbieter: Gemessen wird der Agent, nicht die Tagesform
 * von Overpass. Sonst schwankte die Zahl mit der Erreichbarkeit fremder
 * Dienste, und der Vergleich zweier Läufe wäre wertlos.
 */

const mitLlm = process.argv.includes('--llm');

/**
 * Bereits gemessene Fälle überspringen und den Bericht ergänzen.
 *
 * Das kostenlose Kontingent reicht nicht immer für zwanzig Gespräche am
 * Stück. Statt den ganzen Lauf zu verlieren, wird er fortgesetzt: Was schon
 * im gespeicherten Bericht steht, wird nicht noch einmal gefragt.
 *
 *   npm run eval -- --llm --weiter
 */
const fortsetzen = process.argv.includes('--weiter');

async function main(): Promise<void> {
  if (mitLlm && env.GEMINI_API_KEY === undefined) {
    console.error('Für --llm wird GEMINI_API_KEY gebraucht.');
    process.exitCode = 1;

    return;
  }

  const llm = mitLlm
    ? // Geduldig, weil der Eval ein Stapellauf ist: Lieber langsam und
      // vollstaendig als schnell und unbrauchbar.
      withPatience(
        createGeminiLlm({
          apiKey: env.GEMINI_API_KEY ?? '',
          models: buildModelChain(env.GEMINI_MODEL),
        }),
      )
    : createRuleBasedLlm();

  const name = mitLlm ? 'gemini' : 'rule-based';
  const frueher = fortsetzen ? await lieseBericht(name) : null;
  const fertig = new Set(frueher?.faelle.map((fall) => fall.id) ?? []);
  const offen = EVAL_FAELLE.filter((fall) => !fertig.has(fall.id));

  if (fertig.size > 0) {
    console.log(`${String(fertig.size)} Fälle liegen bereits vor, ${String(offen.length)} offen.`);
  }

  if (offen.length === 0) {
    console.log('Nichts mehr zu tun.');

    return;
  }

  console.log(`Eval gegen ${llm.name} — ${String(offen.length)} Fälle`);
  console.log('');

  const neu = await runEval({
    llm,
    providers: createSeedProviders(),
    faelle: offen,
  });

  const bericht = vereinige(frueher, neu);

  zeigeBericht(bericht);

  /*
   * Ein Bericht mit ungemessenen Faellen sieht aus wie eine Messung und ist
   * keine. Genau das ist einmal passiert: Nach drei Faellen war das
   * Minutenkontingent erschoepft, die restlichen siebzehn liefen ins Leere,
   * und unten stand eine Genauigkeit von 49 Prozent — eine Zahl ueber die
   * Drosselung, nicht ueber das Modell. Solche Zahlen duerfen nicht in eine
   * Datei geraten, aus der spaeter eine Tabelle im README wird.
   */
  if (bericht.kennzahlen.nichtGemesseneFaelle > 0) {
    /*
     * Was gemessen wurde, bleibt erhalten — nur die ungemessenen Faelle
     * fallen weg. Beim naechsten Mal mit `--weiter` werden genau sie
     * nachgeholt, statt das Kontingent noch einmal fuer alles auszugeben.
     */
    const brauchbar = bericht.faelle.filter((fall) => !fall.nichtGemessen);

    if (brauchbar.length > 0) {
      await schreibeBericht(neuBerechnet(bericht, brauchbar), name);
      console.error('');
      console.error(
        `  ${String(brauchbar.length)} gemessene Fälle wurden gesichert — ` +
          'Fortsetzung mit: npm run eval -- --llm --weiter',
      );
    }

    console.error('');
    console.error(
      `✗ ${String(bericht.kennzahlen.nichtGemesseneFaelle)} von ` +
        `${String(bericht.faelle.length)} Fällen wurden nicht gemessen — ` +
        'das Modell war nicht erreichbar.',
    );
    console.error('  Der Bericht wird nicht gespeichert; die Zahlen oben sind wertlos.');
    console.error('  Später erneut versuchen, wenn das Kontingent zurückgesetzt ist.');
    process.exitCode = 1;

    return;
  }

  await schreibeBericht(bericht, name);
}

/** Liest einen früheren Bericht, falls vorhanden. */
async function lieseBericht(name: string): Promise<EvalBericht | null> {
  try {
    const roh = await readFile(join(process.cwd(), 'eval', 'ergebnisse', `${name}.json`), 'utf8');

    return JSON.parse(roh) as EvalBericht;
  } catch {
    return null;
  }
}

/** Fügt einen früheren und einen neuen Bericht zusammen. */
function vereinige(frueher: EvalBericht | null, neu: EvalBericht): EvalBericht {
  if (frueher === null) {
    return neu;
  }

  return neuBerechnet(neu, [...frueher.faelle, ...neu.faelle]);
}

function zeigeBericht(bericht: EvalBericht): void {
  for (const fall of bericht.faelle) {
    const zeichen = fall.bestanden ? '✓' : fall.nochOffen ? '○' : '✗';

    console.log(`${zeichen} ${fall.id} — ${fall.beschreibung}`);

    for (const befund of fall.befunde) {
      if (befund.urteil === 'richtig') {
        continue;
      }

      console.log(
        `    ${befund.slot}: ${befund.urteil} ` +
          `(erwartet ${JSON.stringify(befund.erwartet)}, ` +
          `bekommen ${JSON.stringify(befund.tatsaechlich)})`,
      );
    }
  }

  const k = bericht.kennzahlen;

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Slot-Genauigkeit:      ${(k.genauigkeit * 100).toFixed(1)} %`);
  console.log(`  richtig:             ${String(k.richtig)} von ${String(k.slotsGesamt)}`);
  console.log(`  falsch:              ${String(k.falsch)}`);
  console.log(`  erfunden:            ${String(k.erfunden)}   ← das Schlimmste`);
  console.log(`  fehlt:               ${String(k.fehlt)}`);
  console.log(
    `Bestandene Fälle:      ${String(k.bestandeneFaelle)} von ${String(bericht.faelle.length)}` +
      ` (davon ${String(k.offeneFaelle)} als noch offen markiert)`,
  );
  console.log(`Werkzeugaufrufe/Fall:  ${k.werkzeugaufrufeJeFall.toFixed(1)}`);
  console.log(`Misslungene Aufrufe:   ${(k.anteilMisslungenerAufrufe * 100).toFixed(1)} %`);

  if (k.nichtGemesseneFaelle > 0) {
    console.log(`Nicht gemessen:        ${String(k.nichtGemesseneFaelle)}`);
  }
}

async function schreibeBericht(bericht: EvalBericht, name: string): Promise<void> {
  const ordner = join(process.cwd(), 'eval', 'ergebnisse');
  await mkdir(ordner, { recursive: true });

  const datei = join(ordner, `${name}.json`);
  await writeFile(datei, `${JSON.stringify(bericht, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`Ergebnis gespeichert: eval/ergebnisse/${name}.json`);
}

await main();
