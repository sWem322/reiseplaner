# Spec 009 — Sprachausgabe der Antworten

**Status:** umgesetzt; der Lauf gegen den echten Dienst steht aus
**Etappe:** 7

## Ziel

Eine Antwort des Assistenten lässt sich anhören statt lesen. Ein Knopf an der
Sprechblase, ein Klick, und der Text kommt als Sprache.

Der Knopf ist der kleinere Teil. Interessant ist, dass ElevenLabs der **fünfte
externe Anbieter** dieses Projekts wird und deshalb dieselbe Form bekommt wie
die vier bestehenden: erst ein Interface in der Domäne, dann ein Adapter, dann
eine Fabrik, die anhand vorhandener Zugangsdaten wählt. Ein Anbieter, der sich
an dieser Stelle nicht einfügt, hätte gezeigt, dass der Schnitt zu eng war.

Ausdrücklich **nicht** Teil dieser Spezifikation ist die Spracheingabe. Wer
seinen Reisewunsch diktieren will, muss weiter tippen — das ist die andere
Richtung, ein anderer Dienst und eine eigene Entscheidung.

## Vertrag

### TextToSpeechPort

```
speak(input: SpeechRequest) -> Promise<Result<SpokenAudio>>

SpeechRequest = { text: string; voiceId?: string }
SpokenAudio   = { data: Uint8Array<ArrayBuffer>; mimeType: string }
```

Wie jeder Port dieses Projekts gibt er `Result` zurück und wirft nie.

Der Typparameter an `Uint8Array` ist kein Zierrat. Seit TypeScript 5.7 ist der
Typ über seinen Puffer generisch, und die Voreinstellung `ArrayBufferLike`
schliesst `SharedArrayBuffer` ein — den nimmt eine `Response` nicht an. Mit dem
blossen `Uint8Array` scheitert also ausgerechnet die Stelle, an der die Bytes
den Server verlassen.

Der Port liefert **fertige Bytes, keinen Strom**. Das ist eine Entscheidung
gegen die naheliegende Alternative, und der Grund ist der Zuschnitt der
Domäne: Ein `ReadableStream` im Rückgabewert wäre Transport, und Transport
gehört nicht in `src/domain/`. Fachlich verliert man dabei wenig — eine Antwort
ergibt wenige Sekunden Ton, und die Wartezeit davor wird ohnehin von der
Erzeugung beim Anbieter bestimmt, nicht von der Übertragung.

## Warum die Sprachausgabe kein Werkzeug des Agenten ist

Der Agent hat sechs Werkzeuge, und das Modell entscheidet selbst, welche es
aufruft. Ein siebtes namens `speak` wäre der falsche Ort — aus zwei Gründen:

1. **Die Entscheidung gehört der reisenden Person, nicht dem Modell.** Ob
   etwas vorgelesen wird, ist eine Frage der Bedienung, keine Frage der
   Reiseplanung.
2. **Ein Werkzeugergebnis geht zurück an das Modell.** Audio kann es nicht
   lesen. Ein Werkzeug, dessen Ergebnis für den Aufrufer wertlos ist, ist
   keines.

Die Sprachausgabe hängt deshalb an der Oberfläche und an einer eigenen Route —
nicht am Loop.

## Fehlerbehandlung

| Situation                                         | `DomainError.kind` |
| ------------------------------------------------- | ------------------ |
| Anbieter antwortet nicht, Zeitüberschreitung, 5xx | `upstream_error`   |
| Anbieter meldet zu viele Anfragen (429)           | `rate_limited`     |
| Schlüssel fehlt oder ist ungültig (401, 403)      | `unauthorized`     |
| Text ist leer oder länger als die Obergrenze      | `validation_error` |
| Antwort ist kein Audio                            | `upstream_error`   |

Dieselbe Tabelle wie in Spec 004, damit im ganzen Projekt dieselben Fehlerarten
auftreten — auch wenn hier kein Loop davon liest.

## Auswahl der Implementierung

| Port               | ohne Schlüssel | mit `ELEVENLABS_API_KEY` |
| ------------------ | -------------- | ------------------------ |
| `TextToSpeechPort` | siehe unten    | ElevenLabs               |

Hier liegt die einzige Stelle, an der dieser Port aus der Reihe fällt, und sie
gehört benannt: **Eine Seed-Implementierung, die spricht, gibt es nicht.**
Deterministische Flugpreise lassen sich ausrechnen, deterministische Sprache
nicht.

Aufgelöst wird das mit zwei verschiedenen Antworten auf zwei verschiedene
Fragen:

- **Für die Tests** gibt es eine In-Memory-Implementierung, die feste Bytes
  zurückgibt. Sie erfüllt AGENTS.md § 2.2 und macht jeden Test dieser Ebene
  netzfrei.
- **Für den Betrieb ohne Schlüssel** spricht der Browser selbst. `speechSynthesis`
  ist auf allen Zielsystemen vorhanden, kennt deutsche Stimmen und kostet
  nichts. Dieser Weg berührt den Port überhaupt nicht: Er läuft im Browser, es
  gibt keinen Serveraufruf.

Damit bleibt die Regel gewahrt, die dieses Projekt trägt — ohne einen einzigen
Schlüssel ist die Anwendung vollständig bedienbar. Die Oberfläche sagt offen,
welcher der beiden Wege gerade aktiv ist, so wie sie es beim regelbasierten
Extraktor schon tut.

## Der Weg des Tons

1. An jeder Antwort des Assistenten steht ein Knopf „Vorlesen".
2. **Mit Schlüssel:** `POST /api/speech` mit `{ messageId }`. Die Route prüft
   die Sitzung, lädt die Nachricht, prüft an **ihrer** `conversationId`, dass
   das Gespräch der anfragenden Person gehört, liest ihre Textblöcke, ruft den
   Port und antwortet mit `audio/mpeg`. Der Browser spielt es über ein
   `Audio`-Objekt.

   Die Gesprächskennung stand hier zunächst mit im Rumpf und ist wieder
   herausgeflogen: Die Nachricht trägt sie bei sich. Zwei Angaben, die dasselbe
   meinen, können auseinanderlaufen — und dann müsste die Route entscheiden,
   welche gilt. Eine Angabe weniger ist eine Fehlerquelle weniger.

3. **Ohne Schlüssel:** kein Netzaufruf. `window.speechSynthesis` spricht den
   Text, der ohnehin auf dem Bildschirm steht.

### Warum die Route keinen freien Text annimmt

Eine Route, die `{ text }` entgegennimmt, ist ein offener Sprachdienst auf
fremde Rechnung: Wer einen Gastzugang bekommt — und den bekommt jeder mit einem
Klick —, könnte beliebigen Text über den Schlüssel des Autors vertonen lassen.

Mit `messageId` spricht die Route ausschliesslich das, was der Assistent
tatsächlich gesagt hat, und nur in einem Gespräch, das der anfragenden Person
gehört. Die Besitzprüfung ist dieselbe wie im Ereignisstrom
(`repositories.conversations.belongsTo`).

### Was dafür im Ereignisstrom fehlt

Die gerade fertig gewordene Antwort hat im Browser **keine Kennung**.
`run-conversation.ts` speichert die Züge des Assistenten erst, nachdem der
Strom `finished` gemeldet hat und der Generator zurückkehrt — die Oberfläche
erfährt die entstandenen Kennungen also nie.

Ohne Kennung kein Knopf an genau der Antwort, die man gerade bekommen hat, und
das ist der häufigste Fall überhaupt. Deshalb kommt ein Ereignis dazu:

```
MessageSavedEvent = { type: 'message_saved'; messageId: string }
```

