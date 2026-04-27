'use client'

import { useEffect, useState } from 'react'
import { list } from 'aws-amplify/storage'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { publicMediaUrl } from '@/lib/media'

interface MediaPickerProps {
  trigger: React.ReactNode
  onSelect: (url: string) => void
}

export function MediaPicker({ trigger, onSelect }: MediaPickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    list({ path: 'public/media/' })
      .then((result) => {
        if (cancelled) return
        setItems(result.items.map((i) => i.path))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function handlePick(path: string) {
    onSelect(publicMediaUrl(path))
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a media file</DialogTitle>
          <DialogDescription>Select an uploaded image to insert.</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No media yet. Upload images at <code>/admin/media</code> first.
          </p>
        )}

        <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-auto sm:grid-cols-4">
          {items.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => handlePick(path)}
              className="group overflow-hidden rounded-md border transition hover:border-primary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={publicMediaUrl(path)}
                alt={path}
                className="aspect-square w-full object-cover"
              />
              <div className="truncate p-1 text-xs text-muted-foreground">
                {path.split('/').pop()}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
