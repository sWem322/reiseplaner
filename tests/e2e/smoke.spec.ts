import { expect, test } from '@playwright/test';

/**
 * Der Einstieg — ohne eine einzige gesetzte Umgebungsvariable.
 *
 * Das ist die Zusage des Projekts: klonen, starten, benutzen. Faellt dieser
 * Test, ist sie gebrochen.
 */
test.describe('Einstieg', () => {
  test('die Startseite lädt ohne gesetzte Umgebungsvariablen', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Als Gast starten' })).toBeVisible();
  });

  test('die Seite ist auf Deutsch ausgezeichnet', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
});
