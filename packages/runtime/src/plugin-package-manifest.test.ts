// vi.mock is hoisted to the top of the file by vitest's transform step.
// We use `importOriginal` to capture the real `readFileSync` implementation
// BEFORE the mock replaces it, then wrap it in a vi.fn() so per-test
// overrides (mockReturnValueOnce / mockImplementationOnce) work while
// non-overridden calls fall through to the real filesystem.
import { describe, it, expect, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    readFileSync: vi.fn(real.readFileSync),
  }
})

import { loadPackageManifest, SUPPORTED_API_VERSION } from './plugin-package-manifest.js'
import { readFileSync } from 'node:fs'
const mockedReadFileSync = vi.mocked(readFileSync)

// ---------------------------------------------------------------------------
// loadPackageManifest — unit tests
// ---------------------------------------------------------------------------
//
// Resolution environment (real node_modules, no mock on the resolver):
//
//   • `@ampless/plugin-og-image` is in runtime's `dependencies` → installed,
//     exposes `./package.json` via `exports`, has an `amplessPlugin` field.
//     Used for the happy-path test AND as the "resolvable" package for
//     mocked-readFileSync tests.
//
//   • `ampless` is installed but its package.json is NOT in `exports`
//     → ERR_PACKAGE_PATH_NOT_EXPORTED → null (resolution error branch).
//
//   • A non-existent package name → ERR_MODULE_NOT_FOUND → null.
//
// `readFileSync` is wrapped in vi.fn() via vi.mock above (ESM-safe).
// Individual tests override it with mockReturnValueOnce / mockImplementationOnce
// to exercise parse / field-guard branches.

describe('SUPPORTED_API_VERSION', () => {
  it('exports SUPPORTED_API_VERSION === 1', () => {
    expect(SUPPORTED_API_VERSION).toBe(1)
  })
})

describe('loadPackageManifest', () => {
  // -----------------------------------------------------------------------
  // Resolution error paths — real packages, readFileSync NOT intercepted
  // -----------------------------------------------------------------------

  it('returns null when the package is not installed (ERR_MODULE_NOT_FOUND)', () => {
    // `import.meta.resolve('this-package-does-not-exist/package.json')`
    // throws ERR_MODULE_NOT_FOUND; the helper catches and returns null.
    const result = loadPackageManifest('this-package-does-not-exist')
    expect(result).toBeNull()
  })

  it('returns null when package.json is not in the package exports (ERR_PACKAGE_PATH_NOT_EXPORTED)', () => {
    // `ampless` is installed in runtime's node_modules but its package.json
    // does NOT expose `"./package.json"` via `exports`. Node throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED, which the helper catches → null.
    const result = loadPackageManifest('ampless')
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Happy path — real package + real readFileSync (call-through default)
  // -----------------------------------------------------------------------

  it('returns a PluginPackageManifest when the package has a valid amplessPlugin field', () => {
    // `@ampless/plugin-og-image` is installed, exposes `./package.json`
    // via exports, and carries an `amplessPlugin` field. The mock defaults
    // to the real readFileSync so the actual file is read.
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).not.toBeNull()
    expect(result?.apiVersion).toBe(1)
    expect(result?.name).toBe('og-image')
    expect(result?.trustLevel).toBe('untrusted')
    expect(result?.capabilities).toContain('metadata')
    expect(result?.displayName).toMatchObject({ en: 'OG Image' })
  })

  // -----------------------------------------------------------------------
  // Parse / field guard paths — intercept readFileSync so resolution
  // succeeds (plugin-og-image resolves fine) but file content varies.
  // -----------------------------------------------------------------------

  it('returns null when readFileSync throws (e.g. ENOENT)', () => {
    mockedReadFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    })
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toBeNull()
  })

  it('returns null when package.json contains malformed JSON', () => {
    mockedReadFileSync.mockReturnValueOnce('{not valid json}')
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toBeNull()
  })

  it('returns null when package.json has no amplessPlugin field', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ name: '@ampless/plugin-og-image', version: '1.0.0' })
    )
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toBeNull()
  })

  it('returns null when amplessPlugin is not an object (e.g. a string)', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ name: '@ampless/plugin-og-image', amplessPlugin: 'invalid' })
    )
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toBeNull()
  })

  it('returns null when amplessPlugin is null', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ name: '@ampless/plugin-og-image', amplessPlugin: null })
    )
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toBeNull()
  })

  it('returns the full manifest object for a synthetic amplessPlugin entry', () => {
    // Verify happy-path field extraction with a controlled payload.
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        name: '@test/pkg',
        amplessPlugin: {
          apiVersion: 1,
          name: 'test-plugin',
          trustLevel: 'trusted',
          capabilities: ['publicHead', 'adminSettings'],
          displayName: { en: 'Test Plugin', ja: 'テストプラグイン' },
        },
      })
    )
    const result = loadPackageManifest('@ampless/plugin-og-image')
    expect(result).toMatchObject({
      apiVersion: 1,
      name: 'test-plugin',
      trustLevel: 'trusted',
      capabilities: ['publicHead', 'adminSettings'],
      displayName: { en: 'Test Plugin', ja: 'テストプラグイン' },
    })
  })

  // Structural validation: a malformed `amplessPlugin` field should
  // never reach the cross-check downstream (where `setsEqual` iterates
  // `capabilities` with `for ... of`). Returning `null` here keeps the
  // failure mode identical to "field absent" — silent skip, caller
  // falls back to per-factory mismatch warnings.

  it('returns null when amplessPlugin.apiVersion is not a number', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: '1', // wrong: string instead of number
          name: 'x',
          trustLevel: 'untrusted',
          capabilities: [],
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('returns null when amplessPlugin.name is not a string', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 42, // wrong: number
          trustLevel: 'untrusted',
          capabilities: [],
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('returns null when amplessPlugin.trustLevel is not one of the three allowed values', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 'x',
          trustLevel: 'super-admin', // wrong: not in TrustLevel union
          capabilities: [],
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('returns null when amplessPlugin.capabilities is an object, not an array', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 'x',
          trustLevel: 'untrusted',
          capabilities: {}, // wrong: object instead of array
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('returns null when amplessPlugin.capabilities is a number', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 'x',
          trustLevel: 'untrusted',
          capabilities: 42, // wrong: scalar instead of array
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('returns null when amplessPlugin.capabilities contains a non-string element', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 'x',
          trustLevel: 'untrusted',
          capabilities: ['publicHead', 42], // one bad element
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toBeNull()
  })

  it('accepts an empty capabilities array (valid manifest shape)', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        amplessPlugin: {
          apiVersion: 1,
          name: 'x',
          trustLevel: 'untrusted',
          capabilities: [],
        },
      })
    )
    expect(loadPackageManifest('@ampless/plugin-og-image')).toMatchObject({
      capabilities: [],
    })
  })
})
