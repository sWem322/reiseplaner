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

  // Auth.js — im Entwicklungsmodus mit Fallback, in Produktion Pflicht.
  AUTH_SECRET: z.string().min(1).optional(),

  // --- Optionale Anbieter. Fehlen sie, greift der Seed-Adapter. ---
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-flash-latest'),
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

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

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
