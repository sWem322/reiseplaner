# Spec 000 — Projekt-Grundgerüst

**Status:** umgesetzt
**Etappe:** 0

## Ziel

Ein lauffähiges Grundgerüst, auf dem alle weiteren Etappen aufsetzen, ohne dass
Werkzeugketten-Fragen später den Fortschritt blockieren. Am Ende dieser Etappe
existiert noch keine Fachlichkeit — aber jede Qualitätsprüfung, die das Projekt
später absichern soll, läuft bereits grün.

## Vertrag

### Befehle

| Befehl                     | Erwartung                                       |
| -------------------------- | ----------------------------------------------- |
| `npm run dev`              | startet ohne gesetzte Umgebungsvariablen        |
| `npm run lint`             | ESLint mit Typinformation, keine Fehler         |
| `npm run typecheck`        | `tsc --noEmit`, keine Fehler                    |
| `npm test`                 | Unit-Tests, grün                                |
| `npm run test:integration` | Integrationstests gegen echtes PostgreSQL, grün |
| `npm run verify`           | alle vier Prüfungen nacheinander                |
| `npm run db:up`            | PostgreSQL über Docker Compose                  |
| `npm run db:local`         | PostgreSQL eingebettet, ohne Docker             |

### Struktur

- `src/domain/` ist durch ESLint gegen Infrastruktur-Importe abgesichert.
- `src/env.ts` ist der einzige Ort, an dem `process.env` gelesen wird; alle
  Anbieter-Schlüssel sind optional.
- `src/domain/result.ts` stellt den `Result`-Typ bereit, auf dem die
  Fehlerbehandlung des Agenten aufbaut.

## Akzeptanzkriterien

1. `npm run verify` läuft ohne Fehler durch. ✔
2. Ein Klon des Repositories startet ohne `.env`-Datei. ✔
3. ESLint meldet einen Fehler, wenn `src/domain/` Infrastruktur importiert. ✔
4. `any`, `@ts-ignore` und Nicht-Null-Assertions führen zu Lint-Fehlern. ✔
5. Integrationstests starten eine echte PostgreSQL-Instanz ohne Docker. ✔
6. CI führt Lint, Typecheck, Unit-, Integrations- und E2E-Tests aus. ✔

## Nicht-Ziele

- Keine Fachlichkeit: keine Reise-Entitäten, keine Werkzeuge, kein Agent.
- Keine Authentifizierung (folgt in Etappe 4).
- Kein Deployment (folgt in Etappe 6).

## Entscheidungen und Begründungen

**TypeScript 6 statt 7.** `typescript-eslint` unterstützt TypeScript 7 zum
Zeitpunkt der Einrichtung nicht (Peer-Bereich `<6.1.0`). Typgestütztes Linting
ist eine harte Anforderung des Projekts, die neueste Compiler-Version nicht.

**Drizzle statt Prisma.** Prisma lädt native Engine-Binärdateien von einer
externen Domäne nach. In der Entwicklungsumgebung dieses Projekts ist diese
Domäne nicht erreichbar, wodurch Migrationen und Client-Generierung
fehlschlagen. Drizzle ist reines TypeScript, erzeugt lesbare SQL-Migrationen im
Repository und leitet Typen ohne Codegenerierungsschritt direkt aus dem Schema
ab. Repositories werden hinter Interfaces in `src/domain/ports/` definiert,
sodass ein späterer Wechsel eine zusätzliche Implementierung ist und keine
Umschreibung der Fachlogik.

**Eingebettetes PostgreSQL für Tests.** Integrationstests sollen echte
SQL-Semantik prüfen — Constraints, Kaskaden, Transaktionen. Ein In-Memory-Mock
täte das nicht. Gleichzeitig darf kein Docker-Daemon vorausgesetzt werden, damit
die Tests in jeder Umgebung laufen. `embedded-postgres` startet denselben
Serverkern ohne Container.

**Vitest-Projekte statt Ordnerkonvention.** Unit- und Integrationstests sind
getrennte Projekte mit eigenen Zeitlimits. So bleibt `npm test` als schneller
Rückkopplungsschritt während der Entwicklung nutzbar, während der langsamere
Datenbankpfad separat läuft.
