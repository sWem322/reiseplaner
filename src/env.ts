import { z } from 'zod';

/**
 * Einziger Ort, an dem process.env gelesen wird.
 *
 * Zentrale Regel des Projekts: Das Programm startet ohne jede optionale
 * Variable. Fehlt ein Anbieter-Schluessel, faellt die jeweilige Port-Fabrik
 * auf die deterministische In-Memory-Implementierung zurueck. Damit laeuft
 * die Demo bei jeder fremden Person, ohne dass sie sich irgendwo registriert.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Pflicht: ohne Datenbank gibt es kein persistentes Gedaechtnis.
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://reiseplaner:reiseplaner@localhost:5432/reiseplaner'),

  /*
   * Kein AUTH_SECRET: Es stammte aus dem urspruenglichen Plan mit Auth.js und
   * wurde nie gelesen. Die Sitzungen dieses Projekts sind Zufallswerte in der
   * Datenbank — es gibt kein selbsttragendes Token, das zu signieren waere.
   * Eine Variable, die nichts tut, aber nach Sicherheit klingt, ist schlimmer
   * als keine: Sie laesst glauben, es haenge etwas daran.
   */

  // --- Optionale Anbieter. Fehlen sie, greift der Seed-Adapter. ---
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * Wunschmodell. Ohne Angabe entscheidet die Modellkette — sie hat keinen
   * einzelnen Standard mehr, sondern eine Reihenfolge nach Ausdauer.
   */
  GEMINI_MODEL: z.string().min(1).optional(),
  DUFFEL_ACCESS_TOKEN: z.string().min(1).optional(),
  TRAVELPAYOUTS_TOKEN: z.string().min(1).optional(),

  // --- Guardrails: Obergrenzen des Agenten-Loops. ---
  AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(20).default(8),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(60).default(20),
  AGENT_TOKEN_BUDGET: z.coerce.number().int().min(1_000).default(120_000),
  GUEST_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(0).default(20),

  /**
   * Netzwerkfreie Anbieter abschalten.
   *
   * Open-Meteo und Overpass brauchen keinen Schluessel, aber ein Netz — und
   * Overpass antwortet unter Last auch mal gar nicht. Fuer den E2E-Lauf waere
   * das ein roter Test, der nichts ueber diesen Code aussagt. Mit
   * `USE_NETWORK_PROVIDERS=false` laeuft alles gegen die Seed-Daten.
   */
  USE_NETWORK_PROVIDERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((wert) => wert === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Eine leere Zeichenkette heisst „nicht gesetzt".
 *
 * `.env.example` gibt jede optionale Variable als `NAME=""` vor — so sieht
 * man auf einen Blick, was es überhaupt gibt. Wer die Datei kopiert und nur
 * einen Wert ausfüllt, hinterlässt genau solche leeren Einträge. Ohne diesen
 * Schritt scheitert die Prüfung an ihnen („expected string to have >=1
 * characters"), und das Projekt startet ausgerechnet bei dem nicht, der der
 * Anleitung gefolgt ist.
 */
function ohneLeere(quelle: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(quelle).filter(
      (eintrag): eintrag is [string, string] =>
        typeof eintrag[1] === 'string' && eintrag[1].trim() !== '',
    ),
  );
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(ohneLeere(process.env));

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ungueltige Umgebungskonfiguration:\n${issues}`);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * Welche echten Anbieter stehen zur Verfuegung? Wird beim Start geloggt,
 * damit im Betrieb sofort sichtbar ist, welcher Adapter aktiv ist.
 */
export const providerAvailability = {
  llm: env.GEMINI_API_KEY !== undefined,
  duffel: env.DUFFEL_ACCESS_TOKEN !== undefined,
  travelpayouts: env.TRAVELPAYOUTS_TOKEN !== undefined,
} as const;

export type ProviderAvailability = typeof providerAvailability;
