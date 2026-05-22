import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { Ampless } from '../index.js'

// `siteId` is still in the params shape because the file route is
// `app/site/[siteId]/[slug]/page.tsx` — Next.js extracts every dynamic
// segment regardless of what we do with the value. Keep the type
// honest so callers / theme Post components see the same params shape
// they get at runtime. The dispatcher itself ignores the field.
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
 * Before delegating, the dispatcher peeks at the post's data and
 * 308-redirects to `/_/<slug>` for both formats that need to bypass
 * the theme's post page:
 *
 *  - `metadata.no_layout === true` — the body is its own complete
 *    HTML document and ships as the entire response. The unified
 *    route handler at `/_/<slug>` emits the body verbatim.
 *  - `format === 'static'` — the body is a manifest pointing at a
 *    bundle of files in S3. The unified route handler then 308s
 *    again to `/_/<slug>/` (trailing slash) so relative paths inside
 *    the bundle resolve correctly.
 *
 * Why the redirect lands on `/_/<slug>` rather than `/_/<slug>/` for
 * static posts: trailing-slash anchoring is the unified route
 * handler's responsibility — keeps the dispatcher format-agnostic
 * and the public URL pattern symmetric (no_layout and static both
 * settle on `/_/<slug>(/...)`). One extra 308 round-trip is cheap;
 * it deduplicates the trailing-slash branch into a single place.
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
    const { slug } = await params
    const post = await ampless.getPublishedPost(slug)
    if (post?.metadata?.no_layout === true || post?.format === 'static') {
      redirect(`/_/${slug}`)
    }
    const { module } = await ampless.resolveActiveTheme()
    const Post = module.components.Post
    if (!Post) notFound()
    return (await Post({ params })) as ReactNode
  }
}

/** generateMetadata factory for the post dispatcher. */
export function createThemePostMetadata(ampless: Ampless): ThemePostMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { module } = await ampless.resolveActiveTheme()
    const fn = module.metadata?.Post
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
