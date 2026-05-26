---
'create-ampless': patch
---

Bundle a dedicated theme-customization guide with scaffolded
projects: `THEMES.md` and `THEMES.ja.md` under
`templates/_shared/`. The new doc covers base-theme selection,
the standard `my-*` copy-and-edit workflow, Claude Design
handoff, AI-assisted implementation, responsive browser QA,
Markdown styling expectations, and common failure modes.

`AGENTS.md` and `AGENTS.ja.md` now keep only a short pointer to
`THEMES.md` instead of an inline customization mini-guide — same
information, no duplication, easier to extend.

`README.md` and `README.ja.md` get their "build your own theme"
paragraph rewritten to point at the in-project `THEMES.md` as
the primary reference (replaces the old GitHub link to the
ampless-contributor-facing `docs/THEMES.md`, which is a
different scope — that doc is for people authoring new official
themes, not for site owners customizing the bundled ones).

Existing scaffolded projects pick up both new files via
`npm run update-ampless` — they're classified as regular
template files (not protected, not seed-if-missing), so the
upgrade copies them in.
