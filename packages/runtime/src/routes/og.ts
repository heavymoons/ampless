// Per-post OG image dispatcher. Twitter / Facebook / Slack crawlers hit
// `/og/<slug>` (or `/og/<slug>.png`) and we return a freshly rendered PNG
// generated via Next.js `ImageResponse`.
//
// The actual JSX, image strategy, fonts, and size come from whichever
// plugin in `cms.config.plugins` declares an `ogImage` config (typically
// `@ampless/plugin-og-image`). This route is a thin adapter so themes /
// projects don't have to repeat the wiring.

import { ImageResponse } from 'next/og'
import type { AmplessPlugin } from 'ampless'
import { loadImageForOg } from '@ampless/plugin-og-image/load-image'
import type { Ampless } from '../index.js'

interface Ctx {
  params: Promise<{ siteId: string; slug: string }>
}

export type OgRouteHandler = (req: Request, ctx: Ctx) => Promise<Response>

function hasOgImage(
  p: unknown
): p is AmplessPlugin & { ogImage: NonNullable<AmplessPlugin['ogImage']> } {
  return (
    typeof p === 'object' &&
    p !== null &&
    'ogImage' in p &&
    (p as { ogImage?: unknown }).ogImage != null
  )
}

export function createOgRouteHandler(ampless: Ampless): OgRouteHandler {
  return async function GET(_req: Request, { params }: Ctx): Promise<Response> {
    const { slug } = await params
    // Allow `/og/<slug>` and `/og/<slug>.png` — some crawlers append the
    // extension based on the metadata image URL's path.
    const cleanSlug = slug.replace(/\.png$/, '')

    const post = await ampless.getPublishedPost(cleanSlug)
    if (!post) return new Response('not found', { status: 404 })

    const plugin = (ampless.cmsConfig.plugins ?? []).find(hasOgImage)
    if (!plugin) return new Response('og not configured', { status: 404 })

    const settings = await ampless.loadSiteSettings()

    // Resolve lazy font loaders once per request. The plugin's loader
    // caches in-process so this is cheap on warm Lambdas.
    const fonts = await Promise.all(
      plugin.ogImage.fonts.map(async (f) => ({
        name: f.name,
        data: typeof f.data === 'function' ? await f.data() : f.data,
        weight: f.weight,
        style: f.style,
      }))
    )

    const element = await plugin.ogImage.render({
      post,
      site: settings.site,
      image: loadImageForOg,
    })

    // Cast through unknown: the plugin's `render` returns React elements
    // typed loosely (so ampless core doesn't depend on React), and
    // `ImageResponse`'s constructor types live in next/og — bridging the
    // two without pulling either dependency type into the route header.
    // The `fonts` weight type is narrowed (100..900) in next/og but the
    // plugin contract uses plain number, so we cast at the boundary.
    type ImageResponseArgs = ConstructorParameters<typeof ImageResponse>
    const options = {
      width: plugin.ogImage.size?.width ?? 1200,
      height: plugin.ogImage.size?.height ?? 630,
      fonts,
      headers: {
        // Short browser TTL, long CDN TTL: when a post is edited the
        // browser refetches within an hour but the Amplify-fronted
        // CloudFront stays warm for a day.
        'Cache-Control':
          'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    } as unknown as ImageResponseArgs[1]
    return new ImageResponse(element as ImageResponseArgs[0], options)
  }
}
