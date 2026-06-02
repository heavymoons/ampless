import type { GraphqlClient, StorageClient } from './types.js'

const GET_BY_ID = /* GraphQL */ `
  query GetMedia($mediaId: ID!) {
    getMedia(mediaId: $mediaId) {
      mediaId
      src
    }
  }
`

const GET_BY_SRC = /* GraphQL */ `
  query GetMediaBySrc($src: String!) {
    getMediaBySrc(src: $src) {
      mediaId
      src
    }
  }
`

const DELETE = /* GraphQL */ `
  mutation DeleteMedia($input: DeleteMediaInput!) {
    deleteMedia(input: $input) {
      mediaId
    }
  }
`

export interface DeleteMediaArgs {
  /**
   * Media row primary key, as returned by `upload_media` in
   * `media.mediaId`. Use this when you have it — it skips the
   * src→mediaId lookup.
   */
  mediaId?: string
  /**
   * Full S3 key including the `public/` prefix, e.g.
   * `public/media/2026/05/1714400000000-photo.jpg`. The same value
   * stored in `Media.src`. Use this when you only have the public URL
   * to delete (strip the `/api/media/` prefix → prepend `public/`).
   */
  src?: string
  /**
   * When true, resolve the target but delete nothing — neither the S3
   * object nor the Media row. Returns a preview of what *would* be
   * deleted so you can confirm before the real call. Defaults to false.
   */
  dryRun?: boolean
}

export const deleteMediaSchema = {
  type: 'object',
  properties: {
    mediaId: {
      type: 'string',
      description:
        "Media row primary key (e.g. 'media-1714400000000-abc123' as returned by `upload_media`). Provide either `mediaId` or `src`; mediaId is the direct path.",
    },
    src: {
      type: 'string',
      description:
        "Full S3 key including `public/` (e.g. 'public/media/2026/05/1714400000000-photo.jpg'). Use when you only have the public URL — strip `/api/media/` and prepend `public/`. Provide either `mediaId` or `src`.",
    },
    dryRun: {
      type: 'boolean',
      description:
        'When true, resolve the target but delete nothing (no S3 delete, no row delete). Returns `{ deleted: false, dryRun: true, ... }` previewing what would be removed. Use it to confirm before the real delete.',
    },
  },
} as const

/**
 * Delete a media file: removes the S3 object and the Media row.
 *
 * Resolution: when `mediaId` is given, looks up the row by primary key
 * to obtain `src`. When only `src` is given, looks up the row via the
 * `getMediaBySrc` query (the same path the public media-proxy uses).
 *
 * Dry run: when `dryRun` is true the lookups still run but neither the
 * S3 object nor the Media row is touched; the result carries
 * `dryRun: true` and (when resolved) the `mediaId` / `src` that the real
 * call would remove.
 *
 * Ordering: S3 DeleteObject first, then GraphQL deleteMedia mutation.
 * Both are idempotent on success — DeleteObject doesn't throw when the
 * object is absent, and the mutation is a no-op on missing key from
 * the caller's perspective. On a failure between the two steps the
 * S3 object is gone but the Media row remains as an orphan pointer;
 * re-running this tool with the same args completes the cleanup.
 *
 * Returns `{ deleted: false, reason: 'media row not found' }` (rather
 * than throwing) when neither lookup finds a row — the S3 object is
 * still removed defensively when `src` was supplied directly, so the
 * caller can sweep orphan files by passing `src` of objects the Media
 * table no longer references.
 */
const MEDIA_PREFIX = 'public/media/'

/**
 * Validate that an S3 key is strictly within the `public/media/` prefix.
 *
 * The check is performed on the normalised path so that traversal sequences
 * such as `public/media/../static/foo` are caught even though they start with
 * the correct prefix as a raw string.
 *
 * Normalisation: reject backslashes first, then collapse each `..` segment
 * against its predecessor until none remain.  We do NOT use `path.normalize`
 * because that is OS-dependent and may produce backslashes on Windows; instead
 * we perform a pure-string resolution loop.
 */
function assertMediaPrefix(key: string): void {
  // Reject embedded backslashes before normalising (belt-and-suspenders).
  if (key.includes('\\')) {
    throw new Error(`delete_media: src must start with "${MEDIA_PREFIX}" — got: ${key}`)
  }

  // Resolve `..` segments without touching the OS.
  const parts = key.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  const normalised = resolved.join('/')

  if (!normalised.startsWith(MEDIA_PREFIX)) {
    throw new Error(`delete_media: src must start with "${MEDIA_PREFIX}" — got: ${key}`)
  }
}

export async function deleteMedia(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: DeleteMediaArgs,
): Promise<
  | { deleted: true; mediaId: string; src: string }
  | { deleted: false; reason: string; dryRun?: boolean; mediaId?: string; src?: string }
> {
  if (!args.mediaId && !args.src) {
    throw new Error('delete_media: provide `mediaId` or `src`')
  }

  // Validate the caller-supplied src before any I/O so we fail early.
  if (args.src !== undefined) {
    assertMediaPrefix(args.src)
  }

  const dryRun = args.dryRun === true
  let mediaId: string | undefined
  let src: string | undefined

  if (args.mediaId) {
    const data = await graphql.query<{
      getMedia: { mediaId: string; src: string } | null
    }>(GET_BY_ID, { mediaId: args.mediaId })
    if (data.getMedia) {
      mediaId = data.getMedia.mediaId
      src = data.getMedia.src
      // Guard against rows with corrupt / unexpected src values.
      assertMediaPrefix(src)
    }
  } else {
    const data = await graphql.query<{
      getMediaBySrc: { mediaId: string; src: string } | null
    }>(GET_BY_SRC, { src: args.src! })
    if (data.getMediaBySrc) {
      mediaId = data.getMediaBySrc.mediaId
      src = data.getMediaBySrc.src
      // Guard against rows with corrupt / unexpected src values.
      assertMediaPrefix(src)
    }
  }

  // Orphan case: row not found. Still delete the S3 object if `src`
  // was supplied directly, so callers can use this tool to sweep
  // objects the Media table no longer references.
  if (!mediaId) {
    if (args.src) {
      if (dryRun) {
        return {
          deleted: false as const,
          dryRun: true as const,
          reason: 'dry run — media row not found; would attempt S3 object delete',
          src: args.src,
        }
      }
      await storage.deleteObject(args.src)
      return {
        deleted: false as const,
        reason: 'media row not found; S3 object delete attempted (idempotent)',
        src: args.src,
      }
    }
    return {
      deleted: false as const,
      ...(dryRun ? { dryRun: true as const } : {}),
      reason: dryRun
        ? 'dry run — media row not found for mediaId; nothing to delete'
        : 'media row not found for mediaId',
    }
  }

  // Dry run: target resolved, but touch nothing. Surface what the real
  // call would remove so the caller can confirm first.
  if (dryRun) {
    return {
      deleted: false as const,
      dryRun: true as const,
      reason: 'dry run — nothing deleted',
      mediaId,
      src: src!,
    }
  }

  // S3 first so the row remains as a marker if storage fails. Retry
  // with the same args re-converges.
  await storage.deleteObject(src!)
  await graphql.query<{ deleteMedia: { mediaId: string } }>(DELETE, {
    input: { mediaId },
  })

  return { deleted: true as const, mediaId, src: src! }
}
