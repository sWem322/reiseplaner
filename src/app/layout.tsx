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
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
