// Server-side Media row lookup for the public `/api/media/...` route.
// Calls the custom `getMediaBySrc` query through the API-key authMode
// — the same auth surface the public post queries use, since Amplify
// Gen 2 custom handlers don't accept `allow.guest()`. The resolver
// only projects `{ src, size, mimeType, metadata }` onto the public
// type, so guests never see the full Media row.
//
// Returns `null` for orphan / legacy assets whose Media row was never
// written (or was deleted) — callers fall back to an Amplify SSR HEAD
// in that case.
//
// The client is stateless: `generateServerClientUsingReqRes` run with
// `nextServerContext: null` uses Amplify's `sharedInMemoryStorage`
// guest-role path — no Cognito guest identityId Set-Cookie is written
// on public route responses.

import { generateServerClientUsingReqRes } from '@aws-amplify/adapter-nextjs/api'
import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { decodeAwsJson, type MediaMetadata } from 'ampless'
import type { AmplessOutputs } from './outputs.js'

/** Public projection returned by the `getMediaBySrc` custom query. */
export interface PublicMediaShape {
  src: string
  size?: number | null
  mimeType?: string | null
  metadata?: unknown
}

/** Decoded form handed to callers. */
export interface ResolvedMedia {
  src: string
  size: number | null
  mimeType: string | null
  metadata: MediaMetadata | null
}

interface QueryResponse<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface PublicMediaQueries {
  getMediaBySrc(
    contextSpec: unknown,
    args: { src: string }
  ): Promise<QueryResponse<PublicMediaShape>>
}

interface PublicMediaClient {
  queries: PublicMediaQueries
}

export interface MediaApi {
  /**
   * Resolve the Media DynamoDB row for the given S3 key. Returns
   * `null` when no row matches (orphan / legacy asset) or when the
   * AppSync call fails — the caller should treat both the same and
   * fall back to a HEAD lookup. Failures are logged.
   */
  getMediaBySrc(src: string): Promise<ResolvedMedia | null>
}

function decodeMediaMetadata(value: unknown): MediaMetadata | null {
  if (value === null || value === undefined) return null
  const parsed = decodeAwsJson(value)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as MediaMetadata
  }
  return null
}

/**
 * Build the media-resolution API from a user-supplied outputs blob.
 * Uses a stateless Amplify server client: `generateServerClientUsingReqRes`
 * run with `nextServerContext: null` — Amplify's `sharedInMemoryStorage`
 * guest-role path — so public apiKey reads never read or write cookies.
 * This prevents Cognito guest identityId Set-Cookie from being written
 * on public route responses.
 */
export function createMediaApi(outputs: AmplessOutputs): MediaApi {
  const { runWithAmplifyServerContext } = createServerRunner({
    config: outputs as Parameters<typeof createServerRunner>[0]['config'],
  })
  const client = generateServerClientUsingReqRes({
    config: outputs as Parameters<typeof generateServerClientUsingReqRes>[0]['config'],
    authMode: 'apiKey',
  }) as unknown as PublicMediaClient

  return {
    async getMediaBySrc(src: string): Promise<ResolvedMedia | null> {
      try {
        const { data, errors } = await runWithAmplifyServerContext({
          nextServerContext: null,
          operation: (contextSpec) => client.queries.getMediaBySrc(contextSpec, { src }),
        })
        if (errors && errors.length > 0) {
          // AppSync returns `errors` instead of throwing — log them
          // explicitly so they don't silently drop us onto the HEAD
          // fallback path. Treat as "no row" so the caller still
          // gets bytes through; CloudWatch is where these surface.
          console.error(
            `[media-api] getMediaBySrc errors for ${src}`,
            errors.map((e) => e.message),
          )
          return null
        }
        if (!data) return null
        return {
          src: data.src,
          size: data.size ?? null,
          mimeType: data.mimeType ?? null,
          metadata: decodeMediaMetadata(data.metadata),
        }
      } catch (err) {
        console.error(`[media-api] getMediaBySrc threw for ${src}`, err)
        return null
      }
    },
  }
}
