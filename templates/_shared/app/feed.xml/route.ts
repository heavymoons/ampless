import { ampless } from '@/lib/ampless'
import { createFeedRouteHandler } from '@ampless/runtime/routes'

export const dynamic = 'force-dynamic'
export const GET = createFeedRouteHandler(ampless)
