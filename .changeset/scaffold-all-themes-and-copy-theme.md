---
'create-ampless': minor
---

Three changes to the scaffolding / upgrade story:

**1. Default themes = all six.** Both the interactive scaffold (`initialValues`) and the non-interactive `--skip-confirm` path now install `blog`, `minimal`, `landing`, `corporate`, `docs`, and `dads` by default. The shared `themes-registry.ts` placeholder already references every shipped theme, so this matches what the runtime expects out of the box and lets users prototype theme switching without re-scaffolding.

**2. `copy-theme` subcommand for project-owned themes.** `npx create-ampless@alpha copy-theme <source> <target>` (or `npm run copy-theme -- <source> <target>`) clones an installed theme into a new directory under `themes/`, rewriting the internal `name` references in `index.ts` / `manifest.ts` plus the `[data-theme='…']` scope in `tokens.css`. The target name must use the `my-` prefix — this is the convention that flags a theme as user-owned. Ampless-managed default themes (`blog`, `minimal`, …) are now resynced from the latest template on every `upgrade`; `my-*` themes are never touched.

**3. `themes-registry.ts` is now auto-managed.** Both `scaffold` and `upgrade` regenerate it from the directories actually present under `themes/`. Custom themes get registered automatically (no more "I added a directory but the build doesn't see it"); removed themes vanish. Hyphenated names like `my-blog` import under a camelCase alias (`myBlog`) and index the exported map with the kebab-case string literal, so `theme.active = 'my-blog'` resolves to the right module at runtime.

**Upgrade additions:**
- Theme sync replaces every shipped theme dir (preserving `README.md` and `.gitignore` so user docs / vcs hints survive) and preserves `my-*` themes intact.
- `package.json` script merging is generalised: ampless owns an allowlist (`sandbox`, `sandbox:dev`, `update-ampless`, `copy-theme`) and the user's other scripts (`dev`, `build`, …) survive every upgrade.

**Template package.json additions:**
- `sandbox:dev`: `ampx sandbox --once && next dev` — one-shot sandbox deploy followed by the dev server. Convenient for local verification when you don't need the watch-mode sandbox.
- `copy-theme`: ergonomic alias for `npx create-ampless@alpha copy-theme`.
