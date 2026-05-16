// Fetch an image URL and convert it to a data URL Satori can paint.
//
// Satori (the layout engine inside next/og's ImageResponse) only accepts
// PNG and JPEG image data. Ampless media is mostly WebP, so we transcode
// WebP → PNG (and AVIF → PNG) on the fly using @jsquash, which are pure
// WASM modules that work in Node and on the Edge runtime.

function toBase64(bytes: Uint8Array): string {
  // Buffer is available in Node and Edge runtimes. We avoid btoa() because
  // converting a binary Uint8Array to a string first risks UTF-8 mangling.
  // Cast through Uint8Array (TS 5.7's stricter ArrayBufferLike vs ArrayBuffer
  // distinction trips up Buffer.from's overloads otherwise).
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Slice the underlying buffer to a fresh ArrayBuffer view. Avoids passing
  // SharedArrayBuffer / oversized backing buffers to @jsquash decoders,
  // and sidesteps TS 5.7's stricter Uint8Array<ArrayBufferLike> vs
  // ArrayBuffer distinction.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function decodeWebp(bytes: Uint8Array): Promise<string | null> {
  try {
    const webp = await import('@jsquash/webp')
    const png = await import('@jsquash/png')
    const imageData = await webp.decode(toArrayBuffer(bytes))
    const pngBytes = await png.encode(imageData)
    return `data:image/png;base64,${toBase64(new Uint8Array(pngBytes))}`
  } catch (err) {
    console.error('[plugin-og-image] webp decode failed:', err)
    return null
  }
}

async function decodeAvif(bytes: Uint8Array): Promise<string | null> {
  try {
    const avif = await import('@jsquash/avif')
    const png = await import('@jsquash/png')
    const imageData = await avif.decode(toArrayBuffer(bytes))
    const pngBytes = await png.encode(imageData)
    return `data:image/png;base64,${toBase64(new Uint8Array(pngBytes))}`
  } catch (err) {
    console.error('[plugin-og-image] avif decode failed:', err)
    return null
  }
}

/**
 * Fetch `url` and return a data URL usable inside Satori JSX.
 *
 * Behavior:
 *  - PNG / JPEG: pass through as a data URL (no re-encode).
 *  - WebP: decode to ImageData, re-encode to PNG, return data URL.
 *  - AVIF: same as WebP.
 *  - GIF / SVG / other: returns null (Satori can't render animated GIFs,
 *    and SVG isn't supported via the image() helper — embed SVG with the
 *    Satori `<img src="data:image/svg+xml;...">` form if you need it).
 *  - Any fetch / decode error: returns null so the OG card still renders
 *    without an image instead of 500ing the route.
 */
export async function loadImageForOg(url: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[plugin-og-image] fetch failed:', err)
    return null
  }
  if (!res.ok) {
    console.error('[plugin-og-image] fetch non-ok:', res.status, url)
    return null
  }

  // Trust the content-type header. URL extensions lie often enough (e.g.
  // CDN proxies that strip suffixes) that we'd rather miss an image than
  // misclassify it.
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim()
  const bytes = new Uint8Array(await res.arrayBuffer())

  if (contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/jpg') {
    return `data:${contentType};base64,${toBase64(bytes)}`
  }
  if (contentType === 'image/webp') {
    return decodeWebp(bytes)
  }
  if (contentType === 'image/avif') {
    return decodeAvif(bytes)
  }
  // GIF, SVG, anything else: skip.
  return null
}
