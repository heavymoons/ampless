// Lifecycle events emitted by ampless. Plugins subscribe via
// `definePlugin({ hooks: { 'after:content.published': ... } })`.
//
// `before:*` is reserved for synchronous validation in the Core library
// and is not yet wired to plugins (planned for v0.2). `after:*` events
// flow through DynamoDB Streams → SQS → trust_level Lambdas.

export type ContentEventType =
  | 'content.created'
  | 'content.updated'
  | 'content.published'
  | 'content.unpublished'
  | 'content.deleted'

export type MediaEventType = 'media.uploaded' | 'media.deleted'

export type SiteSettingsEventType = 'site.settings.updated'

export type EventType = ContentEventType | MediaEventType | SiteSettingsEventType

/** Minimal projection of a Post item carried in events (no body, to keep payloads small). */
export interface ContentEventPayload {
  siteId: string
  postId: string
  slug: string
  title: string
  status: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
}

export interface MediaEventPayload {
  siteId: string
  mediaId: string
  src: string
  mimeType: string
}

/**
 * Emitted whenever any setting under `siteconfig:{siteId}` in KvStore
 * is created, updated, or removed. Subscribers (built-in or user
 * plugins) can rebuild caches, theme assets, etc.
 */
export interface SiteSettingsEventPayload {
  siteId: string
}

export type EventPayloadOf<T extends EventType> = T extends ContentEventType
  ? ContentEventPayload
  : T extends MediaEventType
    ? MediaEventPayload
    : T extends SiteSettingsEventType
      ? SiteSettingsEventPayload
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
