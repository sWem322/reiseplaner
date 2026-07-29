import { redirect } from 'next/navigation';
import { currentUser } from '@/server/trpc/server-caller';
import { GuestStart } from '@/components/guest-start';

/**
 * Einstieg.
 *
 * Wer bereits eine Sitzung hat, landet direkt bei seinen Reisen. Alle anderen
 * sehen einen Satz zum Projekt und einen Knopf. Kein Registrierungsformular
 * vor der ersten Nutzung: Wer diese Demo oeffnet, will sie ausprobieren, nicht
 * ein Konto anlegen.
 */

export default async function HomePage() {
  const user = await currentUser();

  if (user !== null) {
    redirect('/reise');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-brand-600 text-sm font-medium tracking-wide uppercase">AI-Reiseplaner</p>

      <h1 className="text-4xl font-semibold text-balance">
        Reisen planen im Gespräch — nicht im Formular
      </h1>

      <p className="text-lg text-pretty text-slate-600">
        Ein Assistent, der zuhört, nachfragt und dabei selbst entscheidet, wann er Flüge, Hotels
        oder das Klima am Zielort nachschlägt. Was er versteht, steht als Reise-Entwurf daneben und
        wächst mit jeder Nachricht.
      </p>

      {/*
        Die Grenze steht vor dem ersten Klick, nicht erst in einer Absage.
        Wer nach Miami fragt und „kenne ich nicht" hoert, haelt das fuer einen
        Fehler — zu Recht, denn Miami gibt es ja.
      */}
      <p className="text-sm text-slate-500">
        <span className="font-medium text-slate-700">
          Europäische Ziele ab deutschen Flughäfen.
        </span>{' '}
        Mittelmeerraum, Kanaren, europäische Städte — von Düsseldorf, München, Berlin und zwölf
        weiteren.
      </p>

      <GuestStart />

      <p className="text-sm text-slate-500">
        Kein Konto nötig. Die Reise bleibt an diesem Browser hängen, solange die Sitzung gilt.
      </p>
    </main>
  );
}
