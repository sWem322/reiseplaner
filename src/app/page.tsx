export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-brand-600 uppercase">
        Etappe 0 — Grundgeruest
      </p>

      <h1 className="text-4xl font-semibold text-balance">AI-Reiseplaner</h1>

      <p className="text-lg text-pretty text-slate-600">
        Chat-Assistent fuer die Planung individueller Reisen. Ein Agenten-Loop orchestriert
        Werkzeuge fuer Flug-, Hotel- und Wettersuche und fuehrt einen strukturierten Reise-Entwurf
        ueber den gesamten Dialog hinweg.
      </p>

      <ul className="grid gap-2 text-sm text-slate-500">
        <li>Naechste Etappe: Domaenenmodell und Zod-Schemata</li>
        <li>
          Das Projekt startet ohne eine einzige Umgebungsvariable — externe Anbieter sind hinter
          Ports gekapselt.
        </li>
      </ul>
    </main>
  );
}
