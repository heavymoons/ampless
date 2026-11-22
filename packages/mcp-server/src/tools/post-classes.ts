import { isValidCustomClassId, normalizePostClasses, type PostMetadata } from 'ampless'

/**
 * JSON Schema for a list of theme post class ids, shared by `create_post`
 * and `update_post` (top-level `postClasses` and `metadata.postClasses`).
 */
export const postClassesSchema = {
  type: 'array',
  items: { type: 'string', pattern: '^[a-z0-9-]+$', maxLength: 64 },
  description:
    "Theme-defined post-level class ids (the active theme declares them in its manifest `customClasses` with target 'post'). Each id renders as `ampless-post--<id>` on the theme's post body wrapper. Ids must match ^[a-z0-9-]+$ (max 64 chars); duplicates are removed. Ids the active theme does not declare are stored and still rendered, just unstyled.",
} as const

/**
 * Validate a caller-supplied post class list. `undefined` passes through;
 * anything else must be an array of valid ids, otherwise a clear Error
 * names the offending entries (we reject rather than silently drop so the
 * agent learns its write did not do what it asked). Returns the list
 * de-duplicated in order.
 */
export function validatePostClasses(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of class ids (strings matching ^[a-z0-9-]+$)`)
  }
  const invalid = value.filter((id) => !isValidCustomClassId(id))
  if (invalid.length > 0) {
    throw new Error(
      `Invalid ${field} id(s): ${invalid.map((id) => JSON.stringify(id)).join(', ')}. ` +
        'Ids must be 1-64 characters of lowercase letters, digits and hyphens (^[a-z0-9-]+$).',
    )
  }
  return normalizePostClasses(value)
}

/**
 * Validate the caller's top-level `postClasses` and `metadata.postClasses`
 * (when present). Returns the de-duplicated top-level list, if any.
 */
export function validatePostClassesArgs(args: {
  postClasses?: unknown
  metadata?: PostMetadata | Record<string, unknown>
}): string[] | undefined {
  if (args.metadata && typeof args.metadata === 'object' && 'postClasses' in args.metadata) {
    validatePostClasses(args.metadata.postClasses, 'metadata.postClasses')
  }
  return validatePostClasses(args.postClasses, 'postClasses')
}

/**
 * When a top-level `postClasses` list is given, write it into a copy of
 * `metadata`: set when non-empty, key removed when empty. Other keys are
 * kept as-is. Does not validate `metadata` itself — on update it may be the
 * stored object, whose old value is being replaced.
 */
export function mergePostClasses(
  metadata: PostMetadata | Record<string, unknown> | undefined,
  postClasses: string[] | undefined,
): PostMetadata | Record<string, unknown> | undefined {
  if (postClasses === undefined) return metadata
  const next: Record<string, unknown> = { ...(metadata ?? {}) }
  if (postClasses.length > 0) next.postClasses = postClasses
  else delete next.postClasses
  return next
}
