import {
  bypassesPostBodyWrapper,
  hasForeignPostClassesValue,
  isValidCustomClassId,
  readPostClasses,
  withPostClasses,
  ConditionalPostUpdateUnsupportedError,
  PostUpdateConflictError,
  CUSTOM_CLASS_ID_MAX_LENGTH,
  POST_CLASSES_METADATA_KEY,
} from 'ampless'
import type { GraphqlClient } from './types.js'
import { getPost } from './get-post.js'
import { MISSING_MUTATION_MESSAGE, expectedFrom, updatePostIfUnchanged } from './conditional-update.js'
import { postVersion, type VersionedPost } from './post-version.js'

// Total read → apply → conditional-write attempts for `add` / `remove`
// without `expectedVersion`: a conflict means someone else changed the post
// in between, so re-read and re-apply the set operations onto their change.
const MAX_ATTEMPTS = 3

export interface SetPostClassesArgs {
  postId: string
  /** Full replacement of the list. Requires `expectedVersion`. */
  ids?: string[]
  /** Ids to add (kept in place when present, appended otherwise). */
  add?: string[]
  /** Ids to remove (absent ones are ignored). */
  remove?: string[]
  /** The `version` from get_post. */
  expectedVersion?: string
}

export interface SetPostClassesResult {
  post: VersionedPost
}

const ID_ITEMS = { type: 'string', pattern: '^[a-z0-9-]+$', maxLength: CUSTOM_CLASS_ID_MAX_LENGTH } as const

export const setPostClassesSchema = {
  type: 'object',
  required: ['postId'],
  properties: {
    postId: { type: 'string' },
    ids: {
      type: 'array',
      items: ID_ITEMS,
      description:
        'Full replacement: the complete post class id list to store ([] removes all post classes), de-duplicated in order. REQUIRES `expectedVersion` (a replacement computed from a stale read would silently undo a concurrent change). Cannot be combined with `add` / `remove`.',
    },
    add: {
      type: 'array',
      items: ID_ITEMS,
      description:
        'Ids to add to the current list (an id already present keeps its position; new ones are appended). Combinable with `remove` (no id in both). Safe without `expectedVersion`: on a concurrent change the tool re-reads and re-applies.',
    },
    remove: {
      type: 'array',
      items: ID_ITEMS,
      description: 'Ids to remove from the current list (absent ids are ignored). Combinable with `add` (no id in both).',
    },
    expectedVersion: {
      type: 'string',
      description:
        "The `version` returned by get_post. When given, nothing is written and the call fails with a conflict (no automatic retry) if the post's content changed in any way since that read — including a change in the same millisecond. Required with `ids`; optional with `add` / `remove`.",
    },
  },
} as const

function conflictError(postId: string, detail: string, cause?: unknown): Error {
  return new Error(
    `set_post_classes: conflict — post ${postId} changed ${detail} (or was deleted). ` +
      'Nothing was saved. Call get_post to re-read it and retry.',
    cause === undefined ? undefined : { cause },
  )
}

function validateIdList(name: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`set_post_classes: \`${name}\` must be an array of post class ids`)
  for (const id of value) {
    if (!isValidCustomClassId(id)) {
      throw new Error(
        `set_post_classes: invalid post class id ${JSON.stringify(id)} in \`${name}\` ` +
          `(use 1-${CUSTOM_CLASS_ID_MAX_LENGTH} lowercase letters, digits or hyphens)`,
      )
    }
  }
  return value as string[]
}

/**
 * Set a post's theme post classes (the tagged
 * `metadata['ampless:postClasses']` value) without touching any other
 * metadata key. Writes `metadata` (merged via `withPostClasses` into the
 * freshly read object) through the atomic `amplessUpdatePostIfUnchanged`
 * mutation; never falls back to the stock unconditional update.
 *
 * - `ids` (full replacement) requires `expectedVersion`.
 * - With `expectedVersion`: the fresh read's content version must equal it
 *   (so the read is exactly what the caller saw — a same-millisecond write
 *   that left updatedAt unchanged still changes the version), and the
 *   write is conditioned on every field of that read. A conflict fails;
 *   no retry.
 * - `add` / `remove` without `expectedVersion`: the set operations are
 *   applied to the fresh read's ids and the write is conditioned on the
 *   metadata, format and updatedAt of that read. On a conflict the tool
 *   re-reads and re-applies (MAX_ATTEMPTS in total) — safe because the
 *   operations commute with whatever the other writer did.
 */
