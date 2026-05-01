# Authoring Themes for ampless

A theme in ampless is a directory under `templates/` that overlays a
shared base when a project is scaffolded by `create-ampless`. This
document explains the layout, the manifest, and the conventions a
theme is expected to follow.

## Big picture

```
templates/
  _shared/         common base — copied first by scaffold
    amplify/
    app/
      (admin)/
      api/
      layout.tsx
      providers.tsx
    components/
    lib/
    middleware.ts
    cms.config.ts
    package.json
    ...

  blog/            theme overlay — copied on top of _shared
    README.md
    theme.manifest.ts
    app/
      globals.css
      site/[siteId]/
        page.tsx
        [slug]/page.tsx
        ...

  minimal/         another theme overlay
    ...
```

When a user runs `npx create-ampless`, the CLI:

1. Copies everything in `_shared/` to the destination.
2. Overlays the chosen theme directory on top (theme files win on conflict).
3. Substitutes `{{projectName}}` / `{{siteName}}` / etc. across all
   text files.

So a theme only needs to ship the files that differ from the shared base.

## What goes where

| Lives in `_shared/` | Lives in the theme |
| --- | --- |
| Amplify backend (`amplify/`) | `theme.manifest.ts` |
| Admin app (`app/(admin)/`) | `app/globals.css` (CSS tokens) |
| API routes (`app/api/`) | `app/site/[siteId]/page.tsx` (home) |
| Auth pages (`app/login/`) | `app/site/[siteId]/[slug]/page.tsx` (post) |
| Root layout (`app/layout.tsx`) | `app/site/[siteId]/tag/[tag]/page.tsx` |
| Providers (`app/providers.tsx`) | `app/site/[siteId]/feed.xml/route.ts` |
| `lib/` (data, auth, posts, theme-config…) | `app/site/[siteId]/sitemap.xml/route.ts` |
| `components/` (UI, editor, admin) | `README.md` |
| `middleware.ts` | |
| `cms.config.ts` | |
| `package.json`, `tsconfig.json`, etc. | |

The dividing line: anything that differs visually between themes lives
in the overlay; anything that's project plumbing stays shared.

## The manifest (`theme.manifest.ts`)

Every theme declares its customizable surface in `theme.manifest.ts`
at the project root. Admin users edit those fields under
`/admin/sites/<siteId>/theme`; values are persisted to KvStore and
applied at render time as CSS variables (or read by template code).

```ts
import { defineTheme } from 'ampless'

export default defineTheme({
  name: 'blog',
  label: 'Blog',
  description: 'Neutral monochrome with shadcn defaults.',
  fields: [
    {
      key: 'primary',
      label: 'Primary color',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.205 0 0)',
      cssVar: '--primary',
    },
    {
      key: 'radius',
      label: 'Corner radius',
      group: 'Shape',
      type: 'length',
      default: '0.5rem',
      cssVar: '--radius',
    },
  ],
})
```

Each field declares:

- `key` — storage key within the theme namespace. Persisted as
  `theme.<key>` in site settings.
- `label` — shown in the admin form.
- `group` (optional) — groups fields under a heading.
- `description` (optional) — helper text below the input.
- `type` — one of: `color`, `length`, `select`, `image`, `fontFamily`, `text`.
- `default` — used when no override is set; always a string.
- `cssVar` (optional) — if set, the loader injects
  `<cssVar>: <value>` into a `:root` block on every public page.
  Without `cssVar`, the field is data the theme reads via
  `loadThemeConfig()`.
- Type-specific extras:
  - `select` / `fontFamily`: `options: [{ value, label }]`
  - `text`: `maxLength?: number`

### Validation

`validateThemeValue` rejects malformed input before storage:

| Type | Accepted form |
| --- | --- |
| `color` | `oklch(...)`, `oklab(...)`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`, `#rgb` / `#rrggbb` / `#rrggbbaa` |
| `length` | `<number><px\|rem\|em\|%\|vh\|vw>` |
| `select` / `fontFamily` | One of the declared `options` values |
| `image` | `https://...` URL or root-relative `/...` path |
| `text` | Stripped of control chars and `<>`; truncated to `maxLength` |

