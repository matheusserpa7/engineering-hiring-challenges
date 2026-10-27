# Tasks 011 — Visual refresh

Flow per task: test first (see it fail) → change → lint, format, typecheck, test, plus the e2e
spec the task touches against a rebuilt stack → review → fix → one spec update → tick here →
diff summary, decisions, commit message → Matheus says go → commit. `Refs: spec-011/Tn` last.

**Review rule.** `code-reviewer` is required for T9 (refund flow, focus behaviour, test shim).
Every other task is self-review against the docs/07 table, **unless its diff touches a
`<script>` block beyond T4's `avatarInitial` or changes a test assertion**: then reviewer too.

**Budget: about 8 h.** Lean path, about 5 h: T1, T2, T3, T5, T8, T10, T11.
**Cut order**, first cut first: T4's avatars (the feed ships without them) → T9 (the refund
row stays inline, restyled in T8) → T7 → the trust strip in T3 → T6.
**Never cut:** T1, T2, T3, T5, T10, T11.

- [x] **T1 — Tokens, base styles, self-hosted fonts** (~60 min) · self-review + licence check
  - Files: `apps/web/src/styles/{tokens,base}.css`, `apps/web/src/main.ts`, `apps/web/index.html`,
    `apps/web/package.json`, `package-lock.json`, `apps/web/test/contrast.test.ts`.
  - Test: `contrast.test.ts`, red with the mockup's marigold focus ring and `--line` borders,
    green with `--focus` and `--line-strong` (tech spec §5).
  - Done: OFL 1.1 in each font package; `woff2` in `dist/assets/`; `/` first view ≤ 250 KB of
    fonts (network panel, number in the note); public e2e green with no CSP violation.
  - Commit: `feat(web): add design tokens and self-hosted fonts` · Depends: —
- [x] **T2 — App shell: header, nav, page width** (~25 min) · self-review
  - Files: `apps/web/src/App.vue`, `apps/web/src/router.ts` (drop `meta.wide`), `base.css`.
  - Test: `router.test.ts`, `admin-page.test.ts`, e2e `session` and `public`, unchanged.
  - Commit: `style(web): add the site header and page shell` · Depends: T1
- [x] **T3 — Campaign page: give card, mobile bar, trust strip** (~60 min) · self-review
  - Files: `views/campaign-page.vue`, `components/{campaign-totals,progress-bar}.vue`,
    `e2e/public.spec.ts` (2 new tests).
  - Test: public › "the give card stays in view on desktop", "Donate stays reachable on a
    phone": red today (the link scrolls away), green after. Unit tests unchanged.
  - Done: tech spec §7 rules hold; 375 px and 1280 px checked by eye in both themes.
  - Commit: `style(web): lay out the campaign page around a give card` · Depends: T2
- [x] **T4 — Recent donations with avatars** (~40 min) · self-review
  - Files: `components/donation-list.vue`, `src/format.ts` (`avatarInitial`), `test/format.test.ts`.
  - Test: format › "avatarInitial" (Latin, `अनिशा` → `अ`, a ZWJ emoji whole); red with
    `[...name][0]`. xss e2e and donation-list tests unchanged.
  - Commit: `style(web): show recent donations as a feed` · Depends: T3
- [x] **T5 — Donation form sections and result screens** (~60 min) · self-review
  - Files: `components/{donation-form,donation-result}.vue`.
  - Test: donation-form, donation-result, campaign-page unit tests and e2e `donate` and
    `refund` (both fill the form), unchanged. `<script>` blocks untouched.
  - Done: chips and segmented radios reachable by Tab and arrows; 375 px by eye.
  - Commit: `style(web): split the donation form into sections` · Depends: T1
- [x] **T6 — Login card and not-found page** (~20 min) · self-review
  - Files: `views/{login-page,not-found-page}.vue`. Test: login-page, router, campaign-page
    (not found) and e2e `session`, unchanged.
  - Commit: `style(web): restyle sign-in and not-found` · Depends: T2
- [x] **T7 — My donations rows** (~35 min) · self-review
  - Files: `views/my-donations-page.vue`. Test: my-donations unit tests unchanged.
  - Done: grid rows ≥ 760 px, stacked below; status pill; no new `a[href="/"]`.
  - Commit: `style(web): show a donor's gifts as aligned rows` · Depends: T2
