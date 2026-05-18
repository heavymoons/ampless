// Client-side Amplify SDK setup. Imported as a side-effect from
// `app/providers.tsx` so it runs on every page load (public + admin +
// login). `<AdminProviders>` (mounted by the admin layout factory)
// also performs this configuration, but it only runs for routes under
// the (admin) group; `/login` is a top-level route outside that group
// and would otherwise hit "Auth UserPool not configured" because no
// AdminProviders has bootstrapped the SDK yet.
//
// `Amplify.configure` is idempotent — calling it once at the root and
// again inside AdminProviders is harmless.

import { Amplify } from 'aws-amplify'
import outputs from '../amplify_outputs.json'

Amplify.configure(outputs, { ssr: true })

export function configureAmplify() {
  // module-level side effect above already ran; keep this as a no-op
  // for callers that still import it as a function for back-compat.
}
