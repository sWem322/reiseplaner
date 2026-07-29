# 007 — Veröffentlichung

Wo die Anwendung im Betrieb läuft und wie sie dorthin kommt. Zwei fremde
Dienste, beide im kostenlosen Tarif und ohne Zahlungsmittel.

## Warum überhaupt zwei

Die lokale Datenbank liegt in `.postgres/` auf der Festplatte des
Entwicklungsrechners. Ein Hoster kommt dort nicht heran, und der Prozess auf
einem Hoster hat ohnehin kein beständiges Dateisystem. Die veröffentlichte
Fassung braucht deshalb eine Datenbank, die über das Netz erreichbar ist.

| Dienst     | Rolle                     | Was dort liegt             |
| ---------- | ------------------------- | -------------------------- |
| **Neon**   | PostgreSQL im Netz        | Konten, Sitzungen, Dialoge |
| **Vercel** | Baut und betreibt Next.js | Der Anwendungscode selbst  |

## Neon

1. Projekt anlegen, Region **Europe (Frankfurt)** — kürzeste Wege zu einer
   Anwendung, die sich an deutschsprachige Reisende richtet.
2. Die Verbindungszeichenfolge kopieren. Sie endet auf `?sslmode=require`;
   ohne diesen Zusatz lehnt Neon die Verbindung ab.
3. In `.env.local` eintragen — **nicht** in `.env`:

   ```
   DATABASE_URL_DEPLOY="postgresql://…?sslmode=require"
   ```

   Zwei getrennte Variablen statt einer sind Absicht. Wer die Adresse der
   Produktivdatenbank in `DATABASE_URL` schreibt, entwickelt ab dem nächsten
   `npm run dev` auf ihr, ohne es zu merken. Ein Schalter, den man ausdrücklich
   umlegen muss, macht diesen Fehler unmöglich.

4. Migrationen anwenden:

   ```
   npm run db:migrate:deploy
   ```

   Das Skript nennt vorher Host und Datenbanknamen — nie das Passwort — damit
   sichtbar ist, worauf es gleich schreibt.

Neon liefert eine leere Datenbank. Ohne diesen Schritt gibt es keine Tabellen,
und der erste Gastzugang scheitert mit `42P01`.

**Zur Warnung des Treibers.** `pg` weist darauf hin, dass es `sslmode=require`
derzeit wie `verify-full` behandelt und das in einer kommenden Fassung nicht
mehr tun wird. Wer die Warnung loswerden und zugleich die strengere Prüfung
festschreiben will, schreibt in der Adresse `sslmode=verify-full` statt
`sslmode=require`. Neon stellt ein Zertifikat einer öffentlichen
Zertifizierungsstelle aus; die strenge Prüfung geht also durch.

## Vercel

Projekt aus dem GitHub-Repository anlegen; Next.js wird erkannt, an den
Build-Befehlen ist nichts zu ändern.

Umgebungsvariablen **vor** dem ersten Deployment setzen:

| Variable         | Wert                         | Fehlt sie …                           |
| ---------------- | ---------------------------- | ------------------------------------- |
| `DATABASE_URL`   | Zeichenfolge aus Neon        | keine Datenbank, nichts funktioniert  |
| `GEMINI_API_KEY` | derselbe Schlüssel wie lokal | der regelbasierte Extraktor übernimmt |

Auf Vercel heißt die Variable `DATABASE_URL` — dort ist sie die einzige
Datenbank, und die Verwechslungsgefahr von oben besteht nicht.

Alles Weitere hat brauchbare Voreinstellungen. `GEMINI_MODEL` bleibt leer,
damit die Modellkette greifen kann.

`.env` und `.env.local` gelangen nicht dorthin: Beide stehen in `.gitignore`.
Das ist kein Versehen, sondern der Grund, warum Zugangsdaten in die Oberfläche
des Hosters gehören und nicht in das Repository.

## Bekannte Stolperstelle

`package.json` verlangt `"engines": { "node": ">=24.0.0" }`. Bietet der Hoster
diese Fassung nicht an, bricht der Build an dieser Zeile ab. Das Projekt
braucht nichts, was es erst ab 24 gibt — die Anforderung darf dann auf `>=22`
sinken.
