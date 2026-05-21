---
"create-ampless": patch
---

Ship a comprehensive user-level `README.md` (English + Japanese) in scaffolded projects.

`templates/_shared/README.md` is now a full orientation guide for site owners: requirements, every `npm` script, first-run flow, admin UI map, authoring formats, theme switching / customization, plugin enable / install pattern, GitHub-to-Amplify-Hosting deploy flow with `amplify.yml`, environment variable conventions, custom-domain wiring, multi-site, MCP integration, and the `update-ampless` upgrade flow.

`RUNBOOK.md` is reframed as a recipe book for occasional operations, with a table of contents and a top-line pointer back to `README.md` for everyday usage. Existing recipes (API key rotation, user promotion, password reset, backup restore, failed plugin events, custom domain setup, multi-site caveats) are unchanged.

Both files ship in English (`README.md` / `RUNBOOK.md`) and Japanese (`README.ja.md` / `RUNBOOK.ja.md`) with language-toggle headers.