Stored values that fail validation at render time are silently dropped
and replaced with the manifest default — keeping a typo from breaking
the public site.

## Hooking the manifest into globals.css

Themes consume the CSS variables their manifest produces. The Blog
theme exposes `--primary`, `--accent`, `--ring`, `--destructive`,
`--radius`, and `--ampless-body-font`; its `globals.css` reads them in
the standard shadcn style:

```css
:root {
  --primary: oklch(0.205 0 0); /* default — overridden inline by loader */
  --radius: 0.5rem;
  ...
}
body {
  font-family: var(--ampless-body-font, system-ui, sans-serif);
}
```

The loader emits `<style>:root { --primary: ...; ... }</style>` after
`globals.css`, so any value the user has overridden wins. Defaults you
write in `globals.css` are the **fallback for un-overridden fields**.

## Page layouts

Public routes live under `app/site/[siteId]/`. The middleware rewrites
`https://blog.example.com/some-slug` to `/site/blog/some-slug`
internally, so page params look like `{ siteId: 'blog', slug: 'some-slug' }`.

A theme typically ships:

- `app/site/[siteId]/page.tsx` — homepage (post list)
- `app/site/[siteId]/[slug]/page.tsx` — single post
- `app/site/[siteId]/tag/[tag]/page.tsx` — tag archive
- `app/site/[siteId]/feed.xml/route.ts` — RSS / Atom proxy
- `app/site/[siteId]/sitemap.xml/route.ts` — sitemap proxy

Use the existing libraries from `@/lib/`:

- `loadSiteSettings(siteId)` — site name, description, date format
- `listPublishedPosts({ siteId })` — query published posts
- `getPublishedPost({ siteId, slug })` — single post
- `siteFor(siteId, cmsConfig)` — per-site name/url/description from cms.config

## Adding a new theme

1. **Copy an existing theme directory** as your starting point:
   ```bash
   cp -R templates/blog templates/<your-theme>
   ```
2. **Edit `app/globals.css`** to use your design tokens. Keep the
   `:root { ... }` block — the loader overrides individual variables
   on top of it.
3. **Edit `theme.manifest.ts`** to declare which fields admins should
   be able to tweak online. Keep this minimal — only expose what
   actually makes sense to vary per site.
4. **Re-skin the page layouts** (`app/site/[siteId]/...`) with your
   typography, layout, and component choices. You can introduce
   theme-only components alongside (e.g. `components/<theme>/`) if
   they aren't shared.
5. **Update `README.md`** in the theme directory with a short
   description of what makes this theme distinct.
6. **Register the theme in the CLI**:
   - Add it to the `theme` select options in
     `packages/create-ampless/src/prompts.ts`.
   - Add the directory name to the `THEMES` array in
     `packages/create-ampless/tsup.config.ts` so the npm tarball
     bundles it.
7. **Verify**:
   ```bash
   pnpm --filter create-ampless build
   node packages/create-ampless/dist/index.js /tmp/test-theme
   # pick your new theme, then:
   cd /tmp/test-theme && npm install && npm run dev
   ```

## Storage layout

Theme overrides live alongside other site settings:

```
KvStore PK = `siteconfig:<siteId>`
KvStore SK = `theme.<fieldKey>`   (e.g. `theme.primary`, `theme.radius`)
```

The dispatcher Lambda watches the KvStore stream — any
`siteconfig:*` write triggers a `site.settings.updated` event, and
the trusted processor rebuilds
`s3://<bucket>/public/site-settings/<siteId>.json`.

Public pages read that S3 file via `loadThemeConfig(siteId)`. The
file is fetched with a 60-second Next.js fetch cache, so admin edits
propagate within ~1 minute.

## Why per-theme manifests instead of a unified set?

Different themes have different surfaces. A docs-style theme might
expose a sidebar width and a tagline; a magazine theme might expose
section accent colors and a hero image. Forcing every theme to share
the same fields leads to:

- Themes that ignore irrelevant fields (UI clutter).
- Themes that can't expose their actual knobs (UI poverty).

By tying the manifest to the theme, the admin UI is always faithful
to what the theme can actually do — no more, no less.
