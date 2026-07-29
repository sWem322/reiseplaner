/**
 * Der vollstaendige Ablauf ohne Browser.
 *
 * Playwright braucht einen Browser, und den gibt es nicht in jeder Umgebung —
 * in der Entwicklungs-Sandbox dieses Projekts etwa sperrt die Netzfreigabe den
 * Download. Dieses Skript prueft deshalb dieselbe Kette eine Ebene tiefer:
 * Gastzugang, Dialog anlegen, Nachricht senden, Ereignisstrom lesen.
 *
 * Es ersetzt den E2E-Lauf nicht — es faengt nur die Fehler ab, die man sonst
 * erst im Browser sieht.
 *
 *   node scripts/flow-check.mjs            (gegen einen laufenden Server)
 *   BASE_URL=http://127.0.0.1:3000 node scripts/flow-check.mjs
 */

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const NACHRICHT =
  'Ich möchte am 2026-10-08 von Düsseldorf nach Mallorca fliegen, eine Woche, zu zweit.';

function fehler(text) {
  console.error(`✗ ${text}`);
  process.exitCode = 1;
}

async function main() {
  // --- Gastzugang ------------------------------------------------------
  const gast = await fetch(`${BASE_URL}/api/auth/guest`, { method: 'POST' });

  if (!gast.ok) {
    fehler(`Gastzugang: Status ${String(gast.status)}`);
    return;
  }

  const cookie = (gast.headers.get('set-cookie') ?? '').split(';')[0];

  if (cookie === '') {
    fehler('Der Gastzugang hat kein Sitzungscookie gesetzt.');
    return;
  }

  console.log('✓ Gastzugang steht');

  // --- Dialog anlegen (tRPC, wie der Browser) --------------------------
  const angelegt = await fetch(`${BASE_URL}/api/trpc/conversation.create?batch=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ 0: { json: null } }),
  });

  const angelegtJson = await angelegt.json();
  const conversationId = angelegtJson?.[0]?.result?.data?.json?.id;

  if (typeof conversationId !== 'string') {
    fehler(`Dialog anlegen: ${JSON.stringify(angelegtJson).slice(0, 300)}`);
    return;
  }

  console.log(`✓ Dialog angelegt (${conversationId.slice(0, 8)}…)`);

  // --- Nachricht und Ereignisstrom -------------------------------------
  const lauf = await fetch(`${BASE_URL}/api/agent/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, message: NACHRICHT }),
  });

  if (!lauf.ok || lauf.body === null) {
    fehler(`Ereignisstrom: Status ${String(lauf.status)}`);
    return;
  }

  const ereignisse = [];
  const decoder = new TextDecoder();
  let puffer = '';

  for await (const stueck of lauf.body) {
    puffer += decoder.decode(stueck, { stream: true });

    let grenze = puffer.indexOf('\n\n');

    while (grenze !== -1) {
      const zeile = puffer.slice(0, grenze);
      puffer = puffer.slice(grenze + 2);
      grenze = puffer.indexOf('\n\n');

      if (zeile.startsWith('data: ')) {
        ereignisse.push(JSON.parse(zeile.slice(6)));
      }
    }
  }

  const werkzeuge = ereignisse.filter((e) => e.type === 'tool_finished');
  const fluege = werkzeuge.find((e) => e.toolName === 'search_flights');
  const entwurf = ereignisse.filter((e) => e.type === 'draft_updated').at(-1);
  const ende = ereignisse.find((e) => e.type === 'finished');

  console.log(`✓ ${String(ereignisse.length)} Ereignisse gelesen`);
  console.log(
    `  Werkzeuge: ${werkzeuge.map((e) => `${e.toolName}=${e.outcome}`).join(', ') || 'keine'}`,
  );

  if (fluege === undefined) {
    fehler('Es wurde nie nach Flügen gesucht.');
  } else if (fluege.content?.offers?.length > 0) {
    console.log(`✓ ${String(fluege.content.offers.length)} Flugangebote im Strom`);
  } else {
    fehler('Die Flugsuche lief, lieferte aber keine Angebote im Ereignis.');
  }

  if (entwurf === undefined) {
    fehler('Der Entwurf wurde nie aktualisiert.');
  } else {
    const d = entwurf.draft;
    const fehlend = ['destination', 'origin', 'departureDate', 'returnDate', 'adults'].filter(
      (feld) => d[feld] === null,
    );

    if (fehlend.length === 0) {
      console.log('✓ Entwurf vollständig');
    } else {
      fehler(`Im Entwurf fehlen: ${fehlend.join(', ')}`);
    }
  }

  console.log(`✓ Abbruchgrund: ${ende?.stopReason ?? 'keiner'}`);

  // --- Gespeicherter Verlauf -------------------------------------------
  const geladen = await fetch(
    `${BASE_URL}/api/trpc/conversation.byId?batch=1&input=${encodeURIComponent(
      JSON.stringify({ 0: { json: { conversationId } } }),
    )}`,
    { headers: { cookie } },
  );

  const geladenJson = await geladen.json();
  const nachrichten = geladenJson?.[0]?.result?.data?.json?.messages ?? [];
  const bloecke = nachrichten.flatMap((n) => n.blocks ?? []);

  const aufrufe = bloecke.filter((b) => b.type === 'tool_use').map((b) => b.toolCallId);
  const ergebnisse = bloecke.filter((b) => b.type === 'tool_result').map((b) => b.toolCallId);
  const offen = aufrufe.filter((id) => !ergebnisse.includes(id));

  console.log(
    `✓ ${String(nachrichten.length)} Nachrichten gespeichert, ${String(aufrufe.length)} Werkzeugaufrufe`,
  );

  if (offen.length > 0) {
    fehler(`Werkzeugaufrufe ohne Ergebnis im Verlauf: ${offen.join(', ')}`);
  }

  if (process.exitCode === undefined || process.exitCode === 0) {
    console.log('');
    console.log('Der vollständige Ablauf funktioniert.');
  }
}

await main();
