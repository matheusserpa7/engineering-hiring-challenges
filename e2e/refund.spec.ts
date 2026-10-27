import { PublicCampaignSchema } from '@aangan/shared';
import { ADMIN, WEBKIT_SECURE_COOKIE, expect, signIn, test } from './fixtures';

test('an admin refunds a gift and the total returns', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.fixme(browserName === 'webkit', WEBKIT_SECURE_COOKIE);
  const raised = async () =>
    PublicCampaignSchema.parse(await (await request.get('/api/campaigns/aangan-courtyard')).json())
      .raisedCents;
  const before = await raised();
  // A hostile name: it must read as text in the public list and in the admin table.
  const name = `<img src=x onerror=alert(1)> E2E ${testInfo.project.name} ${String(Date.now())}`;

  await page.goto('/');
  await page.getByLabel('$21.00').check();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill('e2e-refund@example.com');
  await page.getByRole('button', { name: 'Donate' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you for your gift' })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await raised()).toBe(before + 2100);

  await signIn(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Donations' })).toBeVisible();
  await page.getByLabel('Search by name or email').fill(name);
  await page.getByRole('button', { name: 'Search' }).click();
  const row = page.getByRole('row', { name: new RegExp('E2E ' + testInfo.project.name) });
  await expect(row).toContainText(name);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  await row.getByRole('button', { name: 'Refund' }).click();
  await page.getByLabel('Reason for the refund').fill('E2E cleanup');
  await page.getByRole('button', { name: 'Confirm refund' }).click();
  await expect(row).toContainText('Refunded');
  expect(await raised()).toBe(before);

  await page.goto('/');
  await expect(page.getByText(name)).toHaveCount(0);
});

test('the refund dialog keeps and returns focus', async ({ page, browserName }) => {
  test.fixme(
    browserName !== 'chromium',
    'showModal focus is only proven on Chromium (tech spec G10)',
  );
  await signIn(page, ADMIN);
  const opener = page.getByRole('button', { name: 'Refund' }).first();
  await opener.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Reason for the refund')).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    // Past the last control, Tab leaves for the browser's own UI (focus reads as body), and never
    // lands on the inert page behind the dialog.
    expect(
      await dialog.evaluate(
        (el) => el.contains(document.activeElement) || document.activeElement === document.body,
      ),
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
