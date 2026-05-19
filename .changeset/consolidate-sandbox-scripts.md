---
"create-ampless": patch
---

Consolidate the two sandbox-related `package.json` scripts into one.

Before:

- `sandbox` = `ampx sandbox` (continuous watch — rarely used in practice)
- `sandbox:dev` = `ampx sandbox --once && next dev` (the actually-useful one)

After:

- `sandbox` = `ampx sandbox --once && next dev`

The continuous-watch flow stays available as `npx ampx sandbox` for the
edge cases that need it, but the rarely-used npm script is gone and the
`:dev` suffix no longer dangles meaninglessly.

`create-ampless upgrade` will remove the now-orphaned `sandbox:dev`
key from existing projects' `package.json` on the next run — the
managed-scripts sync now iterates the allowlist (rather than the
template) so keys ampless used to own but has since dropped get
cleaned up automatically.

Theme READMEs, the `create-ampless` post-scaffold "next steps" outro,
and related docs are updated to recommend `npm run sandbox`.
