'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon } from 'lucide-react'
import {
  createPost,
  updatePost,
  deletePost,
  getPostById,
  formatDate,
  PostUpdateConflictError,
  ConditionalPostUpdateUnsupportedError,
  POST_CLASSES_METADATA_KEY,
  POST_CLASSES_METADATA_KIND,
  readPostClasses,
  hasForeignPostClassesValue,
  withPostClasses,
  isValidCustomClassId,
  type PostClassesMetadata,
  type Post,
  type PostMetadata,
  type PostRevision,
  type StaticPostBody,
  type ContentFormat,
} from 'ampless'
import { Button, Input, Label, Textarea } from '@ampless/runtime/ui'
import { TiptapEditor } from '../editor/tiptap-editor.js'
import { MediaPicker } from './media-picker.js'
import { PostHistoryPanel } from './post-history-panel.js'
import { StaticUploader } from './static-uploader.js'
import {
  uploadBundle,
  deleteBundle,
  type ExtractedFile,
} from '../lib/static-bundle.js'
import { useT } from './i18n-provider.js'
import { isoToLocalInput, resolvePublishedAtForSave } from '../lib/post-published-at.js'
import { getPostDisplayStatus, scheduledTransitionAt } from '../lib/post-display-status.js'
import { useNow } from '../lib/use-now.js'
import {
  readDraft,
  writeDraft,
  clearDraft,
  reconcileDraft,
  NEW_POST_DRAFT_ID,
  deepEqual,
  type PostDraft,
  type LoadedPostState,
  type DraftDecision,
} from '../lib/post-draft.js'
import { getAdminCmsConfig } from '../lib/admin-config-client.js'
import { buildPreviewSrcDoc } from '../lib/preview-srcdoc.js'
import { getAdminTiptapNodeMarkdown } from '../editor/admin-node-markdown.js'
import { getAdminTiptapNodeHtml } from '../editor/admin-node-html.js'
import { getAdminEditorExtensions } from '../editor/admin-editor-extensions.js'
import { BASE_TIPTAP_EXTENSIONS } from '../editor/base-extensions.js'
import { convertBodyFormat, confirmLossyFormatChange } from '../editor/format-switch.js'
import type { AnyExtension } from '@tiptap/core'

type PostFormView = 'edit' | 'preview'

/**
 * A post custom class the active theme declares (ThemeManifest.customClasses
 * with target 'post'), with its label already resolved for the admin locale.
 * Serializable so the server page factory can pass it to the client form
 * (see `loadEditorPostClasses`).
 */
export interface EditorPostClass {
  id: string
  label: string
  description?: string
}

interface PostFormProps {
  post?: Post
  /**
   * The active theme's post classes, offered as the "Post classes"
   * checkboxes. Ids stored on the post but missing here are still shown
   * (marked "not in current theme") so they can be kept or unchecked.
   */
  postClasses?: ReadonlyArray<EditorPostClass>
  /**
   * Phase 7: endpoint that the form POSTs the in-flight draft to for
   * server-rendered preview HTML (body + page-level scripts). Defaults
   * to `/admin/preview`, the Route Handler shipped by the template
   * scaffold at `app/(admin)/admin/preview/route.tsx`. The factory
   * (`createEditPostPage` / `createNewPostPage`) exposes a
   * `previewEndpoint?: string` option that threads down to here for
   * non-default admin mount paths (e.g. Next.js `basePath`).
   *
   * The resulting HTML is shown in an `<iframe srcDoc>` with
   * `sandbox="allow-scripts allow-same-origin"` (v1 trust boundary
   * expansion — admin preview content / plugin script are explicitly
   * treated as trusted; see the iframe comment below for full rationale).
   */
  previewEndpoint?: string
}

const EMPTY_TIPTAP_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

const IMAGE_URL_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)(\?|$)/i
const STYLESHEET_URL_RE = /\.css(\?|$)/i
const SCRIPT_URL_RE = /\.m?js(\?|$)/i

