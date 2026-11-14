---
"create-ampless": patch
---

Restore `npm run lint` on Next.js 16 sites (#384). Next.js 16 removed `next lint`, so new scaffolds now ship an `eslint.config.mjs` flat config (`eslint-config-next` core-web-vitals + TypeScript rules), `"lint": "eslint ."`, and `eslint` / `eslint-config-next` devDependencies.

`update-ampless` migrates an existing site only when it still has the original `"lint": "next lint"` and no ESLint setup of its own — no `eslint.config.*`, `.eslintrc*`, `eslintConfig` key, or `eslint` / `eslint-config-next` dependency. Customised lint scripts, ESLint configs and ESLint dependency versions are left untouched (with a warning when `lint` still calls `next lint`), and an existing `eslint.config.mjs` is never overwritten.
