'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/trpc-client';

/**
 * Neue Reise anlegen.
 *
 * Hier zeigt sich, wofuer tRPC in diesem Projekt ueberhaupt da ist: Der
 * Rueckgabewert von `create` ist im Browser typisiert, ohne dass eine Zeile
 * Schnittstellenbeschreibung von Hand gepflegt wuerde.
 */
export function NewTripButton() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen(): Promise<void> {
    setLaeuft(true);
    setFehler(null);

    try {
      const dialog = await api.conversation.create.mutate();

      router.push(`/reise/${dialog.id}`);
    } catch {
      setFehler('Die Reise konnte nicht angelegt werden.');
      setLaeuft(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => void anlegen()}
        disabled={laeuft}
        data-testid="new-trip"
        className="bg-brand-600 hover:bg-brand-700 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {laeuft ? 'Einen Moment …' : 'Neue Reise'}
      </button>

      {fehler !== null && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          {fehler}
        </p>
      )}
    </div>
  );
}

/**
 * Reise loeschen.
 *
 * Zwei Stufen statt eines Bestaetigungsfensters: Der erste Klick verwandelt
 * das Kreuz in ein deutliches „Loeschen?", erst der zweite loescht. Ein
 * `confirm()` waere schneller geschrieben, blockiert aber die Seite und laesst
 * sich im Test nicht bedienen.
 *
 * Weg ist weg: Nachrichten, Entwurf und Werkzeugprotokoll haengen per
 * Fremdschluessel daran und verschwinden mit.
 */
export function DeleteTripButton({ conversationId, title }: DeleteTripButtonProps) {
  const router = useRouter();
  const [gefragt, setGefragt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function loeschen(): Promise<void> {
    if (!gefragt) {
      setGefragt(true);

      return;
    }

    setLaeuft(true);
    setFehler(null);

    try {
      await api.conversation.remove.mutate({ conversationId });

      router.refresh();
    } catch {
      setFehler('Nicht gelöscht.');
      setLaeuft(false);
      setGefragt(false);
    }
  }

  if (fehler !== null) {
    return (
      <span role="alert" className="px-2 text-xs text-amber-800">
        {fehler}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void loeschen()}
      onBlur={() => {
        setGefragt(false);
      }}
      disabled={laeuft}
      data-testid="delete-trip"
      aria-label={gefragt ? `„${title}" wirklich löschen` : `„${title}" löschen`}
      className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
        gefragt
          ? 'bg-amber-100 text-amber-900'
          : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600'
      }`}
    >
      {gefragt ? 'Löschen?' : '✕'}
    </button>
  );
}

interface DeleteTripButtonProps {
  readonly conversationId: string;
  /** Nur fuer die Vorlesehilfe — ein nacktes „Löschen" sagt nicht, was. */
  readonly title: string;
}