export async function setPostClasses(
  client: GraphqlClient,
  args: SetPostClassesArgs
): Promise<SetPostClassesResult> {
  if (typeof args.postId !== 'string' || !args.postId) {
    throw new Error('set_post_classes: `postId` is required')
  }
  const ids = validateIdList('ids', args.ids)
  const add = validateIdList('add', args.add)
  const remove = validateIdList('remove', args.remove)
  if (args.expectedVersion !== undefined && (typeof args.expectedVersion !== 'string' || !args.expectedVersion)) {
    throw new Error('set_post_classes: `expectedVersion` must be a non-empty string (the post\'s `version` from get_post)')
  }
  const expectedVersion = args.expectedVersion
  if (ids !== undefined) {
    if (add !== undefined || remove !== undefined) {
      throw new Error('set_post_classes: pass either `ids` (full replacement) or `add` / `remove`, not both')
    }
    if (expectedVersion === undefined) {
      throw new Error(
        'set_post_classes: `ids` replaces the whole list, so it requires `expectedVersion` (the `version` from get_post) — ' +
          'otherwise a list computed from an earlier read would silently undo a concurrent change. ' +
          'Pass the version, or use `add` / `remove`, which are safe without it. Nothing was saved.',
      )
    }
  } else {
    if (add === undefined && remove === undefined) {
      throw new Error('set_post_classes: pass `ids` (with `expectedVersion`) or at least one of `add` / `remove`')
    }
    if ((add?.length ?? 0) + (remove?.length ?? 0) === 0) {
      throw new Error('set_post_classes: `add` / `remove` are both empty; nothing to change')
    }
    const removing = new Set(remove ?? [])
    const both = (add ?? []).filter((id) => removing.has(id))
    if (both.length > 0) {
      throw new Error(`set_post_classes: ${JSON.stringify(both)} appear in both \`add\` and \`remove\``)
    }
  }

  const nextIds = (current: string[]): string[] => {
    if (ids !== undefined) return ids
    const removing = new Set(remove ?? [])
    const out = current.filter((id) => !removing.has(id))
    for (const id of add ?? []) if (!out.includes(id)) out.push(id)
    return out
  }

  const attempts = expectedVersion === undefined ? MAX_ATTEMPTS : 1
  for (let attempt = 1; ; attempt++) {
    const current = await getPost(client, { postId: args.postId })
    if (!current) {
      if (expectedVersion !== undefined) throw conflictError(args.postId, `since version ${expectedVersion}`)
      throw new Error(`set_post_classes: post ${args.postId} not found`)
    }
    if (expectedVersion !== undefined && postVersion(current) !== expectedVersion) {
      throw conflictError(args.postId, `since version ${expectedVersion}`)
    }
    if (!current.updatedAt) {
      // The conditional mutation needs an updatedAt to condition on.
      throw new Error(
        `set_post_classes: post ${args.postId} has no updatedAt, so the change cannot be written safely; nothing was saved`,
      )
    }
    if (bypassesPostBodyWrapper(current)) {
      throw new Error(
        `set_post_classes: post ${args.postId} is a ${current.format === 'static' ? 'static' : 'no_layout HTML'} post; ` +
          'post classes are never applied to it, so nothing was saved',
      )
    }
    if (hasForeignPostClassesValue(current.metadata)) {
      throw new Error(
        `set_post_classes: post ${args.postId} already has a metadata["${POST_CLASSES_METADATA_KEY}"] value that ` +
          'is not a tagged post-classes value; it was left untouched and nothing was saved',
      )
    }

    // Every other key of the freshly read metadata is carried over as-is.
    const metadata = withPostClasses(current.metadata, nextIds(readPostClasses(current.metadata)))
    try {
      // With a version: every field of the read (the caller asked for "no
      // change at all since my read"). Without: metadata and `format` —
      // the static / no_layout refusal above was decided on them.
      const expected = expectedVersion !== undefined ? expectedFrom(current) : expectedFrom(current, ['metadata', 'format'])
      const post = await updatePostIfUnchanged(client, args.postId, { metadata }, expected)
      return { post }
    } catch (err) {
      if (err instanceof ConditionalPostUpdateUnsupportedError) {
        throw new Error(`set_post_classes: ${MISSING_MUTATION_MESSAGE}`, { cause: err })
      }
      if (!(err instanceof PostUpdateConflictError)) throw err
      if (attempt >= attempts) {
        throw conflictError(
          args.postId,
          expectedVersion !== undefined ? `since version ${expectedVersion}` : `on each of ${attempts} attempts`,
          err,
        )
      }
    }
  }
}
