# @ampless/runtime

## 0.2.0-alpha.12

### Patch Changes

- Updated dependencies [e1fd2ca]
  - ampless@0.2.0-alpha.8
  - @ampless/plugin-og-image@0.2.0-alpha.8

## 0.2.0-alpha.11

### Minor Changes

- da28c62: Markdown renderer overhaul + tiptap rich extensions.

  `@ampless/runtime`: replaces the minimal hand-rolled markdown parser in `renderMarkdown` with `marked` v14 + GFM, so posts in `format: 'markdown'` now render the full set of common constructs — tables, task lists, h3–h6, links, images, blockquotes, ordered lists, italic, strikethrough, horizontal rules, autolinks. `renderTiptap`, `tiptapToMarkdown`, and `htmlToMarkdown` learn the new node types (`table`/`tableRow`/`tableHeader`/`tableCell`, `taskList`/`taskItem`) and marks (`underline`, `highlight`, `textAlign` on paragraph/heading), so admin format switches preserve more of the document. Underline/highlight fall back to `<u>`/`<mark>` HTML tags in markdown (preserved across round trips); textAlign cannot be expressed in markdown and is dropped on conversion.

  `@ampless/admin`: tiptap editor gains `Table` (resizable), `TableRow`/`TableHeader`/`TableCell`, `TaskList`/`TaskItem`, `Underline`, `Highlight`, and `TextAlign` (heading + paragraph). Toolbar adds buttons for underline, strikethrough, highlight, task list, blockquote, horizontal rule, and four text-align directions, plus a table popover with insert + row/column add/remove + header toggle + delete. Tables, task lists, marks, and resize handles get minimal scoped CSS using existing theme tokens.

## 0.2.0-alpha.10

### Patch Changes

- 1ccbeda: Consolidate AppSync `AWSJSON` encode / decode behind shared `encodeAwsJson` / `decodeAwsJson` helpers in `ampless`.

  Background: every `a.json()` field (`Post.body`, `Post.metadata`, `Page.body`, `KvStore.value`, …) carries a _JSON-encoded string_ on the wire, regardless of whether the underlying value is a string, object, or array. That rule held in five different ad-hoc implementations across `admin`, `runtime`, `mcp-server`, and `backend` — until the `mcp-server` copy diverged, returning string bodies verbatim and tripping AppSync's `Variable 'body' has an invalid value.` validator on markdown / html posts (already patched in the prior fix).

  Now there is one implementation and one set of tests in [`packages/ampless/src/awsjson.ts`](packages/ampless/src/awsjson.ts). Callers across the monorepo import it — no more drift.

  No behavior change for callers that were already correct; the encode path is now uniformly `JSON.stringify(value ?? null)` and the decode path tolerates both wire shapes (string and the DynamoDB-unmarshalled native value).

- Updated dependencies [1ccbeda]
  - ampless@0.2.0-alpha.7
  - @ampless/plugin-og-image@0.2.0-alpha.7

## 0.2.0-alpha.9

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
  - @ampless/plugin-og-image@0.2.0-alpha.6
  - ampless@0.2.0-alpha.6

## 0.2.0-alpha.8

### Patch Changes

- Updated dependencies [ddbffbf]
  - ampless@0.2.0-alpha.5
  - @ampless/plugin-og-image@0.2.0-alpha.5

## 0.2.0-alpha.7

### Minor Changes

- bb6c2ae: Three follow-ups to the dark / light theme support shipped earlier:
  1. **Custom colour overrides accept a light / dark pair.** Every color
     field on the theme settings page now has an opt-in "Add dark
     variant" toggle. When set, the value is stored as
     `light-dark(L, D)`, which the runtime pastes verbatim into the
     inline `:root { --foo: ... }` override — the browser then picks
     between the two per active `color-scheme`. Stored value parsing
     and validation handle both single-form (existing) and pair-form
     (new); the validator splits on the top-level comma so nested
     `rgb(r, g, b)` / `hsl(...)` commas don't trip it.
  2. **Colour picker now starts on the current value.** The previous
     canvas-based hex round-trip relied on `ctx.fillStyle` parsing,
     which silently kept the reset value when oklch parsing failed on
     some browsers — surfacing as a picker stuck on black. The new
     `useColorAsHex` initialises from `#rrggbb` synchronously and then
     resolves any non-hex form via `getComputedStyle` in `useEffect`,
     so the swatch always reflects the saved colour after mount.
  3. **Iframe preview now reflects the unsaved colour-scheme.**
     Middleware forwards `?previewColorScheme=<mode>` as the
     `x-preview-color-scheme` header; the root layout uses it to
     override the saved `theme.colorScheme` for the duration of that
     request. The admin form's iframe `key` and `src` now include the
     pending colorScheme so changing the select live-updates the
     preview.

  `ampless` exports `parseColorPair` and `formatColorPair` helpers.

