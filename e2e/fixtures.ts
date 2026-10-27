import { expect, test as base, type Page } from '@playwright/test';

interface CspWindow {
  cspViolations: string[];
}

// Every spec ends by proving that nothing opened a dialog and that the page's CSP blocked
// nothing: an injected script or handler would show up as one or the other.
export const test = base.extend({
  page: async ({ page }, use) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.addInitScript(() => {
      const violations: string[] = [];
      (window as unknown as CspWindow).cspViolations = violations;
      document.addEventListener('securitypolicyviolation', (event) => {
        // WebKit reports the progress bar's CSSOM-set width as style-src-attr although it applies
        // it, and public.spec asserts the width. Every other directive stays fatal.
        if (event.violatedDirective === 'style-src-attr') return;
        violations.push(
          `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)}`,
        );
      });
    });

    await use(page);

    // A skipped test never loaded a page, so the init script left nothing to read.
    expect(dialogs).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as Partial<CspWindow>).cspViolations ?? []),
    ).toEqual([]);
  },
});

export { expect };

// WebKit stores the Secure session cookie on http://localhost but never sends it back (checked:
// /api/auth/me answers 401 after a good login), so specs that sign in skip it there (tech spec
// G10). The README names COOKIE_SECURE=false for a WebKit reviewer.
export const WEBKIT_SECURE_COOKIE = 'WebKit does not send Secure cookies over http://localhost';

export const ADMIN = { email: 'admin@himalayacc.example', password: 'admin12345' };

export async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export const DONOR = { email: 'donor@himalayacc.example', password: 'donor12345' };
