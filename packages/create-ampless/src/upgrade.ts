import { cp, readFile, writeFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, extname, dirname } from 'node:path'
import { log, outro } from '@clack/prompts'
import pc from 'picocolors'
import { execa } from 'execa'
import semver from 'semver'
import { validateMountableProject } from './mount.js'
import { sharedTemplateDir } from './templates.js'
import { buildRegistry, discoverInstalledThemes } from './themes-registry.js'
import type { ParsedArgs } from './args.js'

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * Directories under `app/` that ampless owns wholesale. Anything
 * present in the user's project at one of these paths but absent from
 * the current `_shared/app/` gets deleted on upgrade — this keeps route
 * shells we no longer ship from lingering and breaking type-checking
 * against newer `@ampless/admin` exports.
 *
 * Add a path here the first time ampless scaffolds anything inside
 * it; never remove. The list is the source of truth for "where ampless
 * might have once put files" — entries whose directory no longer
 * exists in the current template trigger a wholesale removal of the
 * user copy on the next upgrade.
 *
 * Files outside these paths are NEVER touched, so user-owned top-level
 * routes (`app/page.tsx`, custom `app/blog/` dirs, etc.) are safe.
 */
const AMPLESS_MANAGED_APP_PATHS: readonly string[] = [
  'app/(admin)/admin',
  'app/api/admin',
  'app/api/media',
  'app/api/mcp',
  'app/login',
  'app/site',
] as const

/**
 * ampless が以前ユーザーのプロジェクトに配置していたが、現在は廃止された
 * 個別ファイル。アップグレード時に存在すれば無条件で削除されます。
 * 追加するファイルは「ampless が完全に所有していた」ものに限定すること。
 */
const AMPLESS_RETIRED_PATHS: readonly string[] = [
  // Phase 7 preview pipeline migrated from a `'use server'` action to a
  // Route Handler at `app/(admin)/admin/preview/route.tsx` (default
  // endpoint: `/admin/preview`). The old action made Next.js 15+ refuse
  // to compile the edit-post page
  // because the import graph traced `react-dom/server` from Client
  // Components through Server Action modules. Sites scaffolded before
  // this change pick the new endpoint up on their next `update-ampless`
  // — the new route file is seeded as part of the normal template
  // sync, and the old action file is retired by this entry.
  'app/(admin)/admin/_actions/render-preview.tsx',
] as const

const AMPLESS_PACKAGES = new Set([
  'ampless',
  '@ampless/admin',
  '@ampless/backend',
  '@ampless/plugin-ai-actions',
  '@ampless/plugin-analytics-ga4',
  '@ampless/plugin-cookie-consent',
  '@ampless/plugin-gtm',
  '@ampless/plugin-og-image',
  '@ampless/plugin-plausible',
  '@ampless/plugin-reading-time',
  '@ampless/plugin-rss',
  '@ampless/plugin-schema-jsonld',
  '@ampless/plugin-seo',
  '@ampless/plugin-webhook',
  '@ampless/plugin-x-embed',
  '@ampless/plugin-youtube',
  '@ampless/runtime',
])

/**
 * Non-`@ampless/*` packages whose version ampless effectively pins on
 * behalf of the consumer. These are peer-dep requirements that
 * `@ampless/admin` and the new plugin packages declare — keeping them
 * in lockstep with `templates/_shared/package.json` avoids ERESOLVE
 * peer-conflict errors when an existing site upgrades only its
 * `@ampless/*` deps and forgets to bump tiptap manually.
 *
 * Matched by prefix so new `@tiptap/extension-*` packages that the
 * admin starts using don't need to be enumerated here separately.
 */
const AMPLESS_MANAGED_TRANSITIVE_PREFIXES: readonly string[] = ['@tiptap/'] as const

/**
 * Exact-name non-`@ampless/*` packages whose version ampless pins on
 * behalf of the consumer — same rationale as the `@tiptap/*` prefix
 * list, but for the Amplify SDK + backend toolchain rather than the
 * editor. Listed exactly (not by prefix) so unrelated `@aws-amplify/*`
 * transitives a site might add stay untouched.
 *
 * `aws-amplify` / `@aws-amplify/adapter-nextjs` are the client-side
 * peers `@ampless/admin` declares (passkey sign-in needs the WebAuthn
 * APIs that shipped in `aws-amplify@6.17.0`). `@aws-amplify/backend` /
 * `@aws-amplify/backend-cli` are the synth-time deps — passkeys require
 * `loginWith.webAuthn`, which a stale `@aws-amplify/backend` in the
 * site's lockfile wouldn't support, so the `npm run sandbox` synth would
 * fail. Keeping all four in lockstep with `templates/_shared/package.json`
 * avoids that on `update-ampless`.
 */
const AMPLESS_MANAGED_EXACT_DEPS: ReadonlySet<string> = new Set([
  'aws-amplify',
  '@aws-amplify/adapter-nextjs',
  '@aws-amplify/backend',
  '@aws-amplify/backend-cli',
])

