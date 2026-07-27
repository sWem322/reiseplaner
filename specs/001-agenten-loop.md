# Spec 001 — Agenten-Loop

**Status:** geplant
**Etappe:** 3

## Ziel

Ein iterativer Orchestrierungs-Loop, der dem Sprachmodell überlässt, wie viele
Schritte zur Beantwortung einer Reiseanfrage nötig sind. Das Modell entscheidet
je Iteration, ob es antwortet oder Werkzeuge aufruft; der Loop führt die
Werkzeuge aus, gibt die Ergebnisse zurück und wiederholt, bis eine Antwort
vorliegt oder eine Obergrenze greift.

## Warum ein Loop und keine feste Kette

Die Zahl der Schritte ist vorab unbekannt. „Mallorca im September" braucht eine
Zielauflösung und eine Flugsuche; „irgendwo warm im Herbst unter 800 €" braucht
mehrere Zielauflösungen, mehrere Suchen und einen Wettervergleich. Eine feste
Kette müsste den ungünstigsten Fall immer durchlaufen und wäre trotzdem für den
nächsten Anfragetyp falsch geschnitten.

## Vertrag

```
runAgent(input: {
  conversationId: string
  userMessage: string
  llm: LlmPort
  tools: ToolRegistry
  limits: AgentLimits
}) -> AsyncIterable<AgentEvent>
```

### Ereignisse

| Ereignis | Nutzlast |
| --- | --- |
| `text_delta` | Textfragment der Modellantwort |
| `tool_started` | Werkzeugname, validierte Eingabe |
| `tool_finished` | Werkzeugname, Ausgang, Dauer in Millisekunden |
| `draft_updated` | aktueller Reise-Entwurf |
| `finished` | `stopReason`, verbrauchte Tokens, Zahl der Iterationen |

### Abbruchgründe

- `completed` — das Modell hat ohne weiteren Werkzeugaufruf geantwortet
- `max_iterations` — Iterationsobergrenze erreicht
- `max_tool_calls` — Obergrenze der Werkzeugaufrufe erreicht
- `budget_exceeded` — Token-Budget des Dialogs aufgebraucht

Jeder Abbruchgrund erzeugt eine für Menschen verständliche Antwort auf Deutsch.
Ein Abbruch ist kein Fehler, sondern ein Ergebnis.

## Akzeptanzkriterien

1. Ruft das Modell in einer Iteration mehrere Werkzeuge auf, werden diese
   parallel ausgeführt; die Ergebnisse gehen gesammelt in einer Nachricht zurück.
2. Schlägt die Zod-Validierung einer Werkzeugeingabe fehl, geht die
   Fehlermeldung als `tool_result` an das Modell zurück. Der Loop läuft weiter,
   das Modell korrigiert sich in der Folgeiteration.
3. Ein Werkzeug, dessen externer Anbieter nicht erreichbar ist, liefert einen
   `upstream_error` als `tool_result` — der Loop bricht nicht ab.
4. Erreicht der Loop die Iterationsobergrenze, endet er mit
   `stopReason: max_iterations` und einer Antwort, die den Stand zusammenfasst.
5. Überschreitet der Dialog das Token-Budget, endet der Loop mit
   `stopReason: budget_exceeded`, bevor eine weitere Modellanfrage gestellt wird.
6. Jeder Werkzeugaufruf wird mit Name, Eingabe, Ausgang und Dauer protokolliert.
7. Der gesamte Loop ist mit einem skriptgesteuerten Ersatzmodell testbar; kein
   Test in dieser Ebene benötigt einen echten Anbieter.

## Nicht-Ziele

- Keine Bewertung der Antwortqualität — das leistet der Eval-Pfad (Spec 004).
- Keine Nebenläufigkeit über Dialoge hinweg; ein Loop bearbeitet einen Dialog.
- Keine Warteschlange für lange Suchen; im Produktionsbetrieb wäre das der
  nächste Schritt, hier bleibt es bewusst synchron.

## Testplan

| Fall | Ebene | Erwartung |
| --- | --- | --- |
| Antwort ohne Werkzeug | Integration | eine Iteration, `completed` |
| Zwei Werkzeuge parallel | Integration | beide ausgeführt, ein Ergebnisblock |
| Ungültige Werkzeugeingabe | Integration | `validation_error` als `tool_result`, Selbstkorrektur |
| Anbieter nicht erreichbar | Integration | `upstream_error`, Loop läuft weiter |
| Endlosschleife des Modells | Integration | `max_iterations` |
| Budget aufgebraucht | Integration | `budget_exceeded` vor der nächsten Anfrage |
