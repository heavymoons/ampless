import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveActiveTheme } from '@/lib/theme-active'

interface Props {
  params: Promise<{ siteId: string; slug: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const fn = module.metadata?.Post
  return fn ? ((await fn({ params })) as Metadata) : {}
}

export default async function SitePostDispatcher({ params }: Props) {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const Post = module.components.Post
  if (!Post) notFound()
  return (await Post({ params })) as React.ReactNode
}
