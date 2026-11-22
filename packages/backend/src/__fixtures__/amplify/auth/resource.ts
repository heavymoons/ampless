// Test-only fixture. `defineAuth` must be called from a file whose path
// ends in `amplify/auth/resource` (Amplify's import-path verifier), hence
// this directory layout.
import { defineAuth } from '@aws-amplify/backend'
import { amplessAuthConfig } from '../../../auth/index.js'
import { resettableSingleton } from '../singleton.js'

export const makeAuth = resettableSingleton((postConfirmation: unknown): unknown =>
  defineAuth(amplessAuthConfig({ postConfirmation }))
)
