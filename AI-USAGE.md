# AI usage

## Tools

- **Claude Code**, the only AI tool used for this project. The main session runs Sonnet and
  writes the code of an approved task. Four subagents are defined in `.claude/agents/`:
  `spec-writer` (Opus, high effort) drafts the PRD, tech spec and task list;
  `test-writer`, `code-reviewer` and `qa-verifier` run on Sonnet. A post-edit hook lints the
  edited file and type-checks its package.

## Roughly how much

Most of the code and the tests were written by the agent, one task at a time, from a spec
that was approved first. The specs in `docs/specs/` (PRD, tech spec, task list per step), the
ADRs and the decisions in them were drafted by the agent and decided by me: I approved each
spec before any code was written, and each commit was made only after my go-ahead. Almost no
line was left unread, because the rule in `CLAUDE.md` is that I must be able to explain every
line live.

## How it was steered

- `CLAUDE.md` makes the order PRD, then tech spec, then tasks, then a stop for my approval,
  before any code. A decision that changes along the way is written into the spec first.
- Every task starts with a test that must be seen failing without the change. The task notes in
  each `tasks.md` list the deliberate mutations that turned each test red.
- A `code-reviewer` subagent reads each diff that touches money, authorisation, concurrency,
  validation, SQL or logging, and returns findings that are fixed before the commit. Review
  fixes are recorded in the task notes.
- Lint rules turn the agent's usual mistakes into build failures: `parseFloat`, `toFixed`,
  `v-html`, `innerHTML` and `any`.

## What changed about what it produced

These are recorded in the task notes of `docs/specs/`, with the commit that fixed each.

- A test meant to prove that money keeps every cent passed even with `cents / 100`. It now uses
  `Number.MAX_SAFE_INTEGER`, where the float version prints the wrong cent (spec 002 T1).
- The first login limiter refunded successful attempts. Because the demo passwords are public,
  anyone could reset the counter with a known login between guesses, so every attempt counts
  (spec 005 T3).
- A name with a no-break or zero-width space inside the surname made the family-name regex
  return the whole name for a "family only" donor. Those characters are separators now, with a
  test for each (spec 003 T3).
- The query string leaked into the request log through the `Referer` header, so the header is
  stripped, with a test (spec 004 T5).
- The first admin-search design implied an index it did not use. The spec now says the `OR`
  keeps a sequential scan, and names the `UNION` that would fix it (spec 005 T5).
- The end-to-end CSP check found a violation on every page load that no unit test could see:
  Zod's JIT probe is blocked by nginx's CSP. Zod now runs without JIT (spec 006 T4).
- The planned admin XSS test could not work: the admin table has no message column. The test was
  rewritten around the donor name, and the spec amended before the test (spec 006 T5).
- I skipped the reviewer on two small tasks and asked for a self-review against `docs/07`
  instead (spec 004 T2 and T3), and I trimmed the workflow when subagent cost grew
  (`docs/specs/010-lean-workflow/`).

## What agents were kept away from

- Commits and pushes: only on my explicit go-ahead, under my own git identity, with no
  co-author trailer.
- The seed in `roles/full-stack-engineer/seed/`, which is read in place and never edited.
- Any file the agent did not create in the task at hand, such as another tool's config.
