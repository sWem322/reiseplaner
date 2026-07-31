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
- eine echte Stadt ausserhalb des Angebots („Miami")
- eine halbe Antwort auf eine Doppelfrage

Der Datensatz wächst dadurch mit jeder Abnahme. Das ist beabsichtigt: Ein
Fehler, der einmal aufgetreten ist, hat ab dann einen Wächter.

## Was dabei herauskam

| Lauf                 | Fälle | Slot-Genauigkeit | erfunden | bestanden | Werkzeuge/Fall |
| -------------------- | ----- | ---------------- | -------- | --------- | -------------- |
| regelbasiert         | 20    | 91,8 %           | 2        | 12/20     | 1,1            |
| Gemini, Prompt 1.1.0 | 20    | 96,7 %           | 1        | 16/20     | 3,6            |
| Gemini, Prompt 1.3.0 | 20    | 100 %            | 0        | 20/20     | 4,1            |
| Gemini, Prompt 1.6.0 | 22    | **100 %**        | **0**    | **22/22** | 4,0            |

Der letzte Lauf lief gegen `gemini-flash-lite-latest` — das schwächste Modell
der Kette, weil es das grösste Kontingent hat. 66 von 66 Angaben richtig, bei
zwei Fällen mehr als beim Lauf davor: „Miami" und die halbe Antwort auf eine
Doppelfrage.

Seit diesem Lauf trägt jeder Bericht die Prompt-Fassung, gegen die er gemessen
wurde. Die Zahl allein sagt nichts — sie gehört zu einem Verhalten, und das
Verhalten steht im Prompt.

**1,1 % der Werkzeugaufrufe schlugen fehl, und das ist keine Schwäche.** Es ist
die Selbstkorrektur im Betrieb: Der Agent ruft ein Werkzeug falsch auf, bekommt
den Fehler als `tool_result` zurück und macht es im nächsten Zug richtig. Eine
Quote von 0 % wäre hier eher ein Hinweis darauf, dass die Fälle zu leicht sind.

Der Weg dorthin ist die eigentliche Geschichte:

**Der erste Lauf fand einen Fehler, den drei Wochen Handbetrieb übersehen
hatten.** Auf „Wie ist das Rezept für Tiramisu?" trug der regelbasierte
Extraktor Istanbul in den Entwurf ein — das deutsche „ist" traf den IATA-Code
IST. Dazu zwei weitere: Er schrieb den Entwurf nur ein einziges Mal je
Gespräch, und eine beanstandete Angabe verwarf alle übrigen gleich mit.

**Drei der vier roten Fälle im Gemini-Lauf waren falsche Erwartungen**, nicht
falsches Verhalten. Der Agent fragte nach dem Abflugort, wo der Datensatz nach
dem Datum verlangte — und hielt sich dabei genau an `MISSING_SLOT_ORDER`. Ein
Eval prüft nicht nur den Code; er prüft auch, ob man verstanden hat, was man
wollte.

**Der vierte war echt:** „Ich möchte nach Ulan-Bator fliegen" wurde zu `ULN`
samt ausgedachter Koordinaten, ohne dass ein Werkzeug den Ort je bestätigt
hatte.

**Und der letzte Fall entlarvte eine Regel, die ich selbst geschrieben
hatte.** In Prompt 1.1.0 stand „Du kannst keine flexiblen Zeiträume
vergleichen". Das war schlicht falsch — der Loop darf mehrere Werkzeuge
aufrufen, drei Flugsuchen sind kein Problem. Das Modell hielt sich brav an das
Verbot und antwortete „das kann ich nicht" auf genau die Frage, wegen der
dieses Projekt existiert. Eine Regel, die dem Agenten etwas verbietet, was er
beherrscht, kostet mehr als eine fehlende Regel.

## Eine Regel, die keine Regel bleiben durfte

Der jüngste Fall ist der lehrreichste. Der Assistent fragte „Wann möchten Sie
reisen und für wie viele Personen?", bekam „21. Oktober" — und suchte danach
Flüge für einen Erwachsenen, den nie jemand genannt hatte.

Im Prompt stand seit 1.1.0: „Ohne genannte Reisendenzahl trägst du keine ein."
Die Regel war da, sie war eindeutig, und sie verlor trotzdem. Denn
`search_flights` verlangt `adults` als Pflichtfeld — und ein Pflichtfeld ist
selbst eine Anweisung, nur eine, die näher an der Tat steht. Wer suchen will,
braucht eine Zahl; also entsteht eine.

Die Lehre daraus gilt über diesen Fall hinaus: **Wo Prompt und Signatur
einander widersprechen, gewinnt die Signatur.** Also prüft das Werkzeug jetzt
selbst den Entwurf und weist die Suche ab, solange dort keine Zahl steht. Der
Fehler geht als `tool_result` zurück, das Modell fragt nach und sucht danach
erneut — dieselbe Selbstkorrektur wie bei jedem Anbieterfehler.

Derselbe `?? 1` stand übrigens auch im regelbasierten Extraktor, also in
meinem eigenen Code. Was man dem Modell vorwirft, sollte man zuerst bei sich
suchen.

## Was die Zahlen nicht sagen

Zwei Dutzend Fälle sind keine Statistik. Sie sind ein Netz, das die bekannten
Fehler festhält — mehr nicht und nicht weniger. Ein Wert von 100 % heisst
nicht „fehlerfrei", sondern „keiner der Fehler, die wir kennen, ist
zurückgekommen".
