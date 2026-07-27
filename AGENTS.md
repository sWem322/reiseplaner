# AGENTS.md

Persistente Anweisungen für jede Person und jeden Coding-Agenten, der an diesem
Repository arbeitet. Diese Datei ist verbindlich — Abweichungen gehören in einen
Pull-Request mit Begründung, nicht in stillschweigende Ausnahmen.

## 1. Was dieses Projekt ist

Ein Chat-Assistent für die Planung individueller Reisen. Ein Agenten-Loop
entscheidet selbst, welche Werkzeuge er wie oft aufruft, sammelt Reiseparameter
aus freiem Text und führt einen strukturierten Reise-Entwurf über den gesamten
Dialog hinweg.

Der Kern des Projekts ist nicht die Oberfläche, sondern die Orchestrierung:
Werkzeug-Registry, Zustandsführung, Guardrails und die Testbarkeit eines
nicht-deterministischen Systems.

## 2. Architekturregeln

### 2.1 Die Domäne bleibt frei von Infrastruktur

`src/domain/` enthält Schemata, Typen und reine Geschäftslogik. Verboten sind
dort Importe von:

- LLM-SDKs (`@google/genai`, `openai`, …)
- HTTP- und Framework-Code (`next`, `@trpc/*`)
- Datenbankzugriff (`drizzle-orm`, `pg`, `src/server/db`)

Diese Regel wird nicht nur dokumentiert, sondern durch ESLint erzwungen
(`no-restricted-imports` in `eslint.config.mjs`). Wer sie umgehen muss, hat
den Schnitt falsch gelegt.

### 2.2 Externe Dienste nur über Ports

Jeder externe Dienst wird zuerst als Interface in `src/domain/ports/`
beschrieben und erst dann in `src/server/adapters/` implementiert. Zu jedem
Port gehört eine deterministische In-Memory- oder Seed-Implementierung.

Konsequenz: Alle Integrationstests laufen ohne Netzwerk. Das ist keine
Bequemlichkeit, sondern die Voraussetzung dafür, dass die Tests überhaupt
verlässlich sind.

### 2.3 Das Projekt startet ohne Schlüssel

`npm run dev` muss ohne eine einzige gesetzte Umgebungsvariable funktionieren.
Fehlt ein Anbieter-Token, wählt die Port-Fabrik den Seed-Adapter und protokolliert
das beim Start. Ein Feature, das ohne Schlüssel hart fehlschlägt, ist ein Bug.

### 2.4 Fehler sind Daten, keine Exceptions

Operationen, die kontrolliert fehlschlagen dürfen, geben `Result<T, DomainError>`
zurück (`src/domain/result.ts`). Grund: Ein fehlgeschlagener Werkzeugaufruf muss
als `tool_result` zurück an das Modell gehen, damit es sich selbst korrigieren
kann. Eine geworfene Exception würde den Loop abbrechen.

Exceptions bleiben dem Unerwarteten vorbehalten — Programmierfehler,
Konfigurationsfehler beim Start.

### 2.5 Ein Schema als einzige Wahrheit

Zod-Schemata in `src/domain/` sind die Quelle für Werkzeug-Validierung,
tRPC-Verträge, Frontend-Typen und Testfixtures. Keine parallel gepflegten
Typdefinitionen, keine handgeschriebenen JSON-Schemas.

