# Tech spec 011 — Visual refresh

Status: approved 2026-10-27 · PRD: [prd.md](prd.md) · Touches `apps/web` and `e2e` only.

## 1. Approach

Global CSS for what every screen shares, scoped styles for each screen's layout. No CSS
framework, no preprocessor: two plain files and `var()` are enough for 12 components.

- `apps/web/src/styles/tokens.css`: custom properties only. Light on `:root`, dark in
  `@media (prefers-color-scheme: dark) { :root { … } }`, plus `color-scheme: light dark`.
  Names and values from the mockup's `:root`, except V4. No `[data-theme]` override (no toggle).
- `apps/web/src/styles/base.css`: the font imports, box-sizing, body type, headings,
  `:focus-visible`, `.visually-hidden` (today duplicated in two components), `.num`
  (`tabular-nums`), `.mono`, and the shared primitives `.btn` (`.primary`, `.danger`,
  `.ghost`), `.input`, `.field`, `.card`, `.pill[data-status]`, `.alert`, `.eyebrow`. The
  `@media (prefers-reduced-motion: reduce)` rule that zeroes transitions and animations.
- Both are imported once, first, in `main.ts`. Components keep `<style scoped>` for layout and
  read tokens with `var(--…)`; no hex value stays in a `.vue` file (grep in T11).
- `App.vue`'s unscoped `<style>` moves to `base.css`. `main` becomes a 1180 px shell; each view
  sets its own width, so `meta.wide` is removed from `router.ts` and `App.vue`.
- Amounts, percentages and counts get `.num`; receipt numbers get `.mono` (JetBrains Mono).
- No inline `style="…"` in templates and no `:style` beyond the existing progress width:
  WebKit already reports that one as `style-src-attr` (fixtures.ts filter, README Known issue).

**Fonts (V3).** `@fontsource-variable/{figtree,bricolage-grotesque,jetbrains-mono,
noto-sans-devanagari}` in `apps/web` `dependencies`, imported in `base.css`. Each ships
`@font-face` rules split by `unicode-range`, so a browser downloads Devanagari only when a
Devanagari glyph is on screen. Vite emits the `woff2` files to `/assets/`
(`assetsInlineLimit: 0` already forbids `data:` URLs), which `default-src 'self'` allows, so
the CSP and nginx stay as they are. Stacks put `"Noto Sans Devanagari Variable"` second in
every family. Licence: OFL 1.1, checked in each package's `package.json` in T1. Weight is
measured in T1 from the network panel on `/`; over 250 KB, drop JetBrains Mono for
`ui-monospace` first.

## 2. Data model, migrations, API contracts

None. No endpoint, schema, DTO or request body changes. The web app makes the same requests
in the same order (`admin-page` › "asks for the first page…" and every `stub` that fails on an
unlisted request keep proving it).

## 3. Per-screen changes

| File | Changes | Must not change |
|---|---|---|
| `App.vue` | Sticky header: brand link (inline SVG mark, `aria-hidden`; "Himalaya Cultural Centre" / "Aangan Giving"), then `nav aria-label="Main"` with today's links; nav wraps at 375 px, never hides | Nav labels, `nav button` = Sign out first, `RouterView` in `main` |
| `campaign-page.vue` | Grid: main column (eyebrow, h1, story, notices, trust strip, `#donate`, recent) and `aside` give card; one column under 980 px; `scroll-margin-top` on `#donate`; mobile bar under 760 px | State branches, `role` regions, `a[href="#donate"]` only when open, every string |
| `campaign-totals.vue` | Becomes the give card body: large total, "raised of $goal", bar, stats row | `$43,058.00` alone in its element, `46 donors` one text node, `Ends {date}` rule |
| `progress-bar.vue` | Marigold fill on `--surface-2` track, 12 px, width transition | ARIA attributes, `data-testid`, fill's parent is the track, `{n}%` label |
| `donation-list.vue` | Card with avatar, name, dedication, message (italic, quotes via CSS `::before/::after` only), amount and time right | Text nodes (xss.spec matches the message exactly), `data-testid`, `<time>` |
| `donation-form.vue` | Fieldsets: Amount (radio chips 3-up), Dedication and message, Your details (2-up ≥ 760 px), Who can see your gift (segmented), Payment (Test card + "Mock provider" tag); primary `lg` submit | `<script>`, every `name`, `id`, label text, radio/select/checkbox type, `data-testid`, "Donate"/"Processing…" |
| `donation-result.vue` | Icon circle (inline SVG) and tone per outcome, receipt in `.mono` pill | Headings, sentences, buttons, focus on mount, receipt alone in its element |
| `login-page.vue` | Centred card, eyebrow, "You can give as a guest" link to `/` | Labels, `autocomplete`, alert text, "Sign in"/"Signing in…" |
| `not-found-page.vue` | Empty-state block | Text and first link `href="/"` |
| `my-donations-page.vue` | Card of rows; each `li` a grid aligned like a table ≥ 760 px; status as `.pill` | `ul/li` markup, strings, no new `a[href="/"]` (test reads the first) |
| `admin-page.vue` | Page head (eyebrow "Office", h1), toolbar card (search with icon + button, status select), count, pager styled | `select[name="status"]` (Q4), `form[role="search"]`, `data-page`, "Page n of m", strings |
| `admin-donation-table.vue` | Uppercase headers, sort arrows, `.pill` status, `.mono` receipt, right-aligned amounts; phone card layout kept; refund row removed (§6) | `data-sort`, `aria-sort`, `data-action="refund"`, columns, labels |
| `refund-form.vue` | Becomes the modal (§6) | `data-form="refund"`, label, `data-testid`, `<script>` validation and error mapping |
| `index.html` | `<meta name="color-scheme" content="light dark">` | Title |

