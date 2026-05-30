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
import type { PluginPackageManifest } from 'ampless'

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
    !('amplessPlugin' in pkg) ||
    typeof (pkg as { amplessPlugin: unknown }).amplessPlugin !== 'object' ||
    (pkg as { amplessPlugin: unknown }).amplessPlugin === null
  ) {
    return null
  }

  return (pkg as { amplessPlugin: PluginPackageManifest }).amplessPlugin
}

/**
 * Maximum `apiVersion` value this runtime can host. Plugins declaring
 * a higher value are rejected at constructor time — the runtime can't
 * safely call into surfaces it doesn't know about yet.
 */
export const SUPPORTED_API_VERSION = 1 as const