## 3. Typisierung

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` sind aktiv
  und werden nicht gelockert.
- `any` ist im gesamten Servercode verboten. Unbekannte Daten sind `unknown`
  und werden mit Zod validiert.
- `@ts-ignore` und `@ts-nocheck` sind verboten. `@ts-expect-error` ist erlaubt,
  aber nur mit Kommentar, der erklärt, warum der Fehler erwartet wird.
- Nicht-Null-Assertions (`!`) sind im Produktivcode verboten.

## 4. Tests

Vier Ebenen mit klarer Aufgabenteilung:

| Ebene       | Ort                  | Prüft                                    | Deterministisch |
| ----------- | -------------------- | ---------------------------------------- | --------------- |
| Unit        | `src/**/*.test.ts`   | Schemata, reine Funktionen, Slot-Logik   | ja              |
| Integration | `tests/integration/` | Agenten-Loop, Adapter, Repositories      | ja              |
| E2E         | `tests/e2e/`         | Ablauf von der Anfrage bis zum Vorschlag | ja              |
| Eval        | `evals/`             | Extraktionsqualität des Modells          | nein            |

Die ersten drei Ebenen laufen in CI und müssen grün sein. Evals laufen manuell:
Sie sind kostenpflichtig und nicht-deterministisch — sie gehören nicht in einen
Gate, der Merges blockiert.

Tests werden aus den Akzeptanzkriterien der Spezifikation abgeleitet und **vor**
der Implementierung geschrieben.

Pflicht-Negativfälle für jedes Werkzeug:

1. Das Modell ruft das Werkzeug mit ungültiger Eingabe auf.
2. Der externe Anbieter ist nicht erreichbar.
3. Der Agent läuft in eine Obergrenze (Iterationen, Werkzeugaufrufe, Budget).

## 5. Arbeitsweise an einer Funktion

1. Spezifikation in `specs/` schreiben oder erweitern: Ziel, Vertrag,
   Akzeptanzkriterien, ausdrücklich Nicht-Ziele.
2. Tests aus den Akzeptanzkriterien ableiten.
3. Implementieren, bis die Tests grün sind.
4. `npm run verify` lokal ausführen (Lint, Typecheck, alle Tests).
5. Commit mit aussagekräftiger Nachricht.

### 5.1 Arbeitsumgebung eines Coding-Agenten

Wer mit einer eigenen Sandbox arbeitet, hält sich an folgende Regeln — sie
stammen aus einem konkreten Vorfall, bei dem die Sandbox durch mehrere
parallele Projektkopien den Datenträger füllte und mitten in der Arbeit
unbrauchbar wurde:

- **Genau eine Arbeitskopie.** Prüfungen laufen in einem einzigen Verzeichnis.
  Kein zweiter Klon für „nur kurz gegenprüfen".
- **`node_modules` wird nie kopiert.** Wo Abhängigkeiten fehlen, wird
  installiert oder verlinkt — nicht dupliziert. Ein `cp -r node_modules`
  überträgt hunderte Megabyte.
- **Temporäre Klone werden sofort nach Gebrauch gelöscht**, im selben Befehl,
  nicht „später".
- **Vor jedem Klonen oder Installieren freien Speicher prüfen** (`df -h`).

Die Regel steht hier und nicht im Gedächtnis eines Agenten, weil ein Agent
zwischen Sitzungen keines hat. Persistente Anweisungen sind der Ersatz dafür —
genau das demonstriert dieses Projekt auch fachlich.

## 6. Commit-Konventionen

Conventional Commits, Betreff auf Englisch, Imperativ, maximal 72 Zeichen:

```
feat(agent): add iteration and token budget guardrails
fix(adapters): map Duffel error codes to DomainError
test(domain): cover slot extraction for relative dates
chore(ci): run integration tests against service postgres
docs(specs): add acceptance criteria for trip draft
```

Ein Commit pro abgeschlossenem Gedanken. Kein Sammelcommit über mehrere
Funktionen, kein `wip` auf `main`.

## 7. Sprachen im Projekt

- Oberfläche, Systemprompts, Modellantworten, README: **Deutsch**
- Bezeichner im Code, Kommentare, Commits, Spezifikationen: **Englisch**
  (Ausnahme: fachliche Begriffe der Reisedomäne bleiben deutsch, wo sie
  in der Oberfläche auftauchen)

Umlaute in Codekommentaren werden als `ae`, `oe`, `ue`, `ss` geschrieben, um
Encoding-Probleme in gemischten Werkzeugketten zu vermeiden. In Markdown und
in der Oberfläche werden echte Umlaute verwendet.

## 8. Verzeichnisse

```
src/app/              Oberfläche: Chat, Zustandsleiste, Angebotskarten
src/server/trpc/      Router, Kontext, Prozeduren — einziger Eingang fürs Frontend
src/server/agent/     Loop, Werkzeug-Registry, Prompts, Guardrails
src/server/adapters/  Implementierungen der Ports (Seed, Duffel, Gemini, …)
src/server/db/        Schema, Client, Repository-Implementierungen
src/domain/           Schemata, Ports, reine Logik — ohne Infrastruktur
specs/                Spezifikationen je Funktion
evals/                Datensatz und Runner für Extraktionsqualität
tests/integration/    Integrationstests
tests/e2e/            Playwright-Tests
```

## 9. Was bewusst nicht getan wird

- Keine echten Buchungen und keine Zahlungsabwicklung.
- Keine Nutzerverwaltung über Registrierung, Gastzugang und Sitzung hinaus.
- Keine Mehrsprachigkeit der Oberfläche.
- Kein eigenes Design-System — Tailwind-Utilities genügen.

Wer eines dieser Themen anfasst, erweitert vorher den Skopus in `specs/`.
