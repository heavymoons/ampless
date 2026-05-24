---
"create-ampless": patch
---

Document the `--mount` deploy mode in the scaffolded project's
`README.md` (and Japanese counterpart). The flow was implemented
earlier but the user-facing docs only described the manual console
path — operators were re-discovering the CLI shortcut from the
`--help` output. The new "Deploying to production" section now leads
with the one-shot CLI command and keeps the console flow as the
fallback.
