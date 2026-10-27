import { formatCents, PublicCampaignSchema } from '@aangan/shared';
import { expect, test } from './fixtures';

const PHONE = { width: 375, height: 667 };

test('the public page shows the real total and fits a phone', async ({ page, request }) => {
  const response = await request.get('/api/campaigns/aangan-courtyard');
  const campaign = PublicCampaignSchema.parse(await response.json());
  await page.setViewportSize(PHONE);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(formatCents(campaign.raisedCents), { exact: true })).toBeVisible();
  // The bar is drawn with an inline width, which the CSP report filter in fixtures.ts ignores,
  // so the width itself is what proves the browser applied it.
  const [fill, track] = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="progress-fill"]');
    return [
      bar?.getBoundingClientRect().width ?? 0,
      bar?.parentElement?.getBoundingClientRect().width ?? 0,
    ];
  });
  expect(fill / track).toBeCloseTo(campaign.progressPercent / 100, 1);
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await scrollWidth()).toBeLessThanOrEqual(PHONE.width);

  await page.getByRole('main').getByRole('link', { name: 'Donate' }).click();
  await expect(page.getByRole('heading', { name: 'Make a donation' })).toBeVisible();
  expect(await scrollWidth()).toBeLessThanOrEqual(PHONE.width);
});
