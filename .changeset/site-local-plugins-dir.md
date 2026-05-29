---
"create-ampless": minor
---

Seed `plugins/` directory + README in the shared template and protect
it from upgrade overwrites.

`plugins/` is the conventional home for site-local plugins — small
customizations a contributor doesn't want to publish as a separate npm
package. New projects scaffolded via `create-ampless` now ship with
this directory pre-existing and a README inside that explains the
local-plugin pattern (factory shape + `cms.config.ts` register + which
capabilities are currently active).

`PROTECTED_PATTERNS` now matches `^plugins(\/|$)`, mirroring the
existing protection for `themes/`. Anything users add or edit inside
`plugins/` survives `update-ampless` unchanged. The README itself is
also frozen at scaffold time; the canonical, kept-up-to-date "how to
write a plugin" doc continues to be `packages/ampless/docs/plugin-
author-guide.md`.

This lands the convention `npx create-ampless plugin --local` (Phase
5) will scaffold into — the per-plugin subcommand still has to come,
but the directory it'll write into is now standard from day one.
