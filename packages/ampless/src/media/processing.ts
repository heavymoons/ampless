// Browser-targeted image processing utilities used by the upload UI.
//
// All work happens client-side via Canvas + (optionally) the @jsquash/webp
// WASM encoder. Designed to run before `aws-amplify/storage` `uploadData`,
// so the file the user sees in S3 is already cropped / resized / re-encoded.

export type OutputFormat = 'webp' | 'jpeg' | 'original'

export interface CropArea {
  /** Source-pixel coordinates of the crop rectangle. */
  x: number
  y: number
  width: number
  height: number
}

export interface ProcessOptions {
  /** Skip all processing and return the input file as-is. */
  original?: boolean
  /** Crop rectangle in source pixels. Omit for no crop. */
  crop?: CropArea
  /** Clamp the longer edge to this many pixels. Never upscales. */
  maxDimension?: number
  /** Output container. `'original'` keeps the input mime. */
  format?: OutputFormat
  /** Lossy quality 0..1. Ignored for lossless WebP and PNG. Defaults to 0.85. */
  quality?: number
  /** Force lossless WebP encoding. Only meaningful when format === 'webp'. */
  lossless?: boolean
}

export interface ProcessedImage {
  blob: Blob
  mime: string
  /** Decoded width in pixels. 0 means the dimensions could not be determined (e.g. SVG, undecodable passthrough). */
  width: number
  /** Decoded height in pixels. 0 means the dimensions could not be determined (e.g. SVG, undecodable passthrough). */
  height: number
  /** Filename derived from the input, with the extension matching `mime`. */
  suggestedName: string
}

/**
 * Hard ceiling on the longer edge regardless of the caller's maxDimension.
 * Above this, Canvas allocation fails on iOS Safari and the WASM WebP
 * encoder needs > 256 MB contiguous heap. Tuned to fit 8000 * 8000 * 4 ≈ 256 MB.
 */
const HARD_MAX_DIMENSION = 8000

const PASSTHROUGH_MIMES = new Set([
  'image/gif', // animated frames would be lost via Canvas
  'image/svg+xml', // raster encoding destroys vectors
  'image/avif', // re-encoding cost > benefit for now
  'image/heic', // iPhone default; most browsers cannot decode at all
  'image/heif',
  'image/bmp', // Canvas decode is patchy
  'image/tiff',
])

export function shouldSkipProcessing(mime: string): boolean {
  if (!mime || !mime.startsWith('image/')) return true
  return PASSTHROUGH_MIMES.has(mime)
}

const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
}

export function extensionFor(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'bin'
}

export function replaceExtension(name: string, mime: string): string {
  const ext = extensionFor(mime)
  const i = name.lastIndexOf('.')
  const base = i > 0 ? name.slice(0, i) : name
  return `${base}.${ext}`
}

export function resolveOutputMime(inputMime: string, format: OutputFormat | undefined): string {
  if (format === 'webp') return 'image/webp'
  if (format === 'jpeg') return 'image/jpeg'
  return inputMime || 'application/octet-stream'
}

export interface TargetDimensions {
  width: number
  height: number
}

/**
 * Resolve target dimensions, honouring caller's maxDimension AND the hard
 * canvas-budget ceiling. Never upscales the source.
 */
export function computeTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number | undefined,
): TargetDimensions {
  const longer = Math.max(sourceWidth, sourceHeight)
  const requested = maxDimension && maxDimension > 0 ? maxDimension : longer
  // Effective cap is the smaller of the requested cap and the hard ceiling.
  const effective = Math.min(requested, HARD_MAX_DIMENSION)
  if (longer <= effective) {
    return { width: sourceWidth, height: sourceHeight }
  }
  const scale = effective / longer
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

export async function processImage(
  file: File,
  options: ProcessOptions = {},
): Promise<ProcessedImage> {
  if (options.original || shouldSkipProcessing(file.type)) {
    return passthrough(file)
  }

  // Decoder failures (corrupt files, browser-unsupported formats that
  // slipped past PASSTHROUGH_MIMES) degrade to passthrough rather than
  // failing the whole upload.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return passthrough(file)
  }
  try {
    const source = options.crop ?? {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    }
    const target = computeTargetDimensions(source.width, source.height, options.maxDimension)
    const canvas = createCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to obtain 2D rendering context')

    ctx.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      target.width,
      target.height,
    )

    const outMime = resolveOutputMime(file.type, options.format)
    const quality = options.quality ?? 0.85
    const wantsLossless = outMime === 'image/webp' && options.lossless === true

    let blob: Blob
    if (wantsLossless) {
      try {
        blob = await encodeWebpLossless(ctx, target.width, target.height)
      } catch {
        // WASM encoder OOMs or is unavailable: fall back to high-quality lossy WebP.
        blob = await canvasToBlob(canvas, 'image/webp', 0.95)
      }
    } else {
      blob = await canvasToBlob(canvas, outMime, quality)
    }

    return {
      blob,
      mime: blob.type || outMime,
      width: target.width,
      height: target.height,
      suggestedName: replaceExtension(file.name, blob.type || outMime),
    }
  } finally {
    bitmap.close?.()
  }
}

async function passthrough(file: File): Promise<ProcessedImage> {
  let width = 0
  let height = 0
  if (typeof createImageBitmap !== 'undefined' && file.type !== 'image/svg+xml') {
    try {
      const bm = await createImageBitmap(file)
      width = bm.width
      height = bm.height
      bm.close?.()
    } catch {
      // Decode failure is acceptable in passthrough; metadata stays 0x0
      // (documented on ProcessedImage.width/height).
    }
  }
  return {
    blob: file,
    mime: file.type || 'application/octet-stream',
    width,
    height,
    suggestedName: file.name,
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * Use OffscreenCanvas when its full encoding API is present.
 * Safari 16.0–16.3 ships the constructor without `convertToBlob`, so we
 * feature-detect on the prototype rather than the constructor.
 */
function createCanvas(width: number, height: number): AnyCanvas {
  const hasOffscreenEncode =
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype !== 'undefined' &&
    'convertToBlob' in OffscreenCanvas.prototype
  if (hasOffscreenEncode) {
    return new OffscreenCanvas(width, height)
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  }
  throw new Error('No canvas implementation available in this environment')
}

async function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`canvas.toBlob returned null for ${type}`))),
      type,
      quality,
    )
  })
}

async function encodeWebpLossless(ctx: AnyCtx, width: number, height: number): Promise<Blob> {
  const imageData = ctx.getImageData(0, 0, width, height)
  const mod = await import('@jsquash/webp')
  // @jsquash/webp's encode returns ArrayBuffer with WebP container bytes.
  const buffer = await mod.encode(imageData, { lossless: 1 })
  return new Blob([buffer], { type: 'image/webp' })
}
