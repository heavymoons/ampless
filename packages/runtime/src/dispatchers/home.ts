import type { Metadata } from 'next'
import type { Ampless } from '../index.js'

interface Props {
  params: Promise<{ siteId: string }>
}

export type ThemeHomeDispatcher = (props: Props) => Promise<unknown>
export type ThemeHomeMetadata = (props: Props) => Promise<Metadata>

/**
 * Home page dispatcher. Resolves the active theme for the request's
 * siteId and renders the theme's `components.Home` server component
 * with the same `params` Promise it was passed.
 *
 * The return type is `unknown` (cast at the route boundary) because
 * Next.js page-component prop types vary by route shape and the
 * underlying theme components are arbitrary server components.
 */
export function createThemeHomeDispatcher(ampless: Ampless): ThemeHomeDispatcher {
  return async function SiteHomeDispatcher({ params }: Props): Promise<unknown> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const Home = module.components.Home
    // The theme component is a server component; await its render and
    // return the resulting React node.
    return await Home({ params })
  }
}

/** generateMetadata factory for the home dispatcher. */
export function createThemeHomeMetadata(ampless: Ampless): ThemeHomeMetadata {
  return async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId } = await params
    const { module } = await ampless.resolveActiveTheme(siteId)
    const fn = module.metadata?.Home
    return fn ? ((await fn({ params })) as Metadata) : {}
  }
}
