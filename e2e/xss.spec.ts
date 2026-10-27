import { PublicDonationListSchema } from '@aangan/shared';
import { ADMIN, WEBKIT_SECURE_COOKIE, expect, signIn, test } from './fixtures';

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

test('seeded rows render in the admin table without running anything', async ({
  page,
  browserName,
}) => {
  test.fixme(browserName === 'webkit', WEBKIT_SECURE_COOKIE);
  await signIn(page, ADMIN);
  for (const [term, receipt] of [
    ['Magar', 'HCC-2026-000009'],
    ['Tamang', 'HCC-2026-000010'],
  ] as const) {
    await page.getByLabel('Search by name or email').fill(term);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('row', { name: new RegExp(receipt) })).toBeVisible();
  }
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});