### Patch Changes

- Updated dependencies [bb6c2ae]
  - ampless@0.2.0-alpha.4
  - @ampless/plugin-og-image@0.2.0-alpha.4

## 0.2.0-alpha.6

### Minor Changes

- 24a731b: Dark / light theme support with a per-site override.

  Every shipped theme already carried a dark palette via
  `@media (prefers-color-scheme: dark)` blocks in `tokens.css`, but a site
  admin had no way to override the visitor's system preference. The
  rewrite turns the dark variant into a first-class part of every theme
  and adds a per-site setting.

  **What changes**
  - **`tokens.css` (all 6 themes + globals defaults)**: rewritten to use
    the CSS `light-dark(L, D)` function. A single declaration covers
    both modes; the active `color-scheme` selects which value is
    rendered. `@media (prefers-color-scheme: dark)` blocks are removed
    (≈half the file size per theme).
  - **`@ampless/runtime`**: `EffectiveThemeConfig` gains a
    `colorScheme: 'auto' | 'light' | 'dark'` field, validated against
    the site's stored override (`theme.colorScheme` in KvStore).
    Exports `ColorScheme`, `validateColorScheme`,
    `DEFAULT_COLOR_SCHEME`, and `COLOR_SCHEME_SETTING_KEY` for
    consumers.
  - **Template `app/layout.tsx`**: writes `data-color-scheme` on
    `<html>` when the site has pinned `'light'` or `'dark'`. Omits the
    attribute for `'auto'` so the document inherits the
    `:root { color-scheme: light dark; }` default and the visitor's
    `prefers-color-scheme` wins.
  - **Template `app/globals.css`**: adds the `:root` /
    `html[data-color-scheme=…]` opt-in block; default tokens converted
    to `light-dark()` so admin / non-theme pages also adapt.
  - **`@ampless/admin`** theme settings page: new "Color scheme" select
    ("Auto / Light only / Dark only") above the per-theme manifest
    fields. Saves through the same KvStore path; selecting "Auto"
    deletes the override.

  **Compatibility note: `light-dark()` requires browsers from 2024 or
  later** (Baseline). Older browsers render only the light value, which
  is acceptable for ampless's target.

## 0.2.0-alpha.5

### Minor Changes

- dbf0fb0: Add `format: 'static'` for ZIP / file-bundle landing pages.

  A "static" post is a directory of HTML / CSS / JS / image assets uploaded as a zip (or as loose files via the directory picker). The bundle is extracted into `public/static/<siteId>/<slug>/` in S3 and served verbatim by a new catch-all route handler at `app/site/[siteId]/[...path]/route.ts` — no theme chrome, no rewriting, just S3 → presigned URL → 302 redirect.

  **Hard constraint enforced at upload time**: every reference inside the bundle (HTML `src`/`href`/`srcset`, CSS `url()`/`@import`) must be **relative**. Absolute paths (`/foo`) and protocol-relative URLs (`//cdn.example/foo`) are flagged by the admin uploader before save. The constraint keeps the bundle portable — exactly the same files work whether you preview locally by opening `index.html` or deploy under any URL prefix. JS string paths aren't validated (too dynamic to verify); authors are responsible for keeping them relative too.

  Pieces:
  - `ContentFormat` gains `'static'`; the schema enum is widened (`Post.format` and `Page.format`).
  - New `StaticPostBody` interface (`entrypoint`, `files[]`, `uploadedAt`) — the body column is now the bundle's manifest; the actual bytes live in S3.
  - `@ampless/admin` ships `StaticUploader` (zip via JSZip, or loose-file directory picker). The component runs path validation + cross-file lint on extract and blocks save until issues are fixed. Switching format away from `static` in `PostForm` clears the pending bundle.
  - New `@ampless/runtime/routes#createStaticRouteHandler` factory. It looks up the post by slug, refuses non-static formats (defense in depth for direct `/raw-ish` URLs), and 302s to a 1-hour presigned URL via Amplify SSR.
  - Theme post dispatcher (`createThemePostDispatcher`) detects `format === 'static'` and 308-redirects to `/<slug>/<entrypoint>` so the URL ends in a real filename — that's what makes the browser resolve relative paths in the bundle under `/<slug>/…` instead of the site root.
  - `templates/_shared/app/site/[siteId]/[...path]/route.ts` is the wiring template projects ship.
  - Bundle delete cleans up the S3 prefix on post deletion or re-upload so removed files don't linger.

  Limitations:
  - Browser-side upload is capped at ~50 MB uncompressed. Larger bundles should land via direct S3 upload + admin-side metadata edit (out of scope for v1).
  - Slug name collisions matter: `og`, `raw`, `tag`, `feed.xml`, `sitemap.xml` are taken by other route handlers, so a static post can't use those as its slug.

