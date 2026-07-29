# AI-Reiseplaner

[![CI](https://github.com/sWem322/reiseplaner/actions/workflows/ci.yml/badge.svg)](https://github.com/sWem322/reiseplaner/actions/workflows/ci.yml)

Ein Chat-Assistent, der Reisen im Gespräch plant. Er hört zu, fragt nach und
entscheidet dabei selbst, wann er Flüge, Unterkünfte oder das Klima am Zielort
nachschlägt. Was er versteht, steht als Reise-Entwurf daneben und wächst mit
jeder Nachricht.

**Das Projekt startet ohne eine einzige Umgebungsvariable.** Ohne Schlüssel
greifen Seed-Adapter und ein regelbasierter Extraktor — die Anwendung bleibt
vollständig bedienbar, nur mit Beispieldaten statt echter Preise. Jede Karte
nennt ihre Quelle.

## Schnellstart

```bash
npm install

# Terminal 1 — PostgreSQL ohne Docker, Daten bleiben in .postgres/
npm run db:local

# Terminal 2
npm run db:migrate
npm run dev
```

Auf `http://localhost:3000` genügt ein Klick auf **Als Gast starten**. Wer ein
Sprachmodell einbinden will, legt einen kostenlosen Schlüssel unter
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) an und trägt
ihn als `GEMINI_API_KEY` in `.env` ein. Alle Variablen sind in `.env.example`
erklärt und alle optional.

## Was hier interessant ist

### Der Agent entscheidet, nicht das Formular

Es gibt keine Suchmaske. Der Loop fragt das Sprachmodell, führt die verlangten
Werkzeuge aus — mehrere parallel, wenn sie unabhängig sind — und gibt die
Ergebnisse zurück, bis das Modell keine weiteren mehr verlangt.

Sechs Werkzeuge: Ziel auflösen, Flüge suchen, Unterkünfte suchen, Klima
abrufen, Entwurf lesen, Entwurf schreiben. Ihre JSON-Schemata entstehen aus den
Zod-Schemata der Domäne; ein neues Feld ist an einer Stelle zu ändern.

### Fehler sind Daten, keine Ausnahmen

Jeder Werkzeugaufruf endet in einem `Result<T, DomainError>`. Schlägt einer
fehl, geht der Fehler als `tool_result` zurück an das Modell — das die Eingabe
korrigieren und es erneut versuchen kann. Ein `throw` würde den Lauf beenden
und diese Selbstkorrektur unmöglich machen.

Dieselbe Haltung an anderer Stelle: Beanstandet die Prüfung ein Feld des
Entwurfs, wird nur dieses verworfen und ausdrücklich benannt — nicht der ganze
Entwurf. Sonst verlöre „von Bremen nach Málaga am 2020-05-01" mit dem
vergangenen Datum auch Abflugort und Ziel.

### Guardrails

Iterationen, Werkzeugaufrufe und Token-Budget sind begrenzt. Jeder Abbruch hat
einen Grund, und zu jedem Grund gehört ein Satz, den die reisende Person lesen
kann — ein Abbruch ist ein Ergebnis, kein Fehler.

### Die Oberfläche zeigt die Arbeit

Während der Agent arbeitet, ist sichtbar, welches Werkzeug läuft, wie lange es
gebraucht hat und ob es geklappt hat. Ein fehlgeschlagener Aufruf wird nicht
versteckt. Angebote erscheinen als Karten, sobald die Suche fertig ist — nicht
erst mit dem Schlusstext des Modells.

## Gemessen statt vermutet

Zwanzig Gespräche liegen als Datensatz vor, mit dem erwarteten Zustand des
Entwurfs nach jedem. Der Runner prüft drei Dinge getrennt: richtig, falsch —
und **erfunden**, also ein Wert, der dasteht, obwohl niemand ihn genannt hat.
Der dritte Fall ist der gefährlichste, weil ihn niemand bemerkt.

| Lauf                 | Slot-Genauigkeit | erfunden | bestanden | Werkzeuge/Fall |
| -------------------- | ---------------- | -------- | --------- | -------------- |
| regelbasiert         | 91,8 %           | 2        | 12/20     | 1,1            |
| Gemini, Prompt 1.1.0 | 96,7 %           | 1        | 16/20     | 3,6            |
| Gemini, Prompt 1.3.0 | **100 %**        | **0**    | **20/20** | 4,1            |

```bash
npm run eval            # regelbasiert — kostenlos, deterministisch
npm run eval -- --llm   # gegen Gemini, verbraucht Kontingent
```

Der Unterschied zwischen 1,1 und 4,1 Werkzeugaufrufen ist der eigentliche
Beitrag des Sprachmodells: Der regelbasierte Extraktor trägt ein, was er
erkennt. Das Modell schlägt nach, vergleicht drei Zeiträume und stellt die
Preise gegenüber.

Der erste Lauf fand sofort einen Fehler, den wochenlanges Ausprobieren
übersehen hatte: Auf „Wie **ist** das Rezept für Tiramisu?" trug der
regelbasierte Extraktor Istanbul ein — das deutsche Wort traf den IATA-Code
IST. Details in [`specs/008-eval.md`](specs/008-eval.md), samt der Regel, die
ich selbst geschrieben hatte und die dem Agenten etwas verbot, das er
beherrschte.

## Ohne Geld auskommen

Kein Dienst in diesem Projekt kostet etwas, und keiner verlangt eine
Kreditkarte. Das ist keine Sparsamkeit um ihrer selbst willen — es erzwingt
Entscheidungen, die ohnehin richtig sind:

**Modellkette statt festem Modell.** Das kostenlose Kontingent gilt je Modell:
20 Anfragen am Tag für die volle Flash-Variante, 500 für die Lite-Variante.
Also stehen die ausdauernden vorn. Läuft eine in ihr Limit, rückt dieselbe
Anfrage zum nächsten Modell weiter; nach Ablauf der Sperre beginnt es wieder
oben. Der Loop merkt davon nichts.

**Regelbasierter Ersatz.** Ohne Schlüssel oder bei erschöpftem Gästekontingent
übernimmt eine Mustererkennung über deutschen Text. Sie ist kein Sprachmodell —
und liefert im Eval die Vergleichslinie, an der sich zeigt, was das
Sprachmodell tatsächlich beiträgt.

**Seed-Adapter.** Deterministisch aus einem Hash, nie `Math.random()`. Dieselbe
Anfrage liefert dieselben Preise, weshalb E2E-Tests und Demo reproduzierbar
sind.

## Architektur

```
src/domain/     Fachlichkeit: Schemata, Ports, Result-Typ. Kennt kein HTTP,
                keine Datenbank, kein Sprachmodell — von ESLint erzwungen.
src/server/
  adapters/     Anbieter hinter Ports: Duffel, Open-Meteo, Overpass, Seed
  agent/        Loop, Werkzeuge, Guardrails, LLM-Adapter, Systemprompt
  auth/         Konten, Sitzungen, Gästekontingent
  db/           Drizzle-Schema und Repositories
  trpc/         Prozeduren und Kontext
src/app/        Next.js: Seiten und Routen
eval/           Datensatz, Runner, Ergebnisse
specs/          Warum es so ist, wie es ist
```

Die Domäne definiert Schnittstellen, die Adapter erfüllen sie. Das ist der
Grund, warum der Wechsel von Prisma zu Drizzle und der Tausch von Amadeus gegen
Duffel jeweils eine Datei betrafen und keine einzige Zeile Fachlogik.

## Entscheidungen und ihre Gründe

Ausführlich in `specs/`, hier die, nach denen am ehesten gefragt wird:

**Eigene Anmeldung statt Auth.js.** Gebraucht werden zwei Wege — Zugangsdaten
und Gastzugang. Auth.js hätte eine Konfigurationsschicht, einen
Datenbankadapter und ein zweites Sitzungsmodell mitgebracht, ohne dass ein
Verhalten dazugekommen wäre. Übernommen wurde die gute Idee: Sitzungen liegen
in der Datenbank, nicht in einem selbsttragenden Token — so lassen sie sich
widerrufen. Argon2id mit ausdrücklichen Parametern; ein unbekanntes Konto wird
gegen einen festen Hash geprüft, damit die Antwortzeit nichts verrät.

**Verdichten statt Abschneiden.** Wächst der Kontext, wird der Anfang des
Gesprächs zusammengefasst. Wer abschneidet, verliert die zuerst genannten
Reisewünsche — genau die, die am Anfang stehen.

**`seq` statt Zeitstempel.** Die Verdichtungsgrenze hängt an einer streng
monotonen Zahl. PostgreSQL speichert Mikrosekunden, JavaScript kennt nur
Millisekunden; ein Zeitstempel als exakte Grenze schließt gelegentlich eine
Nachricht zu viel oder zu wenig ein. Ein Test hat genau das gefunden.

**Eingebettetes PostgreSQL für Tests.** Echte Datenbank statt Attrappe, damit
Constraints, Kaskaden und Transaktionen wirklich geprüft werden — aber ohne
Docker-Daemon, damit die Tests überall laufen. Jede Testdatei bekommt einen
eigenen Cluster auf einem vom Betriebssystem zugeteilten Port.

## Prüfen

```bash
npm run verify      # Lint, Typecheck, Format, Unit- und Integrationstests
npm run test:e2e    # Playwright gegen einen Produktionsbuild
npm run flow:check  # derselbe Ablauf ohne Browser, gegen einen laufenden Server
npm run llm:check   # ein echter Aufruf gegen Gemini, mit zweitem Zug
```

432 Tests: Domäne, Adapter gegen untergeschobene Antworten, Agenten-Loop gegen
ein skriptgesteuertes Modell, Repositories und Prozeduren gegen echtes
PostgreSQL, vier E2E-Fälle im Browser.

## Veröffentlichung

Neon für die Datenbank, Vercel für die Anwendung — beides im kostenlosen
Tarif. Schritt für Schritt in
[`specs/007-deployment.md`](specs/007-deployment.md).

## Stand

Was zu welcher Etappe gehörte und was unterwegs schiefging, steht in
[`specs/ETAPPENPLAN.md`](specs/ETAPPENPLAN.md) — einschließlich der Fehler, die
erst die Abnahme oder der Eval zutage gefördert hat.