function isManagedDep(name: string): boolean {
  if (AMPLESS_PACKAGES.has(name)) return true
  if (AMPLESS_MANAGED_EXACT_DEPS.has(name)) return true
  return AMPLESS_MANAGED_TRANSITIVE_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * `scripts` keys merged from the template into the project's
 * package.json on upgrade. Ampless owns these — keeping the allowlist
 * narrow guarantees we never clobber the user's own `dev` / `build` /
 * `start` overrides.
 */
const AMPLESS_MANAGED_SCRIPTS = new Set([
  'sandbox',
  'sandbox:dev',
  'update-ampless',
  'copy-theme',
])

const PROTECTED_PATTERNS: readonly RegExp[] = [
  /^cms\.config\.ts$/,
  // `themes/` and `themes-registry.ts` are handled separately — see
  // syncThemes() below. The themes directory is owned per-entry by
  // either ampless (default themes, resynced on upgrade) or the user
  // (`my-*` themes, preserved). The registry is regenerated to match
  // whatever is on disk afterward.
  /^\.env/,
  /^node_modules(\/|$)/,
  /^\.next(\/|$)/,
  /^\.turbo(\/|$)/,
  /^\.amplify(\/|$)/,
  /^amplify_outputs\.json$/,
  /^next-env\.d\.ts$/,
  // `tsconfig.json` is auto-managed by Next.js during `next build` /
  // `next dev` — it rewrites `jsx: "preserve"` → `"react-jsx"` for
  // the React automatic runtime and appends `.next/dev/types/**/*.ts`
  // to `include`. Treating the file as `replace` here would overwrite
  // those mutations on every `update-ampless`, only for Next.js to
  // re-apply them on the next build — a churn cycle that produces a
  // dirty diff after every upgrade. Protect the file; users hand-
  // merge new compiler options in the rare case the template
  // tsconfig changes meaningfully.
  /^tsconfig\.json$/,
  /^tsconfig\.tsbuildinfo$/,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  // Anything under themes/ is handled by syncThemes; the file-walk
  // classifier must not double-process it.
  /^themes(\/|$)/,
  /^themes-registry\.ts$/,
  // `plugins/` is the site-local plugin directory (user-owned, mirrors
  // the `themes/my-*` convention for user-customised themes). The
  // initial scaffold seeds a README into this directory; everything
  // afterwards is the user's territory. We never overwrite or delete
  // files here — even the seeded README is frozen at scaffold time,
  // because plugin authors will sometimes edit it to document the
  // site's own conventions. The kept-up-to-date "how to write a
  // plugin" doc lives in `packages/ampless/docs/plugin-author-guide.md`.
  /^plugins(\/|$)/,
  // The site's ESLint setup is user-owned. New scaffolds get the
  // template's `eslint.config.mjs`, but an upgrade never adds or
  // replaces it: an existing file (or symlink) is the user's, and a new
  // flat config would shadow whatever legacy `.eslintrc*` / `.eslintignore`
  // the site relies on, here or in a parent directory.
  /^eslint\.config\.mjs$/,
]

/**
 * Printed by `update-ampless` when the site's `lint` script still calls
 * `next lint`, which Next.js 16 removed. The upgrade never changes the
 * lint script, ESLint config or ESLint dependencies — moving them is a
 * manual step because only the site owner knows which settings to keep.
 */
const NEXT_LINT_WARNING =
  'package.json "lint" still runs `next lint`, which Next.js 16 removed, so `npm run lint` fails. ' +
  'update-ampless leaves your lint script, ESLint config and ESLint dependencies untouched. ' +
  'To migrate by hand: run `npx @next/codemod@latest next-lint-to-eslint-cli .` (or install ' +
  '`eslint@^9` and `eslint-config-next` with the same major as your `next` — `eslint-config-next@^16` for Next.js 16 — ' +
  'add an `eslint.config.mjs` flat config and set "lint" to "eslint ."), ' +
  'then carry over any `.eslintrc*` / `.eslintignore` settings, because flat config does not read them. ' +
  'See "Updating ampless" in README.md.'

function usesNextLint(projectPkg: Record<string, unknown>): boolean {
  const lint = ((projectPkg['scripts'] ?? {}) as Record<string, unknown>)['lint']
  return typeof lint === 'string' && /(^|[\s;&|(])next\s+lint(\s|$|[;&|)])/.test(lint)
}

// Files that must be COPIED IN on first encounter but never overwritten
// once present. Three cases live here:
//
//   1. `*.custom.ts` — user extension stubs. The matching `resource.ts`
//      / `backend.ts` template files import from `./*.custom.js`, so a
//      missing stub breaks the build. Older scaffolds didn't ship them;
//      the seed branch covers those projects.
//   2. `plugins/README.md` / `plugins/README.ja.md` — the local-plugin
//      tutorial seeded into the `plugins/` directory. The directory
//      itself is in PROTECTED_PATTERNS (= user-owned territory), but
//      the README needs to appear in projects that upgrade across the
//      change that introduced `plugins/`. Once present, it's
//      user-owned — contributors edit it to document site-specific
//      conventions.
//   3. `amplify/secrets/encryption-key.ts` — a placeholder is needed
//      when older sites upgrade to a template that imports it from
//      `amplify/backend.ts`, but once the operator runs
//      `create-ampless setup-encryption-key` the real key must never be
//      overwritten by a later upgrade.
//
// The classifier checks SEED_IF_MISSING_PATTERN before PROTECTED so the
// matched files escape the protected-skip path. See `isProtected`.
const SEED_IF_MISSING_PATTERN =
  /\.custom\.ts$|^plugins\/README(\.ja)?\.md$|^amplify\/secrets\/encryption-key\.ts$/

const TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.css', '.env', '.txt', '.yaml', '.yml', '.toml', '.gitignore',
])

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface UpgradeResult {
  added: string[]
  updated: string[]
  seeded: string[]
  protected: string[]
  themesSynced: string[]
  themesPreserved: string[]
  /**
   * Theme directories deleted because their name matched a known
   * non-theme template prefix (e.g. `plugin-local`, `plugin-standalone`
   * leaked in by the buggy `create-ampless@alpha` after PR #168). The
   * upgrade tool removes them so the regenerated `themes-registry.ts`
   * stops importing modules that don't exist.
   */
  themesQuarantined: string[]
  packageJsonMerged: boolean
  /** Obsolete files removed from ampless-managed app/ subtrees. */
  obsoleteRemoved: string[]
  /**
   * Number of plugin editor extensions auto-wired into
   * `_editor-bootstrap.tsx` by `regenerateEditorBootstrap`.
   */
  editorExtensionsWired?: number
  /**
   * Number of user-installed `@ampless/*` plugin packages bumped to
   * the latest `@beta` dist-tag by `bumpUserAmplessPlugins`.
   */
  userPluginsBumped?: number
}

interface FileClassification {
  replace: string[]
  merge: string[]
  /** `*.custom.ts` stubs: copied only when missing in the destination. */
  seed: string[]
  protected: string[]
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isProtected(relPath: string): boolean {
  // SEED_IF_MISSING takes precedence: files matched there are
  // "seed-if-missing, else leave alone" and need to escape the
  // protected-skip path on initial encounter. Without this carve-out,
  // the seeded README under `plugins/` would never reach projects
  // upgrading across the change that introduced the directory.
  if (SEED_IF_MISSING_PATTERN.test(relPath)) return false
  return PROTECTED_PATTERNS.some((re) => re.test(relPath))
}

/**
 * Prefixes that mark a `templates/<dir>/` entry as something other
 * than a theme. `plugin-local/` and `plugin-standalone/` ship under
 * `templates/` because the Phase 5 `create-ampless plugin <name>`
 * scaffold needs them, but they are NOT themes — they hold a
 * placeholder-laden plugin factory, not a `defineThemeModule(...)`
 * export. Without this exclusion, `listShippedThemes` would discover
 * them, `update-ampless` would copy them into the user's `themes/`
 * directory, and `themes-registry.ts` would try to import them as
 * themes — which then breaks `next build` because the placeholder
 * `index.ts` doesn't compile and doesn't export the expected shape.
 */
const NON_THEME_TEMPLATE_PREFIXES = ['plugin-'] as const

function isThemeDirName(name: string): boolean {
  if (name === '_shared') return false
  for (const prefix of NON_THEME_TEMPLATE_PREFIXES) {
    if (name.startsWith(prefix)) return false
  }
  return true
}

/**
 * One-time recovery for sites whose `themes/` got corrupted by the
 * pre-fix `listShippedThemes` (PR #168 → buggy create-ampless@alpha).
 * Anything matching these names IS NOT a theme and should be cleaned
 * up if a previous `update-ampless` deposited it under the user's
 * `themes/`. The list mirrors the scaffold-template names that are
 * now correctly excluded by `NON_THEME_TEMPLATE_PREFIXES`, so future
 * additions to the `plugin-*` prefix family auto-recover too.
 *
 * Safe to keep in place — these names were never valid themes; even
 * a contributor who happened to create `themes/plugin-something/`
 * by hand would have been broken on the next upgrade anyway because
 * the registry would have tried to import it as a theme.
 */
function isQuarantinedThemeName(name: string): boolean {
  return !isThemeDirName(name)
}

/**
 * The set of ampless-managed default themes is whatever the create-ampless
 * package ships outside of `_shared/` and the scaffold-template
 * exclusion list above. Discovered at runtime instead of hardcoded so
 * adding a new theme to `templates/<name>/` automatically makes the
 * upgrade aware of it.
 *
 * `templatesRoot` is the directory containing `_shared/` and every
 * theme subdirectory (i.e. one level above `sharedDir`). Tests pass a
 * scratch dir; the CLI passes the bundled `templatesDir`.
 */
async function listShippedThemes(templatesRoot: string): Promise<string[]> {
  if (!existsSync(templatesRoot)) return []
  const entries = await readdir(templatesRoot, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && isThemeDirName(e.name))
    .map((e) => e.name)
    .sort()
}

interface ThemeSyncResult {
  synced: string[]
  preserved: string[]
}

/**
 * Files inside a theme directory that ampless treats as user-owned —
 * never overwritten on upgrade even for ampless-managed default themes.
 * README and .gitignore are documentation / build-tool config; they
 * don't belong to the runtime theme contract that the upgrade is
 * trying to keep in lockstep with the template.
 */
const USER_OWNED_THEME_FILES = new Set(['README.md', '.gitignore'])

function isUserOwnedThemeFile(path: string): boolean {
  const name = path.split(/[/\\]/).pop() ?? ''
  return USER_OWNED_THEME_FILES.has(name)
}

async function captureUserOwnedFiles(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  if (!existsSync(dir)) return out
  for (const name of USER_OWNED_THEME_FILES) {
    const p = join(dir, name)
    if (existsSync(p)) {
      out.set(name, await readFile(p))
    }
  }
  return out
}

async function restorePreservedFiles(dir: string, files: Map<string, Buffer>): Promise<void> {
  for (const [name, content] of files) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, name), content)
  }
}

