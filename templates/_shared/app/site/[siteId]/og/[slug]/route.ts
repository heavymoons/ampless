import { ampless } from '@/lib/ampless'
import { createOgRouteHandler } from '@ampless/runtime/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createOgRouteHandler(ampless)
