---
"create-ampless": patch
---

Protect `tsconfig.json` from `update-ampless` overwrites.

Next.js auto-mutates `tsconfig.json` during `next build` / `next dev`
(it rewrites `jsx: "preserve"` → `"react-jsx"` for the React automatic
runtime and appends `.next/dev/types/**/*.ts` to `include`). Until
this patch, `update-ampless` treated the file as `replace` and
overwrote those mutations on every upgrade — only for Next.js to
re-apply them on the next build, producing a dirty diff after every
upgrade. Adds `tsconfig.json` to `PROTECTED_PATTERNS` so the user's
build-mutated copy stays put. Users now hand-merge new compiler
options in the rare case the template tsconfig changes meaningfully.