/**
 * Reconcile `<destDir>/themes/` with the latest template:
 *  - Every ampless-managed default theme is replaced wholesale (treat
 *    the user's copy as a build artifact synced from the template).
 *  - `my-*` themes are owned by the project and never touched.
 *  - Any non-default, non-`my-` theme directory is left alone too —
 *    treat it as a community / third-party install whose upgrade
 *    cadence is independent of ampless.
 *
 * After reconciliation the registry is regenerated from whatever
 * directories actually exist on disk, so the bundle always matches
 * the filesystem and theme switching at runtime never targets a
 * missing module.
 */
async function syncThemes(
  destDir: string,
  templatesRoot: string,
): Promise<ThemeSyncResult & { quarantined: string[] }> {
  const shipped = await listShippedThemes(templatesRoot)
  const themesDir = join(destDir, 'themes')
  await mkdir(themesDir, { recursive: true })

  // Recovery for sites that ran the buggy create-ampless@alpha after
  // PR #168: scaffold template directories (`plugin-local`,
  // `plugin-standalone`) got synced into the user's `themes/` and
  // wired into `themes-registry.ts`, breaking `next build`. Remove
  // any leftover quarantined entries before we walk the registry,
  // and surface the cleanup in the result so the CLI can log it.
  const quarantined: string[] = []
  if (existsSync(themesDir)) {
    const present = await readdir(themesDir, { withFileTypes: true })
    for (const entry of present) {
      if (!entry.isDirectory()) continue
      if (!isQuarantinedThemeName(entry.name)) continue
      await rm(join(themesDir, entry.name), { recursive: true, force: true })
      quarantined.push(entry.name)
    }
  }

  // Replace shipped themes — `rm` is a no-op if the dir doesn't exist
  // (this is how an old project picks up missing default themes added
  // since it was scaffolded). The README inside the project's theme
  // dir is preserved across the rm/cp because (a) scaffolding ran
  // `{{vars}}` substitution on it and the upgrade can't recreate that
  // without re-parsing cms.config.ts, and (b) README is documentation
  // the user might tweak. Same logic for .gitignore — the project root
  // ships the canonical one; a theme-level copy is just leftover noise.
  for (const name of shipped) {
    const src = join(templatesRoot, name)
    const dst = join(themesDir, name)
    const preservedFiles = await captureUserOwnedFiles(dst)
    await rm(dst, { recursive: true, force: true })
    await cp(src, dst, {
      recursive: true,
      filter: (sourcePath) => !isUserOwnedThemeFile(sourcePath),
    })
    await restorePreservedFiles(dst, preservedFiles)
  }

  // Discover survivors — anything that isn't an ampless default. The
  // ampless ones we just rewrote, so the union covers everything.
  const installed = await discoverInstalledThemes(destDir)
  const shippedSet = new Set(shipped)
  // Filter quarantined names out of `installed` too — defensive in case
  // a name slipped past the cleanup above (e.g. a community contributor
  // added something with a `plugin-` prefix by hand).
  const preserved = installed.filter(
    (t) => !shippedSet.has(t) && !isQuarantinedThemeName(t),
  )

  // Regenerate themes-registry.ts to list both halves.
  const all = [...shipped, ...preserved]
  await writeFile(join(destDir, 'themes-registry.ts'), buildRegistry(all), 'utf-8')

  return { synced: shipped, preserved, quarantined }
}

async function walkDir(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relative(base, full)
    if (entry.isDirectory()) {
      await walkDir(full, base, out)
    } else {
      out.push(rel)
    }
  }
}

/**
 * Walk a directory recursively, returning file paths relative to the
 * given root. Directories themselves aren't returned; only files.
 */
async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string, relPrefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel)
      } else if (entry.isFile()) {
        out.push(rel)
      }
    }
  }
  if (!existsSync(root)) return out
  await walk(root, '')
  return out
}

/**
 * Bottom-up empty-directory pruning. After deleting orphan files, the
 * surrounding directory tree may be empty — clean it up so the user's
 * project tree doesn't accumulate dead dirs.
 */
