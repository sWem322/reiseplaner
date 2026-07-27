# AI-Reiseplaner

[![CI](https://github.com/USER/ai-reiseplaner/actions/workflows/ci.yml/badge.svg)](https://github.com/USER/ai-reiseplaner/actions/workflows/ci.yml)

Chat-Assistent für die Planung individueller Reisen. Ein Agenten-Loop
orchestriert Werkzeuge für Ziel-, Flug-, Hotel- und Wettersuche, extrahiert
Reiseparameter aus freiem Text und führt einen strukturierten Reise-Entwurf über
den gesamten Dialog hinweg.

> **Etappe 0 von 7.** Das Grundgerüst steht: Typisierung, Linting, Tests, CI und
> Datenbankanbindung sind eingerichtet und grün. Die Fachlichkeit entsteht in den
> folgenden Etappen.

## Schnellstart

```bash
npm install

# Datenbank starten — mit Docker …
npm run db:up
# … oder ohne Docker (eingebettetes PostgreSQL)
npm run db:local

npm run db:migrate
npm run dev
```

Das Projekt startet **ohne eine einzige Umgebungsvariable**. Fehlen
Anbieter-Schlüssel, greifen deterministische Seed-Adapter und ein regelbasierter
Extraktor — die Demo bleibt vollständig bedienbar. Optionale Schlüssel sind in
[`.env.example`](.env.example) dokumentiert.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run verify` | Lint, Typecheck und alle Tests nacheinander |
| `npm run lint` | ESLint mit Typinformation |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit-Tests |
| `npm run test:integration` | Integrationstests gegen echtes PostgreSQL |
| `npm run test:e2e` | Playwright gegen einen Produktionsbuild |
| `npm run db:generate` | SQL-Migration aus dem Schema erzeugen |
| `npm run db:migrate` | Migrationen anwenden |

## Architektur

```
src/domain/           Schemata, Ports, reine Logik — ohne Infrastruktur
src/server/agent/     Loop, Werkzeug-Registry, Prompts, Guardrails
src/server/adapters/  Implementierungen der Ports (Seed, Duffel, Gemini, …)
src/server/trpc/      Router und Prozeduren — einziger Eingang fürs Frontend
src/server/db/        Schema, Client, Repositories
src/app/              Oberfläche
specs/                Spezifikation je Funktion
evals/                Datensatz und Runner für Extraktionsqualität
```

### Ports und Adapter

Die Werkzeuge des Agenten kennen keine Anbieter, sondern nur Interfaces
(`FlightSearchPort`, `HotelSearchPort`, `LlmPort` …). Zu jedem Port gehört eine
deterministische Seed-Implementierung; welche Variante zum Einsatz kommt,
entscheidet eine Fabrik anhand der vorhandenen Umgebungsvariablen.

Das ist der Grund, warum alle Integrationstests ohne Netzwerk laufen — und
warum der Wegfall eines Anbieters kein Umbau ist, sondern ein neuer Adapter.
Genau dieser Fall trat während der Entwicklung ein: Amadeus hat sein
Self-Service-Portal am 17. Juli 2026 abgeschaltet. Ersetzt wurde es durch Duffel
und Travelpayouts, ohne dass Domäne oder Agenten-Loop angefasst werden mussten.

### Fehler als Daten

Werkzeuge geben `Result<T, DomainError>` zurück statt zu werfen. Ein
fehlgeschlagener Aufruf geht als `tool_result` zurück an das Modell, das sich in
der nächsten Iteration selbst korrigiert. Eine Exception würde den Loop abbrechen
und diese Selbstkorrektur verhindern.

## Technischer Stand

| Bereich | Wahl |
| --- | --- |
| Sprache | TypeScript 6, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4 |
| API | tRPC 11, Zod 4 |
| Daten | Drizzle ORM, PostgreSQL 18 |
| Sprachmodell | Gemini über `LlmPort`, regelbasierter Ersatz ohne Schlüssel |
| Tests | Vitest (Unit, Integration), Playwright (E2E), eigener Eval-Runner |
| CI | GitHub Actions |

Begründungen zu den einzelnen Entscheidungen stehen in
[`specs/000-projekt-grundlagen.md`](specs/000-projekt-grundlagen.md);
die verbindlichen Projektregeln in [`AGENTS.md`](AGENTS.md).

## Tests

Vier Ebenen mit klarer Aufgabenteilung: Unit prüft reine Logik, Integration den
Agenten-Loop gegen ein skriptgesteuertes Ersatzmodell, E2E den Ablauf von der
Anfrage bis zum Vorschlag. Evals messen die Extraktionsqualität des Modells und
laufen bewusst **nicht** in CI — sie sind nicht-deterministisch und dürfen kein
Merge blockieren.
