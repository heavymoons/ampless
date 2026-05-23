> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/runtime

Public-side runtime for [ampless](https://github.com/heavymoons/ampless). Bundles the post-fetching client, site settings, theme resolution, SEO metadata aggregation, middleware, and public route handlers behind a single `createAmpless()` factory.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Splitting this out of the template lets you `npm update @ampless/runtime` without touching scaffolded files — public-site behaviour upgrades come in through the package, not by re-running the scaffolder.

## Install

```bash
npm install @ampless/runtime@alpha ampless@alpha
```

`@ampless/runtime` declares peer dependencies on `next` (15+), `react` (18/19), `aws-amplify` (6+), and `@aws-amplify/adapter-nextjs` (1+). The CLI scaffolder pins compatible versions in the template's `package.json`.

## Usage

Templates create one shared instance at `lib/ampless.ts`:

```ts
import outputs from '../amplify_outputs.json'
import cmsConfig from '../cms.config'
import { themes, DEFAULT_THEME } from '../themes-registry'
import { createAmpless } from '@ampless/runtime'

export const ampless = createAmpless({
  outputs,
  cmsConfig,
  themes: { themes, defaultTheme: DEFAULT_THEME },
})
```

Routes and dispatchers under `app/` become one-line factory invocations:

```ts
// app/page.tsx
import { ampless } from '@/lib/ampless'
import {
  createThemeHomeDispatcher,
  createThemeHomeMetadata,
} from '@ampless/runtime/dispatchers'

export const dynamic = 'force-dynamic'
export const generateMetadata = createThemeHomeMetadata(ampless)
export default createThemeHomeDispatcher(ampless)
```

```ts
// app/og/[slug]/route.ts
import { ampless } from '@/lib/ampless'
import { createOgRouteHandler } from '@ampless/runtime/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createOgRouteHandler(ampless)
```

Middleware (proxy):

```ts
// proxy.ts (Next.js 16 rename of middleware.ts)
import cmsConfig from './cms.config'
import outputs from './amplify_outputs.json'
import { createAmplessMiddleware } from '@ampless/runtime/middleware'

export const proxy = createAmplessMiddleware({
  cmsConfig,
  appsyncUrl: outputs.data.url,
  apiKey: outputs.data.api_key!,
})

// Inline the matcher — Next.js 16's Turbopack requires
// `export const config` to be a static object literal.
export const config = {
  matcher: [
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
```

The middleware fetches `post.format` / `post.metadata` / `post.updatedAt`
from AppSync (apiKey auth) on each request, caches the result in a
200-entry LRU keyed by slug (60-second TTL, Lambda module scope), and
rewrites the request to the right internal handler:

- themed post → no rewrite, served by `app/[slug]/page.tsx`
- `metadata.no_layout: true` HTML / `format: 'static'` → `/r/<slug>(/<path>)`,
  served by `app/r/[slug]/[[...path]]/route.ts`

It also computes `Cache-Control` from `post.metadata.cache` (auto /
deep / hot) + `post.updatedAt` + `cms.config.cache.{cooldownMs,
freshTtlSeconds, deepTtlSeconds}` and sets the header on the response.
See `docs/CONTENT.md` for the cache strategy contract.

## Sub-paths

- `@ampless/runtime` — `createAmpless`, runtime types, and re-exports of `renderBody`, `renderThemeCss`, format converters
- `@ampless/runtime/middleware` — `createAmplessMiddleware`, `defaultMatcherConfig`
- `@ampless/runtime/routes` — `createOgRouteHandler`, `createSitemapRouteHandler`, `createFeedRouteHandler`, `createUnderscoreRouteHandler`
- `@ampless/runtime/dispatchers` — `createThemeHomeDispatcher`, `createThemePostDispatcher`, `createThemeTagDispatcher` (each with a matching `*Metadata` factory)

## What's still in the template

Admin-side modules (post providers, theme actions, auth, kv writes) and theme components stay in the scaffold. They move into `@ampless/admin` in a later release; until then, edits to those files belong in the user's project.

## License

MIT
