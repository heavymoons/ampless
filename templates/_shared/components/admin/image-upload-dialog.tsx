'use client'

import { useEffect, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PercentCrop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { shouldSkipProcessing } from 'ampless/media'
import type { ProcessOptions, OutputFormat } from 'ampless/media'
import type { MediaProcessingDefaults } from 'ampless'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/components/i18n-provider'

// Format choices the dialog exposes. The 'original' OutputFormat exists in
// the core API for programmatic callers, but we hide it from the dialog to
// avoid conflation with the "useOriginal" checkbox above.
type FormatChoice = 'auto' | 'webp' | 'jpeg'
type AspectChoice = 'free' | '1:1' | '4:3' | '16:9' | '3:2'

const ASPECTS: Record<AspectChoice, number | undefined> = {
  free: undefined,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '3:2': 3 / 2,
}

const ASPECT_CHOICES: AspectChoice[] = ['free', '1:1', '4:3', '16:9', '3:2']
const FORMAT_CHOICES: FormatChoice[] = ['auto', 'webp', 'jpeg']

// Quick-pick longest-edge values. Roughly: thumbnail / mobile content /
// desktop content / retina hero / full-HD ish. Free input still available
// underneath for anything else.
const MAX_DIMENSION_PRESETS = [640, 1024, 1600, 2400, 4000] as const

const MIN_DIMENSION = 100
const MAX_DIMENSION_CEILING = 8000

function clampMaxDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(MAX_DIMENSION_CEILING, Math.max(MIN_DIMENSION, Math.round(value)))
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) return 0.85
  return Math.min(1, Math.max(0, value))
}

function resolveFormat(
  choice: FormatChoice,
  inputMime: string,
  losslessForPng: boolean,
): { format: OutputFormat; lossless: boolean } {
  if (choice === 'auto') {
    return {
      format: 'webp',
      lossless: losslessForPng && inputMime === 'image/png',
    }
  }
  return { format: choice, lossless: false }
}

// Build the initial crop. For free aspect this is the whole image (so a
// user who doesn't touch the cropper uploads the full original); for fixed
// aspects it's the largest centered rectangle that fits the chosen ratio.
function buildInitialCrop(
  naturalWidth: number,
  naturalHeight: number,
  aspect: number | undefined,
): PercentCrop {
  if (aspect) {
    return centerCrop(
      makeAspectCrop({ unit: '%', width: 100 }, aspect, naturalWidth, naturalHeight),
      naturalWidth,
      naturalHeight,
    )
  }
  return { unit: '%', x: 0, y: 0, width: 100, height: 100 }
}

export interface ImageUploadDialogProps {
  file: File | null
  /** Total number of files still queued, including the current one. */
  remaining: number
  /** True while the parent is uploading the current file. Disables Skip/Upload to prevent the queue race. */
  busy?: boolean
  defaults?: MediaProcessingDefaults
  onConfirm: (file: File, options: ProcessOptions) => void
  onSkip: () => void
  onCancel: () => void
}

