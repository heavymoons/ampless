// Re-exported from @ampless/backend so the package can ship Lambda
// handler updates via `npm update`. Amplify's esbuild follows this
// import and bundles the real handler into the Lambda artifact.
//
// The dispatcher now also captures per-post revision history. The
// retention window comes from the user-side `cms.config` — the package
// handler never imports `cms.config` directly (it can't know the project
// layout), so this thin shell wires the value in via the factory.
import { createDispatcherHandler } from '@ampless/backend/events/dispatcher'
import config from '../../../cms.config'

export const handler = createDispatcherHandler({
  historyRetentionDays: config.history?.retentionDays ?? 0,
})
