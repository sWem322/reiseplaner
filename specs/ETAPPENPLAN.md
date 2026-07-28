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

## Etappe 3 — Agenten-Kern (ein Punkt offen)

**Stand:** elf von zwölf Punkten erledigt. Offen ist allein der Lauf gegen die echte Schnittstelle — er kann in dieser Entwicklungsumgebung nicht ausgeführt werden.

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
- [ ] **Ein Lauf gegen die echte Schnittstelle** mit einem gültigen Schlüssel

## Etappe 4 — API und Authentifizierung

- [ ] tRPC-Router und -Kontext
- [ ] Auth.js v5 mit Zugangsdaten und Gastzugang
- [ ] Gästekontingent als Teil der Guardrails
- [ ] SSE-Route für den Ereignisstrom des Agenten
- [ ] Verdichtung der Historie über `LlmPort`
- [ ] Integrationstests der Prozeduren

## Etappe 5 — Oberfläche

- [ ] Chat mit Streaming
- [ ] Seitenleiste mit dem Reise-Entwurf, gefüllte Felder hervorgehoben
- [ ] Karten für Flüge und Unterkünfte
- [ ] Anzeige des gerade laufenden Werkzeugs
- [ ] Liste vergangener Reisen
- [ ] Schaufensterseiten `/debug/*` entfernen
- [ ] E2E über den vollständigen Ablauf

## Etappe 6 — Eval, Dokumentation, Deployment

- [ ] Eval-Datensatz mit 20 Fällen auf Deutsch
- [ ] Eval-Runner mit Slot-Genauigkeit
- [ ] Vergleich regelbasiert gegen Gemini im README
- [ ] README auf Deutsch: Aufgabe, Architektur, Start, Entscheidungen
- [ ] GIF der Demo
- [ ] Deployment, öffentliche Adresse
- [ ] Prüfung gegen die Definition of Done der Aufgabenstellung

## Verschiebungen

Bisher keine bewilligten Verschiebungen.

| Datum | Punkt | Von | Nach | Grund | Zustimmung |
| ----- | ----- | --- | ---- | ----- | ---------- |
| —     | —     | —   | —    | —     | —          |
