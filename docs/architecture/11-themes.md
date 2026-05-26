> 日本語版: [11-themes.ja.md](./11-themes.ja.md)
> 
## 11. Themes

### Design Philosophy

A theme owns the entire public-side rendering: page components, metadata generators, RSS/sitemap routes, and a customization surface that the admin UI exposes as a form. Themes ship as code inside the project repo, not as runtime-installed bundles — switching between installed themes is a click in the admin; *adding* a new theme is a code change.

The admin UI is a separate concern (shadcn/ui + Tailwind, theme-independent). What we call "theme" only governs the public site.

### Theme Anatomy

A theme is two values, both exported from the theme's `index.ts`:

```typescript
// themes/blog/manifest.ts — customization fields
import { defineTheme } from 'ampless'
export default defineTheme({
  name: 'blog',
  label: { en: 'Blog', ja: 'ブログ' },
  fields: [
    { key: 'primary', type: 'color', default: 'oklch(0.205 0 0)', cssVar: '--primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' } },
    // ...
  ],
})
```

```typescript
// themes/blog/index.ts — runtime module
import { defineThemeModule } from 'ampless'
import manifest from './manifest'
import BlogHome from './pages/home'
import BlogPost, { generatePostMetadata } from './pages/post'
import BlogTag from './pages/tag'
import { blogFeedHandler, blogSitemapHandler } from './pages/feed'

export default defineThemeModule({
  name: 'blog',
  manifest,
  components: { Home: BlogHome, Post: BlogPost, Tag: BlogTag },
  metadata: { Post: generatePostMetadata },
  routes: { feed: blogFeedHandler, sitemap: blogSitemapHandler },
})
```

- **`defineTheme()`** describes the customization fields. The admin UI auto-generates a form from this and stores override values in KvStore under `theme.<key>`.
- **`defineThemeModule()`** is what the public dispatcher consumes. `Home` is required; `Post`, `Tag`, and the `feed` / `sitemap` route handlers are optional — the dispatcher returns 404 when an optional surface is absent.

The full type is in [`packages/ampless/src/theme.ts`](../../packages/ampless/src/theme.ts).

### Themes-Registry

Each project ships a `themes-registry.ts` (regenerated on `create-ampless --upgrade`) that imports every installed theme module and exposes a map plus a `DEFAULT_THEME` constant. `@ampless/runtime` consumes this to resolve the active theme on every request.

### Active Theme Resolution

The active theme name is stored as `theme.active` in KvStore (`pk='siteconfig', sk='theme.active'`). The trusted event processor mirrors KvStore site settings to `public/site-settings.json` on every change, and the public site reads `theme.active` from that JSON.

```
admin UI sets theme.active in KvStore (AppSync mutation)
  → DynamoDB Stream → SQS-trusted → processor-trusted
    → rebuild public/site-settings.json
      → public site reads { 'theme.active': 'dads' } on next request
        → resolveActiveTheme() → themes-registry['dads']
```

`resolveActiveTheme()` ([`packages/runtime/src/theme-active.ts`](../../packages/runtime/src/theme-active.ts)) caches the S3 read with `next.revalidate: 60`, so admin-side changes propagate within ~60 s without a CDK redeploy. Unknown / missing values fall back to `DEFAULT_THEME`.

### Theme Customization

`defineTheme().fields` supports the following types:

| `type` | Storage | Render |
|---|---|---|
| `color` | CSS color string or `light-dark(L, D)` pair | injected as `:root { --<cssVar>: <value> }` |
| `length` | `<n><unit>` (px / rem / em / % / vh / vw) | same — CSS variable |
| `text` | sanitized string (control chars and `<>` stripped) | template reads via `loadThemeConfig()` |
| `select` / `fontFamily` | one of the declared options | CSS variable (or template-read for fontFamily) |
| `image` | URL (rejects `javascript:` / `vbscript:`) | template-read |
| `linkList` | JSON array of `{ label, url }` (incl. `tag:<name>` form) | template-read; renders as nav menus, footer link sets, sidebar groups |