async function pruneEmptyDirs(root: string): Promise<void> {
  if (!existsSync(root)) return
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await pruneEmptyDirs(join(root, entry.name))
    }
  }
  const remaining = await readdir(root)
  if (remaining.length === 0) {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Compute the list of files under ampless-managed app/ paths that
 * exist in the user's project but not in the current template. Returns
 * project-relative paths. Used in both the dry-run summary and the
 * execute phase so the plan == the action.
 */
async function findObsoleteFiles(destDir: string, sharedDir: string): Promise<string[]> {
  const obsolete: string[] = []
  for (const managedPath of AMPLESS_MANAGED_APP_PATHS) {
    const userPath = join(destDir, managedPath)
    if (!existsSync(userPath)) continue
    const templatePath = join(sharedDir, managedPath)
    const templateFiles = new Set(await listFilesRecursive(templatePath))
    const userFiles = await listFilesRecursive(userPath)
    for (const f of userFiles) {
      if (!templateFiles.has(f)) {
        obsolete.push(`${managedPath}/${f}`)
      }
    }
  }
  for (const retiredPath of AMPLESS_RETIRED_PATHS) {
    const userFile = join(destDir, retiredPath)
    if (existsSync(userFile)) {
      obsolete.push(retiredPath)
    }
  }
  return obsolete
}

/**
 * Execute the deletions identified by `findObsoleteFiles`. After
 * the unlinks, walk each managed path and remove now-empty subdirs
 * (bottom-up) so the user's project tree stays clean.
 */
async function removeObsoleteFiles(destDir: string, paths: string[]): Promise<void> {
  for (const rel of paths) {
    const abs = join(destDir, rel)
    if (existsSync(abs)) {
      await rm(abs, { force: true })
    }
  }
  // Prune empty managed dirs (and only those — never touch the project root).
  for (const managedPath of AMPLESS_MANAGED_APP_PATHS) {
    await pruneEmptyDirs(join(destDir, managedPath))
  }
}

function substituteVars(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

async function copyWithSubstitution(
  src: string,
  dst: string,
  vars: Record<string, string>,
): Promise<void> {
  const ext = extname(src) || (src.endsWith('.gitignore') ? '.gitignore' : '')
  await mkdir(dirname(dst), { recursive: true })

  if (TEXT_EXTENSIONS.has(ext)) {
    const content = await readFile(src, 'utf-8')
    await writeFile(dst, substituteVars(content, vars), 'utf-8')
  } else {
    const buf = await readFile(src)
    await writeFile(dst, buf)
  }
}

function detectIndent(jsonStr: string): number {
  const m = jsonStr.match(/^{\n(\s+)/)
  if (!m) return 2
  return m[1]!.length
}

// ----------------------------------------------------------------------------
// package.json merge (computed in memory before anything is written)
// ----------------------------------------------------------------------------

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
type DepSection = (typeof DEP_SECTIONS)[number]

function depsOf(pkg: Record<string, unknown>, section: DepSection): Record<string, unknown> {
  return (pkg[section] ?? {}) as Record<string, unknown>
}

/**
 * Apply the template's managed deps and managed scripts to `projectPkg` in
 * place. Returns one warning per duplicate declaration it had to sync.
 *
 * A managed name the project also declares in a second section (e.g.
 * `optionalDependencies["@tiptap/core"]` next to the template's
 * `dependencies` entry) is set to the template spec there too, keeping its
 * placement: ampless owns that version, and npm lets `optionalDependencies`
 * override `dependencies`, so a stale duplicate would make the install fail
 * with ERESOLVE even though the template's entry was updated.
 */
function mergeManagedPackageJson(
  projectPkg: Record<string, unknown>,
  templatePkg: Record<string, unknown>,
): string[] {
  const warnings: string[] = []

  for (const section of DEP_SECTIONS) {
    const templateDeps = depsOf(templatePkg, section) as Record<string, string>
    const projectDeps = depsOf(projectPkg, section) as Record<string, string>

    for (const [name, version] of Object.entries(templateDeps)) {
      if (!isManagedDep(name)) continue
      projectDeps[name] = version

      for (const other of DEP_SECTIONS) {
        if (other === section || name in depsOf(templatePkg, other)) continue
        const otherDeps = projectPkg[other] as Record<string, string> | undefined
        if (!otherDeps || !(name in otherDeps)) continue
        const previous = otherDeps[name]
        otherDeps[name] = version
        warnings.push(
          `package.json declares "${name}" in both ${section} and ${other}. ampless manages its version, ` +
          `so update-ampless sets ${other}["${name}"] to "${version}" as well` +
          (previous !== version ? ` (it was "${String(previous)}")` : '') +
          `. Remove the ${other} entry: a second declaration can override the managed version and break the install.`,
        )
      }
    }

    if (Object.keys(projectDeps).length > 0) {
      projectPkg[section] = projectDeps
    }
  }

  // Merge ampless-managed scripts. The allowlist (AMPLESS_MANAGED_SCRIPTS)
  // captures the scripts ampless owns end-to-end — the user is free to
  // edit `dev` / `build` / `start` and they survive every upgrade.
  //
  // Iterate the allowlist itself (not the template) so a script that
  // ampless once shipped but no longer does (e.g. `sandbox:dev`) gets
  // cleaned out of the user's package.json on the next upgrade.
  // Without this branch the obsolete key would linger forever.
  const templateScripts = (templatePkg['scripts'] ?? {}) as Record<string, string>
  const projectScripts = (projectPkg['scripts'] ?? {}) as Record<string, string>
  for (const name of AMPLESS_MANAGED_SCRIPTS) {
    if (name in templateScripts) {
      projectScripts[name] = templateScripts[name]!
    } else {
      delete projectScripts[name]
    }
  }
  if (Object.keys(projectScripts).length > 0) {
    projectPkg['scripts'] = projectScripts
  }

  return warnings
}

// ----------------------------------------------------------------------------
// Project-only @tiptap/* peer check
// ----------------------------------------------------------------------------

/** One published release as reported by `npm view <name>@<range> ... --json`. */
export interface PublishedVersion {
  version: string
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/**
 * Resolve the published releases of `name` that satisfy `range`. Returns an
 * empty array when nothing matches; throws when the registry cannot be asked.
 */
export type VersionLookup = (name: string, range: string) => Promise<PublishedVersion[]>

/**
 * Range used to list every stable release when looking for a suggestion.
 * Not `*`: `npm view name@*` collapses to the `latest` dist-tag only.
 */
const ALL_STABLE_RANGE = '>=0.0.0'

interface PeerConflict {
  section: DepSection
  name: string
  current: string
  /** e.g. `3.32.0 requires @tiptap/core 3.32.0, template uses ^3.35.0` */
  reason: string
  /** Managed peers that conflict, rendered as `<name> <template spec>`. */
  managedPeers: string[]
  /** Spec to change to, or null when no published release is compatible. */
  suggestion: string | null
  /** Why `suggestion` could not be computed, when the lookup itself failed. */
  suggestionError?: string
}

export interface PeerCheckReport {
  conflicts: PeerConflict[]
  /** Entries that could not be checked (non-semver spec, registry failure, no match). */
  warnings: string[]
}

function normaliseNpmView(stdout: string): PublishedVersion[] {
  const parsed: unknown = JSON.parse(stdout)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((entry) =>
    typeof entry === 'string' ? { version: entry } : (entry as PublishedVersion),
  )
}

/** Production {@link VersionLookup}: asks the registry configured for `destDir`. */
function npmViewLookup(destDir: string): VersionLookup {
  return async (name, range) => {
    try {
      const { stdout } = await execa(
        'npm',
        ['view', `${name}@${range}`, 'version', 'peerDependencies', 'peerDependenciesMeta', '--json'],
        { cwd: destDir, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      // npm prints nothing at all for some no-match cases.
      return stdout.trim() ? normaliseNpmView(stdout) : []
    } catch (e) {
      // No match exits 1 with `{"error":{"code":"E404",...}}` on stdout.
      const stdout = (e as { stdout?: unknown }).stdout
      if (typeof stdout === 'string' && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout) as { error?: { code?: string } }
          if (parsed?.error?.code === 'E404') return []
        } catch {
          // fall through to the original error
        }
      }
      throw e
    }
  }
}

/**
 * Peers of `candidate` that are ampless-managed names declared by the
 * template and cannot share a version with the template's spec. Optional
 * peers and peers on non-managed names are not ampless's concern.
 */
function conflictingManagedPeers(
  candidate: PublishedVersion,
  templateSpecs: Map<string, string>,
): Array<{ peer: string; required: string; template: string }> {
  const out: Array<{ peer: string; required: string; template: string }> = []
  for (const [peer, required] of Object.entries(candidate.peerDependencies ?? {})) {
    if (!isManagedDep(peer)) continue
    const template = templateSpecs.get(peer)
    if (template === undefined) continue
    if (candidate.peerDependenciesMeta?.[peer]?.optional) continue
    // A peer or template spec that is not a semver range cannot be judged here.
    if (semver.validRange(required) === null || semver.validRange(template) === null) continue
    if (!semver.intersects(required, template)) out.push({ peer, required, template })
  }
  return out
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message.split('\n')[0]! : String(e)
}

/**
 * Check every `@tiptap/*` package the project declares but the template
 * does not (in any section) against the peer requirements its published
 * releases actually declare — no assumption that it is versioned in
 * lockstep with `@tiptap/core` (`@tiptap/y-tiptap`, for example, has its own
 * version line and no `@tiptap/core` peer). The upgrade never rewrites these
 * specs, so a spec whose every matching release peers on a managed version
 * the template no longer allows would fail the install after the template
 * files had been written.
 */
export async function checkProjectOnlyPeers(
  projectPkg: Record<string, unknown>,
  templatePkg: Record<string, unknown>,
  lookup: VersionLookup,
): Promise<PeerCheckReport> {
  const report: PeerCheckReport = { conflicts: [], warnings: [] }

  const templateSpecs = new Map<string, string>()
  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries(depsOf(templatePkg, section))) {
      if (typeof spec === 'string' && !templateSpecs.has(name)) templateSpecs.set(name, spec)
    }
  }
  const coreHint = templateSpecs.has('@tiptap/core')
    ? ` (this ampless release uses @tiptap/core ${templateSpecs.get('@tiptap/core')})`
    : ''

  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries(depsOf(projectPkg, section))) {
      if (!name.startsWith('@tiptap/') || templateSpecs.has(name)) continue
      if (typeof spec !== 'string') continue
      const label = `${section}["${name}"] is "${spec}"`

      if (semver.validRange(spec) === null) {
        report.warnings.push(
          `${label}, which is not a semver range, so update-ampless cannot check its peer dependencies. ` +
          `Make sure the release it installs supports the @tiptap/* versions ampless uses${coreHint}.`,
        )
        continue
      }

      let candidates: PublishedVersion[]
      try {
        candidates = (await lookup(name, spec)).filter((c) => semver.valid(c.version) !== null)
      } catch (e) {
        report.warnings.push(
          `${label}; update-ampless cannot check its peer dependencies because the registry lookup failed ` +
          `(${errorText(e)}). Make sure the release it installs supports the @tiptap/* versions ampless uses${coreHint}.`,
        )
        continue
      }
      if (candidates.length === 0) {
        report.warnings.push(
          `${label}, but no published release matches it, so update-ampless cannot check its peer dependencies. ` +
          'npm install will report the problem.',
        )
        continue
      }

      if (candidates.some((c) => conflictingManagedPeers(c, templateSpecs).length === 0)) continue

      // Every matching release conflicts. Describe the newest one.
      const newest = [...candidates].sort((a, b) => semver.rcompare(a.version, b.version))[0]!
      const peers = conflictingManagedPeers(newest, templateSpecs)
      const conflict: PeerConflict = {
        section,
        name,
        current: spec,
        reason:
          `${newest.version} requires ` +
          peers.map((p) => `${p.peer} ${p.required}, template uses ${p.template}`).join('; '),
        managedPeers: peers.map((p) => `${p.peer} ${p.template}`),
        suggestion: null,
      }

      try {
        const all = (await lookup(name, ALL_STABLE_RANGE))
          .filter((c) => semver.valid(c.version) !== null)
          .sort((a, b) => semver.rcompare(a.version, b.version))
        const isCompatible = (c: PublishedVersion) => conflictingManagedPeers(c, templateSpecs).length === 0
        const best = all.find(isCompatible)
        if (best) {
          // `^V` would let npm pick the newest release in that range, so only
          // suggest it when that newest release is compatible too.
          const caret = `^${best.version}`
          const newestInCaret = all.find((c) => semver.satisfies(c.version, caret))
          conflict.suggestion = newestInCaret && isCompatible(newestInCaret) ? caret : best.version
        }
      } catch (e) {
        conflict.suggestionError = errorText(e)
      }
      report.conflicts.push(conflict)
    }
  }
  return report
}

