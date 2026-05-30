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
 * Aliased copy of `import.meta.resolve` to hide the call site from
 * Next.js' webpack. Webpack 5 has a hand-written recognizer for the
 * literal `import.meta.resolve(<expr>)` shape and tries to follow it
 * as a static module request — which fails with a build-time
 * `module-not-found` whenever the specifier is dynamic (which ours
 * always is — `${packageName}/package.json`). Reading `.resolve` off
 * `import.meta` first and calling through the local binding turns
 * the call site into a plain function invocation that webpack leaves
 * alone, while Node still resolves it at runtime.
 *
 * Stored as a function-type optional so older runtimes (pre-Node 22,
 * or any bundler that strips `import.meta.resolve`) cleanly degrade
 * to "no cross-check" — `loadPackageManifest` returns `null` and the
 * runtime falls back to the existing per-factory mismatch checks.
 */
type ResolveFn = (specifier: string) => string
const metaResolve: ResolveFn | undefined =
  typeof import.meta.resolve === 'function'
    ? (import.meta.resolve.bind(import.meta) as ResolveFn)
    : undefined

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
 * Failure modes that resolve to `null`:
 *   - Package not installed at this resolution root
 *     (`ERR_MODULE_NOT_FOUND`)
 *   - `package.json` not in the package's `exports`
 *     (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — see the spec under
 *     `docs/tmp/plugin-extension-phase5.md` §B
 *   - `readFileSync` throws (e.g. ENOENT, permissions)
 *   - JSON parse error
 *   - `amplessPlugin` field absent or not an object
 *   - `amplessPlugin` field present but structurally invalid (e.g.
 *     `apiVersion` not a number, `capabilities` not an array of
 *     strings, `trustLevel` not one of the three allowed values) —
 *     see `isValidManifest`
 *
 * The structural check matters: without it, a downstream consumer
 * like `crossCheckStaticManifest`'s `for ... of` over the manifest's
 * `capabilities` would crash on `capabilities: {}` or `capabilities: 42`,
 * which is at odds with the "non-apiVersion mismatches warn rather
 * than throw" policy.
 *
 * After this function returns a non-null value, the caller can trust
 * every field it inspects has the declared type; mismatches against
 * the factory return value are still surfaced as warnings (or, for
 * `apiVersion`, throws) by the caller itself.
 */
export function loadPackageManifest(packageName: string): PluginPackageManifest | null {
  if (!metaResolve) return null

  let resolvedUrl: string
  try {
    resolvedUrl = metaResolve(`${packageName}/package.json`)
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
