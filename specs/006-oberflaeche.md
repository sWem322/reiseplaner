# 006 — Oberfläche

Etappe 5. Bis hierhin war der Agent nur über die Schnittstelle erreichbar:
lauffähig, getestet, aber nicht bedienbar. Diese Etappe macht ihn benutzbar.

## Was die Oberfläche zeigen muss

Ein Chat allein wäre zu wenig. Das Interessante an diesem Projekt ist nicht,
dass ein Modell antwortet, sondern **wie es zu seiner Antwort kommt**: Es
entscheidet selbst, welche Werkzeuge es aufruft, sammelt daraus einen
strukturierten Entwurf und korrigiert sich, wenn ein Aufruf fehlschlägt.
Genau das bleibt unsichtbar, wenn die Oberfläche nur Text anzeigt.

Deshalb werden drei Dinge gleichzeitig dargestellt:

1. **Die Antwort**, während sie entsteht.
2. **Die Arbeit dahinter** — welches Werkzeug gerade läuft, wie lange es
   gebraucht hat, ob es geklappt hat.
3. **Das Ergebnis der Arbeit** — der Reise-Entwurf, der mit jeder Nachricht
   vollständiger wird, und die gefundenen Angebote als Karten.

## Seitenaufbau

| Pfad          | Art             | Inhalt                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------- |
| `/`           | Server          | Einstieg; ohne Sitzung Gastzugang, sonst Weiterleitung zur jüngsten Reise |
| `/reise`      | Server          | Liste der Reisen, Anlegen einer neuen                                     |
| `/reise/[id]` | Server + Client | Chat, Entwurfsleiste, Angebote                                            |

Die Server-Komponenten laden den Anfangszustand über den tRPC-Caller — ohne
Netzwerkweg, im selben Prozess. Erst der Chat selbst ist eine Client-Komponente.
Das hält den ersten Seitenaufbau schnell und den Verlauf ohne Ladezustand.

## Transport

Zwei Wege, und der Unterschied ist beabsichtigt:

- **Abrufe und Änderungen** laufen über tRPC. Im Browser über
  `@trpc/client` (Vanilla-Client, ohne React Query — der Zustand dieser
  Oberfläche ist klein genug für eigene Hooks, und jede weitere Abhängigkeit
  will begründet sein).
- **Der Agentenlauf** läuft über den SSE-Handler aus Etappe 4. Ein Lauf ist
  kein Abruf: Er dauert Sekunden, erzeugt Zwischenereignisse und hat
  Nebenwirkungen.

`EventSource` scheidet aus — es kann nur GET, die Nachricht muss aber im Rumpf
stehen. Stattdessen `fetch` mit `POST` und Lesen des Antwortstroms.

## Ereignisse sind an der Grenze zu prüfen

Die Ereignisse stammen zwar aus dem eigenen Server, kommen im Browser aber als
`unknown` an. Sie werden mit Zod geprüft, bevor sie den Zustand berühren —
dieselbe Regel wie bei jeder Provider-Antwort. Ein unbekannter Ereignistyp
wird übersprungen, nicht geworfen: Ein späterer Server, der ein Ereignis mehr
sendet, darf eine ältere Oberfläche nicht zum Absturz bringen.

Der Strom kann außerdem zwei Ereignisse senden, die nicht aus dem Loop stammen
und deshalb nicht in `AgentEvent` stehen: `quota_exceeded` und `stream_error`.
Beide gehören ins Schema der Oberfläche.

## Zustand während eines Laufs

Ein Lauf verändert vier Dinge:

- den Text der laufenden Antwort (`text_delta`, angehängt),
- die Liste der Werkzeugaufrufe (`tool_started` → `tool_finished`),
- den Entwurf (`draft_updated`, ersetzt),
- den Abschluss (`finished`, mit Abbruchgrund).

Nach `finished` wird der Verlauf **nicht** neu geladen. Die Nachricht steht
bereits vollständig auf dem Bildschirm; ein Nachladen würde sie nur ersetzen
und dabei flackern. Neu geladen wird erst beim Seitenwechsel.

## Abbruchgründe sind sichtbar

`stopReasonMessage()` liefert zu jedem Grund außer `completed` einen Satz für
die reisende Person. Er wird unter der Antwort angezeigt, nicht als Fehler,
sondern als Hinweis — der Lauf hat ja ein Ergebnis geliefert.

## Kein Schlüssel, keine Sackgasse

Ohne `GEMINI_API_KEY` läuft der regelbasierte Extraktor. Die Oberfläche sagt
das offen: Ein Hinweis nennt den aktiven Modus. Sonst wirkt die Demo kaputt,
wo sie nur sparsam ist.

## Was diese Etappe entfernt

`/debug/search` war ein Schaufenster für Etappe 2 und ist mit dem Chat
überflüssig. Es verschwindet samt Server-Aktion — eine Seite, die niemand mehr
benutzt, ist kein Denkmal, sondern Ballast.
