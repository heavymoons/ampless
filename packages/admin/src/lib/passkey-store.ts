/**
 * Injectable registry for the admin account page's passkey operations.
 * Mirrors the `setMcpTokenStore` pattern: the production default wraps
 * `aws-amplify/auth`'s WebAuthn APIs, while tests inject an in-memory
 * fake via `setPasskeyApi` (no DOM / Cognito required).
 *
 * Amplify types `credentialId` and `createdAt` as possibly `undefined`
 * (the Cognito list response is permissive). We normalise the raw list
 * here so the view only ever sees a `PasskeyCredential` with a usable
 * `credentialId` — entries without one are dropped, because they can't
 * be displayed as a deletable row anyway.
 */

import {
  associateWebAuthnCredential,
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
} from 'aws-amplify/auth'

/** A passkey credential after normalisation, safe for the view to render. */
export interface PasskeyCredential {
  /** Stable identifier; required for deletion. Never undefined here. */
  credentialId: string
  /** Operator-friendly label set at registration, or undefined. */
  friendlyName: string | undefined
  /** ISO 8601 creation timestamp, or null when Cognito omitted it. */
  createdAt: string | null
}

export interface PasskeyApi {
  /** Register a new passkey for the signed-in user (runs the ceremony). */
  register(): Promise<void>
  /** List the signed-in user's passkeys, normalised + sorted newest-first. */
  list(): Promise<PasskeyCredential[]>
  /** Delete a passkey by its credential id. */
  remove(credentialId: string): Promise<void>
}

/**
 * Production implementation backed by `aws-amplify/auth`. Pages the full
 * credential list (Cognito returns a `nextToken`), normalises each entry,
 * and drops any that lack a `credentialId`.
 */
const defaultPasskeyApi: PasskeyApi = {
  async register() {
    await associateWebAuthnCredential()
  },
  async list() {
    const credentials: PasskeyCredential[] = []
    let nextToken: string | undefined
    do {
      const page = await listWebAuthnCredentials(nextToken ? { nextToken } : undefined)
      for (const cred of page.credentials) {
        if (!cred.credentialId) continue
        credentials.push({
          credentialId: cred.credentialId,
          friendlyName: cred.friendlyCredentialName,
          createdAt: cred.createdAt ? cred.createdAt.toISOString() : null,
        })
      }
      nextToken = page.nextToken
    } while (nextToken)
    // Newest first; entries without a timestamp sort last.
    credentials.sort((a, b) => {
      if (!a.createdAt) return 1
      if (!b.createdAt) return -1
      return b.createdAt.localeCompare(a.createdAt)
    })
    return credentials
  },
  async remove(credentialId: string) {
    await deleteWebAuthnCredential({ credentialId })
  },
}

let api: PasskeyApi = defaultPasskeyApi

export function setPasskeyApi(next: PasskeyApi): void {
  api = next
}

export function getPasskeyApi(): PasskeyApi {
  return api
}
