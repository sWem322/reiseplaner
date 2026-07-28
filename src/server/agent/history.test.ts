import { describe, expect, it } from 'vitest';
import type { Conversation, Message } from '@/domain/conversation';
import type { ConversationRepository, MessageRepository } from '@/domain/ports/repositories';
import { emptyTripDraft, type TripDraft } from '@/domain/trip/trip';
import {
  buildHistory,
  compactIfNeeded,
  COMPACTION_THRESHOLD,
  KEEP_RECENT,
  summarizeFromDraft,
} from './history';
import { createFailingLlm, createScriptedLlm } from './llm/scripted';

const CONVERSATION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    summary: null,
    summarizedUntilSeq: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function message(seq: number, text: string, role: Message['role'] = 'user'): Message {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    conversationId: CONVERSATION_ID,
    role,
    blocks: [{ type: 'text', text }],
    createdAt: new Date('2026-07-01T10:00:00Z'),
  };
}

function messagesUpTo(count: number): Message[] {
  return Array.from({ length: count }, (_unused, index) =>
    message(index + 1, `Nachricht ${String(index + 1)}`),
  );
}

/** Sammelt, was gespeichert wurde. */
function recordingConversations(): ConversationRepository & {
  saved: { summary: string; untilSeq: number } | null;
} {
  const repo = {
    saved: null as { summary: string; untilSeq: number } | null,
    create: () => Promise.resolve(conversation()),
    findById: () => Promise.resolve(conversation()),
    listByUser: () => Promise.resolve([]),
    belongsTo: () => Promise.resolve(true),
    setTitle: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    addTokenUsage: () => Promise.resolve(),
    saveSummary: (_id: string, summary: string, untilSeq: number) => {
      repo.saved = { summary, untilSeq };
      return Promise.resolve();
    },
  };

  return repo;
}

function messageRepository(messages: readonly Message[]): MessageRepository {
  return {
    append: () => Promise.reject(new Error('nicht benutzt')),
    listByConversation: (_id, options) => {
      const afterSeq = options?.afterSeq;

      return Promise.resolve(
        afterSeq === undefined
          ? [...messages]
          : messages.filter((nachricht) => nachricht.seq > afterSeq),
      );
    },
  };
}

const filledDraft: TripDraft = {
  ...emptyTripDraft(),
  origin: { name: 'Düsseldorf', iataCode: 'DUS', latitude: 51.2895, longitude: 6.7668 },
  destination: { name: 'Palma', iataCode: 'PMI', latitude: 39.5517, longitude: 2.7388 },
  departureDate: '2026-09-05',
  returnDate: '2026-09-12',
  adults: 2,
  childAges: [6],
  budgetEuros: 2_000,
  preferences: ['Strandnähe'],
};

describe('Zusammenfassung aus dem Entwurf', () => {
  it('nennt alle gefüllten Angaben', () => {
    const text = summarizeFromDraft(filledDraft);

    expect(text).toContain('Düsseldorf');
    expect(text).toContain('Palma');
    expect(text).toContain('2026-09-05');
    expect(text).toContain('2000 €');
    expect(text).toContain('Strandnähe');
  });

  it('erwähnt Kinder mit Alter', () => {
    expect(summarizeFromDraft(filledDraft)).toContain('6 Jahre');
  });

  it('kommt mit einem leeren Entwurf zurecht', () => {
    expect(summarizeFromDraft(emptyTripDraft())).toContain('keine Reiseparameter');
  });

  it('kommt ohne Entwurf zurecht', () => {
    expect(summarizeFromDraft(null)).toContain('keine Reiseparameter');
  });
});