New copy (additive, V2): eyebrows; legends "Dedication and message", "Your details",
"Payment"; trust strip (Q5): **"A receipt number for every gift"** / "Quote it if you call the
office." · **"You choose how your name appears"** / "Public, family or anonymous, applied by our
server before anything is shown." · **"One gift, even if you press twice"** / "A repeated
request is recognised and never charged again." Each claim is backed by specs 004/003/004.

## 4. Mockup elements that need data the API does not return

| Element | Decision | Why |
|---|---|---|
| Days left | Drop; keep "Ends {date}" | Already shown and tested; a day count adds clock logic for no new fact |
| Gift count in the feed head, "Show more" | Drop | The list holds the latest 20, not a count; paging is a feature |
| Status chip counts | Drop; keep the select | Five extra requests per view; Q4 |
| "Total given" / tiles on `/me` | Drop | `/me/donations` returns the newest 100, so a client sum can be wrong (S1 flagged) |
| Live "shown as" preview | Drop | The family rule (003 C1) lives in the API only; a copy could disagree with the server |
| Refund impact on total | Derive from the row: "{title} total goes down by {amount}." | Exact: only `completed` rows count (003 C3) and only they have a Refund button |
| Refund impact on donor count | Rule sentence: "The donor count drops by one if this was their only gift to it." | True by 000 A2 without the data |
| Avatar | `avatarInitial(displayName)`: first grapheme by `Intl.Segmenter`, no case change, no parsing of "The … family"; `aria-hidden` | Display-only; never splits an emoji or a Devanagari cluster |
| Hero illustration | Optional (cut list), static decorative SVG | No data |

## 5. Accessibility and contrast

Measured from the mockup's values (WCAG relative luminance):

- **V4a — Focus ring.** Marigold `#E39E0B` on white is 2.3:1, under the 3:1 a focus indicator
  needs. New `--focus`: `--brand-strong` in light, marigold in dark (≈ 9:1).
- **V4b — Control borders.** `--line` `#D9E2E3` on white is 1.3:1. New `--line-strong`
  (≥ 3:1 on `--surface`, both themes) for inputs, selects, textareas and unselected chips;
  `--line` stays for dividers. The selected chip adds a 2 px `--brand` border and `--brand-soft`.
- **V4c — Progress fill.** Marigold on `--surface-2` is 2.0:1 in light. Accepted: the bar
  never carries information alone (`{n}%` text and `aria-valuetext`, 003 US-6). Q3.
- Text pairs checked by the test: `ink`/`muted` on `bg`, `surface`, `surface-2`; `brand-ink`
  on `brand`; `brand` on `surface` (links); `brand-strong` on `brand-soft`; each status colour
  on its `-soft`; `marigold-ink` on `marigold-soft`; `bad` on `surface` (errors).
- Inputs keep their `<label for>`; chips are `<label>` around a visually hidden radio whose
  `:focus-visible` draws the ring on the label; the mobile bar is a plain link.
- Progress bar ARIA unchanged. Reduced motion: transitions and the spinner stop.

## 6. Refund dialog (V5)

`refund-form.vue`'s root becomes `<dialog aria-labelledby>` holding today's form. On mount it
records `document.activeElement` (the Refund button) and calls `showModal()`: the browser makes
the rest of the page inert (the focus trap) and focuses the textarea (`autofocus`). The
`cancel` event (Escape) is `preventDefault`ed and turned into `emit('cancel')` unless `busy`,
the same rule as the disabled Cancel button. Chromium cannot cancel a second Escape, so a `close` event while `busy` reopens the dialog with `showModal()` and otherwise counts as Cancel (reviewer finding). Before unmount it calls `close()` and focuses the
recorded opener if it is still connected. The Refund button stays mounted while its dialog is open, or a cancel would have nothing to return to. Safari and Firefox on macOS do not focus a clicked button, so there the recorded opener can be `body` and focus is not restored (the e2e check is Chromium only). The dialog has `aria-describedby` on the impact sentence. After a refund the opener is gone (the row is no
longer `completed`), so `admin-page` focuses the notice (`tabindex="-1"`). `::backdrop` uses a
literal `rgba(…)`, because older engines do not inherit custom properties into it.
`admin-donation-table` renders the one `RefundForm` after the `<table>`, not in a `<tr>`.

