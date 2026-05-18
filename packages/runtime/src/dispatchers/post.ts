import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
 * theme's `components.Post` server component. If the theme doesn't
 * declare a Post component, returns Next.js's notFound() (404).
 */
export function createThemePostDispatcher(ampless: Ampless): ThemePostDispatcher {
  return async function SitePostDispatcher({ params }: Props): Promise<ReactNode> {
    const { siteId } = await params
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
