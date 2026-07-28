import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI-Reiseplaner',
  description:
    'Chat-Assistent fuer die Planung individueller Reisen — mit Agenten-Loop, Tool-Use und persistentem Reise-Entwurf.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      {/*
        suppressHydrationWarning nur am body: Browser-Erweiterungen (Passwort-
        manager, Sicherheitssoftware) haengen dort eigene Attribute an, bevor
        React uebernimmt. Das erzeugt eine Hydration-Warnung, die nichts mit
        dem Code zu tun hat. Die Unterdrueckung gilt ausschliesslich fuer die
        Attribute dieses einen Elements, nicht fuer den Inhalt darunter —
        echte Abweichungen im Baum werden weiterhin gemeldet.
      */}
      <body className="min-h-full antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
