import { admin } from '@/lib/admin'
import { createPreviewRouteHandler } from '@ampless/admin/api'

export const POST = createPreviewRouteHandler(admin)
