import type { AgentLimits, StopReason } from '@/domain/agent';

/**
 * Guardrails des Agenten-Loops.
 *
 * Ein Modell, das Werkzeuge aufrufen darf, kann sich verrennen: dieselbe Suche
 * in Schleife, immer neue Varianten, kein Abschluss. Ohne Obergrenzen kostet
 * das im besten Fall Geld und im schlechtesten einen haengenden Server.
 *
 * Die Zaehler stehen bewusst in einer eigenen, testbaren Einheit statt als
 * Variablen im Loop. So laesst sich jede Grenze einzeln pruefen, ohne einen
 * kompletten Lauf zu simulieren.
 */

export interface GuardrailState {
  readonly iterations: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface GuardrailDecision {
  /** Darf die naechste Iteration starten? */
  readonly allowed: boolean;
  /** Wenn nicht: warum. */
  readonly stopReason?: StopReason;
}

export class Guardrails {
  private iterations = 0;
  private toolCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly limits: AgentLimits) {}

  get state(): GuardrailState {
    return {
      iterations: this.iterations,
      toolCalls: this.toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  /**
   * Wird vor jeder Modellanfrage aufgerufen.
   *
   * Die Budgetpruefung steht bewusst *vor* der Anfrage: Ein ueberschrittenes
   * Budget nachtraeglich festzustellen hiesse, es bereits ueberschritten zu
   * haben. Die Iterationsgrenze ebenso — sonst laeuft immer eine Anfrage mehr.
   */
  beforeIteration(): GuardrailDecision {
    if (this.totalTokens >= this.limits.tokenBudget) {
      return { allowed: false, stopReason: 'budget_exceeded' };
    }

    if (this.iterations >= this.limits.maxIterations) {
      return { allowed: false, stopReason: 'max_iterations' };
    }

    this.iterations += 1;

    return { allowed: true };
  }

  /**
   * Wird vor jedem Block von Werkzeugaufrufen aufgerufen.
   *
   * Prueft die Gesamtzahl inklusive der anstehenden Aufrufe: Ein Zug mit fuenf
   * parallelen Aufrufen darf die Grenze nicht ueberspringen, nur weil er als
   * einzelner Schritt zaehlt.
   */
  beforeToolCalls(count: number): GuardrailDecision {
    if (this.toolCalls + count > this.limits.maxToolCalls) {
      return { allowed: false, stopReason: 'max_tool_calls' };
    }

    this.toolCalls += count;

    return { allowed: true };
  }

  recordUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
  }

  /** Verbleibendes Token-Budget — steuert die maximale Antwortlaenge. */
  get remainingTokens(): number {
    return Math.max(0, this.limits.tokenBudget - this.totalTokens);
  }
}
