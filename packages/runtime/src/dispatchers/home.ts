import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import type { Ampless } from '../index.js'

interface Props {
  params: Promise<{ siteId: string }>
}

// Use `ReactNode` (via the `react` peer dep) — `Promise<unknown>`
// trips Next.js 16's `AppPageConfig` type check during `next build`.
export type ThemeHomeDispatcher = (props: Props) => Promise<ReactNode>
export type ThemeHomeMetadata = (props: Props) => Promise<Metadata>

/**
 * Home page dispatcher. Resolves the active theme and renders the
 * theme's `components.Home` server component with the same `params`
 * Promise it was passed.
 */
export function createThemeHomeDispatcher(ampless: Ampless): ThemeHomeDispatcher {
  return async function SiteHomeDispatcher({ params }: Props): Promise<ReactNode> {
    const { module } = await ampless.resolveActiveTheme()
    const Home = module.components.Home
    return (await Home({ params })) as ReactNode
  }
}

/** generateMetadata factory for the home dispatcher. */
export function createThemeHomeMetadata(ampless: Ampless): ThemeHomeMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { module } = await ampless.resolveActiveTheme()
    const fn = module.metadata?.Home
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
