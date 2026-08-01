/**
 * Wandelt die Aufnahme in ein GIF fuer das README.
 *
 *   npm run demo:record   # nimmt auf  -> demo/aufnahme/**\/video.webm
 *   npm run demo:gif      # wandelt um -> docs/demo.gif
 *
 * Braucht ffmpeg im PATH. Warum nicht in JavaScript? Ein GIF aus einem Video
 * zu erzeugen heisst, eine gemeinsame Farbpalette ueber alle Bilder zu finden;
 * ohne diesen Schritt sieht die Oberflaeche fleckig aus. ffmpeg kann das in
 * zwei Durchlaeufen, und eine eigene Umsetzung waere ein Projekt fuer sich.
 *
 * Die beiden Durchlaeufe:
 *   1. `palettegen` sammelt die 256 Farben, die im Bild wirklich vorkommen.
 *   2. `paletteuse` malt die Bilder mit genau diesen Farben.
 *
 * 12 Bilder je Sekunde reichen fuer eine Oberflaeche, in der sich vor allem
 * Text aendert — und halbieren die Dateigroesse gegenueber 24.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const AUFNAHME = join(process.cwd(), 'demo', 'aufnahme');
const ZIEL = join(process.cwd(), 'docs', 'demo.gif');
const BREITE = 960;
const BILDER_JE_SEKUNDE = 12;

/**
 * Wie viel am Anfang wegfaellt, in Sekunden.
 *
 * Playwright beginnt die Aufnahme mit dem Browserfenster, nicht mit der
 * Seite — die ersten Bilder zeigen deshalb eine weisse Flaeche. In einer
 * Vorschau, die nur das erste Bild anzeigt, sieht das GIF damit leer aus.
 */
const VORLAUF_SEKUNDEN = 1.2;

const video = await juengstesVideo(AUFNAHME);

if (video === null) {
  console.error('Keine Aufnahme gefunden. Erst `npm run demo:record` ausführen.');
  process.exit(1);
}

console.log(`Aufnahme: ${video}`);

await mkdir(dirname(ZIEL), { recursive: true });

const filter =
  `fps=${String(BILDER_JE_SEKUNDE)},scale=${String(BREITE)}:-1:flags=lanczos,` +
  'split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3';

await ffmpeg([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  // `-ss` vor `-i`: So springt ffmpeg gleich an die Stelle, statt den
  // Vorlauf erst zu dekodieren und dann wegzuwerfen.
  '-ss',
  String(VORLAUF_SEKUNDEN),
  '-i',
  video,
  '-filter_complex',
  filter,
  '-loop',
  '0',
  ZIEL,
]);

const groesse = (await stat(ZIEL)).size / 1_048_576;

console.log(`✓ ${ZIEL} — ${groesse.toFixed(1)} MB`);

if (groesse > 10) {
  console.warn('');
  console.warn('Über 10 MB. GitHub zeigt das GIF zwar, laedt es aber traege.');
  console.warn(`Kleiner wird es mit BREITE=720 oder BILDER_JE_SEKUNDE=10 in ${import.meta.url}.`);
}

/** Das zuletzt geschriebene `video.webm` unterhalb eines Ordners. */
async function juengstesVideo(ordner) {
  let bestes = null;

  async function durchsuche(pfad) {
    let eintraege;

    try {
      eintraege = await readdir(pfad, { withFileTypes: true });
    } catch {
      return;
    }

    for (const eintrag of eintraege) {
      const voll = join(pfad, eintrag.name);

      if (eintrag.isDirectory()) {
        await durchsuche(voll);
        continue;
      }

      if (!eintrag.name.endsWith('.webm')) {
        continue;
      }

      const info = await stat(voll);

      if (bestes === null || info.mtimeMs > bestes.zeit) {
        bestes = { pfad: voll, zeit: info.mtimeMs };
      }
    }
  }

  await durchsuche(ordner);

  return bestes?.pfad ?? null;
}

/**
 * Wo liegt ffmpeg?
 *
 * Zwei Wege, weil beide ihre Berechtigung haben: Wer es ohnehin installiert
 * hat, soll nichts weiter tun; wer es nicht hat, soll nicht erst eine
 * Systeminstallation und ein neues Terminal brauchen, um ein GIF zu erzeugen.
 * `ffmpeg-static` bringt eine passende Binärdatei als Paket mit.
 */
async function findeFfmpeg() {
  try {
    const paket = await import('ffmpeg-static');
    const pfad = paket.default;

    if (typeof pfad === 'string' && pfad.length > 0) {
      return pfad;
    }
  } catch {
    // Paket nicht installiert — dann eben das aus dem PATH.
  }

  return 'ffmpeg';
}

async function ffmpeg(argumente) {
  const befehl = await findeFfmpeg();

  return new Promise((resolve, reject) => {
    const lauf = spawn(befehl, argumente, { stdio: ['ignore', 'ignore', 'inherit'] });

    lauf.on('error', () => {
      reject(
        new Error(
          [
            'ffmpeg wurde nicht gefunden. Zwei Wege:',
            '',
            '  npm i -D ffmpeg-static      — Binärdatei als Paket, kein neues Terminal nötig',
            '  winget install Gyan.FFmpeg  — systemweit, danach ein neues Terminal öffnen',
          ].join('\n'),
        ),
      );
    });

    lauf.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg endete mit Code ${String(code)}`));
      }
    });
  });
}
