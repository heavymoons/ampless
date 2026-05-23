import { ampless } from '@/lib/ampless'
import { createSitemapRouteHandler } from '@ampless/runtime/routes'

export const dynamic = 'force-dynamic'
export const GET = createSitemapRouteHandler(ampless)
