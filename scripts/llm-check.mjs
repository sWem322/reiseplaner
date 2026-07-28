/**
 * Prüft den Gemini-Zugang gegen die echte Schnittstelle.
 *
 *   npm run llm:check
 *
 * Existiert, weil die Entwicklungsumgebung dieses Projekts
 * generativelanguage.googleapis.com nicht erreicht: Der Adapter wird gegen
 * einen untergeschobenen Client getestet, dieser Aufruf beweist, dass er auch
 * gegen den echten Dienst funktioniert.
 *
 * Das Skript fragt die verfügbaren Modelle beim Dienst ab, statt einen Namen
 * fest anzunehmen. Google benennt und entfernt Modelle laufend — ein fest
 * eingetragener Name wäre in wenigen Monaten falsch, und die Fehlermeldung
 * ("model is no longer available to new users") sagt nicht, welcher Name
 * stattdessen gilt.
 */
import { readFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

function readEnvFile() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const values = {};

    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);

      if (match) {
        values[match[1]] = match[2];
      }
    }

    return values;
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(), ...process.env };
const apiKey = env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('GEMINI_API_KEY fehlt. Schlüssel in die Datei .env eintragen.');
  console.error('Erzeugen unter https://aistudio.google.com/apikey');
  process.exitCode = 1;
} else {
  await main(apiKey, env.GEMINI_MODEL);
}

async function main(key, wunschModell) {
  console.log(`Schlüssel: ${key.slice(0, 6)}… (${key.length} Zeichen)`);
  console.log('');

  const client = new GoogleGenAI({ apiKey: key });

  // --- Schritt 1: Welche Modelle stehen diesem Schlüssel offen? -----------

  let verfuegbare = [];

  try {
    const seiten = await client.models.list();

    for await (const modell of seiten) {
      const kann = modell.supportedActions ?? modell.supportedGenerationMethods ?? [];

      if (kann.length === 0 || kann.includes('generateContent')) {
        verfuegbare.push(modell.name?.replace(/^models\//, '') ?? '');
      }
    }
  } catch (error) {
    berichteFehler(error, wunschModell);
    process.exitCode = 1;
    return;
  }

  if (verfuegbare.length === 0) {
    console.error('✗ Der Dienst nennt kein einziges nutzbares Modell.');
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Zugang steht — ${String(verfuegbare.length)} Modelle verfügbar`);

  const flashModelle = verfuegbare.filter((name) => name.includes('flash'));

  console.log('');
  console.log('Flash-Modelle (kostenloses Kontingent):');
  for (const name of flashModelle.slice(0, 12)) {
    console.log(`  ${name}`);
  }

  // --- Schritt 2: Ein Modell auswählen -----------------------------------

  const modell =
    wunschModell && verfuegbare.includes(wunschModell)
      ? wunschModell
      : (flashModelle.find((name) => !name.includes('lite') && !name.includes('image')) ??
        flashModelle[0] ??
        verfuegbare[0]);

  if (wunschModell && !verfuegbare.includes(wunschModell)) {
    console.log('');
    console.log(`⚠ „${wunschModell}" aus .env ist nicht verfügbar — nutze „${modell}".`);
  }

  console.log('');
  console.log(`Testlauf mit: ${modell}`);
  console.log('');

  // --- Schritt 3: Ein Aufruf mit Werkzeugnutzung -------------------------

  const werkzeug = {
    name: 'resolve_destination',
    description:
      'Wandelt einen Ortsnamen aus freiem Text in einen Ort mit IATA-Code um. ' +
      'Immer zuerst aufrufen, bevor nach Flügen gesucht wird.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Ortsname aus der Nutzereingabe' },
      },
      required: ['query'],
    },
  };

  try {
    const start = Date.now();

    const antwort = await client.models.generateContent({
      model: modell,
      contents: [
        { role: 'user', parts: [{ text: 'Ich möchte im September nach Mallorca fliegen.' }] },
      ],
      config: {
        systemInstruction:
          'Du bist ein Reiseassistent. Löse Ortsnamen immer zuerst mit dem Werkzeug auf.',
        tools: [{ functionDeclarations: [werkzeug] }],
        temperature: 0.2,
      },
    });

    const dauer = Date.now() - start;
    const teile = antwort.candidates?.[0]?.content?.parts ?? [];
    const aufrufe = teile.filter((teil) => teil.functionCall !== undefined);
    const text = teile
      .filter((teil) => typeof teil.text === 'string')
      .map((teil) => teil.text)
      .join('');

    console.log(`✓ Antwort erhalten (${String(dauer)} ms)`);
    console.log('');

    if (aufrufe.length > 0) {
      console.log('✓ Werkzeugaufruf erkannt:');
      for (const aufruf of aufrufe) {
        console.log(`  ${aufruf.functionCall.name}(${JSON.stringify(aufruf.functionCall.args)})`);
      }
    } else {
      console.log('⚠ Kein Werkzeugaufruf — das Modell hat direkt geantwortet:');
      console.log(`  „${text.trim().slice(0, 200)}"`);
    }

    console.log('');
    console.log('Tokenverbrauch:');
    console.log(`  Eingabe: ${String(antwort.usageMetadata?.promptTokenCount ?? '?')}`);
    console.log(`  Ausgabe: ${String(antwort.usageMetadata?.candidatesTokenCount ?? '?')}`);
    console.log('');
    console.log('Der Gemini-Zugang funktioniert.');

    if (modell !== wunschModell) {
      console.log('');
      console.log('Diesen Namen in .env eintragen, damit er fest steht:');
      console.log(`  GEMINI_MODEL="${modell}"`);
    }
  } catch (error) {
    berichteFehler(error, modell);
    process.exitCode = 1;
  }
}

function berichteFehler(error, modell) {
  const message = error instanceof Error ? error.message : String(error);

  console.error('✗ Der Aufruf ist fehlgeschlagen:');
  console.error(`  ${message.slice(0, 400)}`);
  console.error('');

  if (/API key|UNAUTHENTICATED|PERMISSION_DENIED|\b401\b|\b403\b/i.test(message)) {
    console.error('Der Schlüssel wird abgelehnt. Prüfen unter https://aistudio.google.com/apikey');
  } else if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    console.error('Das kostenlose Kontingent ist erschöpft. Später erneut versuchen.');
  } else if (/no longer available|not found|NOT_FOUND|\b404\b/i.test(message)) {
    console.error(`Das Modell „${modell ?? '?'}" gibt es für diesen Zugang nicht.`);
    console.error('Die Liste oben zeigt, was stattdessen zur Verfügung steht.');
  } else if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    console.error('Keine Verbindung zu generativelanguage.googleapis.com.');
  }
}
