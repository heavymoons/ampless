import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { Ampless } from '../index.js'

// File route is `app/[slug]/page.tsx` — Next.js extracts the single
// `slug` dynamic segment. The siteId segment was dropped when the
// public URL structure was flattened (PR feat/middleware-driven-routing,
// see the changeset for the motivation). Themes that consume params
// see only `{ slug }`.
interface Props {
  params: Promise<{ slug: string }>
}

// Return type must be React.ReactNode-compatible — Next.js 16's
// `AppPageConfig` constraint rejects `Promise<unknown>` at production
// `next build` type-check time even though runtime semantics are
// identical. Use `ReactNode` (via the `react` peer dep) so the
// scaffolded thin shell satisfies the constraint without a cast.
export type ThemePostDispatcher = (props: Props) => Promise<ReactNode>
export type ThemePostMetadata = (props: Props) => Promise<Metadata>

/**
 * Themed post page dispatcher. Resolves the active theme and renders
 * the theme's `components.Post` server component.
 *
 * Routing decision (no_layout HTML vs static bundle vs themed) lives
 * in middleware now — middleware fetches `post.format` /
 * `post.metadata` / `post.updatedAt` from AppSync once per slug
 * (Lambda-memory LRU, 60s TTL) and rewrites the request to either
 * this dispatcher (themed render) or the unified route handler at
 * `/r/<slug>(/...)` (no_layout HTML or static bundle). That keeps the
 * decision in one place and avoids the dispatcher's extra AppSync
 * round-trip when the post is a themed render.
 *
 * If the theme doesn't declare a Post component at all, returns
 * Next.js's notFound() (404).
 */
export function createThemePostDispatcher(ampless: Ampless): ThemePostDispatcher {
  return async function SitePostDispatcher({ params }: Props): Promise<ReactNode> {
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
