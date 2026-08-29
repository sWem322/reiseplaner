'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * „Vorlesen" an einer Antwort des Assistenten.
 *
 * Zwei Wege, und welcher gilt, entscheidet nicht dieser Knopf, sondern die
 * Ausstattung des Servers:
 *
 * - **Mit Schluessel** holt die Route eine Aufnahme und spielt sie ab. Sie
 *   nimmt dafuer die Kennung der Nachricht, nicht ihren Text — Begruendung in
 *   specs/009.
 * - **Ohne Schluessel** spricht der Browser selbst. Das kostet nichts, laeuft
 *   ohne Netz und klingt schlechter; vorhanden ist es ueberall.
 *
 * Kann weder das eine noch das andere, erscheint kein Knopf. Ein Knopf, der
 * nichts tut, ist schlimmer als keiner.
 */

/**
 * Es spricht immer nur einer.
 *
 * Der Zustand liegt am Modul, nicht an einer Komponente, weil die Frage keiner
 * einzelnen gehoert: Jede Antwort im Verlauf hat ihren eigenen Knopf, und ohne
 * diese Stelle redeten nach dem zweiten Klick zwei Stimmen gleichzeitig — die
 * erste liefe einfach weiter. Fuer dieselbe Antwort verhinderte das schon der
 * eigene Zustand; fuer zwei verschiedene half er nicht.
 *
 * Aufbewahrt wird das Anhalten selbst. Es schliesst ueber die Komponente, zu
 * der es gehoert, und setzt deren Knopf mit zurueck — sonst stuende dort
 * „Stopp" an etwas, das laengst schweigt.
 */
let laufend: (() => void) | null = null;

function uebernimmDasWort(anhalten: () => void): void {
  if (laufend !== null && laufend !== anhalten) {
    laufend();
  }

  laufend = anhalten;
}

function gibDasWortZurueck(anhalten: () => void): void {
  if (laufend === anhalten) {
    laufend = null;
  }
}

function schweige(): void {
  laufend?.();
  laufend = null;
}

type Zustand = 'bereit' | 'laedt' | 'spricht' | 'fehler';

export interface SpeakButtonProps {
  readonly text: string;
  /**
   * Kennung der gespeicherten Nachricht.
   *
   * `null`, solange der Lauf sie noch nicht gemeldet hat — dann bleibt nur der
   * Browser, und das ist kein Mangel: Der Text steht ja auf dem Bildschirm.
   */
  readonly messageId: string | null;
  /** Steht auf dem Server eine Stimme bereit? */
  readonly serverSpeech: boolean;
}

