import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { Ampless } from '../index.js'

// File route is `app/tag/[tag]/page.tsx` — only the `tag` segment
// remains after the URL flatten.
interface Props {
  params: Promise<{ tag: string }>
}

// Use `ReactNode` (via the `react` peer dep) — `Promise<unknown>`
// trips Next.js 16's `AppPageConfig` type check during `next build`.
export type ThemeTagDispatcher = (props: Props) => Promise<ReactNode>
export type ThemeTagMetadata = (props: Props) => Promise<Metadata>

/**
 * Tag page dispatcher. Resolves the active theme and renders the
 * theme's `components.Tag` server component. If the theme doesn't
 * declare a Tag component, returns Next.js's notFound() (404).
 */
export function createThemeTagDispatcher(ampless: Ampless): ThemeTagDispatcher {
  return async function SiteTagDispatcher({ params }: Props): Promise<ReactNode> {
    const { module } = await ampless.resolveActiveTheme()
    const Tag = module.components.Tag
    if (!Tag) notFound()
    return (await Tag({ params })) as ReactNode
  }
}

/** generateMetadata factory for the tag dispatcher. */
export function createThemeTagMetadata(ampless: Ampless): ThemeTagMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { module } = await ampless.resolveActiveTheme()
    const fn = module.metadata?.Tag
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
