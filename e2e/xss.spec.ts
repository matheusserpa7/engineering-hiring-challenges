import { PublicDonationListSchema } from '@aangan/shared';
import { expect, test } from './fixtures';

// Receipts 9 and 10 of the seed (donations.csv). They are older than the latest 20 gifts, so
// the public page never asks for them and the list response is extended with the same strings.
const SCRIPT = '<script>alert(1)</script>';
const IMG = '<img src=x onerror="alert(document.cookie)">';

test('hostile donor text renders as text in the public list', async ({ page }) => {
  await page.route('**/api/campaigns/*/donations?*', async (route) => {
    const list = PublicDonationListSchema.parse(await (await route.fetch()).json());
    const hostile = [SCRIPT, IMG].map((message) => ({
      id: crypto.randomUUID(),
      displayName: 'Seeded XSS',
      amountCents: 2100,
      dedication: null,
      message,
      createdAt: new Date().toISOString(),
    }));
    await route.fulfill({ json: { data: [...hostile, ...list.data] } });
  });

  await page.goto('/');
  await expect(page.getByText(SCRIPT, { exact: true })).toBeVisible();
  await expect(page.getByText(IMG, { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});
