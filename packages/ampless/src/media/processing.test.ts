import { describe, expect, it } from 'vitest'
import {
  computeTargetDimensions,
  extensionFor,
  replaceExtension,
  resolveOutputMime,
  shouldSkipProcessing,
} from './processing.js'

describe('shouldSkipProcessing', () => {
  it('skips non-image mime types', () => {
    expect(shouldSkipProcessing('application/pdf')).toBe(true)
    expect(shouldSkipProcessing('')).toBe(true)
  })

  it('skips animation- and vector-bearing image formats', () => {
    expect(shouldSkipProcessing('image/gif')).toBe(true)
    expect(shouldSkipProcessing('image/svg+xml')).toBe(true)
    expect(shouldSkipProcessing('image/avif')).toBe(true)
  })

  it('skips formats most browsers cannot decode via Canvas', () => {
    expect(shouldSkipProcessing('image/heic')).toBe(true)
    expect(shouldSkipProcessing('image/heif')).toBe(true)
    expect(shouldSkipProcessing('image/bmp')).toBe(true)
    expect(shouldSkipProcessing('image/tiff')).toBe(true)
  })

  it('processes raster formats Canvas can encode losslessly', () => {
    expect(shouldSkipProcessing('image/png')).toBe(false)
    expect(shouldSkipProcessing('image/jpeg')).toBe(false)
    expect(shouldSkipProcessing('image/webp')).toBe(false)
  })
})

describe('extensionFor', () => {
  it('maps known image mimes to canonical extensions', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/webp')).toBe('webp')
    expect(extensionFor('image/png')).toBe('png')
  })

  it('falls back to bin for unknown mimes', () => {
    expect(extensionFor('application/octet-stream')).toBe('bin')
  })
})

describe('replaceExtension', () => {
  it('swaps the trailing extension for the one that matches the output mime', () => {
    expect(replaceExtension('photo.jpg', 'image/webp')).toBe('photo.webp')
    expect(replaceExtension('PHOTO.JPEG', 'image/webp')).toBe('PHOTO.webp')
  })

  it('preserves unicode basenames (japanese, emoji)', () => {
    expect(replaceExtension('猫.png', 'image/webp')).toBe('猫.webp')
    expect(replaceExtension('🍣.jpg', 'image/webp')).toBe('🍣.webp')
  })

  it('appends an extension when the input has none', () => {
    expect(replaceExtension('noext', 'image/webp')).toBe('noext.webp')
  })

  it('treats leading-dot dotfiles as having no extension to strip', () => {
    // `.profile` is a dotfile, not an extension. We append rather than swap.
    expect(replaceExtension('.profile', 'image/webp')).toBe('.profile.webp')
  })
})

describe('resolveOutputMime', () => {
  it('returns the explicit format when one is set', () => {
    expect(resolveOutputMime('image/png', 'webp')).toBe('image/webp')
    expect(resolveOutputMime('image/png', 'jpeg')).toBe('image/jpeg')
  })

  it('passes through the input mime for original / undefined', () => {
    expect(resolveOutputMime('image/png', 'original')).toBe('image/png')
    expect(resolveOutputMime('image/png', undefined)).toBe('image/png')
  })

  it('substitutes a generic mime when the input is empty', () => {
    expect(resolveOutputMime('', 'original')).toBe('application/octet-stream')
  })
})

describe('computeTargetDimensions', () => {
  it('falls back to the hard ceiling when maxDimension is unset', () => {
    // 4000x3000 fits under the 8000 hard ceiling so it passes through.
    expect(computeTargetDimensions(4000, 3000, undefined)).toEqual({ width: 4000, height: 3000 })
  })

  it('does not upscale when source is smaller than max', () => {
    expect(computeTargetDimensions(800, 600, 2400)).toEqual({ width: 800, height: 600 })
  })

  it('clamps the longer edge while preserving aspect ratio', () => {
    expect(computeTargetDimensions(4800, 2400, 2400)).toEqual({ width: 2400, height: 1200 })
    expect(computeTargetDimensions(2400, 4800, 2400)).toEqual({ width: 1200, height: 2400 })
  })

  it('rounds without producing zero dimensions on extreme aspect ratios', () => {
    const { width, height } = computeTargetDimensions(10000, 1, 100)
    expect(width).toBe(100)
    expect(height).toBe(1)
  })

  it('enforces the 8000 hard ceiling even when caller asks for more', () => {
    // Source: 12000x9000, caller asks for 10000 — must still clamp to 8000.
    const { width, height } = computeTargetDimensions(12000, 9000, 10000)
    expect(Math.max(width, height)).toBe(8000)
    expect(width).toBe(8000)
    expect(height).toBe(6000)
  })

  it('enforces the 8000 hard ceiling when maxDimension is unset', () => {
    const { width, height } = computeTargetDimensions(20000, 5000, undefined)
    expect(width).toBe(8000)
    expect(height).toBe(2000)
  })
})
