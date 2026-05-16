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

Routes and dispatchers under `app/site/[siteId]/` become one-line factory invocations:

```ts
// app/site/[siteId]/page.tsx
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
// app/site/[siteId]/og/[slug]/route.ts
import { ampless } from '@/lib/ampless'
import { createOgRouteHandler } from '@ampless/runtime/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createOgRouteHandler(ampless)
```

Middleware:

```ts
// middleware.ts
import cmsConfig from './cms.config'
import { createAmplessMiddleware, defaultMatcherConfig } from '@ampless/runtime/middleware'

export const middleware = createAmplessMiddleware({ cmsConfig })
export const config = defaultMatcherConfig
```

## Sub-paths

- `@ampless/runtime` — `createAmpless`, runtime types, and re-exports of `renderBody`, `renderThemeCss`, format converters
- `@ampless/runtime/middleware` — `createAmplessMiddleware`, `defaultMatcherConfig`
- `@ampless/runtime/routes` — `createOgRouteHandler`, `createSitemapRouteHandler`, `createFeedRouteHandler`, `createRawRouteHandler`
- `@ampless/runtime/dispatchers` — `createThemeHomeDispatcher`, `createThemePostDispatcher`, `createThemeTagDispatcher` (each with a matching `*Metadata` factory)

## What's still in the template

Admin-side modules (post providers, theme actions, auth, kv writes) and theme components stay in the scaffold. They move into `@ampless/admin` in a later release; until then, edits to those files belong in the user's project.

## License

MIT
