// Back-compat shim. Auth helpers moved to `@ampless/admin` (L2
// extraction). New code should call `admin.getServerSession` /
// `admin.isAdmin` / `admin.isEditor` directly.

import { admin } from './admin'

export type { ServerSession } from '@ampless/admin'

export const getServerSession = admin.getServerSession.bind(admin)
export const isAdmin = admin.isAdmin.bind(admin)
export const isEditor = admin.isEditor.bind(admin)
