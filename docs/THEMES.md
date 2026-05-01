# Authoring Themes for ampless

A theme in ampless is a self-contained module that ships under
`themes/<name>/` in a scaffolded project. **Multiple themes are
installed simultaneously** — each site picks its active theme at
runtime, so a single deployment can render different subdomains with
different themes.

This document explains the layout, the manifest, and how to add a new
theme.

## Big picture

```
project/
  themes/
    blog/
      index.ts           # default export: ThemeModule
      manifest.ts        # default export: ThemeManifest
      tokens.css         # [data-theme='blog'] { --primary: ...; ... }
      pages/
        home.tsx
        post.tsx
        tag.tsx
        feed.ts
        sitemap.ts
    minimal/
      ...
  themes-registry.ts     # imports every installed theme
  app/
    site/[siteId]/       # thin dispatchers — render the active theme
      page.tsx
      [slug]/page.tsx
      tag/[tag]/page.tsx
      feed.xml/route.ts
      sitemap.xml/route.ts
    layout.tsx           # sets <body data-theme={active}>
    globals.css          # default tokens + Tailwind base
    (admin)/             # admin app — theme-agnostic
  cms.config.ts
  ...
```

## Runtime model

1. The middleware rewrites `https://blog.example.com/some-slug` →
   `/site/blog/some-slug` and sets `x-site-id: blog`.
2. The dispatcher (`app/site/[siteId]/page.tsx`) reads `theme.active`
   for that siteId from the S3 site-settings cache.
3. The active theme module is looked up in `themes-registry.ts`, and
   its `components.Home` is rendered with the request params.
4. The root layout sets `<body data-theme="<active>">`, so only the
   matching theme's `tokens.css` block applies.

Switching themes per site = update the `theme.active` setting in the
admin (or via MCP / API). No deploy required.

Adding a new theme = drop `themes/<name>/` in, add it to
`themes-registry.ts`, redeploy.

## What goes where

| Lives in `themes/<name>/` | Lives in `app/` (shared) |
| --- | --- |
| `manifest.ts` (customizable fields) | Dispatcher routes (`app/site/[siteId]/...`) |
| `tokens.css` (CSS variables) | Default tokens (`app/globals.css`) |
| `pages/home.tsx` | Root layout (`app/layout.tsx`) |
| `pages/post.tsx` | Admin app (`app/(admin)/`) |
| `pages/tag.tsx` | Auth pages (`app/login/`) |
| `pages/feed.ts` (RSS handler) | API routes (`app/api/`) |
| `pages/sitemap.ts` (sitemap handler) | Middleware, providers |
| `index.ts` (theme module entry) | |

A theme can ship its own components alongside (e.g.
`themes/<name>/components/`) — anything not under `pages/` is just a
private theme detail.

## The theme module (`index.ts`)

Every theme exports a default `ThemeModule`:

```ts
import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import BlogHome from './pages/home'
import BlogPost, { generatePostMetadata } from './pages/post'
import BlogTag from './pages/tag'
import { blogFeedHandler } from './pages/feed'
import { blogSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'blog',
  manifest,
  components: {
    Home: BlogHome,
    Post: BlogPost,
    Tag: BlogTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: blogFeedHandler,
    sitemap: blogSitemapHandler,
  },
})
```

`tokens.css` is imported as a side effect so Next.js bundles it
whenever the registry pulls this module in. All installed themes' CSS
ships in every page, but only the active theme's `[data-theme="..."]`
selector matches.

### Component contract

Theme components are async server components. Their `params` typing
matches the dispatcher route shape:

```ts
import type { ThemeRouteContext } from 'ampless'

export default async function BlogHome({ params }: ThemeRouteContext) {
  const { siteId } = await params
  // ... fetch posts, render
}

export default async function BlogPost(
  { params }: ThemeRouteContext<{ slug: string }>
) {
  const { siteId, slug } = await params
}
```

`Home` is required. `Post` and `Tag` are optional — the dispatcher
returns 404 if the active theme doesn't define them.

### Route handlers

`routes.feed` and `routes.sitemap` receive `{ siteId, request }` and
must return a `Response`. They're optional; missing handlers produce
404 from the corresponding dispatcher route.

