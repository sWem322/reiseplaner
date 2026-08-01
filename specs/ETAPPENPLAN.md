# Etappenplan — verbindliche Reihenfolge

Diese Datei ist die einzige Wahrheit darüber, was zu welcher Etappe gehört.
Sie entstand, nachdem eine Etappe für abgeschlossen erklärt wurde, obwohl ein
zugesagter Bestandteil fehlte (der Gemini-Adapter in Etappe 3). Solche
Verschiebungen sind ab hier ausgeschlossen: Was hier steht, wird erledigt,
bevor die nächste Etappe beginnt.

## Regeln

1. **Vor Beginn einer Etappe** wird ihre Punkteliste vollständig vorgelesen und
   die ausdrückliche Freigabe abgewartet. Kein Beginn ohne dieses „starte".
2. **Keine Etappe gilt als abgeschlossen, solange nicht jeder Punkt ihrer
   Abschlussbedingungen erfüllt ist.** Ein Punkt darf nicht in eine spätere
   Etappe verschoben werden.
3. **Am Ende jeder Etappe steht ein zeilenweiser Bericht** entlang dieser
   Liste: jeder Punkt einzeln, mit Haken oder als offen gekennzeichnet.
   Kein „fertig" ohne diesen Abgleich Punkt für Punkt.
4. **Verschiebungen sind nur mit ausdrücklicher Zustimmung möglich** und werden
   in der Tabelle am Ende dieser Datei festgehalten — mit Grund und neuer
   Etappe.
5. **Fehlt ein externer Zugang**, wird der Code trotzdem vollständig
   geschrieben und gegen eine Attrappe getestet. Nur der Lauf gegen den echten
   Dienst wird nachgeholt — nicht die Implementierung.
6. **Jede Etappe endet grün**: Lint, Typecheck, alle Tests, Build.
7. **Innerhalb einer Etappe wird nichts hinzuerfunden.** Fällt unterwegs etwas
   Sinnvolles auf, das nicht in der Liste steht, wird es vorgeschlagen und
   erst nach Zustimmung ergänzt — in dieser Datei und dann im Code.

## Etappe 0 — Grundgerüst ✔

- [x] Next.js, TypeScript streng, ESLint mit Typinformation, Prettier
- [x] Vitest (Unit + Integration), Playwright
- [x] PostgreSQL über Docker **und** eingebettet
- [x] GitHub Actions: Lint, Typecheck, Format, Tests, E2E
- [x] `AGENTS.md`, `specs/000`, README

## Etappe 1 — Domänenmodell ✔

- [x] `TripDraft`, `TripQuery`, Statusmodell, fehlende Slots
- [x] Dialog, Nachrichten mit Inhaltsblöcken, Werkzeug-Protokoll
- [x] Repository-Ports ohne ORM-Wissen
- [x] Tabellen, erste Migration, Drizzle-Implementierungen
- [x] Integrationstests gegen echtes PostgreSQL

## Etappe 2 — Ports und Adapter ✔

- [x] Vier Anbieter-Ports
- [x] Seed-Adapter, deterministisch, ~20 Flughäfen + Ziele
- [x] Open-Meteo, Overpass, Duffel als HTTP-Adapter
- [x] Fabrik wählt nach vorhandenen Zugangsdaten
- [x] Schaufensterseite `/debug/search`

## Etappe 3 — Agenten-Kern ✔

**Stand:** vollständig abgeschlossen.

**Zwei Randbedingungen, die während der Vorbereitung sichtbar wurden:**

1. Google stellt die Schlüssel um: Neue Schlüssel beginnen mit `AQ.` statt mit
   `AIzaSy`. Alte Standardschlüssel werden im September 2026 abgeschaltet. Ein
   `AQ.`-Schlüssel funktioniert nicht mit dem einfachen REST-Aufruf
   `?key=…` — deshalb baut der Adapter auf dem offiziellen SDK auf, das beide
   Formate kennt. Ursprünglich war ein eigener fetch-Aufruf vorgesehen; die
   Änderung wurde ausdrücklich abgestimmt.
2. Die Entwicklungs-Sandbox erreicht `generativelanguage.googleapis.com` nicht.
   Der Adapter wird deshalb gegen einen untergeschobenen SDK-Client getestet;
   den Lauf gegen den echten Dienst führt die auftraggebende Person mit
   `npm run llm:check` aus.
