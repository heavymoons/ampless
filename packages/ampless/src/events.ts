// Lifecycle events emitted by ampless. Plugins subscribe via
// `definePlugin({ hooks: { 'after:content.published': ... } })`.
//
// `before:*` is reserved for synchronous validation in the Core library
// and is not yet wired to plugins. `after:*` events flow through
// DynamoDB Streams → SQS → trust_level Lambdas.

export type ContentEventType =
  | 'content.created'
  | 'content.updated'
  | 'content.published'
  | 'content.unpublished'
  | 'content.deleted'

export type MediaEventType = 'media.uploaded' | 'media.deleted'

export type SiteSettingsEventType = 'site.settings.updated'

/**
 * Emitted on every Post mutation (INSERT / MODIFY / REMOVE) with both
 * the previous and the next projection of the row. Drives index-style
 * derivation: the built-in trusted-processor handler uses it to keep
 * the `PostTag` denormalized index in sync without making every write
 * path (admin, MCP, future REST clients) remember to call a helper.
 *
 * Plugins that maintain their own indexes (custom search, sitemaps
 * with per-tag pages, etc.) can subscribe through the same hook
 * surface as the other event types — the diff payload is already in
 * the right shape for "compute add/remove/update".
 */
export type PostIndexEventType = 'post.index.refresh'

export type EventType =
  | ContentEventType
  | MediaEventType
  | SiteSettingsEventType
  | PostIndexEventType

/** Minimal projection of a Post item carried in events (no body, to keep payloads small). */
export interface ContentEventPayload {
  postId: string
  slug: string
  title: string
  status: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
}

export interface MediaEventPayload {
  mediaId: string
  src: string
  mimeType: string
}

/**
 * Emitted whenever any setting under the `siteconfig:` PK in KvStore is
 * created, updated, or removed. Subscribers (built-in or user plugins)
 * can rebuild caches, theme assets, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SiteSettingsEventPayload {}

/**
 * Diff payload for `post.index.refresh`. `previous` is null on INSERT;
 * `next` is null on REMOVE; both populated on MODIFY. Subscribers
 * compute the add / remove / update set from this — see the trusted
 * processor's `rebuildPostTags` handler for the canonical example.
 */
export interface PostIndexEventPayload {
  previous: ContentEventPayload | null
  next: ContentEventPayload | null
}

export type EventPayloadOf<T extends EventType> = T extends ContentEventType
  ? ContentEventPayload
  : T extends MediaEventType
    ? MediaEventPayload
    : T extends SiteSettingsEventType
      ? SiteSettingsEventPayload
      : T extends PostIndexEventType
        ? PostIndexEventPayload
        : never

export interface AmplessEvent<T extends EventType = EventType> {
  type: T
  payload: EventPayloadOf<T>
  /** ISO 8601 timestamp of when the source mutation happened. */
  timestamp: string
}

/**
 * Maps a single content mutation to the CMS-level events it represents.
 * Always emits `content.updated` for any MODIFY so plugins that subscribe
 * to "any change" reliably fire; status transitions add the matching
 * published / unpublished event on top.
 *
 * Used by the DynamoDB Stream dispatcher Lambda — kept here so the same
 * decision table is testable in plain Node without AWS deps.
 */
export type StreamEventName = 'INSERT' | 'MODIFY' | 'REMOVE'

export function detectContentEvents(input: {
  eventName: StreamEventName | string | undefined
  oldStatus?: 'draft' | 'published'
  newStatus?: 'draft' | 'published'
}): ContentEventType[] {
  switch (input.eventName) {
    case 'INSERT': {
      const out: ContentEventType[] = ['content.created']
      if (input.newStatus === 'published') out.push('content.published')
      return out
    }
    case 'MODIFY': {
      const wasPublished = input.oldStatus === 'published'
      const isPublished = input.newStatus === 'published'
      const out: ContentEventType[] = ['content.updated']
      if (!wasPublished && isPublished) out.push('content.published')
      else if (wasPublished && !isPublished) out.push('content.unpublished')
      return out
    }
    case 'REMOVE': {
      const out: ContentEventType[] = []
      if (input.oldStatus === 'published') out.push('content.unpublished')
      out.push('content.deleted')
      return out
    }
    default:
      return []
  }
}
