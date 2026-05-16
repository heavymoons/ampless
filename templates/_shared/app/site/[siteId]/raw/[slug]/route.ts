import { ampless } from '@/lib/ampless'
import { createRawRouteHandler } from '@ampless/runtime/routes'

export const dynamic = 'force-dynamic'
export const GET = createRawRouteHandler(ampless)
