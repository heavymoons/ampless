---
"create-ampless": patch
---

Add explicit Tailwind v4 `@source` directives to `app/globals.css` so
classes used inside the `@ampless/admin` and `@ampless/runtime` dist
files actually make it into the generated CSS.

Tailwind v4 skips `node_modules/` during its automatic content
detection. Every utility used only inside the admin UI (e.g. the
sidebar's `flex`, `fixed`, `md:sticky`, ...) was tree-shaken out, and
the admin layout fell back to browser defaults — sidebar overlapped
main content on `/admin`.

Surfaced via the `ishinao.net` dogfood site.