export function SpeakButton({ text, messageId, serverSpeech }: SpeakButtonProps) {
  const [zustand, setZustand] = useState<Zustand>('bereit');
  const [meldung, setMeldung] = useState<string | null>(null);

  /*
   * Ob der Browser sprechen kann, ist eine Eigenschaft der Aussenwelt — und
   * `useSyncExternalStore` ist die Frage danach, samt getrennter Antwort fuer
   * den Server. Ein Effekt, der nach dem Einhaengen `setState` ruft, taete
   * dasselbe mit einem zusaetzlichen Durchlauf; die Regel
   * `react-hooks/set-state-in-effect` beanstandet ihn zu Recht.
   *
   * Auf dem Server lautet die Antwort `false`. Faellt der Knopf damit beim
   * ersten Aufbau weg und erscheint gleich darauf, ist das kein Fehler,
   * sondern der Sinn der Sache: Angeboten wird nur, was auch geht.
   */
  const browserKann = useSyncExternalStore(
    () => () => {
      // Der Wert aendert sich waehrend einer Sitzung nicht — nichts zu melden.
    },
    () => 'speechSynthesis' in window,
    () => false,
  );

  const audio = useRef<HTMLAudioElement | null>(null);
  /** Einmal geholt, fuer diese Seite behalten — ein zweiter Klick fragt nicht neu. */
  const tonUrl = useRef<string | null>(null);
  /** Das eigene Anhalten, damit das Aufraeumen nicht fremde Stimmen abwuergt. */
  const meinAnhalten = useRef<(() => void) | null>(null);

  const ueberDenServer = serverSpeech && messageId !== null;

  // Beim Verlassen verstummt nur, was diese Komponente angestossen hat: eine
  // Stimme, die nach dem Seitenwechsel weiterspricht, laesst sich nicht mehr
  // abstellen — eine fremde mitzureissen waere aber ebenso falsch.
  useEffect(() => {
    return () => {
      const eigenes = meinAnhalten.current;

      if (eigenes !== null) {
        eigenes();
        gibDasWortZurueck(eigenes);
      }

      audio.current?.pause();

      if (tonUrl.current !== null) {
        URL.revokeObjectURL(tonUrl.current);
      }
    };
  }, []);

  async function vomServer(): Promise<void> {
    if (tonUrl.current === null) {
      const antwort = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });

      if (!antwort.ok) {
        setMeldung(await fehlertext(antwort));
        setZustand('fehler');
        return;
      }

      tonUrl.current = URL.createObjectURL(await antwort.blob());
    }

    /*
     * Je Wiedergabe ein frisches Abspielgeraet, statt eines aus der Ref
     * weiterzubenutzen. Der Umweg hat einen Grund: Die Ref wird im Aufraeumen
     * des Effekts gelesen, und ein Objekt daraus nachtraeglich zu veraendern
     * beanstandet `react-hooks/immutability`.
     */
    const spieler = new Audio(tonUrl.current);

    const anhalten = () => {
      spieler.pause();
      setZustand('bereit');
    };

    spieler.onended = () => {
      gibDasWortZurueck(anhalten);
      setZustand('bereit');
    };

    uebernimmDasWort(anhalten);
    meinAnhalten.current = anhalten;
    audio.current = spieler;

    await spieler.play();
    setZustand('spricht');
  }

  function ueberDenBrowser(): void {
    const stimme = new SpeechSynthesisUtterance(text);

    // Ohne Sprachangabe nimmt der Browser die des Systems — und liest deutsche
    // Saetze mit englischer Aussprache vor.
    stimme.lang = 'de-DE';

    const anhalten = () => {
      window.speechSynthesis.cancel();
      setZustand('bereit');
    };

    stimme.onend = () => {
      gibDasWortZurueck(anhalten);
      setZustand('bereit');
    };

    stimme.onerror = () => {
      gibDasWortZurueck(anhalten);
      setMeldung('Der Browser konnte den Text nicht vorlesen');
      setZustand('fehler');
    };

    uebernimmDasWort(anhalten);
    meinAnhalten.current = anhalten;

    window.speechSynthesis.speak(stimme);
    setZustand('spricht');
  }

  async function klick(): Promise<void> {
    if (zustand === 'spricht') {
      schweige();
      return;
    }

    setMeldung(null);

    if (!ueberDenServer) {
      ueberDenBrowser();
      return;
    }

    setZustand('laedt');

    try {
      await vomServer();
    } catch {
      setMeldung('Die Aufnahme liess sich nicht abspielen');
      setZustand('fehler');
    }
  }

  if (!serverSpeech && !browserKann) {
    return null;
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => void klick()}
        disabled={zustand === 'laedt'}
        aria-label={zustand === 'spricht' ? 'Vorlesen anhalten' : 'Antwort vorlesen'}
        className="hover:text-brand-600 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
      >
        <Lautsprecher aktiv={zustand === 'spricht'} />
        {beschriftung(zustand)}
      </button>

      {meldung !== null && <span className="text-xs text-amber-700">{meldung}</span>}
    </div>
  );
}

function beschriftung(zustand: Zustand): string {
  switch (zustand) {
    case 'laedt':
      return 'Einen Moment …';
    case 'spricht':
      return 'Stopp';
    case 'bereit':
    case 'fehler':
      return 'Vorlesen';
  }
}

/** Zwei Zustaende, eine Form: sprechend mit Schallwelle, still ohne. */
function Lautsprecher({ aktiv }: { readonly aktiv: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 3 5 6H2.5v4H5l3.5 3z" />
      {aktiv ? <path d="M11 5.5a3.5 3.5 0 0 1 0 5M13 3.5a6.5 6.5 0 0 1 0 9" /> : null}
    </svg>
  );
}

async function fehlertext(antwort: Response): Promise<string> {
  try {
    const koerper: unknown = await antwort.json();

    if (
      typeof koerper === 'object' &&
      koerper !== null &&
      'error' in koerper &&
      typeof koerper.error === 'string'
    ) {
      return koerper.error;
    }
  } catch {
    // Antwort ohne JSON — der Statuscode muss reichen.
  }

  return `Die Sprachausgabe antwortete mit Status ${String(antwort.status)}`;
}