## The manifest (`manifest.ts`)

Declares which fields the admin UI exposes for runtime customization:

```ts
import { defineTheme } from 'ampless'

export default defineTheme({
  name: 'blog',           // must match the theme directory name
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
    // ...
  ],
})
```

Each field has:

- `key` — storage key. Persisted as `theme.<key>` in site settings.
- `label`, `description?`, `group?` — admin UI labels.
- `type` — `color`, `length`, `select`, `image`, `fontFamily`, `text`.
- `default` — value used when no override is set.
- `cssVar?` — if set, the loader injects it into `:root` at render time.

See `validateThemeValue` (in `ampless`) for the accepted formats per
type.

### Per-theme variation

Different themes can declare different fields. Blog might expose
`primary / accent / radius / bodyFont`; Minimal might only expose
`primary / radius`; a docs theme might expose `sidebarWidth /
codeFont`. The admin form is generated from whichever theme is active,
so it always matches the theme's actual customization surface.

## Tokens CSS

Each theme ships `tokens.css` with its design tokens scoped under
`[data-theme='<name>']`:

```css
[data-theme='blog'] {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --radius: 0.5rem;
  --ampless-body-font: system-ui, sans-serif;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  [data-theme='blog'] {
    --background: oklch(0.145 0 0);
    /* ... */
  }
}
```

The shared `app/globals.css` defines the same tokens at `:root` as
fallbacks. The active theme's scoped block always wins because the
attribute selector and `:root` selector have the same specificity, but
the attribute one comes later in the cascade (theme tokens.css imports
follow globals.css in the bundle).

Manifest field overrides come in via inline `<style>:root { ... }</style>`
in the document head, so they override the scoped tokens block too.

## Adding a new theme

1. **Copy an existing theme directory:**
   ```bash
   cp -R themes/blog themes/your-theme
   ```
2. **Rewrite `manifest.ts`** — change `name`, `label`, and which
   fields you want to expose.
3. **Edit `tokens.css`** — change the selector to
   `[data-theme='your-theme']` and pick your design tokens.
4. **Edit `pages/*.tsx`** — re-skin layouts. Keep the
   `ThemeRouteContext` typing on the default exports.
5. **Update `themes-registry.ts`** to import the new theme:
   ```ts
   import yourTheme from '@/themes/your-theme'

   export const themes = {
     blog,
     minimal,
     'your-theme': yourTheme,
   } as const
   ```
6. **Update create-ampless** if you want the theme to ship in the npm
   tarball:
   - Add to `THEMES` in `packages/create-ampless/tsup.config.ts`.
   - Add to the `themes` multiselect options in
     `packages/create-ampless/src/prompts.ts`.
7. **Verify**:
   ```bash
   npm run dev
   # admin: /admin/sites/<siteId>/theme → switch to your-theme
   ```

## Storage layout

| Setting | Storage |
| --- | --- |
| Active theme per site | KvStore PK `siteconfig:<siteId>`, SK `theme.active`, value = theme name |
| Manifest field overrides | KvStore PK `siteconfig:<siteId>`, SK `theme.<fieldKey>` |

Both flow through the existing site-settings cache pipeline (KvStore
stream → trusted processor → `s3://<bucket>/public/site-settings/<siteId>.json`).
The public site reads that JSON file with a 60-second Next.js fetch
cache; admin edits propagate within ~1 minute.

## Why per-theme manifests instead of a unified set?

Different themes have different surfaces. Forcing every theme to share
the same fields leads to:

- Themes that ignore irrelevant fields (UI clutter).
- Themes that can't expose their actual knobs (UI poverty).

By tying the manifest to the theme, the admin UI is always faithful to
what the theme can actually do — no more, no less.

## Why bundle every installed theme even when only one is active?

Switching themes should be instant — a single setting change, no
deploy. Static-importing each theme means Next.js's bundler ships them
all, so the active theme can change without rebuilding. The cost is a
larger bundle proportional to the number of installed themes; the
benefit is no rebuild on every theme decision.

If a theme stops being used, remove it: drop `themes/<name>/` and the
import + map entry in `themes-registry.ts`, then redeploy.
