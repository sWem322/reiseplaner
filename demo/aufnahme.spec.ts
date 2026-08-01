import { expect, test } from '@playwright/test';

/**
 * Die Aufnahme für das GIF im README.
 *
 * Kein Test, sondern eine Vorführung — deshalb steht sie neben `tests/e2e`
 * und nicht darin: Sie darf niemals in CI laufen. Eine Aufnahme, die den Lauf
 * rot färbt, weil das Modell heute einen Satz anders formuliert, wäre eine
 * Fehlerquelle ohne Nutzen.
 *
 * Sie prüft trotzdem etwas, und zwar das Einzige, was für ein GIF zählt: dass
 * am Ende Angebotskarten dastehen. Ein GIF, das eine leere Seite zeigt, merkt
 * man sonst erst nach der Umwandlung.
 *
 *   npm run demo:record
 *
 * Getippt wird buchstabenweise. Ein Satz, der auf einmal im Feld erscheint,
 * sieht nach Automat aus; das GIF soll aussehen wie eine Benutzung.
 */

/** Ein Satz, der alles enthält — sonst passen zwanzig Sekunden nicht. */
const ANFRAGE =
  'Ich möchte am 08.10.2026 von Düsseldorf nach Mallorca fliegen, eine Woche, zu zweit.';

test('Reise planen — Aufnahme für das GIF', async ({ page }) => {
  await page.goto('/');

  // Kurz stehen lassen: Das GIF beginnt sonst mitten in der Bewegung.
  await page.waitForTimeout(1_200);

  await page.getByRole('button', { name: /Als Gast starten/i }).click();
  await expect(page.getByRole('textbox', { name: /Nachricht/i })).toBeVisible();
  await page.waitForTimeout(800);

  await page.getByRole('textbox', { name: /Nachricht/i }).pressSequentially(ANFRAGE, { delay: 45 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Senden/i }).click();

  /*
   * Jetzt arbeitet der Agent: Ziel auflösen, Flüge suchen, antworten. Genau
   * das soll man sehen — die Werkzeugzeile, den Entwurf, der sich füllt, und
   * den Text, der einläuft.
   */
  await expect(page.getByTestId('flight-card').first()).toBeVisible({ timeout: 90_000 });

  // Die fertige Antwort noch einen Moment stehen lassen.
  await page.waitForTimeout(2_500);
});