### Patch Changes

- Updated dependencies [dbf0fb0]
  - ampless@0.2.0-alpha.3
  - @ampless/plugin-og-image@0.2.0-alpha.3

## 0.2.0-alpha.4

### Minor Changes

- 0f47d6e: Replace the `.html` slug-suffix convention for bare-HTML rendering with a data-driven `metadata.no_layout` toggle.

  `Post` gains a free-form `metadata` JSON column (DynamoDB `a.json()` + `PublicPost` customType + `PostMetadata` TS interface in `ampless`). The well-known key `no_layout: boolean` tells the runtime to serve the post as bare HTML (no theme chrome, no Next.js root layout). Other keys are passed through unchanged for plugin / app use.

  Behavioural changes:
  - **Middleware**: the `/(slug).html → /raw/(slug).html` rewrite is gone. Slugs ending in `.html` are now treated as ordinary post URLs. The slug-suffix shortcut never carried real semantics (middleware can't see post fields), so the data column is now the only source of truth.
  - **Theme post dispatcher**: peeks at `post.metadata.no_layout` before delegating. When true, redirects to `/raw/<slug>` so the raw route handler can emit the body directly (the browser URL settles on `/raw/<slug>`).
  - **Raw route handler**: also enforces `metadata.no_layout === true` and 404s otherwise. A direct `/raw/<slug>` request for a normal post no longer leaks the body without theme chrome.
  - **Admin post form**: adds a "no layout" checkbox that writes `metadata.no_layout`. The checkbox merges into existing metadata (plugin state etc. is preserved on save).

  Migration for posts published before this release: rename the slug (drop `.html`) and tick the new "no layout" checkbox in the admin. The old URL `/promo.html` will no longer auto-route to the raw handler — set the metadata flag and the post lives at `/raw/promo` instead.

### Patch Changes

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2
  - @ampless/plugin-og-image@0.2.0-alpha.2

## 0.2.0-alpha.3

### Patch Changes

- 55734e5: Fix `next build` type error on scaffolded thin-shell page files:

  ```
  Type 'ThemePostDispatcher' is not assignable to type 'FunctionComponent<any>'.
  Type 'Promise<unknown>' is not assignable to type 'Promise<AwaitedReactNode>'.
  ```

  The L1 extraction typed the three theme dispatcher return values as `Promise<unknown>` to avoid pulling React into ampless core. But `next build` (Next.js 16's stricter type-check pass) rejects this at the App Router page-default-export site.

  Narrow the dispatchers' return type to `Promise<React.ReactNode>` via the `react` peer dep. Runtime semantics unchanged; the returned value already is a server component render result.

  Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.

## 0.2.0-alpha.2

### Patch Changes

- da08397: Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

  ```
  Next.js can't recognize the exported `config` field in route.
  It needs to be a static object.
  ```

  Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

  Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.

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
  - @ampless/plugin-og-image@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
  - @ampless/plugin-og-image@0.2.0-alpha.0
