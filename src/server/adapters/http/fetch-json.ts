import type { z } from 'zod';
import { fail, ok, type Result } from '@/domain/result';

/**
 * Gemeinsamer Zugang zu allen HTTP-Anbietern.
 *
 * Drei Dinge passieren hier an genau einer Stelle, statt in jedem Adapter neu:
 * 1. Zeitbegrenzung — ein haengender Anbieter darf den Agenten nicht blockieren.
 * 2. Uebersetzung von HTTP-Status in DomainError.
 * 3. Pruefung der Antwort gegen ein Schema, bevor sie in die Domaene gelangt.
 *
 * Punkt drei ist der wichtigste: Ein Anbieter kann sein Format aendern, ohne
 * es anzukuendigen. Ohne Pruefung wanderten fremde Strukturen ungeprueft durch
 * die Anwendung und faenden erst irgendwo tief drin einen Fehler.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  /** Name des Anbieters — erscheint in Fehlermeldungen und Protokollen. */
  readonly provider: string;
}

function describeStatus(status: number, provider: string): Result<never> {
  if (status === 429) {
    return fail('rate_limited', `${provider} meldet zu viele Anfragen`, { status });
  }

  if (status === 404) {
    return fail('not_found', `${provider} kennt die angefragte Ressource nicht`, { status });
  }

  if (status === 401 || status === 403) {
    return fail('unauthorized', `${provider} verweigert den Zugriff`, { status });
  }

  return fail('upstream_error', `${provider} antwortete mit Status ${String(status)}`, { status });
}

/**
 * Fuehrt eine Anfrage aus und prueft die Antwort gegen ein Schema.
 *
 * `fetchImpl` ist ueberschreibbar, damit Tests ohne Netzwerk auskommen — die
 * Alternative waere ein globaler Mock, der Nebenwirkungen zwischen Tests
 * verschleppt.
 */
export async function fetchJson<T>(
  options: FetchJsonOptions,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(options.url, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return describeStatus(response.status, options.provider);
    }

    const payload: unknown = await response.json();
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      // Bewusst upstream_error statt validation_error: Nicht unsere Eingabe
      // war falsch, sondern die Antwort des Anbieters passt nicht mehr.
      return fail('upstream_error', `${options.provider} lieferte ein unerwartetes Format`, {
        issues: parsed.error.issues.slice(0, 5),
      });
    }

    return ok(parsed.data);
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';

    return fail(
      'upstream_error',
      aborted
        ? `${options.provider} antwortete nicht innerhalb von ${String(timeoutMs)} ms`
        : `${options.provider} ist nicht erreichbar`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    clearTimeout(timer);
  }
}
