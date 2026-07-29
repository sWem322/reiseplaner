// Muss als Erstes stehen: füllt process.env, bevor `@/env` es liest.
import './load-env';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/env';
import { createGeminiLlm } from '@/server/agent/llm/gemini';
import { buildModelChain } from '@/server/agent/llm/model-rotation';
import { createRuleBasedLlm } from '@/server/agent/llm/rule-based';
import { createSeedProviders } from '@/server/adapters/factory';
import { EVAL_FAELLE } from './faelle';
import { runEval, type EvalBericht } from './runner';

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

async function main(): Promise<void> {
  if (mitLlm && env.GEMINI_API_KEY === undefined) {
    console.error('Für --llm wird GEMINI_API_KEY gebraucht.');
    process.exitCode = 1;

    return;
  }

  const llm = mitLlm
    ? createGeminiLlm({
        apiKey: env.GEMINI_API_KEY ?? '',
        models: buildModelChain(env.GEMINI_MODEL),
      })
    : createRuleBasedLlm();

  console.log(`Eval gegen ${llm.name} — ${String(EVAL_FAELLE.length)} Fälle`);
  console.log('');

  const bericht = await runEval({
    llm,
    providers: createSeedProviders(),
    faelle: EVAL_FAELLE,
  });

  zeigeBericht(bericht);
  await schreibeBericht(bericht, mitLlm ? 'gemini' : 'rule-based');
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
