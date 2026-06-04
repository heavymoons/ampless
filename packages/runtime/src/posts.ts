// Server-side post fetching for the public blog. Calls the custom
// `listPublishedPosts` / `getPublishedPost` queries — those resolvers
// hard-code the `status='published'` filter, so drafts are never exposed
// even if a guest hits the AppSync API directly.
//
// authMode is 'apiKey' because Amplify Gen 2 custom handlers
// (`a.handler.custom`) don't support `allow.guest()` — only apiKey /
// userPool / lambda / group / owner. See RUNBOOK.md for the API key
// rotation runbook.
//
// The client is stateless: `generateServerClientUsingReqRes` run with
// `nextServerContext: null` uses Amplify's `sharedInMemoryStorage`
// guest-role path — no Cognito guest identityId Set-Cookie is written
// on public route responses (`/og/[slug]`, `/feed.xml`, etc.).

import { generateServerClientUsingReqRes } from '@aws-amplify/adapter-nextjs/api'
import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { decodeAwsJson, type Post, type PostMetadata } from 'ampless'
import type { AmplessOutputs } from './outputs.js'

// Wire shape of the three queries this module calls. The actual
// generated `Schema` type from the user's amplify/data/resource.ts is
// far richer, but the runtime only cares about these three —
// templates pass their generated Schema in if they want full typing
// of unrelated client.models / client.queries surfaces, but the
// runtime narrows to this minimal shape internally so it can compile
// without depending on any single template's schema definition.
export interface PublicPostShape {
  postId: string
  slug: string
  title: string
  excerpt?: string | null
  format?: string | null
  body?: unknown
  status?: string | null
  publishedAt?: string | null
  tags?: Array<string | null> | null
  metadata?: unknown
  /**
   * ISO 8601 timestamp from DynamoDB's auto-managed `updatedAt`.
   * Surfaced through the `PublicPost` projection so middleware can
   * compute the `metadata.cache='auto'` cooldown.
   */
  updatedAt?: string | null
}

export interface PublicPostConnectionShape {
  items?: Array<PublicPostShape | null> | null
  nextToken?: string | null
}

interface QueryResponse<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface PublicQueries {
  listPublishedPosts(
    contextSpec: unknown,
    args: { from?: string; to?: string; limit?: number; nextToken?: string }
  ): Promise<QueryResponse<PublicPostConnectionShape>>
  getPublishedPost(
    contextSpec: unknown,
    args: { slug: string }
  ): Promise<QueryResponse<PublicPostShape>>
  listPostsByTag(
    contextSpec: unknown,
    args: { tag: string; limit?: number; nextToken?: string }
  ): Promise<QueryResponse<PublicPostConnectionShape>>
}

interface PublicClient {
  queries: PublicQueries
}

export interface ListPostsOptions {
  /** ISO 8601 timestamp; SK lower bound (inclusive). */
  from?: string
  /** ISO 8601 timestamp; SK upper bound (inclusive). */
  to?: string
  limit?: number
  /** Opaque cursor returned by a previous call. */
  nextToken?: string
}

export interface ListPostsByTagOptions {
  limit?: number
  nextToken?: string
}

export interface ListPostsResult {
  items: Post[]
  nextToken: string | null
}

export interface PostsApi {
  listPublishedPosts(opts?: ListPostsOptions): Promise<ListPostsResult>
  getPublishedPost(slug: string): Promise<Post | null>
  listPostsByTag(tag: string, opts?: ListPostsByTagOptions): Promise<ListPostsResult>
}

// `body` / `metadata` are AWSJSON scalars on the wire — see
// `packages/ampless/src/awsjson.ts` for the encode/decode contract.
// Metadata returns undefined for nullish / malformed payloads so
// callers can rely on `post.metadata?.no_layout`.
function decodeMetadata(value: unknown): PostMetadata | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = decodeAwsJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as PostMetadata)
    : undefined
}

