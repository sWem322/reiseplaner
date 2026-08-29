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
 * Anfrage, Zeitbegrenzung, Statuszuordnung — und dann erst das Lesen.
 *
 * Das Lesen des Rumpfes kommt als Funktion herein, statt dass es zwei fast
 * gleiche Kopien dieses Ablaufs gaebe: eine fuer JSON, eine fuer Bytes. Wichtig
 * ist dabei, dass es **innerhalb** der Zeitbegrenzung geschieht — ein Anbieter,
 * der den Kopf sofort schickt und den Rumpf nie zu Ende, waere sonst wieder
 * genau das haengende Gegenueber, gegen das die Frist gedacht ist.
 */
async function fetchWithTimeout<T>(
  options: FetchJsonOptions,
  accept: string,
  fetchImpl: typeof fetch,
  read: (response: Response) => Promise<Result<T>>,
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
        accept,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return describeStatus(response.status, options.provider);
    }

    return await read(response);
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
  return fetchWithTimeout(options, 'application/json', fetchImpl, async (response) => {
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
  });
}

export interface FetchBytesOptions extends FetchJsonOptions {
  /**
   * Womit der Inhaltstyp der Antwort beginnen muss, etwa `audio/`.
   *
   * Ein Anbieter kann mit 200 antworten und trotzdem keine Nutzlast liefern,
   * sondern eine Fehlermeldung als JSON. Ohne diese Pruefung landeten deren
   * Bytes im `<audio>`-Element, und auf dem Bildschirm stuende ein
   * Abspielgeraet, das schweigt.
   */
  readonly expects?: string;
}

/**
 * Dieselbe Anfrage, nur dass der Rumpf Bytes sind statt JSON.
 *
 * Fuer Nutzlasten, die kein Schema haben, weil sie keine Struktur haben —
 * Ton, Bilder, Dateien. Geprueft wird deshalb, was sich pruefen laesst: der
 * Inhaltstyp und die Frage, ob ueberhaupt etwas ankam.
 */
export async function fetchBytes(
  options: FetchBytesOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<{ data: Uint8Array<ArrayBuffer>; mimeType: string }>> {
  const erwartet = options.expects;

  /*
   * Als Accept geht "alles" hinaus, nicht der erwartete Typ: `expects` ist ein
   * Praefix wie `audio/` und waere als Kopfzeile keine gueltige Angabe.
   * Geprueft wird die Antwort, gefordert wird nichts.
   */
  return fetchWithTimeout(options, '*/*', fetchImpl, async (response) => {
    const mimeType = response.headers.get('content-type') ?? '';

    if (erwartet !== undefined && !mimeType.startsWith(erwartet)) {
      return fail(
        'upstream_error',
        `${options.provider} antwortete mit ${mimeType === '' ? 'unbekanntem Inhaltstyp' : mimeType} statt mit ${erwartet}…`,
        { contentType: mimeType },
      );
    }

    const data = new Uint8Array(await response.arrayBuffer());

    if (data.length === 0) {
      return fail('upstream_error', `${options.provider} lieferte eine leere Antwort`);
    }

    return ok({ data, mimeType });
  });
}
