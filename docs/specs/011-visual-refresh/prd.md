# PRD 011 — Visual refresh

Status: implemented, QA re-run passed · Parent: [000 overview](../000-overview/prd.md) ·
Depends on: 003, 004, 005 (the screens), 006 (the e2e suite and QA checklist it must pass again)

## Problem and context

The screens work and are tested, but they look like a form dump: system font, one column
of 40 rem, no hierarchy between the total and the story. An approved HTML mockup
(`aangan-mockup.src.html`, outside the repo) defines the look: teal brand, marigold progress,
a story column with a sticky "give card", sectioned form, login card, console-style admin.
It is applied **before** the video (006 T13 is open), so the video shows the final UI, and the
e2e suite and `CHECKLIST.md` must pass again afterwards.

The rubric scores no points for looks. The value is the video's first impression and the
accessibility work that comes with it (focus, contrast, a real modal). Scope discipline is
scored (rubric §2), so this spec changes **layout and styling only**.

## Goals

1. Every existing screen takes the mockup's tokens, type and layout, in light and dark.
2. Behaviour, API calls, request bodies, routes and every existing visible string stay as
   they are (V2). No endpoint, no shared-package change, no contract change.
3. AA contrast for the token pairs the UI uses, a visible focus ring, reduced motion honoured.
4. The refund confirmation becomes a modal that traps focus and closes on Escape.
5. Fonts are self-hosted; the CSP stays `default-src 'self'`.

## Non-goals

- Mockup screens and controls with no feature behind them: dedication wall (X1), PDF receipt
  (X2), Nepali toggle (S5), monthly toggle (S2), date filter and CSV (S0), live polling badge
  (S6), office overview page and chart, audit log page, the "Mockup guide" panel, demo-account
  buttons on login, the copy-receipt button, rows-per-page and numbered pages, campaign switcher.
- Mockup elements that need data the API does not return: decided per element in tech spec §4
  (dropped or derived from data already fetched; no new request).
- Admin left rail and detail drawer (V6). A manual theme toggle (dark follows the OS only).
- Any change to `apps/api`, `packages/shared`, nginx or the CSP.
- An axe run for the X3 bonus (Q6).

## User stories and acceptance criteria

Test files: web `apps/web/test/{contrast,format,admin-page}.test.ts` plus every existing web
test unchanged; e2e `e2e/{public,layout,refund}.spec.ts` plus the existing specs unchanged.

### US-1 — A visitor sees the campaign laid out for the screen (M3)
- **Given** a desktop viewport (1280 px), **when** the visitor scrolls to the recent
  donations, **then** the give card (total, bar, %, donors, Donate) stays in view and `main`
  holds exactly one link named "Donate". *(public › "the give card stays in view on desktop")*