function toCorePost(p: PublicPostShape): Post {
  return {
    postId: p.postId,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? undefined,
    format: (p.format ?? 'markdown') as Post['format'],
    body: decodeAwsJson(p.body),
    status: (p.status ?? 'draft') as Post['status'],
    publishedAt: p.publishedAt ?? undefined,
    tags: (p.tags ?? []).filter((t): t is string => typeof t === 'string'),
    metadata: decodeMetadata(p.metadata),
    updatedAt: p.updatedAt ?? undefined,
  }
}

/**
 * Build the post-fetching API from a user-provided amplify_outputs
 * blob. Uses a stateless Amplify server client: `generateServerClientUsingReqRes`
 * run with `nextServerContext: null` — Amplify's `sharedInMemoryStorage`
 * guest-role path — so public apiKey reads never read or write cookies.
 * This prevents the runtime from writing a Cognito guest identityId
 * Set-Cookie on public route responses (e.g. `/og/[slug]`, `/feed.xml`).
 *
 * authMode is 'apiKey' because Amplify Gen 2 custom handlers
 * (`a.handler.custom`) don't support `allow.guest()` — only apiKey /
 * userPool / lambda / group / owner.
 *
 * Internally we type the client structurally (just `client.queries`
 * with the three methods we use) so the runtime doesn't depend on
 * any specific template's generated Schema. Templates that want
 * end-to-end type safety on those queries can still get it through
 * their own thin wrapper that re-types this API.
 */
export function createPostsApi(outputs: AmplessOutputs): PostsApi {
  const { runWithAmplifyServerContext } = createServerRunner({
    config: outputs as Parameters<typeof createServerRunner>[0]['config'],
  })
  // The adapter's generic is variance-friendly; we ask for a Schema
  // shape it doesn't need to introspect (no models, no custom
  // operations declared) and immediately cast to our structural
  // PublicClient. At runtime the AppSync request shape is identical
  // — the generic only drives type narrowing, which we override here
  // because the runtime is schema-agnostic.
  const client = generateServerClientUsingReqRes({
    config: outputs as Parameters<typeof generateServerClientUsingReqRes>[0]['config'],
    authMode: 'apiKey',
  }) as unknown as PublicClient

  return {
    async listPublishedPosts(opts: ListPostsOptions = {}): Promise<ListPostsResult> {
      const { data, errors } = await runWithAmplifyServerContext({
        nextServerContext: null,
        operation: (contextSpec) =>
          client.queries.listPublishedPosts(contextSpec, {
            from: opts.from,
            to: opts.to,
            limit: opts.limit ?? 20,
            nextToken: opts.nextToken,
          }),
      })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts')
      const items = (data?.items ?? [])
        .filter((p): p is PublicPostShape => p !== null)
        .map(toCorePost)
      return { items, nextToken: data?.nextToken ?? null }
    },

    async getPublishedPost(slug: string): Promise<Post | null> {
      const { data, errors } = await runWithAmplifyServerContext({
        nextServerContext: null,
        operation: (contextSpec) => client.queries.getPublishedPost(contextSpec, { slug }),
      })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to get post')
      return data ? toCorePost(data) : null
    },

    async listPostsByTag(
      tag: string,
      opts: ListPostsByTagOptions = {}
    ): Promise<ListPostsResult> {
      const { data, errors } = await runWithAmplifyServerContext({
        nextServerContext: null,
        operation: (contextSpec) =>
          client.queries.listPostsByTag(contextSpec, {
            tag,
            limit: opts.limit ?? 20,
            nextToken: opts.nextToken,
          }),
      })
      if (errors) throw new Error(errors[0]?.message ?? 'Failed to list posts by tag')
      const items = (data?.items ?? [])
        .filter((p): p is PublicPostShape => p !== null)
        .map(toCorePost)
      return { items, nextToken: data?.nextToken ?? null }
    },
  }
}
