---
"create-ampless": patch
---

Translate `update-ampless` plan-summary output to English.

The six log lines printed during `upgrade` (`replace`, `merge`, `seed`,
`themes`, `cleanup`, `protected`) were the only Japanese strings left in
the CLI, leftover from earlier hand-written status messages. There's no
i18n infrastructure here — the strings were just hardcoded in one
language. Switch them to English so the CLI output matches the rest of
the project's English-primary policy (per `CLAUDE.md`'s Documentation
Language Policy: English at `name.md`, Japanese translations live
alongside as `name.ja.md`).

No structural change, no new dependency, no test churn (tests don't
assert against log text). Behaviour is identical.
