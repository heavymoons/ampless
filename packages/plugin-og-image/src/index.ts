import {
  definePlugin,
  extractFirstImageUrl,
  type AmplessPlugin,
  type Config,
  type OgImageFont,
  type OgImageRenderContext,
  type Post,
} from 'ampless'
import type { ReactElement } from 'react'
import { DefaultCard } from './default-card.js'

export { loadFontFromUrl } from './load-font.js'
export { loadImageForOg } from './load-image.js'
export { DefaultCard } from './default-card.js'

/**
 * Image strategy:
 *  - 'theme'   : use the URL passed in `themeImageUrl`
 *  - 'content' : use the first image found in the post body
 *  - 'none'    : never include an image
 *  - function  : pick the URL yourself (return null to omit)
 */
export type OgImageStrategy =
  | 'theme'
  | 'content'
  | 'none'
  | ((post: Post, site: Config['site']) => string | null | undefined)

export interface OgImagePluginOptions {
  fonts: OgImageFont[]
  size?: { width: number; height: number }
  image?: OgImageStrategy
  themeImageUrl?: string
  /** Override the entire card render. Receives the same context the route hands the plugin. */
  render?: (ctx: OgImageRenderContext) => Promise<ReactElement> | ReactElement
}

function pickImageUrl(
  strategy: OgImageStrategy,
  themeImageUrl: string | undefined,
  post: Post,
  site: Config['site']
): string | null {
  if (typeof strategy === 'function') {
    return strategy(post, site) ?? null
  }
  switch (strategy) {
    case 'theme':
      return themeImageUrl ?? null
    case 'content':
      return extractFirstImageUrl(post)
    case 'none':
    default:
      return null
  }
}

/**
 * OG image plugin. Contributes:
 *  - `metadata(post)` → tells SNS crawlers the per-post OG image URL.
 *  - `ogImage.render(ctx)` → invoked by the dispatcher route at request time.
 *
 * The dispatcher route picks the first plugin in `cms.config.plugins`
 * that has an `ogImage` config, so only register one OG image plugin per site.
 */
export default function ogImagePlugin(options: OgImagePluginOptions): AmplessPlugin {
  if (!options.fonts || options.fonts.length === 0) {
    // Satori refuses to render without a font, and the failure manifests
    // as an opaque 500 from the route. Fail loudly at config time instead.
    throw new Error('[plugin-og-image] at least one font must be provided in `fonts`')
  }

  const size = options.size ?? { width: 1200, height: 630 }
  const strategy: OgImageStrategy = options.image ?? 'content'
  const fontFamily = options.fonts[0].name

  const defaultRender = async (ctx: OgImageRenderContext): Promise<ReactElement> => {
    const url = pickImageUrl(strategy, options.themeImageUrl, ctx.post, ctx.site)
    const imageDataUrl = url ? await ctx.image(url) : null
    return DefaultCard({
      title: ctx.post.title,
      excerpt: ctx.post.excerpt,
      siteName: ctx.site.name,
      imageDataUrl,
      fontFamily,
    })
  }

  return definePlugin({
    name: 'og-image',
    packageName: '@ampless/plugin-og-image',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['metadata'],
    metadata(post, site) {
      const baseUrl = site.url.replace(/\/$/, '')
      const url = `${baseUrl}/og/${post.slug}`
      return {
        openGraph: {
          images: [{ url, width: size.width, height: size.height }],
        },
        twitter: {
          card: 'summary_large_image',
          images: [url],
        },
      }
    },
    ogImage: {
      fonts: options.fonts,
      size,
      render: options.render ?? defaultRender,
    },
  })
}
