import { expect, test as base } from '@playwright/test';

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

    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as CspWindow).cspViolations)).toEqual([]);
  },
});

export { expect };