describe('Verdichtung', () => {
  it('verdichtet nicht, solange die Schwelle nicht erreicht ist', async () => {
    const conversations = recordingConversations();

    const geschehen = await compactIfNeeded({
      conversation: conversation(),
      messages: messagesUpTo(COMPACTION_THRESHOLD - 1),
      draft: filledDraft,
      llm: createScriptedLlm({ turns: [] }),
      conversations,
    });

    expect(geschehen).toBe(false);
    expect(conversations.saved).toBeNull();
  });

  it('verdichtet ab der Schwelle', async () => {
    const conversations = recordingConversations();
    const llm = createScriptedLlm({
      turns: [{ blocks: [{ type: 'text', text: 'Die Person plant eine Reise nach Mallorca.' }] }],
    });

    const geschehen = await compactIfNeeded({
      conversation: conversation(),
      messages: messagesUpTo(COMPACTION_THRESHOLD),
      draft: filledDraft,
      llm,
      conversations,
    });

    expect(geschehen).toBe(true);
    expect(conversations.saved?.summary).toContain('Mallorca');
  });

  it('behält die jüngsten Nachrichten unverdichtet', async () => {
    const conversations = recordingConversations();

    await compactIfNeeded({
      conversation: conversation(),
      messages: messagesUpTo(30),
      draft: filledDraft,
      llm: createScriptedLlm({ turns: [{ blocks: [{ type: 'text', text: 'Zusammenfassung' }] }] }),
      conversations,
    });

    // 30 Nachrichten, die letzten KEEP_RECENT bleiben — Grenze ist Nummer 22.
    expect(conversations.saved?.untilSeq).toBe(30 - KEEP_RECENT);
  });

  it('weicht auf den Entwurf aus, wenn das Modell nicht antwortet', async () => {
    const conversations = recordingConversations();

    const geschehen = await compactIfNeeded({
      conversation: conversation(),
      messages: messagesUpTo(COMPACTION_THRESHOLD),
      draft: filledDraft,
      llm: createFailingLlm(),
      conversations,
    });

    // Eine misslungene Zusammenfassung darf das Gespraech nicht beenden.
    expect(geschehen).toBe(true);
    expect(conversations.saved?.summary).toContain('Palma');
  });

  it('gibt dem Modell die bisherige Zusammenfassung mit', async () => {
    const conversations = recordingConversations();
    const llm = createScriptedLlm({ turns: [{ blocks: [{ type: 'text', text: 'neu' }] }] });

    await compactIfNeeded({
      conversation: conversation({ summary: 'Frühere Zusammenfassung', summarizedUntilSeq: 5 }),
      messages: messagesUpTo(COMPACTION_THRESHOLD),
      draft: filledDraft,
      llm,
      conversations,
    });

    const gesendet = JSON.stringify(llm.requests[0]?.messages);

    expect(gesendet).toContain('Frühere Zusammenfassung');
  });
});

describe('Verlauf für die nächste Anfrage', () => {
  it('gibt ohne Zusammenfassung alle Nachrichten zurück', async () => {
    const verlauf = await buildHistory({
      conversation: conversation(),
      messages: messageRepository(messagesUpTo(3)),
    });

    expect(verlauf).toHaveLength(3);
  });

  it('stellt die Zusammenfassung voran und lässt Verdichtetes weg', async () => {
    const verlauf = await buildHistory({
      conversation: conversation({
        summary: 'Bisher: Mallorca im September',
        summarizedUntilSeq: 7,
      }),
      messages: messageRepository(messagesUpTo(10)),
    });

    // Erste Nachricht ist die Zusammenfassung, danach die Nummern 8 bis 10.
    expect(verlauf).toHaveLength(4);
    expect(JSON.stringify(verlauf[0])).toContain('Mallorca im September');
  });

  it('behält die Reihenfolge der Nachrichten bei', async () => {
    const verlauf = await buildHistory({
      conversation: conversation(),
      messages: messageRepository(messagesUpTo(5)),
    });

    const texte = verlauf.map((nachricht) =>
      nachricht.blocks[0]?.type === 'text' ? nachricht.blocks[0].text : '',
    );

    expect(texte).toEqual([
      'Nachricht 1',
      'Nachricht 2',
      'Nachricht 3',
      'Nachricht 4',
      'Nachricht 5',
    ]);
  });
});