`cssVar`-bound fields are emitted as an inline `:root { ... }` block on every public page. Fields without `cssVar` are exposed to template code via `loadThemeConfig()`. Validation is enforced server-side (`validateThemeValue`) so malformed inputs from the admin form can't break a page's CSS or sneak into the inline style tag.

### Theme Switching and Preview (Admin UI)

The admin's Site → Theme page lets admins switch between installed themes and preview each one in a live iframe before committing.

```
┌────────────────────────────────────────────────┐
│ Site → Theme                                    │
├────────────────┬───────────────────────────────┤
│ Installed:     │   ┌──────────────────────┐    │
│ ● blog (active)│   │  /?previewTheme=dads │    │
│ ○ corporate    │   │  (iframe)            │    │
│ ○ dads         │   └──────────────────────┘    │
│ ○ docs         │                                │
│ ○ landing      │   Customize: primary [■]      │
│ ○ minimal      │              accent  [■]      │
│                │                                │
│                │              [Apply Theme]    │
└────────────────┴───────────────────────────────┘
```

- Preview URL: `/?previewTheme=<name>&previewColorScheme=<light|dark>`. Middleware reads the query and sets an `x-preview-theme` header on the rewritten request; `resolveActiveTheme()` honours that header. Public visitors never see it because the query only sets the header for the admin's iframe context.
- "Apply Theme" calls `setSiteSetting('theme.active', name)` and then polls the S3 cache (via `readStoredActiveThemeFresh`) until the trusted processor has propagated the new value — that way the hard reload after switching doesn't race the cache rebuild.

### Caching

Themes do not pre-render. Every page request runs the theme's server components and emits the response with a `Cache-Control` header computed from `metadata.cache` + `cms.config.cache.*` (see [03-content-management.md](./03-content-management.md#cache-strategy)). The CDN absorbs repeat traffic; the theme Lambda only re-renders when the CDN misses or the cooldown expires.

There is no ISR cache for theme output. Switching themes flips `theme.active` in S3 and the next CDN-miss request picks the new theme up — no per-page cache invalidation pass is needed.

### Slots / Plugin Injection

Themes do **not** expose generic "slot" insertion points. Plugins inject into the page via specific contracts:

- `siteMetadata` / `metadata` — return `<head>` content (title, OG tags, RSS link).
- `ogImage` — provide a JSX renderer that the `app/og/[slug]/route.ts` route consumes.
- `writePublicAsset` — write a static asset (RSS feed, sitemap) that the theme links to from `<head>`.

If a theme wants to surface a custom plugin output inline (e.g. an AdSense unit between the title and body), the theme component decides where to put it — there is no theme-agnostic "before-content" slot.

### Themes Currently Shipped

All six live under `templates/<theme>/` and are copied into the user's repo by `create-ampless`.

| Directory | Use case |
|---|---|
| `blog` | Personal / business blog. Neutral monochrome aesthetic. |
| `corporate` | Corporate site + blog combined. Landing-page-style top with a posts section. |
| `dads` | Digital Agency design system (Japan's `dads` Tailwind plugin). Public-sector / institutional look. |
| `docs` | Documentation handbook. Sidebar nav, per-tag listings, deep-link friendly. |
| `landing` | Single-page landing site. Posts surface as sections. |
| `minimal` | Headless-friendly bare-bones theme. Almost no styling — a starting point for custom builds. |

Per-project theme customization (override one of the shipped themes locally) is covered in `templates/_shared/THEMES.md`.

### Admin UI vs Theme

The admin app (`(admin)/admin/*` routes) is intentionally theme-independent — it's the same shadcn/ui + Tailwind build no matter which theme is active. Site furniture inside the admin (left rail, top bar) comes from `@ampless/runtime/ui`, shared with theme-side site chrome where it makes sense. Themes never override admin styles.

---
