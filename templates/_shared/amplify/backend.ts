import { defineAmplessBackend } from '@ampless/backend'

import { auth } from './auth/resource.js'
import { data } from './data/resource.js'
import { storage } from './storage/resource.js'
import { postConfirmation } from './auth/post-confirmation/resource.js'
import { eventDispatcher } from './events/dispatcher/resource.js'
import { processorTrusted } from './events/processor-trusted/resource.js'
import { processorUntrusted } from './events/processor-untrusted/resource.js'
import { apiKeyRenewer } from './functions/api-key-renewer/resource.js'
import { mcpHandler } from './functions/mcp-handler/resource.js'
import { userAdmin } from './functions/user-admin/resource.js'
import { pluginSecretHandler } from './functions/plugin-secret-handler/resource.js'
import { customizeBackend } from './backend.custom.js'
// Plugin secret encryption key (Phase 6a v2.2).
// Generate with: npx create-ampless@beta setup-encryption-key
// The key lives in amplify/secrets/encryption-key.ts (gitignore it for
// public repos; safe to commit for private repos).
import { PLUGIN_SECRET_ENCRYPTION_KEY } from './secrets/encryption-key.js'

// `defineAmplessBackend` provisions auth, data, storage, the event
// system (DynamoDB Streams → SQS-trusted / SQS-untrusted → trust_level
// Lambdas), the AppSync API key renewer, and every IAM / CORS /
// password policy override. Add custom CDK constructs / IAM policies
// in `amplify/backend.custom.ts` by mutating the `backend` instance —
// `defineAmplessBackend` returns the same object Amplify Gen 2's
// `defineBackend` does.
const backend = defineAmplessBackend({
  auth,
  data,
  storage,
  postConfirmation,
  eventDispatcher,
  processorTrusted,
  processorUntrusted,
  apiKeyRenewer,
  mcpHandler,
  userAdmin,
  pluginSecretHandler,
  pluginSecretEncryptionKey: PLUGIN_SECRET_ENCRYPTION_KEY,
})

// Run user-defined customizations after baseline wiring. `backend.custom.ts`
// is never overwritten by `create-ampless upgrade`.
customizeBackend(backend)

export default backend
