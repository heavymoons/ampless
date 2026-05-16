import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { Ampless } from '../index.js'

interface Props {
  params: Promise<{ siteId: string; tag: string }>
}

export type ThemeTagDispatcher = (props: Props) => Promise<unknown>
export type ThemeTagMetadata = (props: Props) => Promise<Metadata>

/**
 * Tag page dispatcher. Resolves the active theme and renders the
 * theme's `components.Tag` server component. If the theme doesn't
 * declare a Tag component, returns Next.js's notFound() (404).
 */
export function createThemeTagDispatcher(ampless: Ampless): ThemeTagDispatcher {
  return async function SiteTagDispatcher({ params }: Props): Promise<unknown> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const Tag = module.components.Tag
    if (!Tag) notFound()
    return await Tag({ params })
  }
}

/** generateMetadata factory for the tag dispatcher. */
export function createThemeTagMetadata(ampless: Ampless): ThemeTagMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const fn = module.metadata?.Tag
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
