import { admin } from '@/lib/admin'
import { createMediaProxyRoute } from '@ampless/admin/api'

export const { GET } = createMediaProxyRoute(admin)
export const runtime = 'nodejs'
