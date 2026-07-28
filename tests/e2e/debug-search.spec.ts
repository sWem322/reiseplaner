import { expect, test } from '@playwright/test';

/**
 * Prueft den Weg von der Eingabe bis zu den Angebotskarten — ohne Netzwerk,
 * ohne Zugangsdaten. Genau der Pfad, den auch eine fremde Person vorfindet.
 */

test.describe('Schaufenster der Anbieter-Adapter', () => {
  test('zeigt Flug- und Unterkunftsangebote zur Voreinstellung', async ({ page }) => {
    await page.goto('/debug/search');

    await page.getByRole('button', { name: 'Suchen' }).click();

    await expect(page.getByRole('heading', { name: 'Flüge' })).toBeVisible();

    const flightCards = page.locator('section').filter({ hasText: 'Flüge' }).locator('li');
    await expect(flightCards.first()).toBeVisible();
    expect(await flightCards.count()).toBeGreaterThan(0);

    const hotelCards = page.locator('section').filter({ hasText: 'Unterkünfte' }).locator('li');
    await expect(hotelCards.first()).toBeVisible();
  });

  test('meldet einen unbekannten Ort verstaendlich', async ({ page }) => {
    await page.goto('/debug/search');

    await page.locator('input[name="destination"]').fill('Atlantis');
    await page.getByRole('button', { name: 'Suchen' }).click();

    await expect(page.getByText(/Kein Ort/)).toBeVisible();
  });

  test('weist gleichen Abflug- und Zielort zurueck', async ({ page }) => {
    await page.goto('/debug/search');

    await page.locator('input[name="destination"]').fill('Düsseldorf');
    await page.getByRole('button', { name: 'Suchen' }).click();

    await expect(page.getByText(/müssen sich unterscheiden/)).toBeVisible();
  });

  test('liefert bei gleicher Anfrage dieselben Preise', async ({ page }) => {
    await page.goto('/debug/search');
    await page.getByRole('button', { name: 'Suchen' }).click();

    const ersterPreis = page.locator('section').filter({ hasText: 'Flüge' }).locator('li').first();
    await expect(ersterPreis).toBeVisible();
    const ersterText = await ersterPreis.textContent();

    await page.reload();
    await page.getByRole('button', { name: 'Suchen' }).click();

    const zweiterPreis = page.locator('section').filter({ hasText: 'Flüge' }).locator('li').first();
    await expect(zweiterPreis).toBeVisible();

    expect(await zweiterPreis.textContent()).toBe(ersterText);
  });
});
