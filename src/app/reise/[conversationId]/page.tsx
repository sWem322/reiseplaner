import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { env } from '@/env';
import { ChatView } from '@/components/chat/chat-view';
import { currentUser, serverApi } from '@/server/trpc/server-caller';

/**
 * Ein Gespräch.
 *
 * Der Anfangszustand kommt aus derselben Prozedur, die auch der Browser
 * benutzt — nur ohne Netzwerkweg. Damit gibt es keinen zweiten Ladepfad, der
 * seine eigene Besitzpruefung mitbringen muesste.
 */

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const user = await currentUser();

  if (user === null) {
    redirect('/');
  }

  const api = await serverApi();

  const daten = await api.conversation.byId({ conversationId }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      return null;
    }

    throw error;
  });

  if (daten === null) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">{daten.draft.destination?.name ?? 'Neue Reise'}</h1>

        <Link href="/reise" className="hover:text-brand-600 text-sm text-slate-500">
          Alle Reisen
        </Link>
      </header>

      <ChatView
        conversationId={conversationId}
        initialMessages={daten.messages}
        initialDraft={daten.draft}
        ruleBasedOnly={env.GEMINI_API_KEY === undefined}
      />
    </main>
  );
}
