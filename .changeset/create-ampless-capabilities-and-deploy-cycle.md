---
"create-ampless": patch
---

Fix plugin-capability scaffold drift and an internal import cycle.

- The `plugin <name> --capabilities` allowlist (`VALID_PLUGIN_CAPABILITIES`) had drifted from the active `PluginCapability` union in `ampless`: `publicHtmlForPost`, `secretSettings`, `contentFields`, and `publicPostScript` are all shipped now but were rejected by the scaffold. They are now accepted.
- Broke the `deploy.ts` ↔ `preflight.ts` import cycle by moving the shared `DeployOptions` type and `extractRegistrableDomain` helper into a new dependency-free `deploy-shared.ts` (both are re-exported from `deploy.ts`, so existing import paths still work).
- Bundled template `list-posts-by-tag.js` no longer hard-codes `format: 'markdown'` for tag-page rows; it reads the real `format` now denormalized onto the PostTag row (see the `ampless` / `@ampless/backend` changeset), so non-markdown posts are no longer mislabeled on tag pages.
