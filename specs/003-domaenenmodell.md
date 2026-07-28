# Spec 003 — Domänenmodell der Reiseplanung

**Status:** in Umsetzung
**Etappe:** 1

## Ziel

Ein Datenmodell, das den Zustand einer Reiseplanung über den gesamten Dialog
trägt. Es ist die einzige Wahrheit für Werkzeug-Validierung, tRPC-Verträge,
Frontend-Typen und Testfixtures.

Zwei Begriffe, die auseinandergehalten werden müssen:

- **TripQuery** — eine _vollständige_ Suchanfrage. Alle Pflichtangaben liegen
  vor, die Suche kann laufen.
- **TripDraft** — der _in Arbeit befindliche_ Entwurf. Jedes Feld darf fehlen.
  Der Agent füllt ihn Schritt für Schritt (Slot Filling).

Der Unterschied ist der Kern des Modells: Der Agent arbeitet immer auf einem
Draft und darf erst suchen, wenn dieser sich in eine Query überführen lässt.

## Vertrag

### TripDraft

| Feld            | Typ                                    | Pflicht für Suche     |
| --------------- | -------------------------------------- | --------------------- |
| `origin`        | Ort mit IATA-Code und Koordinaten      | ja                    |
| `destination`   | Ort mit IATA-Code und Koordinaten      | ja                    |
| `departureDate` | ISO-Datum (`YYYY-MM-DD`)               | ja                    |
| `returnDate`    | ISO-Datum                              | ja                    |
| `adults`        | ganze Zahl ≥ 1                         | ja                    |
| `childAges`     | Liste ganzer Zahlen 0–17               | nein (Standard: leer) |
| `budgetEuros`   | ganze Zahl > 0, Gesamtbudget der Reise | nein                  |
| `preferences`   | Freitext-Liste (z. B. „Strandnähe")    | nein                  |

Bewusste Entscheidungen:

- **Nur exakte Daten.** Kein Zeitraum, keine Flexibilität. Steht im Text „im
  September", ist der Slot leer und der Agent stellt genau eine Rückfrage.
  Begründung: Ein Feld mit zwei sich ausschließenden Ausdrucksformen erzeugt
  Sonderfälle in Validierung, Suche und Anzeige, ohne dass der Kern des
  Projekts — die Orchestrierung — davon profitiert.
- **Kinder mit Altersangabe.** Reiseanbieter berechnen Tarife nach Alter, nicht
  nach Kopfzahl. `childAges: [4, 9]` trägt mehr Information als `children: 2`
  und kostet kein zusätzliches Feld.
- **Budget als eine Zahl in ganzen Euro.** Immer für die gesamte Reise. Kein
  Feld für „pro Person": Der Agent rechnet um und fragt im Zweifel nach.

### Statusmodell

```
collecting ──► searching ──► proposed ──► confirmed
     ▲                            │
     └────────────────────────────┘
        (Nutzer ändert Parameter)
```

| Status       | Bedeutung                            |
| ------------ | ------------------------------------ |
| `collecting` | Pflichtangaben fehlen noch           |
| `searching`  | vollständig, Suche läuft             |
| `proposed`   | Vorschläge liegen vor                |
| `confirmed`  | Nutzer hat einen Vorschlag bestätigt |

Übergänge sind geprüft: Von `collecting` nach `searching` nur, wenn keine
Pflichtangabe fehlt. Von `proposed` zurück nach `collecting`, wenn der Nutzer
einen Parameter ändert.

## Akzeptanzkriterien

1. Ein leerer Entwurf meldet alle sechs Pflichtangaben als fehlend.
2. Ein vollständiger Entwurf meldet keine fehlende Angabe und lässt sich
   verlustfrei in eine `TripQuery` überführen.
3. Ein Rückreisedatum vor dem Hinreisedatum wird abgelehnt.
4. Ein Datum in der Vergangenheit wird abgelehnt.
5. Ein Reisezeitraum über einem Jahr wird abgelehnt.
6. `adults` unter 1 oder über 9 wird abgelehnt.
7. Ein Kindesalter außerhalb 0–17 wird abgelehnt.
8. Ein negatives oder null Budget wird abgelehnt.
9. Ein IATA-Code, der nicht aus genau drei Großbuchstaben besteht, wird
   abgelehnt.
10. Gleicher Abflug- und Zielort wird abgelehnt.
11. Der Übergang `collecting → searching` scheitert bei unvollständigem Entwurf.
12. Die Reihenfolge der fehlenden Angaben ist stabil — der Agent fragt
    vorhersagbar nach Ziel, dann Datum, dann Reisenden.

## Nicht-Ziele

- Keine Zwischenstopps, keine Multi-City-Reisen: eine Strecke, hin und zurück.
- Keine Kabinenklasse, kein Gepäck, keine Sitzplatzwahl.
- Keine Währung außer Euro.
- Keine Preisberechnung im Domänenmodell — das leisten die Adapter.

## Persistenz

| Tabelle         | Inhalt                                                                |
| --------------- | --------------------------------------------------------------------- |
| `conversation`  | Dialog: Zusammenfassung für die Verdichtung, Token-Zähler             |
| `message`       | Rolle und Inhaltsblöcke im Originalformat, Index nach Dialog und Zeit |
| `trip_draft`    | Strukturierter Zustand, 1:1 zum Dialog, mit Status                    |
| `tool_call_log` | Audit: Werkzeug, Eingabe, Ausgang, Dauer                              |

Repositories werden als Interfaces in `src/domain/ports/` beschrieben und in
`src/server/db/` implementiert. Die Domäne kennt kein Drizzle, kein SQL und
keine Verbindung — damit bleibt ein späterer Wechsel der Persistenzschicht eine
zusätzliche Implementierung statt eines Umbaus.
