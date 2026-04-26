'use client'

import { useState, useEffect, useCallback } from 'react'
import { uploadData, list, getUrl, remove } from 'aws-amplify/storage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'

interface MediaItem {
  path: string
  url: string
}

export function MediaUploader() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await list({ path: 'public/media/' })
      const withUrls: MediaItem[] = await Promise.all(
        result.items.map(async (item) => {
          const url = await getUrl({ path: item.path })
          return { path: item.path, url: url.url.toString() }
        })
      )
      setItems(withUrls)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const path = `public/media/${yyyy}/${mm}/${Date.now()}-${safeName}`
        await uploadData({ path, data: file, options: { contentType: file.type } }).result
      }
      e.target.value = ''
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(path: string) {
    if (!confirm('Delete this file?')) return
    try {
      await remove({ path })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4">
        <Input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFiles}
          disabled={uploading}
        />
        {uploading && <p className="mt-2 text-sm text-muted-foreground">Uploading...</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.path} className="group relative overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.path} className="aspect-square w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 p-2 text-xs text-white opacity-0 transition group-hover:opacity-100">
              <span className="truncate">{item.path.split('/').pop()}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white hover:bg-white/20"
                onClick={() => handleDelete(item.path)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">No media yet.</p>
      )}
    </div>
  )
}
