import { PublicCampaignSchema } from '@aangan/shared';
import { expect, test } from './fixtures';

test('a donor gives $21 and sees the gift on the page', async ({ page, request }, testInfo) => {
  const raised = async () =>
    PublicCampaignSchema.parse(await (await request.get('/api/campaigns/aangan-courtyard')).json())
      .raisedCents;
  const before = await raised();
  const name = `E2E ${testInfo.project.name} ${String(Date.now())}`;

  await page.goto('/');
  await page.getByLabel('$21.00').check();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Donate' }).click();

  await expect(page.getByRole('heading', { name: 'Thank you for your gift' })).toBeVisible();
  await expect(page.getByText(/^HCC-\d{4}-\d{6,}$/)).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();

  await page.reload();
  await expect(page.getByText(name)).toBeVisible();
  expect(await raised()).toBe(before + 2100);
});