export function ImageUploadDialog({
  file,
  remaining,
  busy = false,
  defaults,
  onConfirm,
  onSkip,
  onCancel,
}: ImageUploadDialogProps) {
  const t = useT()
  const defaultMaxDimension = defaults?.maxDimension ?? 2400
  const defaultQuality = defaults?.quality ?? 0.85
  const losslessForPng = defaults?.losslessForPng ?? true

  const [original, setOriginal] = useState(false)
  const [aspect, setAspect] = useState<AspectChoice>('free')
  const [crop, setCrop] = useState<Crop | undefined>(undefined)
  const [percentCrop, setPercentCrop] = useState<PercentCrop | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [formatChoice, setFormatChoice] = useState<FormatChoice>('auto')
  const [losslessOverride, setLosslessOverride] = useState<boolean | null>(null)
  const [quality, setQuality] = useState(defaultQuality)
  const [maxDimension, setMaxDimension] = useState(defaultMaxDimension)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement | null>(null)

  // New file → reset all per-file state. Defaults come from cms.config.
  useEffect(() => {
    setOriginal(false)
    setAspect('free')
    setCrop(undefined)
    setPercentCrop(null)
    setNaturalSize(null)
    setFormatChoice('auto')
    setLosslessOverride(null)
    setQuality(defaultQuality)
    setMaxDimension(defaultMaxDimension)
  }, [file, defaultQuality, defaultMaxDimension])

  // Re-center crop when aspect changes mid-session.
  useEffect(() => {
    if (!naturalSize) return
    const next = buildInitialCrop(naturalSize.width, naturalSize.height, ASPECTS[aspect])
    setCrop(next)
    setPercentCrop(next)
  }, [aspect, naturalSize])

  // Object URL is owned by an effect (not useMemo) so React 19 StrictMode's
  // double-invoke doesn't leave the URL revoked while ReactCrop still needs it.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!file) return null

  const isImage = file.type.startsWith('image/')
  const passthrough = !isImage || shouldSkipProcessing(file.type)
  const showCropper = !passthrough && !original
  const { format, lossless: autoLossless } = resolveFormat(formatChoice, file.type, losslessForPng)
  const lossless = losslessOverride ?? autoLossless
  const showLosslessToggle = !original && !passthrough && format === 'webp'
  const showQualitySlider =
    !original && !passthrough && (format === 'jpeg' || (format === 'webp' && !lossless))

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget
    setNaturalSize({ width: naturalWidth, height: naturalHeight })
    const initial = buildInitialCrop(naturalWidth, naturalHeight, ASPECTS[aspect])
    setCrop(initial)
    setPercentCrop(initial)
  }

  function handleConfirm() {
    if (!file || busy) return
    if (original || passthrough) {
      onConfirm(file, { original: true })
      return
    }

    let cropArea: ProcessOptions['crop'] = undefined
    if (percentCrop && naturalSize) {
      // Convert percent → source-pixel coordinates that processImage expects.
      const x = Math.round((percentCrop.x / 100) * naturalSize.width)
      const y = Math.round((percentCrop.y / 100) * naturalSize.height)
      const width = Math.round((percentCrop.width / 100) * naturalSize.width)
      const height = Math.round((percentCrop.height / 100) * naturalSize.height)
      // Skip if user kept the full image (no real crop).
      if (
        width > 0 &&
        height > 0 &&
        (x !== 0 || y !== 0 || width !== naturalSize.width || height !== naturalSize.height)
      ) {
        cropArea = { x, y, width, height }
      }
    }

    onConfirm(file, {
      crop: cropArea,
      maxDimension: clampMaxDimension(maxDimension, defaultMaxDimension),
      format,
      quality: clampQuality(quality),
      lossless: format === 'webp' ? lossless : false,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return
        onCancel()
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{file.name}</DialogTitle>
          <DialogDescription>
            {remaining > 1
              ? t('media.dialog.remaining', { count: remaining })
              : `${formatBytes(file.size)} · ${file.type || 'unknown'}`}
            {busy && t('media.dialog.uploading')}
          </DialogDescription>
        </DialogHeader>

        {previewUrl && showCropper && (
          <div className="flex items-center justify-center rounded-md bg-black/90 p-2">
            <ReactCrop
              crop={crop}
              aspect={ASPECTS[aspect]}
              minWidth={20}
              minHeight={20}
              onChange={(_pixel, percent) => {
                setCrop(percent)
                setPercentCrop(percent)
              }}
            >
              {/* Constrain in BOTH dimensions so any image fits the dialog
                  without horizontal overflow. ReactCrop reads the rendered
                  size, so percentage crop math stays correct. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={previewUrl}
                alt="preview"
                className="block max-h-[60vh] max-w-full"
                onLoad={handleImageLoad}
              />
            </ReactCrop>
          </div>
        )}
        {previewUrl && !showCropper && isImage && (
          <div className="flex h-48 items-center justify-center rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="preview" className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {!isImage && (
          // Non-image upload: skip the broken-img preview. Show the
          // file's name / size / mime so the admin can confirm before
          // committing the bytes to S3.
          <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-md bg-muted text-sm text-muted-foreground">
            <span className="font-medium">{file.name}</span>
            <span className="font-mono text-xs">
              {formatBytes(file.size)} · {file.type || 'unknown'}
            </span>
          </div>
        )}

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={original}
              disabled={busy}
              onChange={(e) => setOriginal(e.target.checked)}
            />
            <span>{t('media.dialog.useOriginal')}</span>
            {passthrough && (
              <span className="text-xs text-muted-foreground">{t('media.dialog.passthroughNote')}</span>
            )}
          </label>

          {!original && !passthrough && (
            <>
              <div>
                <Label>{t('media.dialog.aspectRatio')}</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ASPECT_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={aspect === choice ? 'default' : 'outline'}
                      size="sm"
                      disabled={busy}
                      onClick={() => setAspect(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label>{t('media.dialog.outputFormat')}</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {FORMAT_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={formatChoice === choice ? 'default' : 'outline'}
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setFormatChoice(choice)
                        setLosslessOverride(null)
                      }}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              </div>

              {showLosslessToggle && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={lossless}
                    disabled={busy}
                    onChange={(e) => setLosslessOverride(e.target.checked)}
                  />
                  <span>{t('media.dialog.losslessWebp')}</span>
                </label>
              )}

              {showQualitySlider && (
                <div>
                  <Label>{t('media.dialog.quality', { value: Math.round(quality * 100) })}</Label>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    disabled={busy}
                    value={Math.round(quality * 100)}
                    onChange={(e) => setQuality(Number(e.target.value) / 100)}
                    className="mt-2 w-full"
                  />
                </div>
              )}

              <div className="max-w-xs">
                <Label htmlFor="maxDimension">{t('media.dialog.maxDimension')}</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MAX_DIMENSION_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={maxDimension === preset ? 'default' : 'outline'}
                      size="sm"
                      disabled={busy}
                      onClick={() => setMaxDimension(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <Input
                  id="maxDimension"
                  type="number"
                  className="mt-2"
                  min={MIN_DIMENSION}
                  max={MAX_DIMENSION_CEILING}
                  disabled={busy}
                  value={maxDimension}
                  onChange={(e) => setMaxDimension(Number(e.target.value) || defaultMaxDimension)}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onCancel}>
            {t('media.dialog.cancelAll')}
          </Button>
          <Button variant="outline" type="button" disabled={busy} onClick={onSkip}>
            {t('media.dialog.skip')}
          </Button>
          <Button type="button" disabled={busy} onClick={handleConfirm}>
            {busy ? t('media.dialog.uploadingButton') : t('media.dialog.upload')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
