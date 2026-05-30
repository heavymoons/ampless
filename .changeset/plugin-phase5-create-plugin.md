---
"create-ampless": minor
---

Phase 5 plugin extension (scaffold): `npx create-ampless plugin <name>`.

New CLI subcommand that scaffolds an ampless plugin in one command. Two modes:

- `--local` (default): writes `plugins/<name>/index.ts` inside the
  current ampless site. The site itself is the build / publish unit;
  the plugin file is just code that sits there. Plugin name is a
  kebab-case identifier (e.g. `site-verification`).
- `--standalone`: writes a complete npm package at `<name>/` ready
  for `npm publish`. Plugin name should be the npm package name
  (e.g. `@scope/ampless-plugin-foo` or `ampless-plugin-foo`). The
  kebab segment after stripping the npm scope and the conventional
  `ampless-plugin-` / `plugin-` prefix becomes `AmplessPlugin.name`,
  matching the convention used by every first-party plugin shipped
  to date (`@ampless/plugin-gtm` → `gtm`,
  `@ishinao/ampless-plugin-site-vrfn` → `site-vrfn`).

Standalone scaffolds include the Phase 5 static manifest
(`package.json#amplessPlugin` + `packageName` factory field), the
`"./package.json": "./package.json"` subpath export required for the
runtime cross-check, the `ampless-plugin` discovery keyword, and a
minimal vitest setup so `pnpm install && pnpm test && pnpm build` runs
clean on the freshly scaffolded directory.

Other flags:

- `--trust-level <untrusted|trusted|privileged>` (default: untrusted)
- `--capabilities <list>` (default: publicHead,adminSettings)
- `--description "<text>"`

`--skip-confirm` is honoured: when set, missing `--trust-level` and
`--capabilities` flags fall back to their documented defaults instead
of launching an interactive prompt, so CI / scripted use never blocks
on a TTY.

`--description` values containing characters that would corrupt the
output are escaped: the value is `JSON.stringify`'d into
`package.json` (preserving quotes / backslashes / newlines exactly)
and sanitised for JS docstrings + Markdown (escaping `*/` so it
doesn't close the JSDoc above the factory, collapsing newlines to
spaces).

Plugin name validation tightened: each kebab segment must start with
a letter, so the scaffold can no longer produce a TS identifier that
starts with a digit (e.g. `ampless-plugin-123foo` is rejected before
it can become a broken `123fooPlugin` function name). The check runs
both on the raw input and on the stripped name in standalone mode.