Es wird nach dem Speichern je gesicherter Assistenten-Nachricht gesendet.
Die Oberfläche merkt sich die Kennungen des Laufs und hängt den Knopf an die
**letzte** — sie trägt die abschliessende Antwort. Die Zwischentexte („Ich
suche jetzt nach Flügen …") stehen auf dem Bildschirm und müssen nicht gehört
werden.

Das Ereignis gehört in `AgentEvent` in der Domäne und in das Zod-Schema der
Oberfläche. Ein älterer Browser, der es nicht kennt, überspringt es — die Regel
aus Spec 006 gilt unverändert.

## Umgebungsvariablen

| Variable              | Pflicht | Bedeutung                                      |
| --------------------- | ------- | ---------------------------------------------- |
| `ELEVENLABS_API_KEY`  | nein    | Fehlt er, spricht der Browser                  |
| `ELEVENLABS_VOICE_ID` | nein    | Stimme; ohne Angabe die im Adapter hinterlegte |
| `ELEVENLABS_MODEL`    | nein    | Voreinstellung `eleven_multilingual_v2`        |

Alle drei sind optional, wie jede Anbieter-Variable dieses Projekts.

## Warum ein eigener Adapter statt des SDK

`@elevenlabs/elevenlabs-js` bringt `node-fetch@2`, `ws` und `command-exists`
mit. Die drei tragen vor allem den Node-Helfer `play()`, der Ton auf den
Lautsprechern des **Servers** ausgibt — auf einer Serverless-Plattform ist das
sinnlos, hier ausserdem falsch: Der Ton gehört in den Browser der reisenden
Person.

Gebraucht wird ein einziger POST mit dem Kopf `xi-api-key`, der Audiobytes
zurückgibt. Die drei bestehenden HTTP-Adapter sind genau so gebaut und werden
über ein untergeschobenes `fetchImpl` netzfrei getestet.

Gegenprobe: Beim Sprachmodell fiel die Entscheidung umgekehrt aus, und zwar aus
einem konkreten Grund — neue Google-Schlüssel im Format `AQ.` funktionieren mit
einem einfachen `?key=`-Aufruf nicht, das SDK kennt beide Formate. Bei
ElevenLabs gibt es keinen solchen Grund.

`fetchJson` selbst passt nicht: Es liest die Antwort als JSON. Der Adapter
benutzt daher dieselbe Statuszuordnung (`describeStatus`) und liest den Rumpf
als Bytes.

## Akzeptanzkriterien

1. Ohne `ELEVENLABS_API_KEY` startet die Anwendung, und der Knopf „Vorlesen"
   spricht über den Browser-Synthesizer.
2. Mit Schlüssel wählt die Fabrik den ElevenLabs-Adapter und protokolliert das
   wie jeden anderen Adapter.
3. Der Knopf steht an jeder gespeicherten Antwort des Assistenten und an der
   gerade fertig gewordenen.
4. An Nachrichten der reisenden Person steht kein Knopf.
5. Die Route antwortet ohne gültige Sitzung mit 401.
6. Die Route antwortet mit 404, wenn das Gespräch einer anderen Person gehört.
7. Die Route vertont ausschliesslich den Text der genannten Nachricht; ein
   freier Text im Rumpf wird nicht angenommen.
8. Ein Anbieter, der nicht antwortet, führt zu `upstream_error` und einer
   lesbaren Meldung — nicht zu einer geworfenen Ausnahme.
9. Ein 429 des Anbieters führt zu `rate_limited`.
10. Ein ungültiger Schlüssel führt zu `unauthorized`.
11. Ein leerer Text führt zu `validation_error`, ohne dass der Anbieter gerufen
    wird.
12. Der Adapter bricht nach einer festen Zeitspanne ab.
13. Kein Test dieser Ebene benötigt eine Netzwerkverbindung oder einen
    Schlüssel.
14. Ein zweiter Klick während der Wiedergabe stoppt sie, statt eine zweite
    Stimme darüberzulegen.

## Nicht-Ziele

- **Keine Spracheingabe.** Andere Richtung, andere Entscheidung.
- **Kein Streamen des Tons.** Begründet oben.
- **Kein Speichern des Audios auf dem Server.** Weder in der Datenbank noch im
  Dateisystem, und die Antwort trägt `cache-control: no-store`. In einem
  Produktivbetrieb wäre ein Zwischenspeicher je Nachricht der nächste Schritt;
  hier bliebe er unbelegt und unbenutzt. Was der Browser für die geöffnete
  Seite bereits geladen hat, behält er von sich aus — ein zweiter Klick auf
  denselben Knopf spielt es erneut ab, ohne zu fragen.
- **Keine Auswahl der Stimme in der Oberfläche.** Die Stimme steht in der
  Umgebung.
- **Kein Vorlesen der Angebotskarten.** Gesprochen wird Fliesstext, keine
  Tabelle.
- **Kein automatisches Abspielen.** Browser unterbinden Autoplay mit Ton
  ohnehin, und ungefragt zu sprechen ist eine Zumutung.

## Testplan

| Fall                                    | Ebene       | Erwartung                       |
| --------------------------------------- | ----------- | ------------------------------- |
| Adapter, Anbieter liefert Audiobytes    | Unit        | `ok`, Bytes und `audio/mpeg`    |
| Adapter, Anbieter antwortet mit 500     | Unit        | `upstream_error`                |
| Adapter, Anbieter antwortet mit 429     | Unit        | `rate_limited`                  |
| Adapter, Anbieter antwortet mit 401     | Unit        | `unauthorized`                  |
| Adapter, Zeitüberschreitung             | Unit        | `upstream_error`                |
| Adapter, leerer Text                    | Unit        | `validation_error`, kein Aufruf |
| Fabrik ohne Schlüssel                   | Unit        | kein ElevenLabs-Adapter         |
| Fabrik mit Schlüssel                    | Unit        | ElevenLabs-Adapter, `active`    |
| Route ohne Sitzung                      | Integration | 401                             |
| Route auf fremdes Gespräch              | Integration | 404                             |
| Route auf eigene Nachricht              | Integration | 200 und `audio/mpeg`            |
| `message_saved` erreicht die Oberfläche | Unit        | Kennung im Zustand des Laufs    |