function buildPeerConflictMessage(conflicts: PeerConflict[]): string {
  const lines = conflicts.map((c) => {
    const head = `  - ${c.section}["${c.name}"] is "${c.current}": ${c.reason}`
    if (c.suggestion) return `${head}; change it to "${c.suggestion}"`
    if (c.suggestionError) {
      return (
        `${head}; update-ampless could not list other releases (${c.suggestionError}), ` +
        `so pick one whose peerDependencies allow ${c.managedPeers.join(', ')}`
      )
    }
    return (
      `${head}; no published release of ${c.name} is compatible with ${c.managedPeers.join(', ')} yet — ` +
      'remove it or stay on your current ampless version until one is released'
    )
  })
  return (
    'update-ampless stopped before changing any files: package.json has @tiptap/* packages that ampless ' +
    'does not ship whose published releases peer-depend on versions this ampless release no longer uses, ' +
    'so the install would fail with ERESOLVE (npm) or load mismatched copies of the editor (pnpm).\n' +
    lines.join('\n') +
    '\nupdate-ampless never rewrites @tiptap/* packages that ampless does not ship, so it leaves these for you. ' +
    'Edit package.json (do not run `npm install` first), then run `npm run update-ampless` again. ' +
    'See "Updating ampless" in README.md.'
  )
}

// ----------------------------------------------------------------------------
// npm install rehearsal
// ----------------------------------------------------------------------------

/**
 * Specs that resolve relative to the project directory, which a rehearsal
 * in a temporary directory cannot reproduce.
 */
const LOCAL_SPEC_PATTERN = /^(file:|link:|workspace:|portal:|\.{0,2}\/|~\/)/

function localDependencySpec(pkg: Record<string, unknown>): string | null {
  if (pkg['workspaces'] !== undefined) return 'workspaces'
  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries(depsOf(pkg, section))) {
      if (typeof spec === 'string' && LOCAL_SPEC_PATTERN.test(spec)) return `${section}["${name}"]`
    }
  }
  return null
}

/**
 * Resolve the merged package.json with npm's own resolver in a temporary
 * directory before anything in the project is written. Catches peer
 * conflicts beyond the @tiptap/* check above (overrides, third-party peers)
 * without update-ampless having to model npm's rules.
 *
 * npm only: pnpm warns about peer mismatches instead of failing, so a pnpm
 * rehearsal would not catch the problems this guards against.
 */
