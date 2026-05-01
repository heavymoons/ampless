import type { Metadata } from 'next'
import { resolveActiveTheme } from '@/lib/theme-active'

interface Props {
  params: Promise<{ siteId: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const fn = module.metadata?.Home
  return fn ? ((await fn({ params })) as Metadata) : {}
}

export default async function SiteHomeDispatcher({ params }: Props) {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const Home = module.components.Home
  // The theme component is a server component; await its render and
  // return the resulting React node. Cast covers Promise<unknown>.
  return (await Home({ params })) as React.ReactNode
}
