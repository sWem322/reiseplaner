# Spec 005 — API-Schicht und Authentifizierung

**Status:** in Umsetzung
**Etappe:** 4

## Ziel

Zwischen Oberfläche und Agent liegt genau eine Schicht: tRPC für alles, was
angefragt und verändert wird, und ein eigener SSE-Pfad für den Ereignisstrom
des Agenten. Beide teilen sich Kontext, Sitzung und Guardrails.

Dazu kommt eine Anmeldung, die niemanden aussperrt: Wer nur schauen will,
klickt „Als Gast fortfahren"; wer seine Reisen wiederfinden möchte, legt ein
Konto an.

## Warum tRPC und SSE getrennt

tRPC beherrscht seit Version 11 auch Abonnements über SSE. Trotzdem läuft der
Agentenstrom hier über einen eigenen Route-Handler:

- Der Strom ist kein Datenabruf, sondern ein Vorgang mit Nebenwirkungen —
  Nachrichten werden gespeichert, Werkzeuge ausgeführt, Tokens verbraucht.
- Ein eigener Handler lässt sich unabhängig von der tRPC-Version auf jeder
  Plattform betreiben; tRPC-Abonnements sind auf serverlosen Umgebungen
  empfindlich gegenüber Zeitlimits.
- Die Ereignisse sind trotzdem typsicher: Sie stammen aus demselben
  `AgentEvent`-Typ, den auch der Loop verwendet, und werden mit Zod validiert.

Alles andere — Dialoge anlegen, Verlauf lesen, Entwurf abfragen — geht über
tRPC und ist damit von der Eingabe bis zur Anzeige typgeprüft.

## Vertrag

### tRPC-Prozeduren

| Prozedur               | Art      | Beschreibung                                   |
| ---------------------- | -------- | ---------------------------------------------- |
| `conversation.create`  | mutation | Legt Dialog und leeren Entwurf an              |
| `conversation.list`    | query    | Reisen der angemeldeten Person, neueste zuerst |
| `conversation.byId`    | query    | Dialog mit Verlauf und Entwurf                 |
| `conversation.remove`  | mutation | Löscht Dialog samt Verlauf                     |
| `draft.byConversation` | query    | Aktueller Reise-Entwurf                        |
| `draft.update`         | mutation | Feldweise Änderung durch die Oberfläche        |
| `usage.remaining`      | query    | Verbleibendes Kontingent der Sitzung           |

### SSE-Pfad

```
POST /api/agent/stream
  { conversationId: string, message: string }
  → text/event-stream mit AgentEvent-Daten
```

Jedes Ereignis geht als `data:`-Zeile mit JSON-Nutzlast. Der Strom endet nach
`finished`.

## Authentifizierung

Auth.js v5 mit zwei Wegen:

1. **Zugangsdaten** — E-Mail und Passwort, Argon2id gehasht. Bewusst kein
   OAuth: Ein Anmeldedienst würde Schlüssel voraussetzen, und das Projekt soll
   ohne fremde Zugangsdaten laufen.
2. **Gastzugang** — ein Klick, anonymes Konto, Sitzung im Cookie. Ohne diesen
   Weg müsste sich eine Person, die das Projekt nur ansehen will, erst
   registrieren; die Hälfte würde das nicht tun.

Sitzungen liegen in der Datenbank, nicht im JWT: Ein Gastkonto ohne Passwort
muss sich serverseitig widerrufen lassen.

### Kontingent

Gäste haben ein Tageskontingent an Nachrichten (`GUEST_DAILY_MESSAGE_LIMIT`,
Standard 20). Es ist Teil der Guardrails, nicht ein separater Mechanismus: Ein
öffentliches Demo mit dem Schlüssel des Autors ist sonst eine offene Rechnung.
Ist das Kontingent erschöpft, antwortet der Agent regelbasiert weiter — die
Demo bleibt bedienbar, nur ohne Sprachmodell.

## Verdichtung der Historie

Wächst ein Dialog, wird der Anfang zusammengefasst statt abgeschnitten:

1. Übersteigt der Verlauf eine Schwelle, werden die ältesten Nachrichten dem
   `LlmPort` zur Zusammenfassung gegeben.
2. Die Zusammenfassung landet in `conversation.summary`, die Grenze in
   `summarizedUntilSeq`.
3. Folgeanfragen bekommen die Zusammenfassung plus die Nachrichten danach.

Warum nicht abschneiden: Die Reisewünsche werden meist zu Beginn genannt.
Wer die ersten Nachrichten wegwirft, verliert genau die Angaben, um die es
geht.

Ohne Sprachmodell entsteht die Zusammenfassung deterministisch aus dem
Reise-Entwurf — er enthält ohnehin alles fachlich Wesentliche.

## Akzeptanzkriterien

1. Ein neuer Besucher kann ohne Registrierung ein Gespräch beginnen.
2. Registrierung mit E-Mail und Passwort funktioniert; das Passwort wird nur
   als Argon2id-Hash gespeichert.
3. Eine angemeldete Person sieht ausschließlich ihre eigenen Dialoge.
4. Ein Zugriff auf einen fremden Dialog scheitert mit `unauthorized`.
5. Der SSE-Pfad liefert dieselben Ereignisse, die der Loop erzeugt.
6. Jede Nachricht und jede Modellantwort wird mit ihren Inhaltsblöcken
   gespeichert.
7. Ist das Gastkontingent erschöpft, läuft der Dialog regelbasiert weiter.
8. Überschreitet der Verlauf die Schwelle, wird verdichtet statt abgeschnitten.
9. Alle Prozeduren sind gegen eine echte Datenbank getestet.

## Nicht-Ziele

- Kein Passwort-Zurücksetzen, keine E-Mail-Bestätigung (kein Mailversand ohne
  fremde Zugangsdaten).
- Keine Rollen und Rechte über „eigener Dialog oder nicht" hinaus.
- Keine Mehrfachanmeldung, kein OAuth.