Endpoint touched: `POST /api/admin/donations/:id/refund`, unchanged. Concurrency: unchanged,
the atomic conditional `UPDATE` (005); the dialog adds no request. Idempotency: unchanged, no
key, a retry gets 409 (005 F2); the `busy` guard still sends one request. Authorisation:
unchanged, the server checks role and session; the dialog shows nothing the row did not.
Validation and errors: unchanged `validate()` and `handleFailure()`. The heading's donor name
is a text interpolation, never markup.

## 7. Strings and selectors the tests pin

Playwright matches `getByRole`/`getByLabel` names as case-insensitive substrings and is
strict, so: no new label containing "Email", "Full name", "Password", "$21.00", "Search by
name or email" or "Reason for the refund"; no new button containing "Donate", "Sign in",
"Search", "Refund" (outside the row) or "Confirm refund"; no new heading containing
"Donations", "Sign in" or "Make a donation"; one `h1` per page; the raised total and the
receipt number each appear in exactly one element; the donor's name is not echoed on the
result screen; the mobile bar shows "{n}% of goal", not the total, and is a link.

## 8. Test plan

| Test | Type | Proves |
|---|---|---|
| Every existing web test, assertions unchanged | Unit (jsdom) | Behaviour, requests, strings and states unchanged |
| `contrast.test.ts` (new) | Unit, reads `tokens.css` | §5 pairs ≥ 4.5:1 / 3:1 in both themes; red on the mockup's focus and border values |
| `format.test.ts` › `avatarInitial` (new) | Unit | Latin, `अनिशा` → `अ`, a ZWJ emoji stays whole; red with a code-point slice |
| `admin-page.test.ts` (3 new cases, 1 title) | Unit | Dialog labelled, name as text, impact sentence; Escape ignored while busy; focus on notice |
| `public.spec.ts` (2 new) | E2E, both browsers | Sticky give card at 1280 px; Donate in viewport at 375 px after scrolling; red today |
| `layout.spec.ts` (new) | E2E | No horizontal scroll at 375 px on `/login` (both), `/me`, `/admin` (Chromium) |
| `refund.spec.ts` (1 new, 1 line) | E2E, Chromium | Tab never reaches the page behind the dialog, Escape closes it, focus returns to the Refund button (the hostile name in the heading is covered by the unit test) |
| Existing e2e and fixture | E2E | No CSP violation (fonts included), no JS dialog, flows intact |

The jsdom used by Vitest has no `showModal()` (its `HTMLDialogElement` is empty), so
`apps/web/test/setup.ts` adds a minimal `showModal`/`close` that toggles `open`. It is an
environment shim, not a mock of the code under test; the real modal behaviour (inert page,
Escape, focus) is proven in Chromium by `refund.spec.ts`. Escape in jsdom is a dispatched
`cancel` event.

## 9. Alternatives rejected

- **Tailwind or a component library:** a new build step and a dependency the author must
  defend for 12 components; tokens in CSS do the same job.
- **Google Fonts:** needs `font-src`/`style-src` for two third-party origins and leaks every
  visitor's IP to them. **System stack only:** zero weight, but not the approved look (Q2).
- **Form in a modal, as the mockup does:** changes focus flow and the `#donate` link the
  tests and video use; the inline section already works on a phone.
- **Hand-built `role="dialog"` with a JS focus trap:** more code than `<dialog>` for the same
  result, and easier to get wrong.
- **Status chips, numbered pages, detail drawer, rail:** new markup with no new capability
  (V6); the drawer would show fields the table does not, which is a feature.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Breaking e2e selectors the day before recording | §7 rules; each task runs the e2e spec it touches; T11 runs the whole suite on both browsers |
| Fonts blocked by CSP or wrong MIME | Same-origin `/assets/`; fixture fails on any violation; T1 network check |
| Font weight on a phone | `unicode-range` subsets, `font-display: swap`, 250 KB budget measured in T1 |
| Devanagari clipped by tight heading line-height | Headings use 1.15 but titles are Latin; donor names use body 1.55; checked on row 2 in T4 |
| `showModal()` focus differs in WebKit | Refund e2e runs on Chromium only (G10); the WebKit admin path is a Known issue already |
| Login limit (20 / 15 min) with three more sign-ins per run | Five Chromium sign-ins per run; note in T10 |
| A file passes 500 lines (`donation-form.vue` is 325) | Shared primitives live in `base.css`; split only if it happens |
| Time before the video | Estimate about 8 h; lean path about 5 h; cut order in tasks.md |
