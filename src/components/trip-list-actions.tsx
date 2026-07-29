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
