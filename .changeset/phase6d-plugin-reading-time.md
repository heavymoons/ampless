---
"@ampless/plugin-reading-time": minor
"create-ampless": patch
---

Add `@ampless/plugin-reading-time` — reading-time badge plugin using the Phase 6d `publicHtmlForPost` capability.

The plugin estimates reading time from the post body (English word count + CJK character count ÷ 2) and injects `<p class="ampless-reading-time" data-words="…" data-minutes="…">` before or after the post content. All three settings (words-per-minute, label template, position) are editable from `/admin/plugins` without a redeploy.

Format support: `tiptap` (recursive JSON tree walk), `markdown` (syntax stripped), `html` (tags stripped), `static` (no badge). The label is HTML-escaped after placeholder substitution to prevent XSS.

`create-ampless` update: adds `@ampless/plugin-reading-time` to the `AMPLESS_PACKAGES` upgrade set and seeds the package into `templates/_shared/package.json` and `cms.config.ts` (as a commented-out entry), and documents the `publicHtmlForPost` capability in `templates/_shared/plugins/README`.