// Build the snippet to insert into a textarea body for the chosen
// format. The MediaPicker hands us a URL only, so we infer the asset
// type from the URL extension.
function snippetFor(url: string, format: ContentFormat): string {
  const isImage = IMAGE_URL_RE.test(url)
  if (format === 'markdown') {
    return isImage ? `![](${url})` : url
  }
  // html
  if (isImage) return `<img src="${url}" alt="" />`
  if (STYLESHEET_URL_RE.test(url)) return `<link rel="stylesheet" href="${url}" />`
  if (SCRIPT_URL_RE.test(url)) return `<script src="${url}"></script>`
  return url
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

// When the user picks a different format mid-edit, the body shape
// changes (tiptap stores an object, the others store strings, static
// stores a manifest). Pre-populate sensibly so they're not staring at
// junk.
function defaultBodyForFormat(format: ContentFormat): unknown {
  if (format === 'tiptap') return EMPTY_TIPTAP_DOC
  if (format === 'static') return null
  return ''
}

// Order-insensitive id list comparison: re-checking a box the user just
// unchecked must count as "unchanged" so the stored value stays verbatim.
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

// Legacy (non-conditional) save: true when `next` equals `loaded` except
// that `no_layout` was dropped because the post is saved in a non-html
// format (buildMetadata always drops it there). Every runtime consumer of
// no_layout gates on `format === 'html'` (runtime middleware /raw rewrite,
// routes/raw.ts, ampless `bypassesPostBodyWrapper`), so the stale flag is
// inert while the post is not html — leaving it stored by omitting
// `metadata` from the save changes nothing anyone renders. When the post is
// opened again, `loadedNoLayout` treats that stored flag as off (it is not
// html), so switching back to html shows it unchecked. Saving it as html
// must then remove the stored flag: the conditional save writes metadata
// without it, and the legacy save refuses (this function returns false for
// html) rather than leave it to take effect.
function onlyDropsInertNoLayout(
  next: PostMetadata,
  loaded: PostMetadata,
  format: ContentFormat | undefined,
): boolean {
  if (format === 'html') return false
  if (!Object.prototype.hasOwnProperty.call(loaded, 'no_layout')) return false
  if (Object.prototype.hasOwnProperty.call(next, 'no_layout')) return false
  const { no_layout: _dropped, ...rest } = loaded
  return deepEqual(next, rest)
}

// The no_layout state a post is opened with: only an html post's flag is live.
function loadedNoLayout(post: Post | undefined): boolean {
  return post?.metadata?.no_layout === true && post?.format === 'html'
}

function isStaticBody(value: unknown): value is StaticPostBody {
  return (
    !!value &&
    typeof value === 'object' &&
    'entrypoint' in value &&
    'files' in value &&
    Array.isArray((value as StaticPostBody).files)
  )
}

// Format a draft's `savedAt` epoch (date + time) in the project's
// configured timezone/locale so it reads naturally in the recovery
// banner. Falls back to a plain locale string if Intl chokes on the TZ.
function formatDraftTime(epochMs: number, timezone: string, locale: string): string {
  const d = new Date(epochMs)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

export function PostForm({ post, previewEndpoint = '/admin/preview', postClasses = [] }: PostFormProps) {
  const router = useRouter()
  const t = useT()
  const isEdit = !!post
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null)

  const [title, setTitle] = useState(post?.title ?? '')
  const [slug, setSlug] = useState(post?.slug ?? '')
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '')
  const [format, setFormat] = useState<ContentFormat>(post?.format ?? 'tiptap')
  const [body, setBody] = useState<unknown>(post?.body ?? EMPTY_TIPTAP_DOC)
  const [status, setStatus] = useState<Post['status']>(post?.status ?? 'draft')
  const [tagsInput, setTagsInput] = useState((post?.tags ?? []).join(', '))
  // A stored `no_layout` on a non-html post is inert (every consumer gates
  // on format === 'html'; see `onlyDropsInertNoLayout`), so it is treated as
  // off: switching the format back to html must not silently reactivate it.
  const [noLayout, setNoLayout] = useState(loadedNoLayout(post))
  // Theme post classes. `loadedPostClassIds` is what the post was opened
  // with (the tagged `metadata['ampless:postClasses']` value); the save
  // only rewrites that key when the selection differs from it. A value
  // under the key that ampless did not write (`foreignPostClasses`) makes
  // the selection read-only and is never touched.
  const loadedPostClassIds = readPostClasses(post?.metadata)
  const foreignPostClasses = hasForeignPostClassesValue(post?.metadata)
  const [postClassIds, setPostClassIds] = useState<string[]>(loadedPostClassIds)
  const [publishedAtInput, setPublishedAtInput] = useState(isoToLocalInput(post?.publishedAt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<PostFormView>('edit')
  // Phase 7: preview HTML returned by the `/admin/preview` Route
  // Handler. Empty string until the first fetch resolves; the iframe
  // re-renders whenever `previewPost` changes (debounced 250ms).
  const [previewHtml, setPreviewHtml] = useState('')
  // Remount key for the tiptap editor. `useEditor({ content })` reads
  // `content` only at init, so restoring a revision's body into a tiptap
  // post requires bumping this to force a fresh mount with the new
  // content. Textarea-based formats (markdown / html) are controlled and
  // update from `setBody` alone — they don't need the remount.
  const [editorEpoch, setEditorEpoch] = useState(0)

  // localStorage autosave / recovery state.
  //
  // `dirtyRef` is the genuine-user-edit gate. Simply OPENING a post must
  // write no draft, but two things make a naive "watch state, save"
  // approach fire on open: (a) TiptapEditor's onCreate calls onChange at
  // mount, and (b) tiptap re-normalises stored JSON so getJSON() isn't
  // byte-equal to the server `body`. So we only autosave when a real edit
  // signal flips this flag: tiptap's onUserEdit (onUpdate only), the
  // textarea onChange, the field inputs, and restoreRevision. A ref (not
  // state) avoids re-running the autosave effect just to read the flag.
  const dirtyRef = useRef(false)
  function markDirty() {
    dirtyRef.current = true
  }
  // The draft-recovery banner shown on mount when a usable draft exists.
  // `null` means no prompt. `decision` distinguishes the same-base recover
  // case from the moved-on stale case (different button labels + copy).
  const [recovery, setRecovery] = useState<{
    draft: PostDraft
    decision: Exclude<DraftDecision, 'discard'>
  } | null>(null)
  // A transient "draft restored" hint after the user accepts recovery.
  const [restoredHint, setRestoredHint] = useState(false)
  // Stable post key for the draft (postId on edit, 'new' for a new post).
  const draftId = post?.postId ?? NEW_POST_DRAFT_ID
  // Static posts can't be autosaved (their bytes live in pendingBundle,
  // not in localStorage). Surfaces a short note instead of a draft.
  const isStaticFormat = format === 'static'
  // Post classes only render where the theme wraps the body: not static
  // bundles, not no_layout HTML (`bypassesPostBodyWrapper`). For those
  // formats the group is hidden and the stored key is left as loaded.
  const postClassesApply = format !== 'static' && !(format === 'html' && noLayout)
  // Checkbox options: the theme's declared classes, then any id the post
  // carries (loaded or restored from a revision) that the theme does not
  // declare, so it stays visible after being unchecked.
  const declaredPostClassIds = new Set(postClasses.map((c) => c.id))
  const postClassOptions: Array<EditorPostClass & { undeclared: boolean }> = [
    ...postClasses.map((c) => ({ ...c, undeclared: false })),
  ]
  for (const id of [...loadedPostClassIds, ...postClassIds]) {
    if (declaredPostClassIds.has(id) || postClassOptions.some((o) => o.id === id)) continue
    postClassOptions.push({ id, label: id, undeclared: true })
  }
  const postClassesChanged =
    postClassesApply && !foreignPostClasses && !sameIdSet(postClassIds, loadedPostClassIds)

  function togglePostClass(id: string, checked: boolean) {
    const next = new Set(postClassIds)
    if (checked) next.add(id)
    else next.delete(id)
    // Keep the option order so the stored list is stable.
    setPostClassIds(postClassOptions.map((o) => o.id).filter((o) => next.has(o)))
    markDirty()
  }
  // Timezone / locale for rendering the draft timestamp in the recovery
  // banner, matching how the revision-history panel formats times.
  const cmsConfig = getAdminCmsConfig()
  const draftTimezone = cmsConfig?.timezone ?? 'UTC'
  const draftLocale = cmsConfig?.locale ?? 'en'

  // The field's value at mount, used to detect whether the user edited
  // publishedAt. When untouched, `resolvePublishedAtForSave` preserves the
  // stored value verbatim so an unrelated edit never rewrites publishedAt
  // (which would shift the public sort key) nor truncates its precision.
  const initialPublishedAtInput = isoToLocalInput(post?.publishedAt)
  // Render-scope resolution — for the preview pane and the scheduled
  // notice only. `save()` re-resolves at submit time so a first-publish
  // "now" stamp reflects the actual save moment, not this render.
  const resolvedPublishedAt = resolvePublishedAtForSave({
    status,
    currentInput: publishedAtInput,
    initialInput: initialPublishedAtInput,
    existing: post?.publishedAt,
  })
  // Display-only: a published post with a future publishedAt is shown as
  // scheduled (status option label + notice). `now` advances when that
  // time arrives so both disappear without a reload. Save is unaffected.
  //
  // Checked against the chosen / stored value only — resolved as if draft,
  // which is `resolvedPublishedAt` minus the first-publish "now" stamp.
  // That stamp is never in the future, and including it would re-stamp on
  // every render and keep re-arming the `useNow` timer.
  const scheduleCandidate = resolvePublishedAtForSave({
    status: 'draft',
    currentInput: publishedAtInput,
    initialInput: initialPublishedAtInput,
    existing: post?.publishedAt,
  })
  const isScheduled = (current: number) =>
    getPostDisplayStatus({ status, publishedAt: scheduleCandidate }, current) === 'scheduled'
  const now = useNow((current) =>
    scheduledTransitionAt({ status, publishedAt: scheduleCandidate }, current)
  )
  const scheduled = isScheduled(now)
  // The notice names when the post actually becomes visible. For a stored
  // non-UTC value (e.g. `+09:00`) that is later than the field's instant,
  // because the public resolvers compare publishedAt as a string.
  const visibleAt = scheduledTransitionAt({ status, publishedAt: scheduleCandidate }, now)
  const scheduledNoticeDate =
    visibleAt !== undefined ? isoToLocalInput(new Date(visibleAt).toISOString()) : publishedAtInput

  // Pending bundle for static posts. Held in memory until save so the
  // user can cancel without leaving an orphan upload in S3. On save,
  // `uploadBundle` flushes it, returns the manifest, and that becomes
  // the post's `body`.
  const [pendingBundle, setPendingBundle] = useState<{
    files: ExtractedFile[]
    entrypoint: string
  } | null>(null)
  const initialStaticBody = isStaticBody(post?.body) ? post!.body : null

  // Merge no_layout into whatever other metadata the post may have
  // accumulated (plugin state, SEO overrides, etc.) so the toggle never
  // wipes out unrelated keys. The flag is only meaningful for html
  // posts (the UI hides the checkbox otherwise), so non-html formats
  // always strip it — protects against stale flags surviving a format
  // switch and confusing the dispatcher. Returns undefined when the
  // resulting object would be empty, so we don't store a meaningless `{}`.
  function buildMetadata(): PostMetadata | undefined {
    const next: PostMetadata = { ...(post?.metadata ?? {}) }
    if (noLayout && format === 'html') next.no_layout = true
    else delete next.no_layout
    return Object.keys(next).length > 0 ? next : undefined
  }

  function parseTags(raw: string): string[] {
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      )
    )
  }

  // ── localStorage autosave / recovery ──────────────────────────────
  //
  // The server values this editor opened with — the base the draft is
  // reconciled against. Derived from the immutable `post` prop, so it
  // doesn't drift as the user edits.
  const loadedState: LoadedPostState = {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    format: post?.format ?? 'tiptap',
    body: post?.body ?? EMPTY_TIPTAP_DOC,
    status: post?.status ?? 'draft',
    tags: (post?.tags ?? []).join(', '),
    publishedAtInput: isoToLocalInput(post?.publishedAt),
    noLayout: loadedNoLayout(post),
    postClasses: loadedPostClassIds,
    updatedAt: post?.updatedAt ?? null,
  }

  function buildCurrentDraft(): PostDraft {
    return {
      title,
      slug,
      excerpt,
      format,
      body,
      status,
      tags: tagsInput,
      publishedAtInput,
      noLayout,
      postClasses: postClassIds,
      baseUpdatedAt: post?.updatedAt ?? null,
      savedAt: Date.now(),
    }
  }

  // Pour a recovered draft into the form. Mirrors `restoreRevision` for
  // the content fields, including the tiptap remount (the editor reads
  // `content` only at init). Marks dirty so the recovered-but-unsaved
  // state is re-captured as a draft.
  function applyDraft(draft: PostDraft) {
    setTitle(draft.title)
    setSlug(draft.slug)
    setExcerpt(draft.excerpt)
    setFormat(draft.format)
    setBody(draft.body)
    setStatus(draft.status)
    setTagsInput(draft.tags)
    setPublishedAtInput(draft.publishedAtInput)
    setNoLayout(draft.noLayout && draft.format === 'html')
    // Drafts from before post classes existed lack the field: keep the
    // loaded selection. A foreign value stays read-only either way.
    if (!foreignPostClasses && Array.isArray(draft.postClasses)) {
      setPostClassIds(draft.postClasses.filter(isValidCustomClassId))
    }
    setPendingBundle(null)
    // Force the tiptap editor to remount with the restored body.
    setEditorEpoch((e) => e + 1)
    setView('edit')
    markDirty()
    setRestoredHint(true)
  }

  function acceptRecovery() {
    if (!recovery) return
    applyDraft(recovery.draft)
    setRecovery(null)
  }

  function discardRecovery() {
    clearDraft(draftId)
    dirtyRef.current = false
    setRecovery(null)
  }

  // On mount, decide whether to offer recovery of an unsaved draft. Runs
  // once per post key. Static posts are skipped (their bytes can't be
  // persisted). A draft that equals the loaded server content is silently
  // dropped; a same-base differing draft prompts to recover; a draft taken
  // against a now-outdated server version warns as stale.
  useEffect(() => {
    if (loadedState.format === 'static') return
    const draft = readDraft(draftId)
    if (!draft) return
    // A persisted static draft shouldn't normally exist, but guard anyway.
    if (draft.format === 'static') {
      clearDraft(draftId)
      return
    }
    const decision = reconcileDraft(draft, loadedState)
    if (decision === 'discard') {
      clearDraft(draftId)
      return
    }
    setRecovery({ draft, decision })
    // Mount-only: the loaded base never changes for this form instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced autosave. Writes the live form state to localStorage ~1.2s
  // after the last genuine edit. Only runs when `dirtyRef` is set (see
  // markDirty callers), so merely opening a post writes nothing. Static
  // posts are never autosaved.
  useEffect(() => {
    if (isStaticFormat) return
    if (!dirtyRef.current) return
    const handle = setTimeout(() => {
      // Re-check the dirty gate at FIRE time, not just schedule time: an
      // explicit save (which sets dirtyRef=false and clears the draft) can
      // land during the 1.2s debounce window. Without this re-check a late
      // timeout would re-create a stale draft right after a successful save
      // cleared it.
      if (!dirtyRef.current) return
      writeDraft(draftId, buildCurrentDraft())
    }, 1200)
    return () => clearTimeout(handle)
    // Re-arm on every tracked field change; the dirty gate decides whether
    // a write actually happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, excerpt, format, body, status, tagsInput, publishedAtInput, noLayout, postClassIds])

  function insertMediaSnippet(url: string) {
    if (format === 'tiptap') return // tiptap handles images via its own MediaPicker
    const snippet = snippetFor(url, format)
    markDirty() // inserting media into the body is a genuine edit
    const ta = bodyTextareaRef.current
    const current = typeof body === 'string' ? body : ''
    if (!ta) {
      // No DOM ref yet — append to end as fallback.
      setBody(current + snippet)
      return
    }
    const start = ta.selectionStart ?? current.length
    const end = ta.selectionEnd ?? current.length
    const next = current.slice(0, start) + snippet + current.slice(end)
    setBody(next)
    // After React re-renders the textarea with the new value, restore
    // focus and place the cursor right after the inserted snippet.
    requestAnimationFrame(() => {
      const t2 = bodyTextareaRef.current
      if (!t2) return
      t2.focus()
      const pos = start + snippet.length
      t2.setSelectionRange(pos, pos)
    })
  }

  function changeFormat(next: ContentFormat) {
    if (next === format) return

    // Markdown cannot carry table custom classes (theme table styles): ask
    // before a conversion that would drop them. Cancel keeps the current
    // format and body untouched (the <select> is controlled by `format`).
    if (
      !confirmLossyFormatChange(
        body,
        format,
        next,
        (message) => window.confirm(message),
        (classes) => t('posts.form.formatLossTableClasses', { classes: classes.join(', ') }),
      )
    ) {
      return
    }

    // Convert the body across tiptap / html / markdown so the user
    // keeps their content. tiptap is parsed by the editor when it
    // remounts (it accepts HTML strings as initial content), so for
    // *any* → tiptap we hand it HTML and tiptap reads it. Markdown
    // → tiptap goes via HTML. Switching to/from `static` resets the
    // body — a bundle manifest can't be losslessly produced from
    // prose, and prose can't be reconstituted from a file list.
    let nextBody: unknown = body
    if (next === 'static' || format === 'static') {
      nextBody = defaultBodyForFormat(next)
    } else {
      nextBody = convertBodyFormat(body, format, next, {
        markdownAdapters: getAdminTiptapNodeMarkdown(),
        htmlAdapters: getAdminTiptapNodeHtml(),
        // BASE_TIPTAP_EXTENSIONS carries real tiptap classes;
        // getAdminEditorExtensions() returns the structural-typed registry
        // (`TiptapExtensionLike[]`), but at runtime its entries are
        // genuine tiptap Node/Mark/Extension instances installed by the
        // plugin codegen. Bridge to the nominal `AnyExtension[]` here so
        // the cast lives in one place (the registry boundary).
        editorExtensions: [
          ...BASE_TIPTAP_EXTENSIONS,
          ...(getAdminEditorExtensions() as readonly unknown[] as readonly AnyExtension[]),
        ],
      })
    }

    setFormat(next)
    setBody(nextBody)
    setPendingBundle(null)
    // no_layout only makes sense for raw-HTML posts (tiptap / markdown
    // fragments don't ship a DOCTYPE / head, so serving them bare is a
    // footgun). Static bundles are already DOCTYPE-complete so the
    // flag is redundant there. Clear it when leaving html format so the
    // checkbox-hidden state matches what gets persisted on save.
    if (next !== 'html') setNoLayout(false)
    // A format switch is a genuine user action — capture it as a draft.
    markDirty()
  }

  // Pour a selected revision's fields into the editor form. Does NOT
  // save — the user reviews and clicks Save, which creates a fresh
  // revision via the existing dispatcher path. Applies ONLY the content
  // fields below; the full `metadata` blob is intentionally NOT restored
  // (buildMetadata rebuilds from the live post.metadata and has no
  // metadata state, so restoring the blob wouldn't apply and could
  // clobber plugin / SEO data). The snapshot still STORES metadata; we
  // just don't apply it on restore in v1. The metadata keys we honour are
  // `no_layout`, only for html revisions (matches buildMetadata's gating),
  // and the revision's post classes, which only set the checkbox
  // selection — the save then rewrites just that one key on top of the
  // live metadata. A live foreign value under the key keeps the selection
  // read-only, so it is not restored.
  function restoreRevision(rev: PostRevision) {
    const fmt = rev.format ?? 'markdown'
    setTitle(rev.title ?? '')
    setSlug(rev.slug ?? '')
    setExcerpt(rev.excerpt ?? '')
    setFormat(fmt)
    setBody(rev.body)
    setStatus(rev.status ?? 'draft')
    setTagsInput((rev.tags ?? []).join(', '))
    setPublishedAtInput(isoToLocalInput(rev.publishedAt))
    setNoLayout(rev.metadata?.no_layout === true && fmt === 'html')
    if (!foreignPostClasses) setPostClassIds(readPostClasses(rev.metadata))
    // A new bundle pick (for static) is irrelevant to a restore — clear
    // any pending upload so it can't leak into the next save.
    setPendingBundle(null)
    // Force the tiptap editor to remount with the restored body (it only
    // reads `content` at init). Harmless for textarea formats.
    setEditorEpoch((e) => e + 1)
    // Surface the editor (in case the user was on the preview tab) so the
    // restored content is visible for review before saving.
    setView('edit')
    // A restored-but-unsaved revision is a real unsaved change — capture
    // it as a draft so a crash before Save doesn't lose the restore.
    markDirty()
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const expectedUpdatedAt = isEdit ? post!.updatedAt : undefined

    try {
      const tags = parseTags(tagsInput)
      let metadata = buildMetadata()
      // Rewrite the post-classes key only when the selection changed;
      // otherwise it stays exactly as loaded (buildMetadata spreads the
      // live post.metadata, which keeps it verbatim). `withPostClasses`
      // replaces just that key and drops it for an empty selection.
      if (postClassesChanged) {
        const next = withPostClasses(metadata, postClassIds)
        metadata = Object.keys(next).length > 0 ? next : undefined
      }
      const finalSlug = slug || slugify(title)

      // Resolve publishedAt at SUBMIT time, not render time: a first
      // publish with an empty field stamps `new Date()` inside
      // `resolvePublishedAtForSave`, so it must run now (the render-scope
      // `resolvedPublishedAt` below is only for preview and could be a
      // stale "now" if the user idled before saving).
      const publishedAt = resolvePublishedAtForSave({
        status,
        currentInput: publishedAtInput,
        initialInput: initialPublishedAtInput,
        existing: post?.publishedAt,
      })

      // For static posts, push the pending bundle to S3 before saving
      // the post row. The returned manifest becomes the body so the
      // DB always references files that actually exist. If no new
      // bundle was picked, we re-use the existing manifest (edit-only
      // metadata changes shouldn't re-upload).
      let nextBody: unknown = body
      // Set when a new static bundle is uploaded below: that save keeps the
      // unconditional write (see the comment on the pre-check).
      let uploadedBundle = false
      if (format === 'static') {
        if (pendingBundle) {
          // NOT PROTECTED against concurrent edits, deletes or uploads.
          // `uploadBundle` wipes and re-uploads the slug's S3 prefix, and the
          // DB write after it is the legacy unconditional one (it must write
          // `metadata.files`; failing it after S3 was replaced would leave
          // the old row pointing at new files). The re-read below is only a
          // best-effort, read-only early abort: it stops a save whose post
          // already changed (S3 untouched), but anything that lands between
          // this check and the final write -- an edit, a delete (the write
          // then recreates nothing but overwrites whatever is there), another
          // bundle upload to the same prefix -- is overwritten or mixed.
          // A safe static bundle replace needs its own design (separate
          // issue); this path deliberately keeps the pre-existing behaviour.
          if (expectedUpdatedAt) {
            const fresh = await getPostById(post!.postId)
            if (!fresh || fresh.updatedAt !== expectedUpdatedAt) {
              throw new PostUpdateConflictError(post!.postId, expectedUpdatedAt)
            }
          }
          uploadedBundle = true
          const result = await uploadBundle({
            slug: finalSlug,
            files: pendingBundle.files,
            entrypoint: pendingBundle.entrypoint,
          })
          nextBody = result.body
          // Stamp the per-file size / mimeType map onto the post
          // metadata so the static delivery route can stream small
          // files back without a HEAD round-trip on first read.
          metadata = { ...(metadata ?? {}), files: result.filesMeta }
        } else {
          // No new bundle picked. Prefer the current `body` if it is
          // already a valid static manifest — this is the case after
          // restoring a static revision (restoreRevision sets `body` to
          // the revision's manifest, and the save branch must honour it
          // instead of silently re-writing the current manifest). Else
          // fall back to the originally-loaded manifest (edit-only
          // metadata change — preserves metadata.files via buildMetadata's
          // spread of post.metadata). If neither is a manifest there is
          // nothing to reference (e.g. restoring a static revision onto a
          // post that never had a bundle).
          const fallbackManifest = isStaticBody(body) ? body : initialStaticBody
          if (!fallbackManifest) throw new Error(t('posts.form.static.noBundle'))
          nextBody = fallbackManifest
        }
      }

      if (isEdit) {
        // This is a full-document save, not a partial patch: provider.update
        // omits `undefined` fields, so clearing excerpt / emptying metadata
        // must send an explicit value or the stored value would survive.
        // Send `excerpt` verbatim ('' clears it) and `metadata ?? {}` ('{}'
        // clears stale keys like a leftover `no_layout`).
        const doc: Partial<Post> = {
          title,
          slug: finalSlug,
          excerpt,
          format,
          body: nextBody,
          status,
          publishedAt,
          tags,
          metadata: metadata ?? {},
        }
        if (uploadedBundle) {
          // Unprotected static bundle save -- see the comment above.
          await updatePost(post!.postId, doc)
        } else {
          await saveEditConditionally(post!, doc)
        }
      } else {
        await createPost({
          slug: finalSlug,
          title,
          excerpt: excerpt || undefined,
          format,
          body: nextBody,
          status,
          publishedAt,
          tags,
          metadata,
        })
      }
      // Explicit save succeeded — the recovery draft is obsolete. Clear
      // this post's key (and the shared 'new' key on first create, since
      // a brand-new post autosaves under 'new' before it has a postId).
      dirtyRef.current = false
      clearDraft(draftId)
      if (!isEdit) clearDraft(NEW_POST_DRAFT_ID)
      router.push('/admin/posts')
      router.refresh()
    } catch (err) {
      if (err instanceof PostUpdateConflictError) {
        // Nothing was saved. Keep the user's work: flush the local draft
        // now (the debounced autosave may not have fired yet) so a reload
        // offers it back as a stale draft. Static posts have no draft.
        if (!isStaticFormat && dirtyRef.current) writeDraft(draftId, buildCurrentDraft())
        setError(t(isStaticFormat ? 'posts.form.saveConflictStatic' : 'posts.form.saveConflict'))
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSaving(false)
    }
  }

  // Edit save conditioned on the post exactly as this form loaded it: the
  // backend writes only if every field still matches (and updatedAt), so a
  // concurrent save elsewhere -- another tab, another editor, MCP, even in
  // the same millisecond -- is reported (PostUpdateConflictError) instead
  // of overwritten.
  //
  // When no conditional write is possible (provider without it, a backend
  // that was not upgraded, or a post with no known updatedAt) nothing was
  // executed, and the legacy save below runs instead:
  //   - metadata unchanged from what was loaded: the update is sent
  //     WITHOUT `metadata`, so the stored attribute -- including post
  //     classes or plugin keys another writer added meanwhile -- is not
  //     touched;
  //   - the only metadata change is `no_layout` dropped because the post
  //     is saved in a non-html format (e.g. html -> markdown): treated as
  //     unchanged and sent WITHOUT `metadata` too. The stale flag stays
  //     stored but is inert (see `onlyDropsInertNoLayout`);
  //   - any other metadata change (post classes, the no_layout toggle on
  //     an html post): refused, nothing saved, because there is no way to
  //     write a single metadata key without a whole-object replace, which
  //     could erase a concurrent metadata change.
  // The content fields of the legacy save stay last-write-wins, exactly as
  // before conditional saves existed.
  async function saveEditConditionally(loaded: Post, doc: Partial<Post>) {
    try {
      await updatePost(loaded.postId, doc, { expected: loaded })
      return
    } catch (err) {
      if (!(err instanceof ConditionalPostUpdateUnsupportedError)) throw err
      console.warn('[ampless admin] conditional save unavailable, using the legacy save:', err.message)
    }
    const nextMetadata = doc.metadata ?? {}
    const loadedMetadata = loaded.metadata ?? {}
    if (
      !deepEqual(nextMetadata, loadedMetadata) &&
      !onlyDropsInertNoLayout(nextMetadata, loadedMetadata, doc.format)
    ) {
      throw new Error(t('posts.form.metadataUnsafe'))
    }
    // The provider omits `undefined` fields from the update input.
    await updatePost(loaded.postId, { ...doc, metadata: undefined })
  }

  async function handleDelete() {
    if (!post) return
    if (!confirm(t('posts.form.deleteConfirm', { title: post.title }))) return
    setSaving(true)
    try {
      // Clear the bundle's S3 files before the post row goes away so
      // we don't orphan ~megabytes of assets. Errors are swallowed —
      // a partial S3 delete shouldn't block the post deletion.
      if (post.format === 'static') {
        await deleteBundle(post.slug).catch(() => undefined)
      }
      await deletePost(post.postId)
      router.push('/admin/posts')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  // Build a Post-like object for preview-time rendering. Fields the
  // current form state owns; everything else falls back to either the
  // existing post (on edit) or sensible defaults.
  const previewPost: Post = {
    postId: post?.postId ?? 'preview',
    slug: slug || slugify(title) || 'preview',
    title,
    excerpt: excerpt || undefined,
    format,
    body,
    status,
    publishedAt: resolvedPublishedAt,
    tags: parseTags(tagsInput),
    // Only the post-classes key, from the current selection, so the
    // preview's <main> gets the same `ampless-post--<id>` classes the
    // theme would add. Omitted when there are none (or the format never
    // gets classes, or a foreign value makes them read-only): the preview
    // request is then exactly what it was before post classes existed.
    ...(postClassesApply &&
      !foreignPostClasses &&
      postClassIds.length > 0 && {
        metadata: {
          [POST_CLASSES_METADATA_KEY]: {
            kind: POST_CLASSES_METADATA_KIND,
            version: 1,
            ids: postClassIds,
          } satisfies PostClassesMetadata,
        },
      }),
  }

  // Phase 7: when the preview tab is active, debounce-POST the draft
  // (250ms) to the preview endpoint (default `/admin/preview`, the
  // template scaffold's Route Handler) and stash the response HTML
  // for the iframe srcDoc. Aborting the pending fetch on unmount /
  // dependency change avoids stale writes overwriting a more-recent
  // render.
  useEffect(() => {
    if (view !== 'preview') return
    if (format === 'static') return
    const ctrl = new AbortController()
    const tid = window.setTimeout(() => {
      fetch(previewEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewPost),
        signal: ctrl.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`preview ${r.status}`)
          return r.text()
        })
        .then((html) => {
          if (!ctrl.signal.aborted) setPreviewHtml(buildPreviewSrcDoc(html))
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return
          // eslint-disable-next-line no-console
          console.error('[ampless admin] preview fetch failed:', err)
        })
    }, 250)
    return () => {
      ctrl.abort()
      window.clearTimeout(tid)
    }
    // We intentionally serialise `previewPost` shallowly via its
    // contributing primitives so the effect re-runs on every change
    // worth re-previewing. `previewPost` itself is a new object each
    // render so it can't be used in the deps directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    previewEndpoint,
    format,
    title,
    slug,
    excerpt,
    body,
    status,
    resolvedPublishedAt,
    tagsInput,
    noLayout,
    postClassIds,
  ])

  return (
    <form onSubmit={save} className="space-y-6">
      {/* Tab strip — keep both views mounted (visibility-only toggle)
          so the tiptap editor doesn't lose focus / cursor / unsaved
          changes when the user peeks at preview and comes back. */}
      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setView('edit')}
          aria-pressed={view === 'edit'}
          className={`px-4 py-2 text-sm font-medium transition ${
            view === 'edit'
              ? 'border-b-2 border-[var(--primary)] text-[var(--primary)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('posts.form.tabEdit')}
        </button>
        <button
          type="button"
          onClick={() => setView('preview')}
          aria-pressed={view === 'preview'}
          className={`px-4 py-2 text-sm font-medium transition ${
            view === 'preview'
              ? 'border-b-2 border-[var(--primary)] text-[var(--primary)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('posts.form.tabPreview')}
        </button>
      </div>

      {view === 'preview' && (
        <article className="space-y-4">
          <header className="border-b pb-4">
            <h1 className="text-3xl font-bold tracking-tight">
              {title || (
                <span className="text-muted-foreground italic">
                  {t('posts.form.previewNoTitle')}
                </span>
              )}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {previewPost.publishedAt ? (
                <time dateTime={previewPost.publishedAt}>
                  {formatDate(previewPost.publishedAt)}
                </time>
              ) : (
                <span>{t('common.draft')}</span>
              )}
              <span className="mx-2">·</span>
              <span className="font-mono text-xs uppercase">{format}</span>
            </p>
            {excerpt && (
              <p className="mt-3 text-base text-muted-foreground">{excerpt}</p>
            )}
          </header>
          {format === 'static' ? (
            <p className="text-sm text-muted-foreground">
              {t('posts.form.static.previewHint')}
            </p>
          ) : (
            // Phase 7: preview HTML is fetched from the template's
            // `/admin/preview` Route Handler so `ampless.renderBody`
            // (async ReactNode) + `ampless.publicPostScriptsForPage(
            // [draft])` can run server-side. The result is injected
            // into an iframe srcDoc.
            //
            // Sandbox is `allow-scripts allow-same-origin`. With srcDoc,
            // this gives the iframe the embedding document's origin
            // (= the admin), which 3rd-party embed widgets (YouTube SDK,
            // x.com widgets.js) require — they refuse to initialise in an
            // opaque-origin (`allow-scripts` only) iframe because they
            // need access to their own non-HttpOnly storage / cache and
            // real-origin requests (an opaque-origin iframe blocks them
            // outright; with a real origin the iframe can use
            // non-opaque-origin storage / cache and issue eligible
            // credentialed XHR — subject to browser settings and
            // third-party cookie restrictions).
            //
            // Trust boundary (v1 explicit design decision): ampless treats
            // admin preview content / plugin script as trusted.
            // Same-origin gives the preview script access to the admin's
            // auth state / non-HttpOnly storage / DOM, and lets it issue
            // authenticated same-origin XHR / fetch (HttpOnly cookies
            // aren't readable from JS but they ride along those requests).
            // v1 explicitly puts both revision body AND configured plugin
            // scripts inside the trust ring: the engineer audits plugins
            // before npm-installing them, and body content is produced by
            // trusted editors of this site. A stricter sandbox (= separate-
            // origin preview route + CSP / COEP / COOP) is parked for
            // v2.0+ if/when a real plugin marketplace lands.
            //
            // Typography note: `prose prose-neutral dark:prose-invert
            // max-w-none` were removed from the iframe element. Those classes
            // style the iframe *element* border-box only, not its content
            // document — an iframe srcDoc does not inherit the parent page's
            // CSS. Typography is now applied inside the document returned by
            // createPreviewRouteHandler (PREVIEW_BASE_CSS + theme cssVars).
            <iframe
              title="post-preview"
              srcDoc={previewHtml}
              sandbox="allow-scripts allow-same-origin"
              className="min-h-[400px] w-full rounded-md border"
            />
          )}
          {previewPost.tags && previewPost.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t pt-4 text-sm">
              {previewPost.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('posts.form.previewHint')}</p>
        </article>
      )}

      <div className={view === 'edit' ? 'space-y-6' : 'hidden'}>
      {/* Draft recovery banner — offered on mount when a usable
          localStorage draft exists for this post. The `stale` variant
          warns that the server moved on under the draft and only offers
          "Restore anyway" alongside Discard. */}
      {recovery && (
        <div
          role="alert"
          className={
            recovery.decision === 'stale'
              ? 'space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950'
              : 'space-y-2 rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-4 text-sm'
          }
        >
          <p className="font-medium">
            {recovery.decision === 'stale'
              ? t('posts.draft.staleTitle')
              : t('posts.draft.recoverTitle')}
          </p>
          <p className="text-muted-foreground">
            {recovery.decision === 'stale'
              ? t('posts.draft.staleBody', {
                  when: formatDraftTime(recovery.draft.savedAt, draftTimezone, draftLocale),
                })
              : t('posts.draft.recoverBody', {
                  when: formatDraftTime(recovery.draft.savedAt, draftTimezone, draftLocale),
                })}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={acceptRecovery}>
              {recovery.decision === 'stale'
                ? t('posts.draft.restoreAnyway')
                : t('posts.draft.restore')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={discardRecovery}>
              {t('posts.draft.discard')}
            </Button>
          </div>
        </div>
      )}

      {/* Transient confirmation after the user accepts recovery. */}
      {restoredHint && !recovery && (
        <p className="rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/5 px-3 py-2 text-xs text-muted-foreground">
          {t('posts.draft.restored')}
        </p>
      )}

      {/* Static posts can't be autosaved to localStorage. */}
      {isStaticFormat && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('posts.draft.staticUnsupported')}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">{t('posts.form.title')}</Label>
        <Input
          id="title"
          required
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!isEdit && !slug) setSlug(slugify(e.target.value))
            markDirty()
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">{t('posts.form.slug')}</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value)
            markDirty()
          }}
          placeholder={slugify(title) || t('posts.form.slugPlaceholder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="excerpt">{t('posts.form.excerpt')}</Label>
        <Textarea
          id="excerpt"
          rows={2}
          value={excerpt}
          onChange={(e) => {
            setExcerpt(e.target.value)
            markDirty()
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="format">{t('posts.form.format')}</Label>
        <select
          id="format"
          value={format}
          onChange={(e) => changeFormat(e.target.value as ContentFormat)}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="tiptap">Tiptap (rich editor)</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="static">{t('posts.form.formatStaticLabel')}</option>
        </select>
        <p className="text-xs text-muted-foreground">{t('posts.form.formatHint')}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('posts.form.body')}</Label>
          {format !== 'tiptap' && format !== 'static' && (
            // For textarea-based formats (markdown / html) there's no
            // embedded toolbar, so we surface the MediaPicker as a
            // standalone button. Selecting an asset inserts a
            // format-aware snippet at the cursor.
            <MediaPicker
              onSelect={insertMediaSnippet}
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <ImageIcon className="mr-2 h-3 w-3" />
                  {t('posts.form.insertMedia')}
                </Button>
              }
            />
          )}
        </div>
        {format === 'tiptap' ? (
          <TiptapEditor
            key={editorEpoch}
            initialContent={body}
            onChange={setBody}
            onUserEdit={markDirty}
          />
        ) : format === 'static' ? (
          <StaticUploader
            initial={initialStaticBody}
            onFilesReady={(files, entrypoint) =>
              setPendingBundle({ files, entrypoint })
            }
            onClear={() => setPendingBundle(null)}
          />
        ) : (
          <Textarea
            ref={bodyTextareaRef}
            rows={20}
            value={typeof body === 'string' ? body : ''}
            onChange={(e) => {
              setBody(e.target.value)
              markDirty()
            }}
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">{t('posts.form.tags')}</Label>
        <Input
          id="tags"
          value={tagsInput}
          onChange={(e) => {
            setTagsInput(e.target.value)
            markDirty()
          }}
          placeholder={t('posts.form.tagsPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('posts.form.tagsHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">{t('posts.form.status')}</Label>
        <select
          id="status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Post['status'])
            markDirty()
          }}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="draft">{t('common.draft')}</option>
          <option value="published">
            {scheduled ? t('common.scheduled') : t('common.published')}
          </option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="publishedAt">{t('posts.form.publishedAt')}</Label>
        <input
          id="publishedAt"
          type="datetime-local"
          value={publishedAtInput}
          onChange={(e) => {
            setPublishedAtInput(e.target.value)
            markDirty()
          }}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        />
        <p className="text-xs text-muted-foreground">{t('posts.form.publishedAtHint')}</p>
        {scheduled && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('posts.form.scheduledNotice', { date: scheduledNoticeDate })}
          </p>
        )}
      </div>

      {format === 'html' && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={noLayout}
              onChange={(e) => {
                setNoLayout(e.target.checked)
                markDirty()
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t('posts.form.noLayout')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('posts.form.noLayoutHint')}
              </span>
            </span>
          </label>
        </div>
      )}

      {postClassesApply && (postClassOptions.length > 0 || foreignPostClasses) && (
        <div className="space-y-2">
          <Label>{t('posts.form.postClasses')}</Label>
          {foreignPostClasses ? (
            <p
              role="note"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950"
            >
              {t('posts.form.postClassesForeign')}
            </p>
          ) : (
            <div className="space-y-1">
              {postClassOptions.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="postClass"
                    value={c.id}
                    checked={postClassIds.includes(c.id)}
                    onChange={(e) => togglePostClass(c.id, e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{c.label}</span>
                    {c.undeclared && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({t('posts.form.postClassesNotInTheme')})
                      </span>
                    )}
                    {c.description && (
                      <span className="block text-xs text-muted-foreground">{c.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('posts.form.postClassesHint')}</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving
            ? t('common.saving')
            : isEdit
              ? t('posts.form.saveChanges')
              : t('posts.form.createPost')}
        </Button>
        {isEdit && (
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving}>
            {t('posts.form.delete')}
          </Button>
        )}
      </div>

      {/* Revision history — only meaningful for an existing post (a new
          post has no snapshots yet). Restoring pours a revision's fields
          into the form above for review; the user saves manually. */}
      {isEdit && post && (
        <PostHistoryPanel
          postId={post.postId}
          onRestore={restoreRevision}
          previewEndpoint={previewEndpoint}
        />
      )}
      </div>
    </form>
  )
}
