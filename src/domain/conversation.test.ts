import { describe, expect, it } from 'vitest';
import {
  contentBlockSchema,
  conversationSchema,
  isBudgetExceeded,
  messageSchema,
  toolCallLogSchema,
  toolSuccessRate,
  totalTokens,
  type Conversation,
  type ToolCallLog,
} from './conversation';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: UUID,
    summary: null,
    summarizedUntilSeq: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function toolLog(overrides: Partial<ToolCallLog> = {}): ToolCallLog {
  return {
    id: OTHER_UUID,
    conversationId: UUID,
    toolName: 'search_flights',
    input: { origin: 'DUS' },
    outcome: 'ok',
    errorMessage: null,
    durationMs: 120,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

describe('Inhaltsbloecke', () => {
  it('erkennt einen Textblock', () => {
    expect(contentBlockSchema.safeParse({ type: 'text', text: 'Hallo' }).success).toBe(true);
  });

  it('erkennt einen Werkzeugaufruf', () => {
    const block = {
      type: 'tool_use',
      toolCallId: 'call_1',
      toolName: 'search_flights',
      input: { origin: 'DUS' },
    };

    expect(contentBlockSchema.safeParse(block).success).toBe(true);
  });

  it('erkennt ein Werkzeugergebnis samt Fehlerkennzeichen', () => {
    const block = {
      type: 'tool_result',
      toolCallId: 'call_1',
      isError: true,
      content: 'Anbieter nicht erreichbar',
    };

    const parsed = contentBlockSchema.safeParse(block);

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'tool_result') {
      expect(parsed.data.isError).toBe(true);
    }
  });

  it('lehnt einen unbekannten Blocktyp ab', () => {
    expect(contentBlockSchema.safeParse({ type: 'bild', url: 'x' }).success).toBe(false);
  });

  it('lehnt einen Werkzeugaufruf ohne Zuordnungskennung ab', () => {
    const block = { type: 'tool_use', toolCallId: '', toolName: 'x', input: {} };

    expect(contentBlockSchema.safeParse(block).success).toBe(false);
  });
});

describe('Nachricht', () => {
  it('braucht mindestens einen Block', () => {
    const message = {
      id: UUID,
      seq: 1,
      conversationId: OTHER_UUID,
      role: 'assistant',
      blocks: [],
      createdAt: new Date(),
    };

    expect(messageSchema.safeParse(message).success).toBe(false);
  });

  it('akzeptiert gemischte Bloecke in einer Nachricht', () => {
    const message = {
      id: UUID,
      seq: 1,
      conversationId: OTHER_UUID,
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Ich suche Fluege …' },
        { type: 'tool_use', toolCallId: 'c1', toolName: 'search_flights', input: {} },
      ],
      createdAt: new Date(),
    };

    expect(messageSchema.safeParse(message).success).toBe(true);
  });

  it('lehnt eine unbekannte Rolle ab', () => {
    const message = {
      id: UUID,
      seq: 1,
      conversationId: OTHER_UUID,
      role: 'tool',
      blocks: [{ type: 'text', text: 'x' }],
      createdAt: new Date(),
    };

    expect(messageSchema.safeParse(message).success).toBe(false);
  });
});

describe('Token-Budget', () => {
  it('summiert Ein- und Ausgabe', () => {
    expect(totalTokens(conversation({ inputTokens: 900, outputTokens: 350 }))).toBe(1250);
  });

  it('meldet das Budget als aufgebraucht, wenn es erreicht ist', () => {
    const dialog = conversation({ inputTokens: 700, outputTokens: 300 });

    expect(isBudgetExceeded(dialog, 1000)).toBe(true);
    expect(isBudgetExceeded(dialog, 1001)).toBe(false);
  });

  it('lehnt negative Token-Zaehler ab', () => {
    expect(conversationSchema.safeParse(conversation({ inputTokens: -1 })).success).toBe(false);
  });
});

describe('Werkzeug-Protokoll', () => {
  it('akzeptiert einen erfolgreichen Aufruf', () => {
    expect(toolCallLogSchema.safeParse(toolLog()).success).toBe(true);
  });

  it('lehnt eine negative Dauer ab', () => {
    expect(toolCallLogSchema.safeParse(toolLog({ durationMs: -5 })).success).toBe(false);
  });

  it('lehnt einen unbekannten Ausgang ab', () => {
    const log = { ...toolLog(), outcome: 'timeout' };

    expect(toolCallLogSchema.safeParse(log).success).toBe(false);
  });

  it('berechnet die Erfolgsquote', () => {
    const logs = [
      toolLog(),
      toolLog({ outcome: 'validation_error', errorMessage: 'IATA ungueltig' }),
      toolLog(),
      toolLog({ outcome: 'upstream_error', errorMessage: 'Zeitueberschreitung' }),
    ];

    expect(toolSuccessRate(logs)).toBe(0.5);
  });

  it('wertet einen Dialog ohne Aufrufe nicht als Ausfall', () => {
    expect(toolSuccessRate([])).toBe(1);
  });
});
