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

import type { PluginPackageManifest, TrustLevel } from 'ampless'

const TRUST_LEVELS: readonly TrustLevel[] = ['untrusted', 'trusted', 'privileged']

/**
 * Lazy holder for the Node-only APIs we need to read a plugin's
 * `package.json`. None of them are statically imported, so Next.js'
 * webpack can't see them at build time:
 *
 *   - Static `import { readFileSync } from 'node:fs'` would cause
 *     `module-not-found 'fs'` in Client Component bundles.
 *     `@ampless/runtime` is transitively pulled into client bundles
 *     via `@ampless/admin`'s re-exports, so anything top-level here
 *     lands in the browser graph too.
 *   - The literal `import.meta.resolve(<expr>)` call shape is
 *     hand-recognized by webpack 5 and treated as a static module
 *     request, which fails with module-not-found whenever the
 *     specifier is dynamic (which ours always is).
 *
 * `process.getBuiltinModule(<name>)` is the Node 22+ sync escape
 * hatch for exactly this case: load a built-in by name without an
 * `import` or `require` statement webpack might recognize. ampless
 * requires Node `>=22.13` so we can rely on it. In environments
 * that don't expose it (the browser, an older Node, a stripped
 * runtime), `_nodeApi` falls through to `null`,
 * `loadPackageManifest` returns `null`, and the runtime falls back
 * to the existing per-factory mismatch checks (same backward-compat
 * path used for plugins predating Phase 5).
 *
 * `import.meta.resolve` is accessed via `import.meta.resolve.bind(...)`
 * (no literal call expression), which webpack also leaves alone.
 */
type ResolveFn = (specifier: string) => string
interface NodeApi {
  readFile: (path: string) => string
  resolve: ResolveFn
}

function getNodeApi(): NodeApi | null {
  if (typeof window !== 'undefined') return null
  const proc =
    typeof process !== 'undefined'
      ? (process as { getBuiltinModule?: (name: string) => unknown })
      : undefined
  if (typeof proc?.getBuiltinModule !== 'function') return null
  if (typeof import.meta.resolve !== 'function') return null
  // Look up `node:fs` / `node:url` fresh on every call so vitest can
  // swap `process.getBuiltinModule` per test (see
  // `plugin-package-manifest.test.ts`). The lookup is an in-process
  // map read — cheap enough that caching wouldn't measurably help.
  try {
    const fs = proc.getBuiltinModule('node:fs') as typeof import('node:fs') | undefined
    const url = proc.getBuiltinModule('node:url') as typeof import('node:url') | undefined
    if (!fs || !url) return null
    const resolve = import.meta.resolve.bind(import.meta) as ResolveFn
    return {
      readFile: (u: string) => fs.readFileSync(url.fileURLToPath(u), 'utf8'),
      resolve,
    }
  } catch {
    return null
  }
}

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
  const node = getNodeApi()
  if (!node) return null

  let resolvedUrl: string
  try {
    resolvedUrl = node.resolve(`${packageName}/package.json`)
  } catch {
    // ERR_PACKAGE_PATH_NOT_EXPORTED (Node) when the plugin's exports
    // field omits "./package.json", or ERR_MODULE_NOT_FOUND when the
    // package itself isn't installed at this resolution root. Either
    // way, no cross-check.
    return null
  }

  let raw: string
  try {
    raw = node.readFile(resolvedUrl)
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
