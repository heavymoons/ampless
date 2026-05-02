'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon } from 'lucide-react'
import {
  createPost,
  updatePost,
  deletePost,
  type Post,
  type ContentFormat,
} from 'ampless'
import { readAdminSiteIdFromCookie } from '@/lib/admin-site-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TiptapEditor } from '@/components/editor/tiptap-editor'
import { MediaPicker } from '@/components/admin/media-picker'
import {
  tiptapToHtml,
  tiptapToMarkdown,
  markdownToHtml,
  htmlToMarkdown,
} from '@/lib/posts'
import { useT } from '@/components/i18n-provider'

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
// changes (tiptap stores an object, the others store strings). Pre-
// populate sensibly so they're not staring at junk.
function defaultBodyForFormat(format: ContentFormat): unknown {
  if (format === 'tiptap') return EMPTY_TIPTAP_DOC
  return ''
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    // Convert the body across all six tiptap / html / markdown
    // directions so the user keeps their content. tiptap is parsed
    // by the editor when it remounts (it accepts HTML strings as
    // initial content), so for *any* → tiptap we hand it HTML and
    // tiptap reads it. Markdown → tiptap goes via HTML.
    let nextBody: unknown = body
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
        // Unreachable for the three formats we expose, but reset to
        // a sensible default if a new format is introduced later.
        nextBody = defaultBodyForFormat(next)
    }

    setFormat(next)
    setBody(nextBody)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const tags = parseTags(tagsInput)
      if (isEdit) {
        await updatePost(
          post!.postId,
          {
            title,
            slug: slug || slugify(title),
            excerpt: excerpt || undefined,
            format,
            body,
            status,
            publishedAt:
              status === 'published' ? (post?.publishedAt ?? new Date().toISOString()) : undefined,
            tags,
          },
          { siteId: post!.siteId }
        )
      } else {
        await createPost({
          siteId: readAdminSiteIdFromCookie(),
          slug: slug || slugify(title),
          title,
          excerpt: excerpt || undefined,
          format,
          body,
          status,
          publishedAt: status === 'published' ? new Date().toISOString() : undefined,
          tags,
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
      await deletePost(post.postId)
      router.push('/admin/posts')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
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
        </select>
        <p className="text-xs text-muted-foreground">{t('posts.form.formatHint')}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('posts.form.body')}</Label>
          {format !== 'tiptap' && (
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
    </form>
  )
}
