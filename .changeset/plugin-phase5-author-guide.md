---
"ampless": patch
---

Phase 5 plugin extension (docs): plugin author guide rewrite.

Rewrites `packages/ampless/docs/plugin-author-guide.md` (en + ja) to
cover all three ways an ampless plugin can be written instead of just
the monorepo-internal case. New / changed sections:

- **§0 (new) — Theme vs Plugin Boundary.** Decision table covering
  what belongs in a theme vs a plugin, with the two boundaries new
  authors most often hit: storage / external API writes always belong
  in a plugin; anything you want admins to toggle from
  `/admin/plugins` belongs in a plugin even if its visible effect is
  cosmetic.
- **§1 — three-paths overview.** Adds a table at the top of "What a
  plugin can do" explaining first-party / site-local / external-npm
  forms before the surface table.
- **§2 — scaffolding-first.** Leads with
  `npx create-ampless plugin <name>` (both modes) and only then
  describes the hand-authored file layouts. Two layouts (single
  `index.ts` for site-local, full package for standalone) replace the
  previous single layout.
- **§3 — `packageName` + static manifest.** Adds the new optional
  `packageName` field, a subsection on the static
  `package.json#amplessPlugin` block, the
  `"./package.json": "./package.json"` subpath-export requirement,
  and a table of which cross-check mismatches throw vs warn.
- **§6 — Client-side DOM mutation: don't.** New subsection at the
  end of the descriptor reference explaining why inline scripts must
  not insert visible DOM elements (hydration mismatch wipes them,
  React 19 refuses to execute client-only `<script>` tags). Safe
  patterns: `window.dataLayer`-style global state, external widget
  loaders, SSR-only descriptors. Avoided patterns: `createElement`
  + `append`, modifying server-rendered content client-side, per-post
  HTML insertion via DOM reads.
- **§14 (new) — Quickstart: scaffolding with `create-ampless`.**
  End-to-end walkthrough of `npx create-ampless plugin`, including
  publishing the standalone output, the npm publish-to-install lag,
  and the convention `AmplessPlugin.name` derivation for community
  packages. Pre-existing "Where to ask" section renumbered to §15.

`templates/_shared/docs/plugin-author-guide.{md,ja.md}` (scaffold
copy) is synced byte-for-byte. `templates/_shared/plugins/README.{md,ja.md}`
adds a pointer to §0 (Theme vs Plugin Boundary) and a short note on
the client-side-DOM-mutation rule with a link into §6, so authors
opening the local-plugin directory land on the same guidance.