- [x] **T8 — Admin toolbar, table and pager** (~40 min) · self-review
  - Files: `views/admin-page.vue`, `components/admin-donation-table.vue` (styles only).
  - Test: admin-page unit tests, e2e `refund` and `xss`, unchanged.
  - Commit: `style(web): give the admin list a toolbar and status pills` · Depends: T2
- [x] **T9 — Refund confirmation as a modal dialog** (~60 min) · **reviewer: yes**
  - Files: `components/{refund-form,admin-donation-table}.vue`, `views/admin-page.vue`,
    `apps/web/test/setup.ts`, `apps/web/vite.config.ts` (`setupFiles`),
    `test/admin-page.test.ts` (3 cases, 1 title), `e2e/refund.spec.ts` (1 test, 1 line).
  - Test: admin-page › "opens a labelled refund dialog", "Escape does not close a refund in
    flight", "focus moves to the notice after a refund"; refund › "the refund dialog keeps and
    returns focus". Red: drop the `cancel` handler, drop the `busy` check, drop the notice focus.
  - Done: every existing refund assertion unchanged and green; tech spec §6 holds line by line.
  - Commit: `feat(web): confirm refunds in a modal dialog` · Depends: T8
- [x] **T10 — Layout e2e on the signed-in pages** (~30 min) · self-review
  - Files: `e2e/layout.spec.ts`, `e2e/fixtures.ts` (`DONOR`, from `apps/api/README.md`).
  - Test: layout › "signed-in pages fit a phone"; red with a 400 px `min-width` on the admin
    toolbar, reverted. Five Chromium sign-ins per run, under `LOGIN_RATE_LIMIT`.
  - Commit: `test(e2e): check the signed-in pages at 375 px` · Depends: T2; after T6–T8 that ship
- [x] **T11 — Re-run everything and close** (~45 min) · `qa-verifier`
  - Files: `docs/specs/006-hardening-and-submission/checklist.md` (re-run evidence),
    `README.md` (Decisions: fonts and CSP, dark mode follows the OS; Known issue V4c if Q3 keeps
    it), `AI-USAGE.md` (the mockup and this spec), `interview-questions.md` (re-check `file:line`
    pointers into files this spec moved), `docs/PROGRESS.md`.
  - Done: clean `docker compose up --build`; full e2e on both browsers; `qa-verifier` passes
    every CHECKLIST item; no hex colour left in `apps/web/src/**/*.vue` (grep); keyboard and
    reduced-motion pass by hand; PROGRESS says "record the video" again.
  - Commit: `docs: record the visual refresh` · Depends: T1–T10

## Dependencies

T1 → T2 → {T3 → T4, T6, T7, T8 → T9, T10}; T1 → T5; every shipped task → T11.

## Optional (only with time left)

Hero illustration (static SVG, `aria-hidden`) · skeleton blocks in the loading state (text
stays) · axe run in T10 with the result in the README (Q6).

## Notes recorded during execution

- Tests bite: `contrast.test` is red with the mockup's focus and border values (4 failures); `format › avatarInitial` was red before the function existed; the dialog guards (the `busy` check, `preventDefault`, reopen on `close`) each turn the admin test red when removed. The two new public e2e tests and `layout.spec` were not made red first.
- Review (T9, `code-reviewer`): no blockers. Fixed the stuck dialog after a second Escape, asserted `defaultPrevented`, added `aria-describedby`, `rgba(…)`; spec text corrected. The Refund button stays mounted while its dialog is open so focus can return.
- Fonts: the first view of `/` downloads 61.5 KB of woff2 (Figtree and Bricolage, Latin subsets); Devanagari adds one 121 KB file only when a Devanagari glyph shows. Under the 250 KB budget, CSP unchanged, no violation in e2e.
- Accepted: progress fill 2.0:1 (Q3); the mobile bar shows no total (e2e matches it once); Safari and Firefox on macOS may not return focus after Cancel (e2e is Chromium only).
- QA re-run (qa-verifier, clean build 28 s): e2e 18 passed, 4 skipped (WebKit Secure cookie); CHECKLIST items pass. It found the admin Refund button wrapping at about 1000 px; fixed with nowrap on .btn and the receipt cell.
