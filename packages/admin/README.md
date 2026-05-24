> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/admin

Admin UI library for [ampless](https://github.com/heavymoons/ampless): post
editor (Tiptap + Markdown + HTML), media manager (S3 + image processing),
site/theme settings, locale-aware UI strings, and the Next.js page
factories that wire it all together.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

## Why a library?

Shipping the admin UI as `@ampless/admin` lets a project pick up
fixes and features with `npm update @ampless/admin` — the same upgrade
flow as any other dependency, without copy-pasting files between the
template and downstream sites.

## Install

```bash
npm install @ampless/admin@alpha @ampless/runtime@alpha ampless@alpha
```

Peer-installs: `next`, `react`, `react-dom`, `aws-amplify`,
`@aws-amplify/adapter-nextjs`.

## Wire-up

Create `lib/admin.ts` in your Next.js project:

```ts
import outputs from '../amplify_outputs.json'
import cmsConfig from '../cms.config'
import { createAdmin } from '@ampless/admin'
import { ampless } from './ampless'

export const admin = createAdmin({ outputs, cmsConfig, ampless })
export const t = admin.t
```

Then expose each admin route as a thin shell:

```tsx
// app/(admin)/admin/posts/page.tsx
import { admin } from '@/lib/admin'
import { createPostsListPage } from '@ampless/admin/pages'
export default createPostsListPage(admin)
```

```ts
// app/api/media/[...path]/route.ts
import { admin } from '@/lib/admin'
import { createMediaProxyRoute } from '@ampless/admin/api'
export const { GET } = createMediaProxyRoute(admin)
export const runtime = 'nodejs'
```

## Sub-paths

| Subpath                       | Contains                                            |
| ----------------------------- | --------------------------------------------------- |
| `@ampless/admin`              | `createAdmin` factory + `Admin` interface           |
| `@ampless/admin/pages`        | Page factories — one per admin route                |
| `@ampless/admin/api`          | API route factories (`createMediaProxyRoute`, ...)  |
| `@ampless/admin/components`   | Form / editor components for advanced wiring        |

## Locale

`createAdmin({ locale: 'ja' })` switches admin UI strings to Japanese.
Pass an object literal to override individual strings:

```ts
createAdmin({
  outputs,
  cmsConfig,
  locale: { sidebar: { brand: 'MySite Admin' } },
})
```
