# Spec 002 — Abhängigkeiten und Sicherheitsmeldungen

**Status:** umgesetzt
**Etappe:** 0

## Ziel

Ein nachvollziehbarer Umgang mit `npm audit`. Weder blindes Ignorieren noch
blindes `npm audit fix --force` — beides ist im Bewerbungskontext ein
Warnsignal. Stattdessen: einordnen, gezielt beheben, Rest begründet stehen
lassen.

## Ausgangslage

`npm audit` meldete 16 Befunde (4 moderate, 12 high). `npm audit fix --force`
hätte Next.js auf 9.3.3 zurückgesetzt und drizzle-kit auf 0.18.1 — ein Downgrade
über mehrere Hauptversionen, der das Projekt zerstört hätte. Die vorgeschlagene
„Lösung" war also gefährlicher als das Problem.

## Vorgehen

### 1. Trennung nach Angriffsfläche

Entscheidend ist nicht der Schweregrad, sondern ob die Abhängigkeit im
ausgelieferten Programm landet:

```bash
npm audit --omit=dev   # was tatsächlich in Produktion läuft
npm audit              # zusätzlich Werkzeuge der Entwicklung
```

Produktionspfad zuerst — dort zählt jeder Befund.

### 2. Produktionsbefunde gezielt beheben

Drei Befunde betrafen `postcss` und `sharp` als transitive Abhängigkeiten von
Next.js 16.2.12. Next liefert die gepatchten Versionen erst in 16.3, das
noch im Preview ist. Statt auf das Release zu warten oder Next zu wechseln,
heben `overrides` die betroffenen Pakete an:

```json
"overrides": {
  "postcss": "8.5.23",
  "sharp": "0.35.3"
}
```

Beides sind Patch- beziehungsweise Minor-Sprünge innerhalb derselben
Hauptversion. Ergebnis: `npm audit --omit=dev` meldet **0 Befunde**,
Build, Typecheck, Lint und Tests bleiben grün.

### 3. Verbleibende Entwicklungsbefunde begründet stehen lassen

| Befund                          | Paket                       | Warum nicht behoben                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brace-expansion` DoS (high)    | transitiv unter ESLint      | Ein Override auf 5.0.8 bricht das ältere `minimatch` (`expand is not a function`) und legt ESLint komplett lahm. Der Angriffsvektor ist eine bösartige Glob-Zeichenkette — die kommt hier aus unserer eigenen Konfiguration. Wird mit dem nächsten ESLint-Release aufgelöst. |
| `esbuild` Dev-Server (moderate) | transitiv unter drizzle-kit | Betrifft den esbuild-Entwicklungsserver, den dieses Projekt nie startet. drizzle-kit nutzt esbuild ausschließlich zum Transpilieren der eigenen Konfigurationsdatei. Die Behebung wäre ein Downgrade von drizzle-kit über 13 Minorversionen.                                 |

Beide laufen ausschließlich auf Entwicklungsrechnern und im CI-Container,
niemals im ausgelieferten Programm.

## Akzeptanzkriterien

1. `npm audit --omit=dev` meldet keine Befunde. ✔
2. `npm run verify` bleibt nach den Overrides grün. ✔
3. `npm run build` erzeugt weiterhin einen funktionierenden Produktionsbuild. ✔
4. Jeder verbleibende Befund ist hier begründet. ✔

## Regel für die Zukunft

- `npm audit fix --force` wird in diesem Projekt nicht ausgeführt.
- Vor jedem Override wird geprüft, ob die angehobene Version noch im selben
  Hauptversionsbereich liegt; danach laufen Lint, Typecheck, Tests und Build.
- Overrides werden entfernt, sobald die Ursprungspakete die gepatchten
  Versionen selbst mitbringen.
