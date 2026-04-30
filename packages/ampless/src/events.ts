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

export type EventType = ContentEventType | MediaEventType

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

export type EventPayloadOf<T extends EventType> = T extends ContentEventType
  ? ContentEventPayload
  : T extends MediaEventType
    ? MediaEventPayload
    : never

export interface AmplessEvent<T extends EventType = EventType> {
  type: T
  payload: EventPayloadOf<T>
  /** ISO 8601 timestamp of when the source mutation happened. */
  timestamp: string
}
