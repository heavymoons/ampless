import { defineAmplessBackend } from '@ampless/backend'

import { auth } from './auth/resource.js'
import { data } from './data/resource.js'
import { storage } from './storage/resource.js'
import { postConfirmation } from './auth/post-confirmation/resource.js'
import { eventDispatcher } from './events/dispatcher/resource.js'
import { processorTrusted } from './events/processor-trusted/resource.js'
import { processorUntrusted } from './events/processor-untrusted/resource.js'
import { apiKeyRenewer } from './functions/api-key-renewer/resource.js'
import { userAdmin } from './functions/user-admin/resource.js'
import { customizeBackend } from './backend.custom.js'

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
  userAdmin,
})

// Run user-defined customizations after baseline wiring. `backend.custom.ts`
// is never overwritten by `create-ampless upgrade`.
customizeBackend(backend)

export default backend