- **Given** 375 px, **when** the visitor scrolls to the bottom of an open campaign, **then** a
  Donate link stays in the viewport, and the page has no horizontal scroll. *(public › "Donate
  stays reachable on a phone"; public › existing 375 px test)*
- **Given** a closed or upcoming campaign, **then** no Donate link and no mobile bar render.
  *(campaign-page › "donate only when open", unchanged)*
- **Given** the seed, **then** `$43,058.00`, `46 donors`, `28%`, `0%` never `NaN%`, and the
  loading, error, empty and not-found states read exactly as today. *(campaign-totals,
  progress-bar, campaign-page, donation-list, all unchanged)*

### US-2 — A donor gives through the sectioned form (M4)
- **Given** the form, **then** presets and "Other amount" are native radios drawn as chips,
  so `getByLabel('$21.00').check()` and arrow keys still work, and privacy is a segmented radio
  group with the same one-sentence explanation. *(donation-form, donate e2e, unchanged)*
- **Given** each outcome (receipt, pending, declined, provider error, in progress, rate
  limited, network, rejected), **then** the result shows the same heading and sentence as
  today, with an icon and tone. *(donation-result, campaign-page, unchanged)*

### US-3 — The UI meets AA in both themes (X3-aligned, not claimed)
- **Given** the light and dark token sets, **then** every text pair in tech spec §5 is ≥ 4.5:1
  and every focus-ring and control-border pair is ≥ 3:1. *(contrast › "text pairs meet 4.5:1",
  "focus and borders meet 3:1")*
- **Given** keyboard use, **then** every focusable element shows a 3 px focus ring; **given**
  `prefers-reduced-motion`, **then** no transition or animation runs. *(manual check in T11)*

### US-4 — Signed-in pages are restyled without changing what they do (M5, S1 list)
- **Given** 375 px, **then** `/login`, `/me` (donor) and `/admin` have no horizontal scroll.
  *(layout › "signed-in pages fit a phone"; `/me` and `/admin` on Chromium only, G10)*
- **Given** the admin table, **then** search, status select, sort, paging and the
  "75 donations" count behave as today. *(admin-page, xss, refund e2e, unchanged)*

### US-5 — An admin confirms a refund in a modal (M5, X3-aligned)
- **Given** a completed row, **when** Refund is pressed, **then** a modal dialog opens,
  labelled by "Refund {amount} to {name}?", with the name as text, a sentence stating the
  campaign total drops by that amount, and focus in the reason field. *(admin-page › "opens a
  labelled refund dialog")*
- **Given** the open dialog, **when** Tab is pressed repeatedly, **then** focus never leaves
  it; **when** Escape is pressed, **then** it closes, nothing is sent, and focus returns to the
  row's Refund button. *(refund e2e › "the refund dialog keeps and returns focus")*
- **Given** a refund in flight, **when** Escape is pressed, **then** the dialog stays open.
  *(admin-page › "Escape does not close a refund in flight")*
- **Given** a successful refund, **then** the dialog closes and focus lands on the status
  notice. *(admin-page › "focus moves to the notice after a refund")*

### US-6 — Fonts load under the existing CSP, Devanagari included
- **Given** the stack on :3000, **when** any e2e spec runs, **then** no CSP violation is
  reported (fixture), and fonts are served from `/assets/` as `woff2`. *(all e2e via
  `fixtures.ts`; network check in T1)*
- **Given** `अनिशा गुरुङ` and an emoji message, **then** they render whole, and the avatar
  shows the first grapheme. *(donation-list unchanged; format › "avatarInitial")*

## Traceability

| Requirement / rubric item | User story | Task |
|---|---|---|
| M3 title, story, goal, total, donors, bar with % | US-1 | T3 |
| M3 recent list: name, amount, dedication, relative time | US-1, US-6 | T4 |
| M3 empty/loading/error states, no `NaN%` | US-1 | T3 (tests unchanged) |
| M3 works at 375 px | US-1, US-4 | T3, T10 |
| M4 presets + custom, privacy default and one sentence | US-2 | T5 |
| M4 decline and timeout shown distinctly, receipt number | US-2 | T5 |
| M5 search, status filter, refund | US-4, US-5 | T8, T9 |
| S1 donor's own list (no total, see below) | US-4 | T7 |
| Cat. 4 output escaped (donor name in the new dialog heading) | US-5 | T9 |
| Cat. 1 it runs: new dependencies build from a clean clone | US-6 | T1, T11 |
| Cat. 3 Devanagari and emoji render | US-6 | T1, T4 |
| X3 (not claimed): labelled inputs, focus, modal trap + Escape, AA | US-3, US-5 | T1, T9 |
| Cat. 6 video shows the final UI | all | T11 |

**Not covered, flagged:** S1's donor *total* (the list caps at 100 rows, so a client sum can
be wrong; tech spec §4). X3's axe run and README result (Q6). Both were open before this spec.

## Decisions to approve

- **V1 — Reverses a PRD 000 non-goal.** PRD 000 excludes "design polish beyond legible and
  usable at 375 px". This spec is that polish, placed before the video and before 007/008.
- **V2 — Copy freeze.** Every string a test, a spec or the video outline shows stays
  byte-identical; new copy is only added (section legends, trust strip, eyebrows, the dialog
  heading and impact sentence). No existing test assertion changes; one test title does (T9).
- **V3 — Self-hosted fonts** (`@fontsource-variable/*`, SIL OFL 1.1) over a system stack;
  CSP unchanged. Budget: ≤ 250 KB of `woff2` on the public page's first view.
- **V4 — Three deliberate deviations from the mockup for AA** (tech spec §5).
- **V5 — Refund confirmation as a native `<dialog>`** with a jsdom shim in tests (tech spec §6).
- **V6 — No admin rail or detail drawer:** one admin screen, and the drawer would show fields
  the table does not, which is a feature.

## Assumptions

- The mockup is the approved source of truth for colour, type and spacing; where it fails AA,
  AA wins (V4).
- The demo is recorded in whichever OS theme the author uses; both themes are tested.

## Answered questions (2026-10-27)

- **Q1:** V1 approved, full scope (about 8 h), before the video.
- **Q2:** V3 approved: self-hosted fonts.
- **Q3:** the light-theme progress fill stays at 2.0:1 (V4c); the percentage is also text.
- **Q4:** the status `<select>` stays.
- **Q5:** the trust-strip copy in tech spec §3 is approved.
- **Q6:** the axe run stays optional, only with time left after T11.
