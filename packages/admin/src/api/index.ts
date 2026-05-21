// `@ampless/admin/api` — Next.js Route Handler factories.
//
// Each factory takes the `Admin` instance and returns an object whose
// keys correspond to HTTP methods (`GET`, `POST`, ...). Templates
// destructure the handlers in their route file:
//
//     // app/api/media/[...path]/route.ts
//     import { admin } from '@/lib/admin'
//     import { createMediaProxyRoute } from '@ampless/admin/api'
//     export const { GET } = createMediaProxyRoute(admin)
//     export const runtime = 'nodejs'

export { createMediaProxyRoute } from './media-proxy.js'
