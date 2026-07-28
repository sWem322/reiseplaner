# Spec 004 — Ports und Adapter der Anbieter

**Status:** in Umsetzung
**Etappe:** 2

## Ziel

Die Werkzeuge des Agenten sollen Flüge, Unterkünfte, Orte und Wetter abfragen,
ohne einen einzigen Anbieter zu kennen. Zwischen beiden steht ein Interface je
Fachaufgabe; welche Implementierung dahinter arbeitet, entscheidet eine Fabrik
anhand der vorhandenen Umgebungsvariablen.

Dass dieses Vorgehen trägt, hat sich während der Entwicklung bereits gezeigt:
Amadeus hat sein Self-Service-Portal am 17. Juli 2026 abgeschaltet. Der Wegfall
kostet einen neuen Adapter — Domäne, Werkzeuge und Agenten-Loop bleiben
unberührt.

## Vertrag

### FlightSearchPort

```
search(query: TripQuery, limit: number) -> Promise<Result<FlightOffer[]>>
```

Liefert höchstens `limit` Angebote, aufsteigend nach Preis. Ein leeres Ergebnis
ist kein Fehler — auf manchen Strecken fliegt an manchen Tagen nichts.

### HotelSearchPort

```
search(input: { destination: Place; checkIn: string; checkOut: string; guests: number },
       limit: number) -> Promise<Result<HotelOffer[]>>
```

### GeocodingPort

```
resolve(freeText: string) -> Promise<Result<Place[]>>
```

Wandelt „Mallorca", „Palma" oder „Düsseldorf" in Orte mit IATA-Code und
Koordinaten. Mehrdeutige Eingaben liefern mehrere Treffer; die Auswahl trifft
der Agent, nicht der Adapter.

### WeatherPort

```
outlook(place: Place, month: number) -> Promise<Result<WeatherOutlook>>
```

Klimatische Normalwerte für einen Reisemonat, keine Tagesvorhersage. Eine
Prognose für September, abgefragt im Januar, gibt es nicht — Normalwerte schon.

## Fehlerbehandlung

Alle Ports geben `Result` zurück, niemals eine Exception. Die Zuordnung:

| Situation                                         | `DomainError.kind` |
| ------------------------------------------------- | ------------------ |
| Anbieter antwortet nicht, Zeitüberschreitung, 5xx | `upstream_error`   |
| Anbieter meldet zu viele Anfragen (429)           | `rate_limited`     |
| Anbieter kennt den Ort nicht                      | `not_found`        |
| Antwort passt nicht zum erwarteten Schema         | `upstream_error`   |
| Eingabe verletzt das Domänenschema                | `validation_error` |

Begründung: Der Agenten-Loop reicht jeden Fehlschlag als `tool_result` an das
Modell zurück. Eine Exception würde den Lauf abbrechen und genau die
Selbstkorrektur verhindern, die das Projekt zeigen soll.

## Auswahl der Implementierung

| Port               | ohne Schlüssel   | mit Schlüssel                            |
| ------------------ | ---------------- | ---------------------------------------- |
| `FlightSearchPort` | Seed-Daten       | Duffel (Testmodus) oder Travelpayouts    |
| `HotelSearchPort`  | Seed-Daten       | Overpass (OpenStreetMap, ohne Schlüssel) |
| `GeocodingPort`    | Seed-Katalog     | Open-Meteo (ohne Schlüssel)              |
| `WeatherPort`      | Seed-Normalwerte | Open-Meteo (ohne Schlüssel)              |

Die Fabrik protokolliert beim Start, welcher Adapter aktiv ist. Ohne jede
Variable läuft das Projekt vollständig auf Seed-Daten — Bedingung aus der
Definition of Done.

## Seed-Daten

- Rund 20 deutsche Abflughäfen (DUS, CGN, FRA, MUC, BER, HAM, STR, …)
- Beliebte Ziele: Balearen, Kanaren, Griechenland, Italien, Türkei, Portugal
- Preise werden **deterministisch** aus Strecke, Datum und Reisendenzahl
  berechnet, nicht zufällig gezogen.

Der Determinismus ist die Voraussetzung dafür, dass E2E-Tests und die Demo
reproduzierbar sind: Dieselbe Anfrage ergibt immer dieselben Angebote. Ein
`Math.random()` an dieser Stelle würde jeden Testlauf zum Glücksspiel machen.

Preise sind als Demo-Daten gekennzeichnet, sobald sie in der Oberfläche
erscheinen. Erfundene Preise als echte auszugeben wäre irreführend.

## Akzeptanzkriterien

1. Ohne Umgebungsvariablen liefert jeder Port Ergebnisse aus Seed-Daten.
2. Dieselbe Anfrage liefert bei den Seed-Adaptern zweimal dasselbe Ergebnis.
3. Flugergebnisse sind aufsteigend nach Preis sortiert und auf `limit` begrenzt.
4. Eine Strecke ohne Verbindung liefert eine leere Liste, keinen Fehler.
5. Ein unbekannter Ort liefert `not_found`.
6. Ein Anbieter, der nicht antwortet, liefert `upstream_error` statt zu werfen.
7. Eine Antwort, die nicht zum Schema passt, liefert `upstream_error`.
8. Jeder HTTP-Adapter bricht nach einer festen Zeitspanne ab.
9. Kein Test dieser Ebene benötigt eine Netzwerkverbindung.
10. Die Fabrik wählt die Seed-Implementierung, wenn der zugehörige Schlüssel
    fehlt, und die echte, wenn er vorhanden ist.

## Nicht-Ziele

- Keine Buchung, keine Zahlung, keine Sitzplatzwahl.
- Kein Caching und keine Warteschlange — im Produktionsbetrieb wären beide der
  nächste Schritt, hier bleiben die Aufrufe direkt.
- Keine Preisvergleiche zwischen Anbietern.

## Testplan

| Fall                                         | Ebene | Erwartung                     |
| -------------------------------------------- | ----- | ----------------------------- |
| Seed-Suche auf bekannter Strecke             | Unit  | nach Preis sortierte Angebote |
| Zweimal dieselbe Anfrage                     | Unit  | identisches Ergebnis          |
| Strecke ohne Verbindung                      | Unit  | leere Liste, `ok`             |
| Unbekannter Ort                              | Unit  | `not_found`                   |
| HTTP-Adapter, Anbieter antwortet mit 500     | Unit  | `upstream_error`              |
| HTTP-Adapter, Anbieter antwortet mit 429     | Unit  | `rate_limited`                |
| HTTP-Adapter, Antwort passt nicht zum Schema | Unit  | `upstream_error`              |
| HTTP-Adapter, Zeitüberschreitung             | Unit  | `upstream_error`              |
| Fabrik ohne Schlüssel                        | Unit  | Seed-Implementierung          |
| Fabrik mit Schlüssel                         | Unit  | Anbieter-Implementierung      |
