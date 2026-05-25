# @ampless/plugin-og-image

## 0.2.0-alpha.13

### Patch Changes

- Updated dependencies [2fba341]
  - ampless@1.0.0-alpha.13

## 0.2.0-alpha.12

### Patch Changes

- 6b46669: Bump direct dependencies to their latest semver-minor / patch versions.
  No source changes — `pnpm install` + `pnpm-lock.yaml` regeneration only,
  verified clean on `pnpm lint` / `pnpm test` / `pnpm build`.

  Notable bumps (all backward-compatible):
  - AWS SDK v3 clients: `^3.717.0` → `^3.1053.0` across backend / mcp-server.
  - `@aws-amplify/backend`: `^1.13.0` → `^1.22.0`; `aws-cdk-lib`: `^2.174.0` → `^2.257.0`.
  - `@modelcontextprotocol/sdk`: `^1.0.0` → `^1.29.0`.
  - Tailwind CSS: `^4.0.0` → `^4.3.0` (templates).
  - Radix UI primitives, React 19.x, `@aws-amplify/adapter-nextjs`, tiptap 3.23.x — all minor / patch.

  Also touches the `templates/_shared` README + AGENTS, replacing the
  stale "Next.js 15" claim with "Next.js 16" so the user-facing docs
  match the actual pinned version (`next@^16.2.6`).

  Out of scope for this update (deferred to follow-ups): `pnpm` 9 → 11
  (packageManager), `marked` 14 → 18 (runtime markdown rendering),
  `@types/node` 22 → 25 (intentionally pinned at 22 — project requires
  Node 20+ at runtime).

  Known leftover advisories (`pnpm audit`): 23 vulnerabilities surface
  in transitive deps pulled by upstream packages (handlebars / lodash /
  hono / fast-uri / etc. via Amplify backend, AWS SDK, MCP SDK). None
  are reachable through ampless's own surface; resolution is upstream.

- Updated dependencies [6b46669]
  - ampless@1.0.0-alpha.12

## 0.2.0-alpha.11

### Patch Changes

- Updated dependencies [dbc7e43]
  - ampless@1.0.0-alpha.11

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
