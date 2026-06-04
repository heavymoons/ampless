'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon } from 'lucide-react'
import {
  createPost,
  updatePost,
  deletePost,
  formatDate,
  type Post,
  type PostMetadata,
  type StaticPostBody,
  type ContentFormat,
} from 'ampless'
import {
  renderBody,
  tiptapToHtml,
  tiptapToMarkdown,
  markdownToHtml,
  htmlToMarkdown,
} from '@ampless/runtime'
import { Button, Input, Label, Textarea } from '@ampless/runtime/ui'
import { TiptapEditor } from '../editor/tiptap-editor.js'
import { MediaPicker } from './media-picker.js'
import { StaticUploader } from './static-uploader.js'
import {
  uploadBundle,
  deleteBundle,
  type ExtractedFile,
} from '../lib/static-bundle.js'
import { useT } from './i18n-provider.js'
import {
  isoToLocalInput,
  localInputToIso,
  resolvePublishedAt,
  isFuture,
} from '../lib/post-published-at.js'

type PostFormView = 'edit' | 'preview'

interface PostFormProps {
  post?: Post
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

function isStaticBody(value: unknown): value is StaticPostBody {
  return (
    !!value &&
    typeof value === 'object' &&
    'entrypoint' in value &&
    'files' in value &&
    Array.isArray((value as StaticPostBody).files)
  )
}

export function PostForm({ post }: PostFormProps) {
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
  const [noLayout, setNoLayout] = useState(post?.metadata?.no_layout === true)
  const [publishedAtInput, setPublishedAtInput] = useState(isoToLocalInput(post?.publishedAt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<PostFormView>('edit')

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

  function insertMediaSnippet(url: string) {
    if (format === 'tiptap') return // tiptap handles images via its own MediaPicker
    const snippet = snippetFor(url, format)
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
      const k = `${format}→${next}` as
        | 'tiptap→html'
        | 'tiptap→markdown'
        | 'html→tiptap'
        | 'html→markdown'
        | 'markdown→tiptap'
        | 'markdown→html'
      switch (k) {
        case 'tiptap→html':
          nextBody = tiptapToHtml(body)
          break
        case 'tiptap→markdown':
          nextBody = tiptapToMarkdown(body)
          break
        case 'html→tiptap':
          // Tiptap parses HTML strings on mount.
          nextBody = String(body ?? '')
          break
        case 'markdown→tiptap':
          nextBody = markdownToHtml(String(body ?? ''))
          break
        case 'html→markdown':
          nextBody = htmlToMarkdown(String(body ?? ''))
          break
        case 'markdown→html':
          nextBody = markdownToHtml(String(body ?? ''))
          break
        default:
          // Unreachable for the formats we expose, but reset to a
          // sensible default if a new format is introduced later.
          nextBody = defaultBodyForFormat(next)
      }
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
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const tags = parseTags(tagsInput)
      let metadata = buildMetadata()
      const finalSlug = slug || slugify(title)

      // For static posts, push the pending bundle to S3 before saving
      // the post row. The returned manifest becomes the body so the
      // DB always references files that actually exist. If no new
      // bundle was picked, we re-use the existing manifest (edit-only
      // metadata changes shouldn't re-upload).
      let nextBody: unknown = body
      if (format === 'static') {
        if (pendingBundle) {
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
        } else if (initialStaticBody) {
          nextBody = initialStaticBody
          // Edit without a new bundle: preserve any existing
          // metadata.files map (already on `metadata` via
          // buildMetadata's spread of post.metadata).
        } else {
          throw new Error(t('posts.form.static.noBundle'))
        }
      }

      if (isEdit) {
        await updatePost(post!.postId, {
          title,
          slug: finalSlug,
          excerpt: excerpt || undefined,
          format,
          body: nextBody,
          status,
          publishedAt: resolvePublishedAt({
            status,
            inputIso: localInputToIso(publishedAtInput),
            existing: post?.publishedAt,
          }),
          tags,
          metadata,
        })
      } else {
        await createPost({
          slug: finalSlug,
          title,
          excerpt: excerpt || undefined,
          format,
          body: nextBody,
          status,
          publishedAt: resolvePublishedAt({
            status,
            inputIso: localInputToIso(publishedAtInput),
            existing: undefined,
          }),
          tags,
          metadata,
        })
      }
      router.push('/admin/posts')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
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

  // Resolved publishedAt for both preview and save — computed once so
  // both uses are consistent.
  const resolvedPublishedAt = resolvePublishedAt({
    status,
    inputIso: localInputToIso(publishedAtInput),
    existing: post?.publishedAt,
  })

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
  }

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
            <div
              className="prose prose-neutral dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderBody(previewPost) }}
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
      <div className="space-y-2">
        <Label htmlFor="title">{t('posts.form.title')}</Label>
        <Input
          id="title"
          required
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!isEdit && !slug) setSlug(slugify(e.target.value))
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">{t('posts.form.slug')}</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={slugify(title) || t('posts.form.slugPlaceholder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="excerpt">{t('posts.form.excerpt')}</Label>
        <Textarea
          id="excerpt"
          rows={2}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
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
          <TiptapEditor initialContent={body} onChange={setBody} />
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
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">{t('posts.form.tags')}</Label>
        <Input
          id="tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t('posts.form.tagsPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('posts.form.tagsHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">{t('posts.form.status')}</Label>
        <select
          id="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Post['status'])}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="draft">{t('common.draft')}</option>
          <option value="published">{t('common.published')}</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="publishedAt">{t('posts.form.publishedAt')}</Label>
        <input
          id="publishedAt"
          type="datetime-local"
          value={publishedAtInput}
          onChange={(e) => setPublishedAtInput(e.target.value)}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        />
        <p className="text-xs text-muted-foreground">{t('posts.form.publishedAtHint')}</p>
        {status === 'published' && isFuture(localInputToIso(publishedAtInput)) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('posts.form.scheduledNotice', { date: publishedAtInput })}
          </p>
        )}
      </div>

      {format === 'html' && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={noLayout}
              onChange={(e) => setNoLayout(e.target.checked)}
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
      </div>
    </form>
  )
}
