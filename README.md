# AI-Reiseplaner

[![CI](https://github.com/sWem322/reiseplaner/actions/workflows/ci.yml/badge.svg)](https://github.com/sWem322/reiseplaner/actions/workflows/ci.yml)

**Live: [reiseplaner-sooty.vercel.app](https://reiseplaner-sooty.vercel.app/)** — ein
Klick auf „Als Gast starten", kein Konto nötig.

Ein Chat-Assistent, der Reisen im Gespräch plant. Er hört zu, fragt nach und
entscheidet dabei selbst, wann er Flüge, Unterkünfte oder das Klima am Zielort
nachschlägt. Was er versteht, steht als Reise-Entwurf daneben und wächst mit
jeder Nachricht.

---

## Zu den Daten: ein Token trennt Demo von Betrieb

Der Assistent läuft in der Demo auf **Beispieldaten**, und jede Karte sagt das
offen. Das ist keine Auslassung, sondern die Lage am Markt:

| Anbieter               | Zugang im Juli 2026                                          |
| ---------------------- | ------------------------------------------------------------ |
| Amadeus Self-Service   | Portal am **17.07.2026 abgeschaltet**, Schlüssel deaktiviert |
| Skyscanner Travel API  | nur für geprüfte Partner, ausdrücklich „commercial use only" |
| Kiwi.com Tequila       | nur auf Einladung, Schwelle ab 50 000 MAU                    |
| Booking.com Demand API | Registrierung neuer Partner derzeit ausgesetzt               |

**Vollständig gebaut ist die Anbindung trotzdem.** Der Duffel-Adapter ist
geschrieben, gegen untergeschobene Antworten geprüft und an denselben Port
gehängt wie die Seed-Daten. Es fehlt nur der Zugang.

Wer einen hat, trägt ihn ein — und mehr passiert nicht:

```bash
# .env
DUFFEL_ACCESS_TOKEN="duffel_test_…"
```

Ab dem nächsten Start kommen die Flüge vom echten Dienst. Kein Umbau, keine
zweite Codepfad-Variante, keine Zeile Fachlogik. Dieselbe Mechanik gilt für
das Sprachmodell (`GEMINI_API_KEY`) und für die Datenbank. Was einen Schlüssel
hat, spricht mit dem Anbieter; was keinen hat, greift auf Seed-Daten zurück und
**sagt es** — im Text des Assistenten und als Markierung auf jeder Karte.

Genau dafür gibt es Ports und Adapter. Der Beleg steht in der
Versionsgeschichte: Der Wechsel von Prisma zu Drizzle und der Tausch von
Amadeus gegen Duffel betrafen jeweils **eine Datei** und keine einzige Zeile
Domänenlogik.

```bash
npm run providers:check   # ein echter Aufruf gegen jeden fremden Dienst
```

Das Skript ruft dieselben Adapter auf, die im Betrieb laufen, und nennt bei
einem Ausfall Status und Ursache — es hat den Grund gefunden, warum die
Hotelsuche monatelang nichts lieferte.

---

## Schnellstart

Das Projekt startet **ohne eine einzige Umgebungsvariable**.

```bash
npm install

# Terminal 1 — PostgreSQL ohne Docker, Daten bleiben in .postgres/
npm run db:local

# Terminal 2
npm run db:migrate
npm run dev
```

Auf `http://localhost:3000` genügt „Als Gast starten". Ein kostenloser
Modellschlüssel liegt unter
[aistudio.google.com/apikey](https://aistudio.google.com/apikey); alle
Variablen sind in `.env.example` erklärt und alle optional.

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

### Eine Grenze, die das Werkzeug zieht

`search_flights` weigert sich zu suchen, solange die Zahl der Reisenden nicht
im Entwurf steht — auch dann, wenn der Aufruf eine Zahl mitbringt. Der Grund
ist eine Lektion aus der Abnahme: Im Prompt stand „ohne genannte Reisendenzahl
trägst du keine ein", und das Modell tat es trotzdem, weil `adults` ein
Pflichtfeld der Signatur ist. **Wo Prompt und Signatur einander
widersprechen, gewinnt die Signatur.** Also wurde aus der Bitte eine Grenze.

### Guardrails

Iterationen, Werkzeugaufrufe und Token-Budget sind begrenzt. Jeder Abbruch hat
einen Grund, und zu jedem Grund gehört ein Satz, den die reisende Person lesen
kann — ein Abbruch ist ein Ergebnis, kein Fehler.

### Die Oberfläche zeigt die Arbeit

Sichtbar ist, welches Werkzeug lief, wie lange es brauchte, ob es geklappt hat
und — seit der Frage „warum dauert das so lange?" — wie lange das Modell je Zug
gedacht hat. Ein fehlgeschlagener Aufruf wird nicht versteckt, sondern zeigt
die Meldung des Anbieters im Klartext. Angebote erscheinen als Karten, sobald
die Suche fertig ist, nicht erst mit dem Schlusstext. Der Text des Modells
läuft ein, während es ihn schreibt.

## Gemessen statt vermutet

Zweiundzwanzig Gespräche liegen als Datensatz vor, mit dem erwarteten Zustand
des Entwurfs nach jedem. Der Runner prüft drei Dinge getrennt: richtig, falsch
— und **erfunden**, also ein Wert, der dasteht, obwohl niemand ihn genannt hat.
Der dritte Fall ist der gefährlichste, weil ihn niemand bemerkt.

| Lauf                 | Fälle | Slot-Genauigkeit | erfunden | bestanden | Werkzeuge/Fall |
| -------------------- | ----- | ---------------- | -------- | --------- | -------------- |
| regelbasiert         | 20    | 91,8 %           | 2        | 12/20     | 1,1            |
| Gemini, Prompt 1.1.0 | 20    | 96,7 %           | 1        | 16/20     | 3,6            |
| Gemini, Prompt 1.3.0 | 20    | 100 %            | 0        | 20/20     | 4,1            |
| Gemini, Prompt 1.6.0 | 22    | **100 %**        | **0**    | **22/22** | 4,0            |

Jeder Bericht trägt die Prompt-Fassung, gegen die er gelaufen ist — die Zeile
im README lässt sich damit nicht mehr unbemerkt von den Zahlen lösen. Die
beiden zusätzlichen Fälle stammen aus Abnahmen: ein Ziel ausserhalb Europas
und eine halbe Antwort auf eine Doppelfrage.

1,1 % der Werkzeugaufrufe schlugen dabei fehl, und das ist kein Makel: Es ist
die Selbstkorrektur bei der Arbeit. Der Agent ruft ein Werkzeug falsch auf,
bekommt den Fehler als Ergebnis zurück und macht es im nächsten Zug richtig.

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

**Seed-Adapter, deterministisch.** Aus einem Hash, nie `Math.random()`.
Dieselbe Anfrage liefert dieselben Preise, weshalb E2E-Tests und Demo
reproduzierbar sind.

**Rückfallebene statt Absage.** Overpass — die einzige schlüssellose Quelle für
echte Unterkünfte — weist seit Frühjahr 2026 einen grossen Teil der Anfragen
mit `406` ab. Statt einer Absage übernimmt dann der Seed-Katalog, und der
Assistent nennt die Herkunft im ersten Satz. Ausgedachte Daten sind vertretbar,
solange sie als solche benannt werden.

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

Die Domäne definiert Schnittstellen, die Adapter erfüllen sie. Ein
Anbieterwechsel ist damit eine zusätzliche Implementierung, kein Umbau.

**Stack:** TypeScript streng, Next.js App Router, React, tRPC und Zod
end-to-end, Drizzle auf PostgreSQL, Gemini über das offizielle SDK, Vitest und
Playwright, ESLint mit Typinformation.

## Entscheidungen und ihre Gründe

Ausführlich in `specs/`, hier die, nach denen am ehesten gefragt wird:

**Eigene Anmeldung statt Auth.js.** Gebraucht werden zwei Wege — Zugangsdaten
und Gastzugang. Auth.js hätte eine Konfigurationsschicht, einen
Datenbankadapter und ein zweites Sitzungsmodell mitgebracht, ohne dass ein
Verhalten dazugekommen wäre. Argon2id mit ausdrücklichen Parametern statt der
Voreinstellungen der Bibliothek, weil sich die zwischen Versionen ändern und
bestehende Hashes prüfbar bleiben müssen. Ein unbekanntes Konto wird gegen
einen festen Hash geprüft, damit die Antwortzeit nicht verrät, ob es die
E-Mail-Adresse gibt.

### Wie eine Sitzung aussieht

Vier Spalten, mehr nicht:

| Spalte       | Inhalt                                          |
| ------------ | ----------------------------------------------- |
| `token`      | 32 Zufallsbytes aus dem CSPRNG, hex, 64 Zeichen |
| `user_id`    | Verweis auf das Konto, `ON DELETE CASCADE`      |
| `expires_at` | 30 Tage nach dem Anlegen                        |
| `created_at` | Zeitpunkt des Anlegens                          |

**Vom Gerät wird nichts gespeichert** — keine IP-Adresse, kein User-Agent, kein
Fingerabdruck. Nicht aus Nachlässigkeit: Solche Werte wären personenbezogene
Daten, sie müssten begründet, befristet und auskunftsfähig sein, und sie
brächten hier keinen Gewinn. Was nicht erhoben wird, kann auch nicht
verloren gehen.

Der Token liegt in einem Cookie mit `HttpOnly`, `SameSite=Lax`, `Path=/` und
in Produktion `Secure`. `Lax` statt `Strict` mit Grund: Bei `Strict` fehlt das
Cookie nach einem Klick von aussen, und wer dem Demo-Link folgt, landet
abgemeldet auf der Startseite.

Entscheidend ist, was der Token **nicht** ist: kein JWT, kein selbsttragendes
Token. Er trägt keine Information, sondern zeigt nur auf eine Zeile. Damit ist
eine Sitzung durch ein `DELETE` sofort ungültig — bei einem selbsttragenden
Token ginge das erst mit dessen Ablauf oder über eine Sperrliste, die dann
doch wieder eine Datenbankabfrage je Anfrage bedeutet. Genau diese Idee ist
von Auth.js übernommen.

**Drizzle statt Prisma.** Reines TypeScript, kein Codegenerierungsschritt, und
die Migrationen liegen als lesbares SQL im Repository statt hinter einer
Abstraktion. Die Typen entstehen direkt aus dem Schema. Beides zusammen macht
den Datenbankzugriff nachvollziehbar, ohne dass ein zusätzliches Werkzeug im
Build stehen muss.

**Verdichten statt Abschneiden.** Wächst der Kontext, wird der Anfang des
Gesprächs zusammengefasst. Wer abschneidet, verliert die zuerst genannten
Reisewünsche — genau die, die am Anfang stehen.

**`seq` statt Zeitstempel.** Die Verdichtungsgrenze hängt an einer streng
monotonen Zahl. PostgreSQL speichert Mikrosekunden, JavaScript kennt nur
Millisekunden; ein Zeitstempel als exakte Grenze schliesst gelegentlich eine
Nachricht zu viel oder zu wenig ein. Ein Test hat genau das gefunden.

**Eingebettetes PostgreSQL für Tests.** Echte Datenbank statt Attrappe, damit
Constraints, Kaskaden und Transaktionen wirklich geprüft werden — aber ohne
Docker-Daemon, damit die Tests überall laufen. Jede Testdatei bekommt einen
eigenen Cluster auf einem vom Betriebssystem zugeteilten Port.

**Der Systemprompt ist eine versionierte Datei.** Er ist das Verhalten des
Agenten; ändert sich hier ein Satz, ändert sich das Produkt. Jede Fassung trägt
im Kommentar den Fehler, der sie erzwungen hat.

## Prüfen

```bash
npm run verify           # Lint, Typecheck, Unit- und Integrationstests
npm run test:e2e         # Playwright gegen einen Produktionsbuild
npm run flow:check       # derselbe Ablauf ohne Browser, gegen einen laufenden Server
npm run llm:check        # ein echter Aufruf gegen Gemini, mit zweitem Zug
npm run providers:check  # ein echter Aufruf gegen jeden fremden Dienst
```

464 Tests in 23 Dateien, Durchlauf in gut fünf Sekunden: Domäne, Adapter gegen
untergeschobene Antworten, Agenten-Loop gegen ein skriptgesteuertes Modell,
Repositories und Prozeduren gegen echtes PostgreSQL, vier E2E-Fälle im
Browser.

Die Trennung ist Absicht und ein eigenes Gesprächsthema: Die **Orchestrierung**
wird deterministisch geprüft — skriptgesteuertes Modell, Seed-Adapter, kein
Netz. Die **Modellqualität** getrennt davon im Eval, von Hand gestartet, weil
sie Kontingent verbraucht und nicht zweimal dasselbe antwortet.

## Veröffentlichung

Neon für die Datenbank, Vercel für die Anwendung — beides im kostenlosen Tarif.
Schritt für Schritt in [`specs/007-deployment.md`](specs/007-deployment.md),
einschliesslich der Stolperstelle, die einen Lauf mit drei Flugsuchen nach 60
Sekunden mit `504` beendete.

## Stand

Was zu welcher Etappe gehörte und was unterwegs schiefging, steht in
[`specs/ETAPPENPLAN.md`](specs/ETAPPENPLAN.md) — einschliesslich der Fehler,
die erst die Abnahme oder der Eval zutage gefördert hat, und des Abgleichs mit
der Definition of Done.
