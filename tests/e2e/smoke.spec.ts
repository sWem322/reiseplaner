import { expect, test } from '@playwright/test';

test.describe('Grundgeruest', () => {
  test('die Startseite laedt ohne gesetzte Umgebungsvariablen', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AI-Reiseplaner');
  });

  test('die Seite ist auf Deutsch ausgezeichnet', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
});
