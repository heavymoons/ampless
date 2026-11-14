---
"create-ampless": patch
---

Restore `npm run lint` on Next.js 16 sites (#384). Next.js 16 removed `next lint`, so new scaffolds now ship an `eslint.config.mjs` flat config (`eslint-config-next` core-web-vitals + TypeScript rules), `"lint": "eslint ."`, and `eslint` / `eslint-config-next` devDependencies.

`update-ampless` never changes an existing site's ESLint setup: it does not add or replace `eslint.config.mjs` (including symlinks), does not touch `.eslintrc*` / `.eslintignore`, the `lint` script or ESLint dependencies, and so never adds a flat config that would shadow legacy settings. When `lint` still calls `next lint`, it prints a warning with the manual migration steps (`npx @next/codemod@latest next-lint-to-eslint-cli .`, then carry over `.eslintrc*` / `.eslintignore` settings). The site README documents the migration under "Migrating from `next lint`".
