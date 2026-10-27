import { expect, test } from './fixtures';

test('a session cookie the server never issued does not sign anyone in', async ({
  page,
  context,
}) => {
  // 43 base64url characters: the shape of a real token, so only the server's lookup refuses it.
  const forged = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await context.addCookies([
    { name: 'aangan_session', value: forged, domain: 'localhost', path: '/' },
  ]);

  await page.goto('/me');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
