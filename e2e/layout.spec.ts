import { ADMIN, DONOR, WEBKIT_SECURE_COOKIE, expect, signIn, test } from './fixtures';

const PHONE = { width: 375, height: 667 };

const scrollWidth = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth);

test('the sign-in page fits a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await scrollWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

test('signed-in pages fit a phone', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit', WEBKIT_SECURE_COOKIE);
  await page.setViewportSize(PHONE);

  await signIn(page, DONOR);
  await expect(page.getByRole('heading', { name: 'My donations' })).toBeVisible();
  expect(await scrollWidth(page)).toBeLessThanOrEqual(PHONE.width);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Donations' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  expect(await scrollWidth(page)).toBeLessThanOrEqual(PHONE.width);
});