async function rehearseNpmInstall(destDir: string, mergedPkgJson: string): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'ampless-upgrade-rehearsal-'))
  try {
    await writeFile(join(workDir, 'package.json'), mergedPkgJson, 'utf-8')
    for (const name of ['package-lock.json', '.npmrc']) {
      if (existsSync(join(destDir, name))) await cp(join(destDir, name), join(workDir, name))
    }
    await execa(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown }
    const output = [err.stderr, err.stdout].filter((s): s is string => typeof s === 'string').join('\n')
    const npmErrors = output
      .split('\n')
      .filter((l) => /^npm (error|ERR!)/.test(l) && !/A complete log of this run/.test(l))
    if (/\bERESOLVE\b/.test(output)) {
      const excerpt = npmErrors.slice(0, 15).map((l) => `  ${l}`).join('\n')
      throw new Error(
        'update-ampless stopped before changing any files: the merged package.json would not install ' +
        '(npm reported ERESOLVE while resolving it in a temporary directory). Nothing was changed.\n' +
        excerpt +
        '\nFix the conflicting entries in package.json (do not run `npm install` first), then run ' +
        '`npm run update-ampless` again. See "Updating ampless" in README.md.',
      )
    }
    throw new Error(
      'update-ampless stopped before changing any files: it could not verify that the merged package.json ' +
      `installs (${npmErrors.slice(0, 3).join(' / ') || errorText(e)}). Nothing was changed. Fix registry access and run \`npm run update-ampless\` ` +
      'again, or run it with `--no-install` to apply the files and run `npm install` yourself.',
    )
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

// ----------------------------------------------------------------------------
// User-installed @ampless/* plugin bump
// ----------------------------------------------------------------------------

interface BumpResult {
  bumped: Array<{ name: string; from: string; to: string }>
  warnings: string[]
}

/**
 * Walk the project's `dependencies` and, for every `@ampless/*` entry
 * that is **not** present in the template's deps (= user-installed opt-in
 * plugin, not a template-managed core package), resolve the latest
 * `@beta` dist-tag version via `npm view` and rewrite the project's pin
 * to `^<resolved>`.
 *
 * Only mutates `projectPkg` in memory; the caller writes `package.json`
 * once, after the preflight checks, and surfaces `warnings` via `log.warn`.
 * Network failures are non-fatal: warn + skip.
 */
async function bumpUserAmplessPlugins(
  destDir: string,
  projectPkg: { dependencies?: Record<string, string> },
  templatePkg: { dependencies?: Record<string, string> },
): Promise<BumpResult> {
  const result: BumpResult = { bumped: [], warnings: [] }
  const deps = projectPkg.dependencies ?? {}
  const templateDeps = templatePkg.dependencies ?? {}

  for (const pkgName of Object.keys(deps)) {
    // Only @ampless/* (= first-party scope)
    if (!pkgName.startsWith('@ampless/')) continue
    // Skip if template already has it (= existing mergePackageJson sync owns this version)
    if (pkgName in templateDeps) continue

    // Resolve latest @beta version via npm registry
    let latest: string
    try {
      const { stdout } = await execa('npm', ['view', `${pkgName}@beta`, 'version'], {
        cwd: destDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      latest = stdout.trim()
    } catch (e) {
      result.warnings.push(
        `${pkgName}: failed to resolve @beta version (${e instanceof Error ? e.message : String(e)}). Leaving the existing pin in package.json.`,
      )
      continue
    }
    if (!latest) {
      result.warnings.push(`${pkgName}: npm view returned empty version. Skipping bump.`)
      continue
    }

    // Caret form matches template style (e.g. "^1.0.0-beta.75")
    const target = `^${latest}`
    const current = deps[pkgName]!
    if (current === target) continue  // already in sync

    deps[pkgName] = target
    result.bumped.push({ name: pkgName, from: current, to: target })
  }

  return result
}

// ----------------------------------------------------------------------------
// Editor bootstrap codegen
// ----------------------------------------------------------------------------

/**
 * djb2 hash helper, module-private (file-scope), defined near
 * `regenerateEditorBootstrap`. Used only for sanitised-identifier
 * disambiguation, so a non-cryptographic 32-bit hash is fine.
 */
function djb2Hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

/**
 * Regenerate `app/(admin)/admin/_editor-bootstrap.tsx` by walking
 * the project's `dependencies` (NOT devDependencies) in `node_modules`
 * and collecting every package that declares
 * `amplessPlugin.editorExports` in its `package.json`.
 *
 * Returns the path written, the number of plugins wired, and any
 * warnings accumulated (caller is responsible for surfacing them via
 * `log.warn`).
 */
async function regenerateEditorBootstrap(
  destDir: string,
  projectPkg: { dependencies?: Record<string, string> }
): Promise<{ path: string; pluginCount: number; warnings: string[] }> {
  const targetPath = join(destDir, 'app', '(admin)', 'admin', '_editor-bootstrap.tsx')
  const installedPlugins: Array<{ packageName: string; editorExports: string }> = []
  const warnings: string[] = []   // caller (runUpgradeIn) が log.warn でまとめて出す

  // Walk `dependencies` only (NOT devDependencies). Editor extensions
  // run in the admin UI = production code path. Including devDeps
  // would risk the generated file importing a package that's stripped
  // from `node_modules` in `npm i --omit=dev` production installs.
  const deps = projectPkg.dependencies ?? {}
  for (const pkgName of Object.keys(deps)) {
    const pkgJsonPath = join(destDir, 'node_modules', pkgName, 'package.json')
    if (!existsSync(pkgJsonPath)) continue   // 存在しない deps (= optional / pruned) は silent skip
    let mf: any
    try {
      mf = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
    } catch (e) {
      // JSON parse failure は warn (= reviewer 指摘で「無言 skip しない」)
      warnings.push(`${pkgName}: failed to read package.json (${e instanceof Error ? e.message : String(e)}). Skipping editor wiring.`)
      continue
    }
    const ep = mf?.amplessPlugin?.editorExports
    if (typeof ep !== 'string') continue
    // Validation (reviewer Medium 指摘): warn + skip on bad values to avoid breaking the build
    if (!ep.startsWith('./') || ep.includes('..') || ep.startsWith('/') || /[?#]/.test(ep)) {
      warnings.push(`${pkgName}: amplessPlugin.editorExports="${ep}" is invalid (must be a ./-prefixed relative subpath without .. or query/fragment). Skipping editor wiring.`)
      continue
    }
    if (!mf?.exports || typeof mf.exports[ep] === 'undefined') {
      warnings.push(`${pkgName}: amplessPlugin.editorExports="${ep}" is not declared in package.json#exports. Skipping editor wiring.`)
      continue
    }
    installedPlugins.push({ packageName: pkgName, editorExports: ep })
  }

  // Sort for deterministic codegen
  installedPlugins.sort((a, b) => a.packageName.localeCompare(b.packageName))

  const lines: string[] = []
  lines.push("'use client'", '')
  lines.push('// AUTO-GENERATED by `npm run update-ampless`. Do not edit — your changes')
  lines.push('// will be overwritten on the next run. To enable / disable a plugin\'s')
  lines.push('// editor extension, add / remove the corresponding @ampless/plugin-...')
  lines.push('// entry in your project\'s package.json (and register it in cms.config.ts')
  lines.push('// for runtime).', '')
  lines.push("import { installAdminEditorExtensions, installAdminTiptapNodeMarkdown, installAdminTiptapNodeHtml } from '@ampless/admin/editor'")

  const identifiers: string[] = []
  const seen = new Map<string, string>()   // ident → packageName, for collision detection
  for (const p of installedPlugins) {
    // sanitise "@scope/pkg-name" → "__scope_pkg_name_editor"
    // Using namespace imports (`import * as`) so that plugins which do NOT
    // export `tiptapNodeToMarkdown` are still valid (missing named exports
    // cause build errors on direct named imports, but are undefined on
    // namespace access — `ns.tiptapNodeToMarkdown ?? {}` handles it).
    let ident = '__' + p.packageName.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '_') + '_editor'
    // Collision detection: identical sanitised identifier from different package names
    // (e.g. `@a/b-c` と `@a/b_c` would both sanitise to `__a_b_c_editor`)
    if (seen.has(ident) && seen.get(ident) !== p.packageName) {
      // disambiguate with a deterministic short hash suffix (first 8 hex of djb2)
      const suffix = djb2Hash(p.packageName).slice(0, 8)
      const orig = ident
      ident = `${ident}_${suffix}`
      warnings.push(`editor-bootstrap codegen: sanitised identifier "${orig}" collides between "${seen.get(orig)}" and "${p.packageName}". Using "${ident}" for the latter to disambiguate.`)
    }
    seen.set(ident, p.packageName)
    const importSubpath = p.editorExports.startsWith('./')
      ? `${p.packageName}/${p.editorExports.slice(2)}`
      : `${p.packageName}/${p.editorExports}`
    lines.push(`import * as ${ident} from '${importSubpath}'`)
    identifiers.push(ident)
  }

  lines.push('')
  lines.push('export function EditorBootstrap({ children }: { children: React.ReactNode }) {')
  if (identifiers.length === 0) {
    // 0 plugin の場合は inline 形 (= testability + 視認性)
    lines.push('  installAdminEditorExtensions([])')
    lines.push('  installAdminTiptapNodeMarkdown([])')
    lines.push('  installAdminTiptapNodeHtml([])')
  } else {
    lines.push('  installAdminEditorExtensions([')
    for (const id of identifiers) lines.push(`    ${id}.editorExtension,`)
    lines.push('  ])')
    // Pass each plugin's adapter map as a separate array entry — install
    // detects cross-plugin nodeType collisions by walking the maps
    // independently. Pre-merging via `{ ...a, ...b }` would lose them
    // silently because JS object literals deduplicate keys.
    lines.push('  installAdminTiptapNodeMarkdown([')
    for (const id of identifiers) lines.push(`    ${id}.tiptapNodeToMarkdown ?? {},`)
    lines.push('  ])')
    lines.push('  installAdminTiptapNodeHtml([')
    for (const id of identifiers) lines.push(`    ${id}.tiptapNodeToHtml ?? {},`)
    lines.push('  ])')
  }
  lines.push('  return <>{children}</>')
  lines.push('}')
  lines.push('')

  // Ensure the parent dir exists (= app/(admin)/admin/), which AMPLESS_MANAGED_APP_PATHS
  // sync already guarantees but defensive write
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, lines.join('\n'), 'utf-8')

  return { path: targetPath, pluginCount: installedPlugins.length, warnings }
}

// ----------------------------------------------------------------------------
// Core logic (pure-ish; accepts dirs as arguments for testability)
// ----------------------------------------------------------------------------

export async function runUpgradeIn(
  destDir: string,
  sharedDir: string,
  opts: { dryRun?: boolean; noInstall?: boolean; templatesRoot?: string } = {},
): Promise<UpgradeResult> {
  // The CLI always passes the directory containing both `_shared/` and
  // theme dirs; tests can override with a scratch root that has its
  // own pretend theme tree (or omit it for tests that don't exercise
  // the theme sync path).
  //
  // The auto-derived parent of a test-supplied `sharedDir` is some
  // unrelated tmpdir whose siblings could be anything (other tests,
  // OS files in `/var/folders/.../TemporaryItems`, …). We only enable
  // the theme sync path when the derived root is recognisably the
  // ampless templates tree — i.e. it contains a `_shared/` sibling —
  // so a test that just makes a fake `_shared/` doesn't pull garbage
  // into the project's themes/ dir.
  const derivedRoot = opts.templatesRoot ?? join(sharedDir, '..')
  const themeSyncEnabled = existsSync(join(derivedRoot, '_shared'))
  const templatesRoot = themeSyncEnabled ? derivedRoot : ''
  // 1. validate
  const problem = validateMountableProject(destDir)
  if (problem) {
    throw new Error(problem)
  }

  // 2. read project name from package.json
  const projectPkgPath = join(destDir, 'package.json')
  const projectPkgRaw = await readFile(projectPkgPath, 'utf-8')
  const projectPkg = JSON.parse(projectPkgRaw) as Record<string, unknown>
  const projectName =
    typeof projectPkg.name === 'string' && projectPkg.name
      ? projectPkg.name
      : 'my-ampless-site'

  const vars: Record<string, string> = { projectName }

  // 2b. read the template package.json up front: the merged package.json and
  // its preflight checks must be computed before anything is written.
  const templatePkg = JSON.parse(
    await readFile(join(sharedDir, 'package.json'), 'utf-8'),
  ) as Record<string, unknown>

  // 3. collect files from shared template dir
  const allRelPaths: string[] = []
  await walkDir(sharedDir, sharedDir, allRelPaths)

  const classification: FileClassification = { replace: [], merge: [], seed: [], protected: [] }
  for (const rel of allRelPaths) {
    if (SEED_IF_MISSING_PATTERN.test(rel)) {
      classification.seed.push(rel)
    } else if (isProtected(rel)) {
      classification.protected.push(rel)
    } else if (rel === 'package.json') {
      classification.merge.push(rel)
    } else {
      classification.replace.push(rel)
    }
  }

  // 4. plan summary
  const replaceNew = classification.replace.filter((r) => !existsSync(join(destDir, r)))
  const replaceUpdate = classification.replace.filter((r) => existsSync(join(destDir, r)))
  const seedNew = classification.seed.filter((r) => !existsSync(join(destDir, r)))
  const seedSkipped = classification.seed.filter((r) => existsSync(join(destDir, r)))

  // 4b. plan summary for themes (theme dirs live outside _shared, so
  // they're not part of the file walk above). Skipped when the caller
  // didn't supply a recognisable templates root (typically in unit
  // tests that exercise only the file-merge logic).
  const shippedThemes = themeSyncEnabled ? await listShippedThemes(templatesRoot) : []
  const existingThemes = themeSyncEnabled ? await discoverInstalledThemes(destDir) : []
  // Preview what `syncThemes` will quarantine — directories under the
  // user's themes/ whose name matches a known non-theme template prefix
  // (PR #174 recovery for sites broken by the buggy PR #168 release).
  // The actual deletion happens inside `syncThemes`; here we just
  // report the plan to the user so the dry-run output matches reality.
  const quarantinedThemesPreview = existingThemes.filter(isQuarantinedThemeName)
  const preservedThemes = existingThemes.filter(
    (t) => !shippedThemes.includes(t) && !isQuarantinedThemeName(t),
  )

  const obsoleteFiles = await findObsoleteFiles(destDir, sharedDir)

  log.info(
    `replace: ${pc.green(`${replaceNew.length} added`)} / ${pc.yellow(`${replaceUpdate.length} updated`)}`
  )
  log.info(`merge:   ${pc.cyan('package.json: sync ampless deps and managed scripts with the template')}`)
  if (classification.seed.length > 0) {
    log.info(
      `seed:    ${pc.green(`${seedNew.length} added`)} / ${pc.dim(`${seedSkipped.length} kept (existing *.custom.ts left untouched)`)}`
    )
  }
  if (themeSyncEnabled) {
    log.info(
      `themes:  ${pc.cyan(`${shippedThemes.length} default themes synced`)} / ${pc.dim(`${preservedThemes.length} custom (my-*) themes preserved`)}`
    )
    if (quarantinedThemesPreview.length > 0) {
      log.info(
        `recover: ${pc.yellow(`${quarantinedThemesPreview.length} bogus theme dir(s) removed`)} (${quarantinedThemesPreview.join(', ')} — scaffold templates leaked in by an earlier buggy create-ampless@alpha)`
      )
    }
  }
  if (obsoleteFiles.length > 0) {
    log.info(`cleanup: ${pc.yellow(`${obsoleteFiles.length} removed`)} (files under ampless-managed app/ paths that no longer exist in the template)`)
  }
  log.info(`protected: ${pc.dim(`${classification.protected.length} template files left untouched`)}`)
  if (usesNextLint(projectPkg)) {
    log.warn(NEXT_LINT_WARNING)
  }

  // 4c. compute the final package.json in memory. Nothing is written until
  // the preflight checks below pass, so a dependency problem never leaves
  // the site half-upgraded.
  const indent = detectIndent(projectPkgRaw)
  for (const w of mergeManagedPackageJson(projectPkg, templatePkg)) {
    log.warn(w)
  }

  // Bump user-installed @ampless/* plugins (not in template) to latest @beta,
  // in memory, so the preflight below and the install see the new versions.
  // Skipped in dry-run, which never resolved these.
  const templatePkgForBump = templatePkg as { dependencies?: Record<string, string> }
  const projectPkgForBump = projectPkg as { dependencies?: Record<string, string> }
  const userPluginBump: BumpResult = opts.dryRun
    ? { bumped: [], warnings: [] }
    : await bumpUserAmplessPlugins(destDir, projectPkgForBump, templatePkgForBump)

  const mergedPkgJson = JSON.stringify(projectPkg, null, indent) + '\n'

  // 4d. project-only @tiptap/* packages whose published releases all peer on
  // managed versions the template no longer allows. Real runs abort here,
  // before any write; dry-run only warns.
  const peerCheck = await checkProjectOnlyPeers(projectPkg, templatePkg, npmViewLookup(destDir))
  for (const w of peerCheck.warnings) {
    log.warn(w)
  }
  if (peerCheck.conflicts.length > 0) {
    const message = buildPeerConflictMessage(peerCheck.conflicts)
    if (!opts.dryRun) throw new Error(message)
    log.warn(message)
  }

  // 4e. rehearse the npm install against the merged package.json when the
  // install will actually run. pnpm projects are not rehearsed (see
  // `rehearseNpmInstall`).
  const usePnpm = existsSync(join(destDir, 'pnpm-lock.yaml'))
  if (!opts.dryRun && !opts.noInstall && !usePnpm) {
    const local = localDependencySpec(projectPkg)
    if (local) {
      log.warn(
        `Skipping the npm install rehearsal: package.json uses ${local}, which resolves relative to the project ` +
        'and cannot be reproduced in a temporary directory. A failing install will leave the updated files in place.',
      )
    } else {
      log.info(`verify:  ${pc.cyan('resolving the merged package.json with npm (no files changed yet)')}`)
      await rehearseNpmInstall(destDir, mergedPkgJson)
    }
  }

  // 5. dry-run exit
  if (opts.dryRun) {
    return {
      added: replaceNew,
      updated: replaceUpdate,
      seeded: seedNew,
      protected: classification.protected,
      themesSynced: shippedThemes,
      themesPreserved: preservedThemes,
      themesQuarantined: quarantinedThemesPreview,
      packageJsonMerged: false,
      obsoleteRemoved: obsoleteFiles,
    }
  }

  // 6. execute replace
  for (const rel of classification.replace) {
    const src = join(sharedDir, rel)
    const dst = join(destDir, rel)
    await copyWithSubstitution(src, dst, vars)
  }

  // 6b. execute seed (only files missing in destination)
  for (const rel of seedNew) {
    const src = join(sharedDir, rel)
    const dst = join(destDir, rel)
    await copyWithSubstitution(src, dst, vars)
  }

  // 6c. sync themes and regenerate themes-registry.ts. Lives in its own
  // pass because theme dirs are siblings of `_shared/` in the template
  // root, not files inside it. Disabled when the templates root isn't
  // recognisable (unit tests against a fake _shared/ folder).
  const themeResult: ThemeSyncResult & { quarantined: string[] } = themeSyncEnabled
    ? await syncThemes(destDir, templatesRoot)
    : { synced: [], preserved: [], quarantined: [] }

  // 6d. Remove app/ files that are no longer in the template. See
  // `AMPLESS_MANAGED_APP_PATHS` — entries get added on first scaffold
  // and never removed, so this loop catches route shells that ampless
  // no longer ships.
  await removeObsoleteFiles(destDir, obsoleteFiles)

  // 7. write the merged package.json computed in step 4c
  await writeFile(projectPkgPath, mergedPkgJson, 'utf-8')

  // 8. npm/pnpm install
  if (!opts.noInstall) {
    const pm = usePnpm ? 'pnpm' : 'npm'
    try {
      await execa(pm, ['install'], { cwd: destDir, stdio: 'inherit' })
    } catch (e) {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}\n` +
        `\`${pm} install\` failed after update-ampless had already updated the template files and package.json. ` +
        'Review the changes with `git status` / `git diff`, fix the reported problem and run ' +
        '`npm run update-ampless` again, or restore the previous versions with git.',
      )
    }
  }

  // 9. Regenerate _editor-bootstrap.tsx from installed plugin manifests.
  // Must run AFTER install so the latest node_modules are available.
  const codegenProjectPkg = JSON.parse(
    await readFile(join(destDir, 'package.json'), 'utf-8')
  ) as { dependencies?: Record<string, string> }
  const bootstrapResult = await regenerateEditorBootstrap(destDir, codegenProjectPkg)

  if (opts.noInstall) {
    bootstrapResult.warnings.push(
      '_editor-bootstrap.tsx was generated without running npm install — ' +
      'node_modules may be stale. Run `npm run update-ampless` (without --no-install) to pick up newly added plugin editor extensions.'
    )
    if (userPluginBump.bumped.length > 0) {
      userPluginBump.warnings.push(
        `package.json was updated with ${userPluginBump.bumped.length} bumped @ampless/* plugin version(s) but npm install was skipped — run \`npm install\` (or \`npm run update-ampless\` without --no-install) to apply the new versions.`,
      )
    }
  }

  for (const w of bootstrapResult.warnings) {
    log.warn(w)
  }

  log.info(
    `editor:  ${pc.cyan(`auto-wired ${bootstrapResult.pluginCount} editor extension(s) in _editor-bootstrap.tsx`)}`
  )

  if (userPluginBump.bumped.length > 0) {
    log.info(`plugins: ${pc.cyan(`bumped ${userPluginBump.bumped.length} user-installed @ampless/* plugin(s) to latest @beta:`)}`)
    for (const { name, from, to } of userPluginBump.bumped) {
      log.info(`  ${name}: ${from} → ${to}`)
    }
  }
  for (const w of userPluginBump.warnings) {
    log.warn(w)
  }

  return {
    added: replaceNew,
    updated: replaceUpdate,
    seeded: seedNew,
    protected: classification.protected,
    themesSynced: themeResult.synced,
    themesPreserved: themeResult.preserved,
    themesQuarantined: themeResult.quarantined,
    packageJsonMerged: true,
    obsoleteRemoved: obsoleteFiles,
    editorExtensionsWired: bootstrapResult.pluginCount,
    userPluginsBumped: userPluginBump.bumped.length,
  }
}

// ----------------------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------------------

export async function runUpgrade(args: ParsedArgs): Promise<void> {
  const destDir = process.cwd()

  try {
    await runUpgradeIn(destDir, sharedTemplateDir(), {
      dryRun: args.dryRun,
      noInstall: args.noInstall,
    })
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  if (args.dryRun) {
    outro(`${pc.dim('(dry-run) No files were changed.')}`)
    return
  }

  outro(
    `${pc.green('✔')} Upgrade complete\n\n` +
    `  Next steps:\n` +
    `    ${pc.cyan('git diff')}              ${pc.dim('# review changes')}\n` +
    `    ${pc.cyan('git commit && git push')}  ${pc.dim('# deploy via Amplify Hosting')}`
  )
}
