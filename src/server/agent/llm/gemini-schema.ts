/**
 * Umbau eines JSON-Schemas in den Dialekt, den Gemini akzeptiert.
 *
 * Gemini erwartet eine Teilmenge von OpenAPI 3.0, nicht das vollständige
 * JSON-Schema, das Zod erzeugt. Wird ein unbekanntes Feld mitgeschickt, lehnt
 * die Schnittstelle die gesamte Anfrage ab — mit einer Meldung, die nicht
 * verrät, welches Feld gestört hat.
 *
 * Diese Datei ist der Preis dafür, dass Werkzeuge einmal in Zod beschrieben
 * werden und trotzdem jeder Anbieter sie versteht. Sie ist gleichzeitig ein
 * gutes Beispiel dafür, warum Anbieter hinter einem Port verschwinden sollten:
 * Diese Eigenheit betrifft genau eine Datei.
 */

/** Felder, die Gemini kennt. Alles andere wird entfernt. */
const ALLOWED_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
]);

/** Formate, die Gemini bei `type: string` akzeptiert. */
const ALLOWED_STRING_FORMATS = new Set(['date-time', 'enum']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Löst die häufigsten Konstrukte auf, die Zod erzeugt und Gemini nicht kennt.
 *
 * - `anyOf` mit genau einem Nicht-Null-Zweig wird zu diesem Zweig plus
 *   `nullable: true`. So bleibt `z.string().nullable()` erhalten.
 * - Mehrdeutige `anyOf` verlieren ihre Verzweigung; übrig bleibt der erste
 *   Zweig. Das ist ein bewusster Informationsverlust: Ein Werkzeug mit echter
 *   Union im Eingabeschema wäre für das Modell ohnehin schwer zu treffen.
 */
function flattenUnion(schema: Record<string, unknown>): Record<string, unknown> {
  const union = schema.anyOf ?? schema.oneOf;

  if (!Array.isArray(union)) {
    return schema;
  }

  const branches = union.filter(isRecord);
  const nullBranch = branches.find((branch) => branch.type === 'null');
  const valueBranches = branches.filter((branch) => branch.type !== 'null');
  const first = valueBranches[0];

  if (first === undefined) {
    return { type: 'string' };
  }

  const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = schema;

  return {
    ...rest,
    ...first,
    ...(nullBranch === undefined ? {} : { nullable: true }),
  };
}

/**
 * Reinigt ein JSON-Schema rekursiv.
 *
 * Entfernt `$schema`, `additionalProperties`, `$ref`, `default` und alles
 * andere, was nicht in der Erlaubnisliste steht.
 */
export function toGeminiSchema(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return { type: 'string' };
  }

  const flattened = flattenUnion(input);
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flattened)) {
    if (!ALLOWED_KEYS.has(key)) {
      continue;
    }

    if (key === 'properties' && isRecord(value)) {
      const properties: Record<string, unknown> = {};

      for (const [propertyName, propertySchema] of Object.entries(value)) {
        properties[propertyName] = toGeminiSchema(propertySchema);
      }

      output.properties = properties;
      continue;
    }

    if (key === 'items') {
      output.items = toGeminiSchema(value);
      continue;
    }

    if (key === 'format' && typeof value === 'string' && !ALLOWED_STRING_FORMATS.has(value)) {
      // Formate wie "date" oder "uuid" kennt Gemini nicht; die Angabe steht
      // ohnehin zusätzlich in der Beschreibung.
      continue;
    }

    output[key] = value;
  }

  if (output.type === undefined) {
    output.type = output.properties === undefined ? 'string' : 'object';
  }

  // Ein Objekt ohne Eigenschaften lehnt Gemini ab; ein leeres properties-Feld
  // ist zulässig und bedeutet dasselbe.
  if (output.type === 'object' && output.properties === undefined) {
    output.properties = {};
  }

  return output;
}
