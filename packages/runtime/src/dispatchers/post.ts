import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { Ampless } from '../index.js'

interface Props {
  params: Promise<{ siteId: string; slug: string }>
}

// Return type must be React.ReactNode-compatible — Next.js 16's
// `AppPageConfig` constraint rejects `Promise<unknown>` at production
// `next build` type-check time even though runtime semantics are
// identical. Use `ReactNode` (via the `react` peer dep) so the
// scaffolded thin shell satisfies the constraint without a cast.
export type ThemePostDispatcher = (props: Props) => Promise<ReactNode>
export type ThemePostMetadata = (props: Props) => Promise<Metadata>

/**
 * Post page dispatcher. Resolves the active theme and renders the
 * theme's `components.Post` server component.
 *
 * Before delegating, the dispatcher peeks at the post's metadata: if
 * `metadata.no_layout === true`, the post is meant to be served as
 * bare HTML (own DOCTYPE, no theme chrome, no Next.js root layout).
 * Next.js page.tsx can't bypass the root layout, so we 308-redirect
 * to the raw route handler at `/raw/<slug>` which returns the body
 * unchanged. The redirect is permanent because no_layout is a
 * persistent property of the post — bookmarks naturally settle on
 * the `/raw/` URL.
 *
 * The metadata peek is an extra AppSync call before theme resolve,
 * but it's the same query the theme's Post component would make
 * anyway; AppSync's query-level dedupe within a single request keeps
 * the wire cost flat in practice.
 *
 * If the theme doesn't declare a Post component at all, returns
 * Next.js's notFound() (404).
 */
export function createThemePostDispatcher(ampless: Ampless): ThemePostDispatcher {
  return async function SitePostDispatcher({ params }: Props): Promise<ReactNode> {
    const { siteId, slug } = await params
    const post = await ampless.getPublishedPost(slug, { siteId })
    if (post?.metadata?.no_layout === true) {
      redirect(`/raw/${slug}`)
    }
    if (post?.format === 'static') {
      // Hand off to the static catch-all. The target URL needs a
      // trailing slash so relative paths inside the bundle resolve
      // against `/<slug>/…` rather than the site root — visiting
      // `/<slug>` would make `<img src="img.png">` load from
      // `/img.png` instead of `/<slug>/img.png`. The catch-all
      // handler itself enforces this too, but doing it here avoids
      // an extra hop.
      const body = (post.body ?? null) as { entrypoint?: string } | null
      const entrypoint =
        typeof body?.entrypoint === 'string' && body.entrypoint
          ? body.entrypoint
          : 'index.html'
      redirect(`/${slug}/${entrypoint}`)
    }
    const { module } = await ampless.resolveActiveTheme(siteId)
    const Post = module.components.Post
    if (!Post) notFound()
    return (await Post({ params })) as ReactNode
  }
}

/** generateMetadata factory for the post dispatcher. */
export function createThemePostMetadata(ampless: Ampless): ThemePostMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const fn = module.metadata?.Post
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