3. Feste Modellnamen halten nicht: `gemini-2.5-flash` steht zwar in der Liste
   von `models.list()`, wird neuen Zugängen aber verweigert. Die Auflistung
   sagt, was es _gibt_, nicht was dieser Schlüssel benutzen darf — belastbar
   ist allein der Aufruf. Deshalb probiert das Prüfskript Kandidaten der Reihe
   nach, und als Standard dient der Alias `gemini-flash-latest`.

- [x] `LlmPort`, Ereignisse, Abbruchgründe
- [x] Registry mit sechs Werkzeugen, JSON-Schema aus Zod abgeleitet
- [x] Guardrails: Iterationen, Werkzeugaufrufe, Token-Budget
- [x] Loop mit paralleler Ausführung und Selbstkorrektur
- [x] Skriptgesteuertes Ersatzmodell, Tests der Orchestrierung
- [x] Regelbasierter Extraktor als schlüsselfreier Ersatz
- [x] **Gemini-Adapter auf Basis des offiziellen SDK `@google/genai`** —
      Übersetzung zwischen `LlmPort` und der Gemini-Schnittstelle, inklusive
      Umbau der Werkzeug-Schemata auf den OpenAPI-Dialekt, Fehlerzuordnung und
      Token-Zählung
- [x] **Tests des Gemini-Adapters** gegen einen untergeschobenen SDK-Client —
      ohne Schlüssel, ohne Netz
- [x] **Systemprompt** als versionierte Datei unter `src/server/agent/prompts/`
- [x] **Fabrik wählt Gemini**, sobald `GEMINI_API_KEY` gesetzt ist
- [x] **Prüfskript `npm run llm:check`** — ein Aufruf gegen die echte
      Schnittstelle mit Werkzeugnutzung, gibt Antwort und Tokenverbrauch aus
- [x] **Ein Lauf gegen die echte Schnittstelle** — `gemini-flash-latest`
      antwortete in 1451 ms und rief `resolve_destination({"query":"Mallorca"})`
      auf; 114 Eingabe- und 17 Ausgabe-Tokens

## Etappe 4 — API und Authentifizierung ✔

**Eine Abweichung, abgestimmt festgehalten:** Statt Auth.js v5 entstand eine
eigene, schmale Umsetzung von Konten und Sitzungen. Grund: Das Projekt braucht
zwei Wege — Zugangsdaten und Gastzugang — und keinen einzigen Fremdanbieter.
Auth.js hätte dafür eine Konfigurationsschicht, einen Datenbankadapter und ein
zweites Sitzungsmodell mitgebracht, ohne dass ein Verhalten dazugekommen wäre.
Was übernommen wurde: Sitzungen liegen in der Datenbank statt in einem
selbsttragenden Token, damit sie sich widerrufen lassen.

- [x] tRPC-Router und -Kontext
- [x] Konten mit Zugangsdaten (Argon2id) und Gastzugang
- [x] Gästekontingent als Teil der Guardrails
- [x] SSE-Route für den Ereignisstrom des Agenten
- [x] Verdichtung der Historie über `LlmPort`
- [x] Integrationstests der Prozeduren

### Nachtrag zu Etappe 3 — Modellkette (abgestimmt am 29.07.2026)

Das kostenlose Kontingent gilt je Modell, nicht je Zugang. In der Abnahme von
Etappe 5 lief `gemini-flash-latest` mitten im Gespräch in ein 429, und die
Demo stand — obwohl `gemini-flash-lite-latest` weiterhin antwortete.

- [x] Kette statt eines festen Modells — **ausdauerndstes** zuerst: Die
      Konsole nennt 20 Anfragen pro Tag für die volle Flash-Variante und 500
      für die Lite-Variante. Ursprünglich stand das stärkste vorn; nach zwei
      Gesprächen stand die Demo still.
- [x] Bei 429 oder entzogenem Modellnamen rückt dieselbe Anfrage zum nächsten
      Modell weiter; der Loop merkt nichts davon
- [x] Sperre endet mit der vom Dienst genannten Wartezeit, sonst zum
      Zurücksetzen des Tageskontingents (Mitternacht in Kalifornien)
- [x] Danach beginnt jede Anfrage wieder beim stärksten Modell — ohne dass
      etwas zurückgesetzt werden müsste
- [x] Der Zustand gehört dem Prozess, nicht dem Adapter: Die Fabrik baut den
      Adapter je Anfrage neu

