// Client-side, per-browser autosave for the post editor. Drafts live in
// `localStorage` purely for crash / accidental-close recovery — they are
// NEVER sent to the server. Explicit saves still go to DynamoDB through
// the normal dispatcher path; this is an independent safety net layered
// on top of (not a replacement for) the server-side revision history.
//
// SSR-safe: every entry point guards on `typeof window`, so importing
// this module from a `'use client'` component that gets server-rendered
// once is harmless (all functions no-op / return null on the server).

import type { ContentFormat, PostStatus } from 'ampless'

/** localStorage key prefix for all post drafts. */
export const DRAFT_KEY_PREFIX = 'ampless:draft:'

/** The sentinel post key used for the unsaved new-post draft. */
export const NEW_POST_DRAFT_ID = 'new'

/**
 * The in-progress editor state we persist. We store the *real* form
 * fields (not a metadata blob): everything the user can edit and that
 * round-trips losslessly to/from localStorage. `body` is stored as-is —
 * a tiptap JSON doc (object) or a markdown / html source string.
 *
 * `static` posts are intentionally NOT persisted: their file bytes live
 * in an in-memory `pendingBundle` that can't be serialised here, so a
 * recovered static "draft" would be missing its payload. Autosave skips
 * them entirely.
 */
export interface PostDraft {
  title: string
  slug: string
  excerpt: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  /** Raw comma-separated tags input (matches the form's `tagsInput`). */
  tags: string
  /** Raw datetime-local input (matches the form's `publishedAtInput`). */
  publishedAtInput: string
  noLayout: boolean
  /**
   * The server post's `updatedAt` at the moment the draft was taken (or
   * null for a brand-new post). The base-version anchor: on recovery we
   * compare this against the freshly-loaded post's `updatedAt` to detect
   * whether the server moved on under the draft (stale draft).
   */
  baseUpdatedAt: string | null
  /** Epoch ms the draft was written — surfaced in the recovery banner. */
  savedAt: number
}

/** Build the full localStorage key for a given post id (or 'new'). */
export function draftKey(postId: string | undefined | null): string {
  return `${DRAFT_KEY_PREFIX}${postId ?? NEW_POST_DRAFT_ID}`
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

/** Read and parse the draft for a post key. Returns null on miss / parse error. */
export function readDraft(postId: string | undefined | null): PostDraft | null {
  if (!hasStorage()) return null
  try {
    const raw = window.localStorage.getItem(draftKey(postId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PostDraft
    // Minimal structural sanity check — a corrupt / legacy blob should be
    // treated as "no draft" rather than crashing the editor on open.
    if (!parsed || typeof parsed !== 'object' || typeof parsed.format !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Write a draft for a post key. No-ops on the server or if storage throws. */
export function writeDraft(postId: string | undefined | null, draft: PostDraft): void {
  if (!hasStorage()) return
  try {
    window.localStorage.setItem(draftKey(postId), JSON.stringify(draft))
  } catch {
    // Quota exceeded / private-mode / serialisation failure — autosave is
    // best-effort, so swallow. The user can still save explicitly.
  }
}

/** Remove the draft for a single post key. */
export function clearDraft(postId: string | undefined | null): void {
  if (!hasStorage()) return
  try {
    window.localStorage.removeItem(draftKey(postId))
  } catch {
    // ignore
  }
}

/**
 * Remove ALL post drafts (every `ampless:draft:*` key). Wired into the
 * admin sign-out path so one user's recovery drafts don't linger for the
 * next person on a shared browser.
 */
export function clearAllDrafts(): void {
  if (!hasStorage()) return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) keys.push(k)
    }
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

/** The loaded server-side values a draft is reconciled against. */
export interface LoadedPostState {
  title: string
  slug: string
  excerpt: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  tags: string
  publishedAtInput: string
  noLayout: boolean
  /** `post?.updatedAt ?? null` — the current server base version. */
  updatedAt: string | null
}

/**
 * Does the draft hold content that differs from the freshly-loaded
 * server state? Used to decide whether a recover prompt is worth showing
 * (a draft identical to what's already loaded is silently discarded).
 *
 * `body` is compared by structural JSON equality. NOTE: this is only ever
 * called for a *user-typed* draft (autosave only writes when the dirty
 * flag is set), so we don't have to worry about the tiptap
 * re-normalisation false-positive here — by the time a draft exists, the
 * user genuinely changed something.
 */
export function draftDiffersFromLoaded(draft: PostDraft, loaded: LoadedPostState): boolean {
  if (draft.title !== loaded.title) return true
  if (draft.slug !== loaded.slug) return true
  if (draft.excerpt !== loaded.excerpt) return true
  if (draft.format !== loaded.format) return true
  if (draft.status !== loaded.status) return true
  if (draft.tags !== loaded.tags) return true
  if (draft.publishedAtInput !== loaded.publishedAtInput) return true
  if (draft.noLayout !== loaded.noLayout) return true
  return !deepEqual(draft.body, loaded.body)
}

/**
 * The decision the editor makes on mount when a draft exists.
 *
 * - `discard`: the draft equals the loaded content → nothing to recover,
 *   silently drop it (no prompt). Checked FIRST so a draft that happens to
 *   match the current server content is dropped even when the base version
 *   moved — there's no point warning about a stale base when there is
 *   nothing to restore.
 * - `stale`: content differs AND the server's `updatedAt` moved since the
 *   draft was taken → the draft is built on an outdated base; warn and let
 *   the user choose Discard or Restore-anyway.
 * - `recover`: content differs on the same base version (or both new) →
 *   offer to restore the unsaved work.
 */
export type DraftDecision = 'recover' | 'stale' | 'discard'

export function reconcileDraft(draft: PostDraft, loaded: LoadedPostState): DraftDecision {
  // Nothing to recover if the draft already matches the loaded content —
  // drop it silently regardless of base version.
  if (!draftDiffersFromLoaded(draft, loaded)) return 'discard'
  // Content differs and the server moved on under the draft → stale.
  // (`null === null` for the new-post case keeps it out of this branch.)
  if (draft.baseUpdatedAt !== loaded.updatedAt) return 'stale'
  // Content differs on the same base → genuine unsaved work to recover.
  return 'recover'
}

// Small structural deep-equality for draft `body` comparison. Handles the
// JSON-shaped values tiptap / markdown / html bodies take (objects,
// arrays, primitives). Not a general-purpose deepEqual — no Maps/Sets/etc.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
    if (!deepEqual(ao[k], bo[k])) return false
  }
  return true
}
