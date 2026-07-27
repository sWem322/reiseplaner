/**
 * Ergebnis-Typ fuer alle Operationen, die kontrolliert fehlschlagen duerfen —
 * insbesondere Adapter zu externen Anbietern und Werkzeug-Ausfuehrungen.
 *
 * Warum kein throw? Der Agenten-Loop muss Fehler als Daten behandeln: Ein
 * fehlgeschlagener Werkzeugaufruf geht als tool_result zurueck an das Modell,
 * damit es sich selbst korrigieren kann. Eine geworfene Exception wuerde den
 * Loop abbrechen und genau diese Selbstkorrektur verhindern.
 */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ERROR_KINDS = [
  'validation_error',
  'upstream_error',
  'not_found',
  'rate_limited',
  'budget_exceeded',
  'unauthorized',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface DomainError {
  readonly kind: ErrorKind;
  /** Fuer Menschen und fuer das Modell lesbar — landet im tool_result. */
  readonly message: string;
  /** Optionaler Kontext fuer Logs, niemals fuer die Modellantwort gedacht. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fail(
  kind: ErrorKind,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Result<never> {
  return err(details === undefined ? { kind, message } : { kind, message, details });
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Wendet eine Funktion auf den Erfolgswert an und laesst Fehler unveraendert. */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => U,
): Result<U, E> {
  return result.ok ? { ok: true, value: transform(result.value) } : result;
}

/** Erzwingt den Erfolgswert. Nur in Tests und Seed-Daten verwenden. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`unwrap auf fehlgeschlagenem Result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