## Etappe 5 — Oberfläche ✔

**Zwei Nachträge, während der Abnahme abgestimmt:** ein Löschknopf je Reise in
der Liste, und in der Modellkette die Rückkehr zur stärksten Variante nach
Ablauf einer Sperre. Beides steht als Punkt unten.

**Was die Abnahme zutage förderte** — jeder Fund wurde behoben, bevor diese
Etappe als abgeschlossen gilt: verlorene Signaturen des Modells, nicht
gespeicherte Werkzeugergebnisse, ein erfundener Reisezeitraum, eine übergangene
Rückfrage, „Italien" als Ziel statt einer Stadt, ein regelbasierter Ersatz ohne
Gedächtnis und Angebotskarten, die erst nach dem Neuladen erschienen.

- [x] Chat mit Streaming
- [x] Seitenleiste mit dem Reise-Entwurf, gefüllte Felder hervorgehoben
- [x] Karten für Flüge und Unterkünfte
- [x] Anzeige des gerade laufenden Werkzeugs
- [x] Liste vergangener Reisen, mit Löschknopf je Eintrag
- [x] Schaufensterseiten `/debug/*` entfernt
- [x] E2E über den vollständigen Ablauf — vier Playwright-Fälle
- [x] `npm run flow:check`: derselbe Ablauf ohne Browser, für Umgebungen ohne
      Chromium; er fand den Fehler, dass der regelbasierte Ersatz Orte nie in
      den Entwurf schrieb

## Etappe 6 — Eval, Dokumentation, Deployment

- [x] Eval-Datensatz auf Deutsch — inzwischen 22 Fälle, jeder aus einem echten
      Fehlverhalten entstanden
- [x] Eval-Runner mit Slot-Genauigkeit, getrennt nach richtig, falsch und
      **erfunden**; jeder Bericht nennt die gemessene Prompt-Fassung
- [x] Vergleich regelbasiert gegen Gemini im README
- [x] README auf Deutsch: Aufgabe, Architektur, Start, Entscheidungen
- [x] GIF der Demo — aufgenommen mit Playwright, gewandelt mit ffmpeg, beides
      als Skript im Repository statt als Handarbeit
- [x] Deployment, öffentliche Adresse
- [ ] Prüfung gegen die Definition of Done der Aufgabenstellung

## Abgleich mit der Definition of Done

Abschnitt 11 der Aufgabenstellung, Punkt für Punkt. Stand 01.08.2026.

| Nr. | Forderung                                               | Stand   | Beleg                                                                                                |
| --- | ------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Lint, Typecheck, Unit, Integration, E2E — lokal und CI  | offen   | Lokal grün: 464 Tests in 23 Dateien. Die CI-Zeile gilt erst mit dem nächsten Push als belegt         |
| 2   | Kein `any`, keine Typunterdrückung im Servercode        | erfüllt | Keine Fundstelle ausserhalb der Tests; ESLint verbietet `any`, `@ts-ignore` und Nicht-Null-Assertion |
| 3   | README auf Deutsch: Aufgabe, Architektur, Start, Gründe | erfüllt | Zehn Abschnitte, darunter alle vier geforderten                                                      |
| 4   | Lebende öffentliche Demo-Adresse                        | erfüllt | `reiseplaner-sooty.vercel.app`, erste Zeile des README                                               |
| 5   | GIF von 20 Sekunden im README                           | erfüllt | `docs/demo.gif` — 15 Sekunden, 2 MB, Anfrage bis Angebotskarten                                      |
| 6   | Sinnvolle Commit-Historie                               | erfüllt | 126 Commits, jeder mit dem Grund im Text                                                             |
| 7   | Start ohne Schlüssel fremder Anbieter                   | erfüllt | Seed-Adapter und regelbasierter Extraktor greifen ohne jede Variable                                 |

### Was die Aufgabenstellung sonst noch verlangt

Abschnitt 5 und 7, ebenfalls einzeln:

| Forderung                                               | Stand   | Beleg                                                                 |
| ------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| Iterativer Loop, Modell entscheidet über Werkzeuge      | erfüllt | `src/server/agent/loop.ts`                                            |
| Mehrere Werkzeugaufrufe eines Zuges parallel            | erfüllt | `Promise.all` über die Aufrufe eines Zuges                            |
| Selbstheilung: Fehler geht als `tool_result` zurück     | erfüllt | `Result<T, DomainError>`, kein `throw` im Werkzeugpfad                |
| Harte Obergrenzen und ausdrücklicher `stopReason`       | erfüllt | `guardrails.ts`, zu jedem Grund ein Satz für die reisende Person      |
| Sechs Werkzeuge mit Zod-Schema und JSON-Schema          | erfüllt | `tools/index.ts`, Schemata aus der Domäne abgeleitet                  |
| `TripDraft` in der Datenbank, Statusmodell              | erfüllt | Tabelle `trip_draft`, Status `collecting` → `confirmed`               |
| Inhaltsblöcke unverändert gespeichert                   | erfüllt | `text`, `tool_use`, `tool_result` — samt Signaturen des Modells       |
| Verdichtung statt Abschneiden                           | erfüllt | `history.ts`                                                          |
| Genau **eine** Rückfrage je fehlender Angabe            | erfüllt | `MISSING_SLOT_ORDER`, Prompt-Regeln 3, 3a, 3b, 3c                     |
| Relative Datumsangaben in ISO                           | erfüllt | Heutiges Datum steht im Systemprompt                                  |
| Streaming, Entwurfsleiste, Karten, Werkzeuganzeige      | erfüllt | Seit dieser Woche echtes Token-Streaming statt ganzer Züge            |
| Protokoll je Werkzeugaufruf mit Ausgang und Latenz      | erfüllt | Tabelle `tool_call_log`, sichtbar auch in der Oberfläche              |
| Tokenverbrauch je Dialog                                | erfüllt | Zähler auf `conversation`                                             |
| Vier Testebenen, Eval getrennt und von Hand             | erfüllt | Unit, Integration, E2E in CI; `npm run eval` ausdrücklich nicht in CI |
| Negativfälle: ungültige Werkzeugeingabe, Ausfall, Limit | erfüllt | In `loop.test.ts`, `http.test.ts` und `hotel-fallback.test.ts`        |

### Drei Punkte, die der Abgleich zusätzlich zutage fördert

**„Ein Kommando" ist es nicht.** Abschnitt 1 verlangt, dass das Projekt bei
einer fremden Person mit **einem** Befehl startet. Heute sind es vier in zwei
Terminals: `npm install`, `npm run db:local`, `npm run db:migrate`,
`npm run dev`. Das ist kein grosser Aufwand, aber es ist nicht, was dasteht.

**Der echte Anbieter ist bisher nur Open-Meteo.** Abschnitt 2 verspricht
„echte Anbieter-API statt Attrappen". Der Duffel-Adapter ist geschrieben und
geprüft, lief aber nie gegen die echte Sandbox — es gibt kein Token. Overpass
antwortet derzeit nicht. Belegt ist damit die Fähigkeit, nicht der Betrieb.
Der Grund steht im README: Amadeus hat sein Self-Service-Portal am 17.07.2026
abgeschaltet, Skyscanner und Kiwi vergeben nur an Partner, Booking.com nimmt
derzeit keine neuen an.

**Der Umfang ist enger als der Titel.** Der Planer deckt europäische Ziele ab
deutschen Flughäfen ab. Das steht auf der Startseite, im Prompt und als
Eval-Fall — aber es ist eine Einschränkung und keine Eigenschaft.

## Verschiebungen

| Datum      | Punkt                                        | Von      | Nach                               | Grund                                                                                                                              | Zustimmung |
| ---------- | -------------------------------------------- | -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2026-07-31 | Verhalten der Hotelsuche bei Ausfall der API | Etappe 6 | — (noch am selben Tag entschieden) | Keine der drei Overpass-Instanzen antwortet zuverlässig; entschieden wurde für den Rückfall auf den Seed-Katalog mit Kennzeichnung | ja         |

**Erledigt am 31.07.2026.** Die Entscheidung fiel, ohne auf einen erreichbaren
Dienst zu warten: Unterkünfte fallen auf den Seed-Katalog zurück, genau wie
Flüge ohne Anbieter-Token. Jedes Ergebnis trägt `isDemoData`, und der
Systemprompt verpflichtet den Assistenten seit 1.6.0, die Herkunft im ersten
Satz zu nennen. Erfundene Daten sind vertretbar, solange sie als solche
benannt werden — verschwiegen wären sie es nicht.

Overpass bleibt als erste Wahl verdrahtet. Antwortet er wieder, kommen echte
Häuser zurück, ohne dass etwas umgestellt werden müsste.
