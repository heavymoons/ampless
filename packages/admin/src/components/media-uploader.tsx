'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { uploadData, list, remove, isCancelError } from 'aws-amplify/storage'
import { processImage } from 'ampless/media'
import type { ProcessOptions } from 'ampless/media'
import { Button, Input } from '@ampless/runtime/ui'
import { Trash2, Copy, Check, FileText, Code2 } from 'lucide-react'
import { publicMediaUrl } from '../lib/media.js'
import { getMediaProcessingDefaults } from '../lib/admin-config-client.js'
import { ImageUploadDialog } from './image-upload-dialog.js'
import { useT } from './i18n-provider.js'

// uploadData has overloads (path-based, key-based) that return different
// TransferTask shapes; cancel + result are common to both, so type only
// what we use.
interface UploadTask {
  cancel(): void
  result: Promise<unknown>
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i
const STYLESHEET_EXT_RE = /\.css$/i
const SCRIPT_EXT_RE = /\.m?js$/i

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toUpperCase() : 'FILE'
}

// Build the most-likely HTML tag the editor would paste for this
// asset, so the admin gets one-click insertion into a raw-HTML post
// body. Falls back to copying the URL itself when there's no obvious
// HTML tag (e.g. a PDF or zip file).
function snippetFor(url: string, path: string): string {
  if (IMAGE_EXT_RE.test(path)) {
    return `<img src="${url}" alt="" />`
  }
  if (STYLESHEET_EXT_RE.test(path)) {
    return `<link rel="stylesheet" href="${url}" />`
  }
  if (SCRIPT_EXT_RE.test(path)) {
    return `<script src="${url}"></script>`
  }
  return url
}

interface MediaItem {
  path: string
  url: string
}

// Preserve Unicode (Japanese, emoji, etc.) — strip control chars and the
// characters S3 / URLs reject. Replace whitespace runs with underscore.
function sanitizeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[ -]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 200) || 'upload'
  )
}

export function MediaUploader() {
  const t = useT()
  const [items, setItems] = useState<MediaItem[]>([])
  const [queue, setQueue] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  // Tracks the currently in-flight uploadData task so Cancel-all can abort
  // it. Without this, an in-flight S3 PUT keeps running after the user
  // clears the queue and ends up persisted anyway.
  const uploadTaskRef = useRef<UploadTask | null>(null)
  // Cancellation flag checked between phases (processImage → uploadData).
  // The task ref alone cannot abort during the pre-upload processImage
  // phase because no UploadTask exists yet, so a long lossless re-encode
  // could otherwise still upload after the user clicked Cancel.
  const cancelTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  const refresh = useCallback(async () => {
    try {
      const result = await list({ path: 'public/media/' })
      setItems(
        result.items.map((item) => ({
          path: item.path,
          url: publicMediaUrl(item.path),
        }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    setQueue((prev) => [...prev, ...files])
  }

  async function handleDialogConfirm(file: File, options: ProcessOptions) {
    const token = { cancelled: false }
    cancelTokenRef.current = token
    setUploading(true)
    setError(null)
    let advance = true
    try {
      const processed = await processImage(file, options)
      if (token.cancelled) {
        advance = false
        return
      }
      const safeName = sanitizeName(processed.suggestedName)
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const path = `public/media/${yyyy}/${mm}/${Date.now()}-${safeName}`
      const task = uploadData({
        path,
        data: processed.blob,
        options: { contentType: processed.mime },
      })
      uploadTaskRef.current = task
      await task.result
      await refresh()
    } catch (err) {
      if (isCancelError(err) || token.cancelled) {
        // Cancel-all already cleared the queue; do not advance again.
        advance = false
      } else {
        setError(err instanceof Error ? err.message : String(err))
        // Skip the offending file so the queue does not get stuck on it.
      }
    } finally {
      uploadTaskRef.current = null
      setUploading(false)
      if (advance) {
        setQueue((prev) => prev.slice(1))
      }
    }
  }

  function handleDialogSkip() {
    if (uploading) return // disabled in UI but defend against programmatic calls
    setQueue((prev) => prev.slice(1))
  }

  function handleDialogCancel() {
    // Two phases need cancelling: (a) processImage hasn't started uploadData
    // yet, so the task ref is null — flip the token so handleDialogConfirm
    // bails before invoking uploadData. (b) uploadData is in flight — call
    // cancel(), the task rejects, isCancelError handles the catch path.
    cancelTokenRef.current.cancelled = true
    uploadTaskRef.current?.cancel()
    setQueue([])
  }

  async function handleDelete(path: string) {
    if (!confirm(t('media.deleteConfirm'))) return
    try {
      await remove({ path })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCopy(item: MediaItem, mode: 'url' | 'tag') {
    const text = mode === 'url' ? item.url : snippetFor(item.url, item.path)
    await navigator.clipboard.writeText(text)
    const key = `${item.path}:${mode}`
    setCopiedPath(key)
    setTimeout(() => setCopiedPath((p) => (p === key ? null : p)), 1500)
  }

  const currentFile = queue[0] ?? null

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4">
        <Input
          type="file"
          multiple
          // No `accept` filter: CSS / JS / fonts / etc. all need to
          // upload too (a raw-HTML post bundles its own assets). Admin
          // is a trusted role, so we don't gate on extension here.
          onChange={handleFiles}
          disabled={uploading}
        />
        {uploading && <p className="mt-2 text-sm text-muted-foreground">{t('media.uploading')}</p>}
        {!uploading && queue.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">{t('media.queued', { count: queue.length })}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ImageUploadDialog
        file={currentFile}
        remaining={queue.length}
        busy={uploading}
        defaults={getMediaProcessingDefaults()}
        onConfirm={handleDialogConfirm}
        onSkip={handleDialogSkip}
        onCancel={handleDialogCancel}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => {
          const isImage = IMAGE_EXT_RE.test(item.path)
          const isStylesheet = STYLESHEET_EXT_RE.test(item.path)
          const isScript = SCRIPT_EXT_RE.test(item.path)
          const filename = item.path.split('/').pop() ?? ''
          const ext = getExtension(item.path)
          const tagSnippet = snippetFor(item.url, item.path)
          const tagDiffersFromUrl = tagSnippet !== item.url
          const urlCopied = copiedPath === `${item.path}:url`
          const tagCopied = copiedPath === `${item.path}:tag`
          return (
            <div
              key={item.path}
              className="group relative overflow-hidden rounded-md border bg-[var(--card)]"
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={item.path}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
                  {isStylesheet || isScript ? (
                    <Code2 className="h-8 w-8" />
                  ) : (
                    <FileText className="h-8 w-8" />
                  )}
                  <span className="font-mono text-xs font-semibold">.{ext.toLowerCase()}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t px-2 py-1 text-xs">
                <span className="truncate" title={filename}>
                  {filename}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopy(item, 'url')}
                    title={t('media.copyUrl')}
                  >
                    {urlCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                  {tagDiffersFromUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleCopy(item, 'tag')}
                      title={t('media.copyTag')}
                    >
                      {tagCopied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Code2 className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleDelete(item.path)}
                    title={t('media.delete')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t('media.empty')}</p>
      )}
    </div>
  )
}
