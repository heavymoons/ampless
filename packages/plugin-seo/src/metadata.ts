import type { Post, Config, PluginMetadata } from 'ampless'

export interface SeoMetadataOptions {
  /** Default OGP image URL when a post has no image override. */
  defaultOgImage?: string
  /** Twitter site handle, e.g. "@example". */
  twitterSite?: string
  /** Twitter creator handle, e.g. "@author". */
  twitterCreator?: string
  /** OGP card type for post pages. Default 'summary_large_image'. */
  twitterCard?: 'summary' | 'summary_large_image'
}

export function buildPostMetadata(
  post: Post,
  site: Config['site'],
  options: SeoMetadataOptions = {}
): PluginMetadata {
  const baseUrl = site.url.replace(/\/$/, '')
  const url = `${baseUrl}/${post.slug}`
  const description = post.excerpt ?? site.description ?? ''
  const ogImage = options.defaultOgImage

  return {
    title: post.title,
    description,
    openGraph: {
      title: post.title,
      description,
      type: 'article',
      url,
      ...(ogImage && { images: [{ url: ogImage }] }),
    },
    twitter: {
      card: options.twitterCard ?? 'summary_large_image',
      title: post.title,
      description,
      ...(options.twitterSite && { site: options.twitterSite }),
      ...(options.twitterCreator && { creator: options.twitterCreator }),
      ...(ogImage && { images: [ogImage] }),
    },
    alternates: { canonical: url },
  }
}

export function buildSiteMetadata(
  site: Config['site'],
  options: SeoMetadataOptions = {}
): PluginMetadata {
  const description = site.description ?? site.name
  return {
    title: site.name,
    description,
    openGraph: {
      title: site.name,
      description,
      type: 'website',
      url: site.url,
      ...(options.defaultOgImage && { images: [{ url: options.defaultOgImage }] }),
    },
    twitter: {
      card: 'summary',
      title: site.name,
      description,
      ...(options.twitterSite && { site: options.twitterSite }),
    },
  }
}
