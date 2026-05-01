import { resolveActiveTheme } from '@/lib/theme-active'

interface Ctx {
  params: Promise<{ siteId: string }>
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { siteId } = await params
  const { module } = await resolveActiveTheme(siteId)
  const handler = module.routes?.sitemap
  if (!handler) {
    return new Response('sitemap not implemented for this theme', { status: 404 })
  }
  return handler({ siteId, request })
}
