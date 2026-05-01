'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPost, updatePost, deletePost, type Post } from 'ampless'
import { readAdminSiteIdFromCookie } from '@/lib/admin-site-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TiptapEditor } from '@/components/editor/tiptap-editor'

interface PostFormProps {
  post?: Post
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function PostForm({ post }: PostFormProps) {
  const router = useRouter()
  const isEdit = !!post

  const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

  const [title, setTitle] = useState(post?.title ?? '')
  const [slug, setSlug] = useState(post?.slug ?? '')
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '')
  const [body, setBody] = useState<unknown>(post?.body ?? emptyDoc)
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

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const tags = parseTags(tagsInput)
      if (isEdit) {
        await updatePost(post!.postId, {
          title,
          slug: slug || slugify(title),
          excerpt: excerpt || undefined,
          body,
          status,
          publishedAt: status === 'published' ? (post?.publishedAt ?? new Date().toISOString()) : undefined,
          tags,
        })
      } else {
        await createPost({
          siteId: readAdminSiteIdFromCookie(),
          slug: slug || slugify(title),
          title,
          excerpt: excerpt || undefined,
          format: 'tiptap',
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
    if (!confirm(`Delete "${post.title}"?`)) return
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
        <Label htmlFor="title">Title</Label>
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
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={slugify(title) || 'my-post-slug'}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="excerpt">Excerpt</Label>
        <Textarea
          id="excerpt"
          rows={2}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Body</Label>
        <TiptapEditor initialContent={body} onChange={setBody} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <Input
          id="tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="comma, separated, tags"
        />
        <p className="text-xs text-muted-foreground">
          Used to group posts on tag pages (e.g. /tag/tech).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Post['status'])}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create post'}
        </Button>
        {isEdit && (
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving}>
            Delete
          </Button>
        )}
      </div>
    </form>
  )
}
