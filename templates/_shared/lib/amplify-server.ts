// Back-compat shim. The Amplify SSR server runner moved to
// `@ampless/admin` (L2 extraction). Existing call sites that import
// `runWithAmplifyServerContext` from here keep working.

import { admin } from './admin'

export const { runWithAmplifyServerContext } = admin.amplifyServer
