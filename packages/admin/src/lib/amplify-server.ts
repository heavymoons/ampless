import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import type { AmplessOutputs } from '@ampless/runtime'

/**
 * Build a Next.js Amplify server runner from outputs. Returns the
 * `runWithAmplifyServerContext` helper used by API routes / server
 * components that need cookie-aware Amplify calls (auth, signed-URL
 * media proxy).
 */
export function createAmplifyServer(outputs: AmplessOutputs) {
  return createServerRunner({
    config: outputs as Parameters<typeof createServerRunner>[0]['config'],
  })
}

export type AmplifyServer = ReturnType<typeof createAmplifyServer>
