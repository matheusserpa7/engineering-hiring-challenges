# Mini-spec 009 — Pin a model per stage

Side change. It does not move spec 002.

## Goal

Claude Code does not route models by stage. With no `model` field, every subagent inherits the picker, so spec, tests, review, QA and implementation all run on whichever model is selected. Pin Opus only where a mistake is inherited by every later task, and keep the repeating work on Sonnet so the picker stays put.

## Change

- `spec-writer`: `model: opus`, `effort: high`
- `test-writer` and `qa-verifier`: `model: sonnet`, `effort: medium`
- `code-reviewer`: `model: sonnet`, `effort: high`
- `.claude/settings.json`: `"model": "sonnet"`, beside the existing hook. No `effortLevel` key. A top-level one would clamp every model, including the spec writer. A new session starts on Sonnet at that model's own default, which is medium. The picker and `claude --model` still override that one session.
- `CLAUDE.md`, Agents section: spec files are written only by `spec-writer`. Delegate without passing a model or an effort. After approval, implement in this session, with the picker left on medium.

Aliases, not dated ids. `opus` and `sonnet` follow the account's current Opus and Sonnet.

## Why this split

Opus is the expensive pass. It runs once per spec, writes documents rather than the edit loop, and those documents are what you defend in the interview. A weak spec is paid for again on every task. `effort: high` on that agent is the extra reasoning for the concurrency, authorisation and money decisions. Medium stays the default everywhere else.

Sonnet is the volume pass. Implementation reads and rewrites code on every task. Tests encode a plan the tech spec already wrote. Review checks a small diff against a checklist already in the reviewer prompt. QA runs commands and compares output to acceptance criteria, once per spec. Sonnet 5.5 is enough for a written plan and a written checklist. Running Opus on those stages bills the same work a second and third time.

Rejected:

- Haiku for tests, review or QA. Those stages judge money boundaries, authorisation and acceptance evidence. Tasks are already small, so the saving against Sonnet is small next to a dropped case.
- Fable. It needs extra usage credits, and neither a templated spec nor a checklist review needs it.
- Opus for `code-reviewer`. Review runs once per task. The prompt already lists the money, concurrency and authorisation checks. The extra care is `effort: high` on Sonnet, not a more expensive model. Upgrade that one agent to Opus only if high-effort reviews still miss those bugs.
- `low` on QA or tests. At low effort the model is more likely to stop early or skip a check, and those two stages exist to check.
- `high` on implementation, and `xhigh` or `max` anywhere. Opus 5.5 and Sonnet 5.5 default to medium, which fits a task whose scope is already written. The spec writer is the exception: `effort: high` on Opus, because that one pass is where concurrency, authorisation and money get decided, and every later task inherits the document. It runs once per spec, not on the edit loop. `xhigh` and `max` are for long unattended jobs and pay for thinking the task list does not need.
- A project-wide `effortLevel`. It would force the spec writer down or up together with the session. Per-agent `effort` overrides the session slider and leaves implementation on whatever the picker says.

## Out of scope

Switching an already-open session. Frontmatter applies when a subagent starts; the session model applies until a new session or a manual picker change. Cursor and any tool other than Claude Code ignore these fields. A parent that passes `model` when delegating still overrides the frontmatter; the `CLAUDE.md` line forbids that.

## Test

No automated test. Claude Code reads the frontmatter when the session starts.

After a new session: the prompt shows Sonnet at medium; asking for a spec shows `spec-writer` on Opus in `/tasks`; a test or QA delegation shows Sonnet at medium; a review shows Sonnet at high. `/tasks` prints the effort next to the model.

## Traceability

No REQUIREMENTS must-have. Supports the working rule that you can explain every step, and leaves the `docs/07` review in place. Does not change product behaviour.
