# Einrichtung auf einem frischen Windows-Rechner

Diese Anleitung führt von einem leeren System bis zum laufenden Projekt.
Alle Schritte sind kostenlos und benötigen keine Kreditkarte.

## 1. Pflicht-Installationen

Alles über `winget` in einer PowerShell (normales Fenster genügt):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Danach **PowerShell schließen und neu öffnen**, damit die Pfade greifen.

Prüfen:

```powershell
node --version   # v24.x.x oder höher
npm --version    # 11.x oder höher
git --version    # 2.x
```

## 2. Optional: Docker Desktop

Nur nötig, wenn PostgreSQL im Container laufen soll. Das Projekt bringt mit
`npm run db:local` eine eingebettete Alternative mit, die ohne Docker auskommt.

```powershell
winget install Docker.DockerDesktop
```

Docker Desktop benötigt WSL 2 und einen Neustart.

## 3. VS Code Erweiterungen

```powershell
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension ms-playwright.playwright
```

## 4. Git-Identität setzen

```powershell
git config --global user.name "Yehor"
git config --global user.email "egormillerfbr@gmail.com"
git config --global init.defaultBranch main
```

Zeilenenden unter Windows — wichtig, damit Prettier und CI nicht streiten:

```powershell
git config --global core.autocrlf input
```

## 5. Projekt starten

```powershell
cd D:\portfolio\reiseplaner

npm install

# Datenbank: eine der beiden Varianten
npm run db:local      # ohne Docker, blockiert das Terminal
npm run db:up         # mit Docker Desktop

# in einem zweiten Terminal
npm run db:migrate
npm run verify
npm run dev
```

Die Anwendung läuft dann auf <http://localhost:3000>.

## 6. Playwright-Browser

Einmalig, für die End-to-End-Tests:

```powershell
npx playwright install chromium
npm run test:e2e
```

## 7. GitHub-Repository verbinden

Das lokale Repository existiert bereits samt Historie — `git init` ist **nicht**
nötig. Es fehlt nur die Gegenstelle.

1. Auf <https://github.com/new> ein **leeres** Repository anlegen:
   Name `ai-reiseplaner`, öffentlich, **ohne** README, `.gitignore` oder Lizenz.
2. Dann:

```powershell
cd D:\portfolio\reiseplaner
git remote add origin https://github.com/DEIN-NAME/ai-reiseplaner.git
git push -u origin main
```

Beim ersten Push öffnet sich ein Browser-Fenster zur Anmeldung bei GitHub.

3. In `README.md` den Platzhalter `USER` in der Badge-Zeile durch den eigenen
   GitHub-Namen ersetzen.

## Fehlerbehebung

**`npm : Die Datei ... kann nicht geladen werden`** — die
Ausführungsrichtlinie blockiert Skripte:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**`npm run db:local` schlägt fehl** — das eingebettete PostgreSQL lädt beim
ersten Start Binärdateien nach. Firewall oder Virenscanner können das
blockieren; in dem Fall auf Docker ausweichen.

**Port 5432 belegt** — eine andere PostgreSQL-Installation läuft bereits. Dann
entweder diese beenden oder in `.env` einen anderen Port eintragen.
