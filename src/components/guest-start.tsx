'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Gastzugang mit einem Klick.
 *
 * Der Aufruf geht an den Auth-Handler und nicht an tRPC, weil dabei ein Cookie
 * gesetzt wird — und Kopfzeilen der Antwort kennt eine tRPC-Prozedur nicht.
 */
export function GuestStart() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function starten(): Promise<void> {
    setLaeuft(true);
    setFehler(null);

    try {
      const response = await fetch('/api/auth/guest', { method: 'POST' });

      if (!response.ok) {
        setFehler('Der Gastzugang konnte nicht angelegt werden.');
        setLaeuft(false);

        return;
      }

      // `refresh` vor `push`: Ohne das liefert die Server-Komponente die
      // Antwort aus dem Cache — noch ohne die gerade entstandene Sitzung.
      router.refresh();
      router.push('/reise');
    } catch {
      setFehler('Der Server ist gerade nicht erreichbar.');
      setLaeuft(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void starten()}
        disabled={laeuft}
        className="bg-brand-600 hover:bg-brand-700 rounded-lg px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {laeuft ? 'Einen Moment …' : 'Als Gast starten'}
      </button>

      {fehler !== null && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          {fehler}
        </p>
      )}
    </div>
  );
}
