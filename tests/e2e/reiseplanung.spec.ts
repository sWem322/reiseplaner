import { expect, test, type Page } from '@playwright/test';

/**
 * Der vollstaendige Ablauf, so wie eine reisende Person ihn erlebt:
 * Gastzugang, neue Reise, eine Nachricht — und danach ein gefuellter Entwurf
 * mit Angeboten.
 *
 * Ohne Schluessel laeuft der regelbasierte Extraktor und ohne Netz-Anbieter
 * die Seed-Daten. Beides ist deterministisch, deshalb prueft dieser Test
 * tatsaechlich den Ablauf und nicht die Tagesform eines Fremddienstes.
 */

/** Eine Nachricht, aus der der Extraktor alle Pflichtangaben lesen kann. */
const ANFRAGE =
  'Ich möchte am 2026-10-08 von Düsseldorf nach Mallorca fliegen, eine Woche, zu zweit.';

async function starteReise(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast starten' }).click();

  await expect(page.getByRole('heading', { name: 'Deine Reisen' })).toBeVisible();

  await page.getByTestId('new-trip').click();
  await expect(page).toHaveURL(/\/reise\/[0-9a-f-]{36}$/);
}

async function sende(page: Page, text: string): Promise<void> {
  await page.getByLabel('Nachricht').fill(text);
  await page.getByRole('button', { name: 'Senden' }).click();
}

test.describe('Reise planen', () => {
  test('vom Gastzugang bis zu den Angeboten', async ({ page }) => {
    await starteReise(page);

    // Vor der ersten Nachricht ist der Entwurf leer.
    await expect(page.getByTestId('draft-progress')).toHaveText('0/5');

    await sende(page, ANFRAGE);

    // Der Agent arbeitet: Werkzeuge laufen sichtbar mit.
    await expect(page.getByTestId('tool-activity').first()).toBeVisible();

    // Ergebnis: Flugkarten, nicht nur Text.
    await expect(page.getByTestId('flight-card').first()).toBeVisible({ timeout: 30_000 });

    // Und der Entwurf ist gefuellt — das ist der eigentliche Zweck des Dialogs.
    await expect(page.getByTestId('draft-progress')).toHaveText('5/5');
    await expect(page.getByTestId('draft-row-Ziel')).toHaveAttribute('data-filled', 'true');
    await expect(page.getByTestId('draft-row-Abflug')).toContainText('DUS');
  });

  test('der Verlauf überlebt das Neuladen', async ({ page }) => {
    await starteReise(page);
    await sende(page, ANFRAGE);

    await expect(page.getByTestId('flight-card').first()).toBeVisible({ timeout: 30_000 });

    await page.reload();

    /*
     * Nach dem Neuladen kommt alles aus der Datenbank. Genau hier fiel frueher
     * auf, dass die Werkzeugergebnisse gar nicht gespeichert wurden.
     */
    await expect(page.getByTestId('draft-progress')).toHaveText('5/5');
    await expect(page.getByTestId('flight-card').first()).toBeVisible();
    await expect(page.getByTestId('message').first()).toContainText('Düsseldorf');
  });

  test('die Reise steht in der Liste und lässt sich löschen', async ({ page }) => {
    await starteReise(page);
    await sende(page, ANFRAGE);

    await expect(page.getByTestId('flight-card').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('link', { name: 'Alle Reisen' }).click();
    await expect(page.getByTestId('trip-link')).toHaveCount(1);

    // Zwei Klicks: Der erste fragt nach, der zweite loescht.
    await page.getByTestId('delete-trip').click();
    await page.getByTestId('delete-trip').click();

    await expect(page.getByTestId('trip-link')).toHaveCount(0);
  });

  test('ohne Sitzung führt der Weg zurück zum Einstieg', async ({ page }) => {
    await page.goto('/reise');

    await expect(page.getByRole('button', { name: 'Als Gast starten' })).toBeVisible();
  });
});
