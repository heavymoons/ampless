'use client'

import { Amplify } from 'aws-amplify'
import type { AmplessOutputs } from '@ampless/runtime'

let configured = false

/**
 * Configure the global Amplify SDK on the client. Safe to call
 * repeatedly — only the first call actually wires `Amplify.configure`.
 * Called once from the admin layout factory so every client component
 * downstream (forms, editor, media picker) sees an initialised SDK.
 */
export function configureAmplify(outputs: AmplessOutputs) {
  if (configured) return
  Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0], { ssr: true })
  configured = true
}
