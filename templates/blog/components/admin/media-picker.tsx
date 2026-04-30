'use client'

import { useEffect, useRef, useState } from 'react'
import { list } from 'aws-amplify/storage'
import { Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { publicMediaUrl } from '@/lib/media'
import { uploadProcessedImage } from '@/lib/upload'
import { ImageUploadDialog } from './image-upload-dialog'
import type { ProcessOptions } from 'ampless/media'
import cmsConfig from '@/cms.config'

interface MediaPickerProps {
  trigger: React.ReactNode
  onSelect: (url: string) => void
}

export function MediaPicker({ trigger, onSelect }: MediaPickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingUpload(file)
  }

  async function handleUploadConfirm(file: File, options: ProcessOptions) {
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadProcessedImage(file, options)
      onSelect(url)
      setPendingUpload(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  // While the upload sub-dialog is open, hide the picker dialog so the user
  // sees a single modal at a time. Re-open if upload is cancelled/skipped.
  const pickerOpen = open && !pendingUpload

  return (
    <>
      <Dialog open={pickerOpen} onOpenChange={(next) => setOpen(next)}>
        <DialogTrigger asChild onClick={() => setOpen(true)}>
          {trigger}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle>Insert image</DialogTitle>
                <DialogDescription>
                  Pick from your media library or upload a new file.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-3 w-3" />
                Upload new
              </Button>
            </div>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelected}
          />

          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No media yet. Click <strong>Upload new</strong> to add the first image.
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

      <ImageUploadDialog
        file={pendingUpload}
        remaining={pendingUpload ? 1 : 0}
        busy={uploading}
        defaults={cmsConfig.media?.processing}
        onConfirm={handleUploadConfirm}
        onSkip={() => setPendingUpload(null)}
        onCancel={() => setPendingUpload(null)}
      />
    </>
  )
}
