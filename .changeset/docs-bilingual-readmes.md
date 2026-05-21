---
"@ampless/admin": patch
"@ampless/backend": patch
"@ampless/mcp-server": patch
"@ampless/plugin-og-image": patch
"@ampless/plugin-rss": patch
"@ampless/plugin-seo": patch
"@ampless/plugin-webhook": patch
"@ampless/runtime": patch
"ampless": patch
"create-ampless": patch
---

Bilingual `.md` / `.ja.md` README convention across all published packages.

Every package README now has a Japanese counterpart at `README.ja.md`,
with a language-toggle header at the top of the English version
linking to it.

`create-ampless` additionally bundles the bilingual versions of every
template README (per-theme + `RUNBOOK.md`) so scaffolded projects
ship with both languages. The per-theme READMEs themselves have been
rewritten to focus purely on the theme's content and customization
fields, dropping generic ampless project-setup instructions that
belonged in the project README / RUNBOOK rather than inside a theme
directory.

No runtime behavior changes.
