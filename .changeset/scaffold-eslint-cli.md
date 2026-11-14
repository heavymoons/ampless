---
"create-ampless": patch
---

Restore `npm run lint` on Next.js 16 sites (#384). Next.js 16 removed `next lint`, so new scaffolds now ship an `eslint.config.mjs` flat config (`eslint-config-next` core-web-vitals + TypeScript rules), `"lint": "eslint ."`, and `eslint` / `eslint-config-next` devDependencies.

`update-ampless` migrates an existing site only when it still has the original `"lint": "next lint"` and no ESLint setup of its own — no `eslint.config.*` / `.eslintrc*` at the root or in any subdirectory (outside `node_modules/` and build output), no `.eslintignore`, no `eslintConfig` / `eslintIgnore` key, and no `eslint` / `eslint-config-next` dependency — settings a flat config would silently stop applying. Symlinked (including broken) config files, and anything the scan cannot read, also block it, and the config is written with an exclusive create so it can never write through a link. The warning names the file that blocked the migration. Customised lint scripts, ESLint configs and ESLint dependency versions are left untouched (with a warning when `lint` still calls `next lint`), and an existing `eslint.config.mjs` is never overwritten.
