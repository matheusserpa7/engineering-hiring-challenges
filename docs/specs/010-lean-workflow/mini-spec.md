# Mini-spec 010 — A leaner per-task workflow

Side change to `CLAUDE.md`. It does not move spec 002 or 003.

## Goal

Spec 002 cost about 774k subagent tokens across 20 calls. Nearly half (373k, on Opus) went to
`spec-writer`, and about 204k of that was nine calls that amended an existing spec with text
the main session had already written. Other waste: up to four spec rounds per task, a
reviewer run on a 19-line infra change, agents re-reading the same files, and the same facts
written into `tasks.md`, the tech spec, `PROGRESS.md` and the chat. Cut that without
removing a check that found a bug.

## Change (`CLAUDE.md`)

1. **`spec-writer` writes decisions.** It drafts new PRDs, tech specs and task lists, and any
   change to a decision, a contract or an acceptance criterion. The main session may tick
   tasks, write execution notes and correct facts that change no decision. A decision change
   still updates the spec before the code, and the user is told.
2. **One spec update per task**, after the review fixes, in the same commit. Order: test →
   code → checks → review → fix everything → one spec update → commit.
3. **`code-reviewer` is required** for money, authentication and authorisation, concurrency
   and idempotency, input validation, logging of personal data, SQL and migrations, and new
   public API. For docs, config or infra under about 30 changed lines, and pure refactors, a
   self-review against the `docs/07` table is enough and the reviewer is optional.
4. **Delegation prompts** name the exact files, line ranges and the contract. Subagents read
   those, not the whole repo. A `test-writer` reads in full, or is given, the data its
   assertions rest on: three wrong expectations in spec 002 came from reading 20 rows.
5. **Short notes.** Execution notes in `tasks.md` are at most four bullets: what proved the
   tests bite, the review outcome, accepted risks with the reason, notes for later specs.
   `PROGRESS.md` is updated when a spec closes or a session ends. Reports to the user are
   at most ten lines per task and do not repeat what was already shown.
6. **Spec size:** PRD up to about 120 lines, tech spec about 200, tasks about 80. Optional
   items go in one list.

Unchanged: test first, with a deliberate break to prove the test bites; `test-writer` for
non-trivial tests; `qa-verifier` when a spec closes; the money and security rules; commits
only on the user's go-ahead.

## What is lost

The `spec-writer` re-reads a spec independently, and that once caught a false claim the main
session had written (a relative `SEED_DIR` resolved against the working directory, not the
repo root). Amendments the main session makes lose that second reader. Mitigations: decisions
and contracts still go through `spec-writer`, and the reviewer's checklist gains "check each
claim in the spec note against the code".

## Test

No automated test. Check on the next task: spec-writer calls limited to new documents or
decision changes, one spec update, no reviewer on a small infra task, and every review item
that matters (PII, authz, money) still raised.
