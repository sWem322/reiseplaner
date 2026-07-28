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
 * Geprüft werden drei Dinge, die im Test nicht beweisbar sind:
 * 1. Der Schlüssel wird akzeptiert.
 * 2. Das Modell versteht die Werkzeugbeschreibung und ruft das Werkzeug auf.
 * 3. Der Tokenverbrauch kommt zurück.
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
const model = env.GEMINI_MODEL ?? 'gemini-2.5-flash';

if (!apiKey) {
  console.error('GEMINI_API_KEY fehlt. Schlüssel in die Datei .env eintragen.');
  console.error('Erzeugen unter https://aistudio.google.com/apikey');
  process.exit(1);
}

console.log(`Modell: ${model}`);
console.log(`Schlüssel: ${apiKey.slice(0, 6)}… (${apiKey.length} Zeichen)`);
console.log('');

const client = new GoogleGenAI({ apiKey });

const werkzeug = {
  name: 'resolve_destination',
  description:
    'Wandelt einen Ortsnamen aus freiem Text in einen Ort mit IATA-Code um. ' +
    'Immer zuerst aufrufen, bevor nach Flügen gesucht wird.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Ortsname aus der Nutzereingabe, etwa „Mallorca"',
      },
    },
    required: ['query'],
  },
};

try {
  const start = Date.now();

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Ich möchte im September nach Mallorca fliegen.' }],
      },
    ],
    config: {
      systemInstruction:
        'Du bist ein Reiseassistent. Löse Ortsnamen immer zuerst mit dem Werkzeug auf.',
      tools: [{ functionDeclarations: [werkzeug] }],
      temperature: 0.2,
    },
  });

  const dauer = Date.now() - start;
  const teile = response.candidates?.[0]?.content?.parts ?? [];
  const aufrufe = teile.filter((teil) => teil.functionCall !== undefined);
  const text = teile
    .filter((teil) => typeof teil.text === 'string')
    .map((teil) => teil.text)
    .join('');

  console.log(`✓ Verbindung steht (${dauer} ms)`);
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
  console.log(`  Eingabe:  ${response.usageMetadata?.promptTokenCount ?? '?'}`);
  console.log(`  Ausgabe:  ${response.usageMetadata?.candidatesTokenCount ?? '?'}`);
  console.log('');
  console.log('Der Gemini-Zugang funktioniert.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error('✗ Der Aufruf ist fehlgeschlagen:');
  console.error(`  ${message}`);
  console.error('');

  if (/API key|UNAUTHENTICATED|PERMISSION_DENIED|401|403/i.test(message)) {
    console.error('Der Schlüssel wird abgelehnt. Prüfen unter https://aistudio.google.com/apikey');
  } else if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    console.error('Das kostenlose Kontingent ist erschöpft. Später erneut versuchen.');
  } else if (/not found|NOT_FOUND|404/i.test(message)) {
    console.error(`Das Modell „${model}" ist nicht verfügbar. Anderes Modell in .env setzen:`);
    console.error('  GEMINI_MODEL="gemini-2.5-flash-lite"');
  }

  process.exit(1);
}
