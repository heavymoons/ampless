---
"@ampless/backend": minor
"create-ampless": patch
---

**Breaking:** Replace `defineAmplessAuth` / `defineAmplessStorage` with `amplessAuthConfig` / `amplessStorageConfig` config-builder helpers. The Amplify factory call (`defineAuth` / `defineStorage`) now happens in the user's `amplify/{auth,storage}/resource.ts` directly.

Amplify Gen 2's import-path verifier inspects the stack trace of `defineAuth` / `defineData` / `defineStorage` and requires the call to originate from `amplify/{auth,data,storage}/resource.ts`. Wrapping those factories in this package made every `ampx sandbox` / deploy fail with `Amplify Auth must be defined in amplify/auth/resource.ts`. Returning a config object instead lets the user invoke the Amplify factory from the canonical location.

Migration in `amplify/auth/resource.ts`:

```ts
// before
import { defineAmplessAuth } from '@ampless/backend'
export const auth = defineAmplessAuth({ postConfirmation })

// after
import { defineAuth } from '@aws-amplify/backend'
import { amplessAuthConfig } from '@ampless/backend'
export const auth = defineAuth(amplessAuthConfig({ postConfirmation }))
```

Same shape for `amplify/storage/resource.ts` (`defineStorage(amplessStorageConfig())`). The `templates/_shared/amplify/{auth,storage}/resource.ts` shells in `create-ampless` have been updated, so new scaffolds pick this up automatically.
