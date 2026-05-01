import { notFound } from 'next/navigation'
import { resolveActiveTheme } from '@/lib/theme-active'

interface Props {
  params: Promise<{ siteId: string; tag: string }>
}

export const dynamic = 'force-dynamic'

export default async function SiteTagDispatcher({ params }: Props) {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const Tag = module.components.Tag
  if (!Tag) notFound()
  return (await Tag({ params })) as React.ReactNode
}
