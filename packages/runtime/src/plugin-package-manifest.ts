// Static plugin manifest reader — Phase 5 of plugin extension.
//
// `loadPackageManifest(packageName)` resolves the package's `package.json`
// via `import.meta.resolve(...)`, reads it, parses its `amplessPlugin`
// field, and returns the typed manifest. Returns `null` for any failure
// (subpath not exported, file unreadable, JSON parse error, no
// `amplessPlugin` field) so the runtime falls back to the existing
// per-factory mismatch checks (backward compatible).
//
// The reader is SYNC on purpose: `createPluginHead(cmsConfig, ...)` is
// a sync constructor today, and threading an async call into it would
// ripple all the way out to `createAmpless` and every site's
// `lib/ampless.ts`. Manifest reads happen once at construction, are
// each a few hundred bytes, and only touch local node_modules, so sync
// is cheap and avoids the API churn. `import.meta.resolve` is sync in
// Node 22+; ampless requires `>=22.13` so we can rely on it.
//
// Plugin packages must expose `package.json` via `exports`:
//
//     "exports": {
//       ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
//       "./package.json": "./package.json"
//     }
//
// Without the subpath export, Node rejects
// `import.meta.resolve('<pkg>/package.json')` with
// `ERR_PACKAGE_PATH_NOT_EXPORTED`. We catch that and return `null` so
// older first-party plugins (and Phase 4 plugins predating this
// convention) continue to work — they just don't participate in the
// new cross-check.
//
// Spec: docs/tmp/plugin-extension-phase5.md §B.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PluginPackageManifest, TrustLevel } from 'ampless'

const TRUST_LEVELS: readonly TrustLevel[] = ['untrusted', 'trusted', 'privileged']

/**
 * Type guard: does `value` look like a usable `PluginPackageManifest`?
 *
 * Checks every field the cross-check downstream reads — `apiVersion`
 * is a number, `name` is a string, `trustLevel` is one of the three
 * declared values, and `capabilities` is an `Array<string>` (so the
 * `setsEqual` loop in `crossCheckStaticManifest` cannot blow up on a
 * `for ... of` over a non-iterable). When a plugin's `amplessPlugin`
 * field is malformed (`capabilities: {}`, `apiVersion: "1"`, etc.) we
 * return `false` here and the caller returns `null` — the cross-check
 * then silently skips that plugin, matching the same backward-compat
 * fallback used when the field is missing.
 *
 * Returning `false` does NOT throw or warn from the load layer. The
 * loader doesn't know enough about who's calling it to produce a
 * useful diagnostic, and a noisy warning during constructor pass would
 * fire for every render under SSR.
 */
function isValidManifest(value: unknown): value is PluginPackageManifest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.apiVersion !== 'number') return false
  if (typeof v.name !== 'string') return false
  if (typeof v.trustLevel !== 'string') return false
  if (!TRUST_LEVELS.includes(v.trustLevel as TrustLevel)) return false
  if (!Array.isArray(v.capabilities)) return false
  for (const c of v.capabilities) {
    if (typeof c !== 'string') return false
  }
  // displayName / description / homepage are optional and not part of
  // the cross-check, so we don't validate them here.
  return true
}

/**
 * Resolve `<packageName>/package.json`, read it, and return the
 * `amplessPlugin` field as a typed `PluginPackageManifest`. Returns
 * `null` for any failure — the caller skips cross-check rather than
 * aborting plugin loading.
 *
 * The manifest itself is NOT validated structurally here; the caller
 * applies field-by-field comparison against the factory return value
 * and emits warnings / throws for individual mismatches.
 */
export function loadPackageManifest(packageName: string): PluginPackageManifest | null {
  let resolvedUrl: string
  try {
    resolvedUrl = import.meta.resolve(`${packageName}/package.json`)
  } catch {
    // ERR_PACKAGE_PATH_NOT_EXPORTED (Node) when the plugin's exports
    // field omits "./package.json", or ERR_MODULE_NOT_FOUND when the
    // package itself isn't installed at this resolution root. Either
    // way, no cross-check.
    return null
  }

  let raw: string
  try {
    raw = readFileSync(fileURLToPath(resolvedUrl), 'utf8')
  } catch {
    return null
  }

  let pkg: unknown
  try {
    pkg = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    typeof pkg !== 'object' ||
    pkg === null ||
    !('amplessPlugin' in pkg)
  ) {
    return null
  }

  const manifest = (pkg as { amplessPlugin: unknown }).amplessPlugin
  if (!isValidManifest(manifest)) return null

  return manifest
}

/**
 * Maximum `apiVersion` value this runtime can host. Plugins declaring
 * a higher value are rejected at constructor time — the runtime can't
 * safely call into surfaces it doesn't know about yet.
 */
export const SUPPORTED_API_VERSION = 1 as const
