# 008 — Eval

## Warum überhaupt messen

Bis hierher wurde das Verhalten des Assistenten nach Bildschirmfotos
korrigiert: Es fällt etwas auf, eine Regel im Prompt wird geändert, es sieht
besser aus. Ob dabei etwas anderes kaputtgeht, weiß niemand — ein Prompt hat
keine Typen und keinen Compiler.

Ein Eval ist der Ersatz dafür. Zwanzig festgehaltene Gespräche, eine Zahl am
Ende, und die Frage „ist es besser geworden?" wird beantwortbar.

## Was gemessen wird

**Slot-Genauigkeit** ist die Leitzahl: Von den Angaben, die aus dem Gespräch
hervorgehen, wie viele stehen danach richtig im Entwurf?

Sie zählt drei Fälle getrennt, weil sie fachlich verschieden sind:

| Fall         | Bedeutung                                       |
| ------------ | ----------------------------------------------- |
| **richtig**  | erwarteter Wert, tatsächlicher Wert — identisch |
| **falsch**   | ein Wert steht da, aber ein anderer             |
| **erfunden** | ein Wert steht da, obwohl nichts gesagt wurde   |

Der dritte Fall ist der gefährlichste und deshalb eine eigene Zahl. Ein leeres
Feld sieht die reisende Person; ein stillschweigend erfundenes Datum nicht.
Genau das ist in der Abnahme passiert: Aus „im Oktober" wurden der 1. bis 8.
Oktober, ohne dass jemand danach gefragt hätte.

Daneben, als Nebenzahlen:

- **Werkzeugaufrufe je Fall** — steigt die Zahl bei gleicher Genauigkeit, wird
  der Agent geschwätzig, nicht besser.
- **Anteil misslungener Aufrufe** — trennt Fehler des Modells (falsche
  Eingabe) von Ausfällen der Anbieter.
- **Erwartete Rückfrage** — bei Fällen, in denen die richtige Antwort eine
  Frage ist, wird geprüft, ob überhaupt eine kommt und ob sie das fehlende
  Feld betrifft.

## Aufbau eines Falls

```ts
{
  id: 'zeitraum-unklar',
  beschreibung: 'Monat genannt, aber keine Daten',
  nachrichten: ['Ich will im Oktober nach Mallorca, zu zweit'],
  erwartet: {
    destination: 'PMI',
    adults: 2,
    departureDate: null,   // ausdrücklich: darf NICHT gesetzt sein
    returnDate: null,
  },
  erwarteteRueckfrage: 'datum',
}
```

`null` heißt nicht „egal", sondern „muss leer bleiben". Ohne diese
Unterscheidung ließe sich Erfinden nicht messen.

## Zwei Läufe, ein Datensatz

Derselbe Satz läuft gegen den regelbasierten Extraktor und gegen Gemini. Die
Gegenüberstellung beantwortet die Frage, die ein Betrachter zu Recht stellt:
Was trägt das Sprachmodell hier eigentlich bei? Ohne Vergleichslinie ist jede
Zahl bedeutungslos.

Der regelbasierte Lauf ist kostenlos und deterministisch, der Gemini-Lauf
verbraucht Kontingent. Deshalb schreibt der Runner sein Ergebnis nach
`eval/ergebnisse/` — der Vergleich braucht dann keinen neuen Lauf.

## Was der Datensatz absichtlich enthält

Jeder Fall, der in der Abnahme aufgefallen ist, steht hier als Fall drin —
auch die, die heute noch scheitern:

- ein Land statt einer Stadt („Italien")
- ein Monat ohne Daten („im Oktober")
- eine Frage statt einer Antwort („kannst du die Daten flexibel machen?")
- Kinder, nach denen nie gefragt wurde
- die Bitte, mehrere Zeiträume zu vergleichen

Der letzte Punkt ist heute nicht erfüllt: Der Prompt verbietet dem Agenten,
Daten selbst zu wählen — und damit auch, zwei Zeiträume zu prüfen und
gegenüberzustellen. Die Regel entstand gegen das Erfinden und trifft dabei das
Mitdenken. Der Datensatz beschreibt deshalb das gewünschte Verhalten, nicht
das heutige; die roten Fälle sind die Arbeitsliste für die Prompt-Überarbeitung
und der Beleg, dass sie gewirkt hat.
