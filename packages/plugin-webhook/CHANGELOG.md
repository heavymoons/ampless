# @ampless/plugin-webhook

## 0.2.0-alpha.10

### Patch Changes

- Updated dependencies [52ee58a]
  - ampless@1.0.0-alpha.10

## 0.2.0-alpha.9

### Patch Changes

- Updated dependencies [af1f9b0]
- Updated dependencies [af1f9b0]
  - ampless@1.0.0-alpha.9

## 0.2.0-alpha.8

### Patch Changes

- Updated dependencies [e1fd2ca]
  - ampless@0.2.0-alpha.8

## 0.2.0-alpha.7

### Patch Changes

- Updated dependencies [1ccbeda]
  - ampless@0.2.0-alpha.7

## 0.2.0-alpha.6

### Patch Changes

- de57606: Bilingual `.md` / `.ja.md` README convention across all published packages.

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

- Updated dependencies [de57606]
  - ampless@0.2.0-alpha.6

## 0.2.0-alpha.5

### Patch Changes

- Updated dependencies [ddbffbf]
  - ampless@0.2.0-alpha.5

## 0.2.0-alpha.4

### Patch Changes

- Updated dependencies [bb6c2ae]
  - ampless@0.2.0-alpha.4

## 0.2.0-alpha.3

### Patch Changes

- Updated dependencies [dbf0fb0]
  - ampless@0.2.0-alpha.3

## 0.2.0-alpha.2

### Patch Changes

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2

## 0.2.0-alpha.1

### Patch Changes

- 9f6adad: Bump all direct dependencies to latest majors so the alpha track isn't carrying a major version behind. Notable bumps:
  - `typescript` 5.9 → 6.0
  - `next` 15 → 16 (Amplify adapter-nextjs peer allows up to <17)
  - `@tiptap/*` 2.27 → 3.23 — editor API migration (BubbleMenu moved to `@tiptap/react/menus`, `tippyOptions` → `options` for Floating-UI)
  - `vitest` 2 → 4
  - `eslint` 9 → 10
  - `lucide-react` 0.469 → 1.16
  - `tailwind-merge` 2 → 3
  - `@jsquash/avif` 1 → 2
  - `@clack/prompts` 0.9 → 1.4
  - plus all minor / patch refreshes (turbo, @aws-sdk, changesets, @types/node, typescript-eslint, vite)

  Behavioural code changes:
  - `theme-actions.ts`: `revalidateTag` → `updateTag` (Next 16's read-your-own-writes variant for Server Actions)
  - `image-bubble-menu.tsx`: tiptap 3 import path + Floating-UI option shape
  - TS 6 strict-mode fixes (catch params, side-effect css import declaration)

- Updated dependencies [9f6adad]
  - ampless@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0

## 0.1.0

### Minor Changes

- v0.1.0 — initial public MVP release.
  - `create-ampless` CLI: scaffolds a Next.js 15 (App Router) blog with the
    Amplify Gen 2 backend definitions baked in.
  - `ampless` core library: shared types, plugin contract (`definePlugin`,
    hooks, `PluginRuntimeContext`), event types, and helpers (`escapeXml`,
    `formatPublicAssetUrl`, `formatDate`, `processImage`, `defineSchema`,
    `defineConfig`).
  - `@ampless/plugin-seo`: OGP / Twitter / canonical metadata for posts and
    the site, plus a `sitemap.xml` regenerated to S3 on every content event.
  - `@ampless/plugin-rss`: RSS 2.0 `/feed.xml` regenerated to S3 on every
    content event, with `<language>` tag and per-call options.
  - `@ampless/plugin-webhook`: POST event payloads to external URLs with
    optional HMAC-SHA-256 signing.
  - `@ampless/mcp-server`: stdio MCP server (Claude Desktop / Cursor /
    Claude Code) exposing 7 tools — list / get / create / update / delete
    posts, upload media, get schema. Authenticates as a Cognito user via
    SRP, so each tool runs with that user's role.
  - Trust-level event system: DynamoDB Streams → event-dispatcher Lambda →
    trusted / untrusted SQS queues → trust-level processor Lambdas. Plugin
    hooks fire in the matching trust level.
  - AppSync API key auto-renewal Lambda runs monthly (EventBridge Rule), so
    the public read path never silently 401s on key expiry.

### Patch Changes

- Updated dependencies
  - ampless@0.1.0
