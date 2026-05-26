import { cp, readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, extname, dirname } from 'node:path'
import { log, outro } from '@clack/prompts'
import pc from 'picocolors'
import { execa } from 'execa'
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
const AMPLESS_RETIRED_PATHS: readonly string[] = [] as const

const AMPLESS_PACKAGES = new Set([
  'ampless',
  '@ampless/admin',
  '@ampless/backend',
  '@ampless/runtime',
  '@ampless/plugin-seo',
  '@ampless/plugin-rss',
  '@ampless/plugin-webhook',
  '@ampless/plugin-og-image',
])

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
  /^tsconfig\.tsbuildinfo$/,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  // Anything under themes/ is handled by syncThemes; the file-walk
  // classifier must not double-process it.
  /^themes(\/|$)/,
  /^themes-registry\.ts$/,
]

// `*.custom.ts` is the user's extension surface — once the file exists
// upgrade must leave it alone, but the empty stub still has to be
// seeded into projects scaffolded before the convention was introduced
// (the matching `resource.ts` / `backend.ts` template files import from
// `./*.custom.js`, so a missing stub breaks the build). Splitting it
// off from PROTECTED_PATTERNS lets the classifier route these files
// through the "seed-if-missing" branch instead of the "ignore" branch.
const SEED_IF_MISSING_PATTERN = /\.custom\.ts$/

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
  packageJsonMerged: boolean
  /** Obsolete files removed from ampless-managed app/ subtrees. */
  obsoleteRemoved: string[]
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
  return PROTECTED_PATTERNS.some((re) => re.test(relPath))
}

/**
 * The set of ampless-managed default themes is whatever the create-ampless
 * package ships outside of `_shared/`. Discovered at runtime instead of
 * hardcoded so adding a new theme to `templates/<name>/` automatically
 * makes the upgrade aware of it.
 *
 * `templatesRoot` is the directory containing `_shared/` and every
 * theme subdirectory (i.e. one level above `sharedDir`). Tests pass a
 * scratch dir; the CLI passes the bundled `templatesDir`.
 */
async function listShippedThemes(templatesRoot: string): Promise<string[]> {
  if (!existsSync(templatesRoot)) return []
  const entries = await readdir(templatesRoot, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && e.name !== '_shared')
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
async function syncThemes(destDir: string, templatesRoot: string): Promise<ThemeSyncResult> {
  const shipped = await listShippedThemes(templatesRoot)
  const themesDir = join(destDir, 'themes')
  await mkdir(themesDir, { recursive: true })

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
  const preserved = installed.filter((t) => !shippedSet.has(t))

  // Regenerate themes-registry.ts to list both halves.
  const all = [...shipped, ...preserved]
  await writeFile(join(destDir, 'themes-registry.ts'), buildRegistry(all), 'utf-8')

  return { synced: shipped, preserved }
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
  const preservedThemes = existingThemes.filter((t) => !shippedThemes.includes(t))

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
  }
  if (obsoleteFiles.length > 0) {
    log.info(`cleanup: ${pc.yellow(`${obsoleteFiles.length} removed`)} (files under ampless-managed app/ paths that no longer exist in the template)`)
  }
  log.info(`protected: ${pc.dim(`${classification.protected.length} template files left untouched`)}`)

  // 5. dry-run exit
  if (opts.dryRun) {
    return {
      added: replaceNew,
      updated: replaceUpdate,
      seeded: seedNew,
      protected: classification.protected,
      themesSynced: shippedThemes,
      themesPreserved: preservedThemes,
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
  const themeResult: ThemeSyncResult = themeSyncEnabled
    ? await syncThemes(destDir, templatesRoot)
    : { synced: [], preserved: [] }

  // 6d. Remove app/ files that are no longer in the template. See
  // `AMPLESS_MANAGED_APP_PATHS` — entries get added on first scaffold
  // and never removed, so this loop catches route shells that ampless
  // no longer ships.
  await removeObsoleteFiles(destDir, obsoleteFiles)

  // 7. execute merge package.json
  const templatePkgRaw = await readFile(join(sharedDir, 'package.json'), 'utf-8')
  const templatePkg = JSON.parse(templatePkgRaw) as Record<string, unknown>

  const indent = detectIndent(projectPkgRaw)

  // Merge ampless deps from template into project
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const templateDeps = (templatePkg[section] ?? {}) as Record<string, string>
    const projectDeps = (projectPkg[section] ?? {}) as Record<string, string>

    for (const [name, version] of Object.entries(templateDeps)) {
      if (!AMPLESS_PACKAGES.has(name)) continue
      projectDeps[name] = version
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

  await writeFile(projectPkgPath, JSON.stringify(projectPkg, null, indent) + '\n', 'utf-8')

  // 8. npm/pnpm install
  if (!opts.noInstall) {
    const usePnpm = existsSync(join(destDir, 'pnpm-lock.yaml'))
    const pm = usePnpm ? 'pnpm' : 'npm'
    await execa(pm, ['install'], { cwd: destDir, stdio: 'inherit' })
  }

  return {
    added: replaceNew,
    updated: replaceUpdate,
    seeded: seedNew,
    protected: classification.protected,
    themesSynced: themeResult.synced,
    themesPreserved: themeResult.preserved,
    packageJsonMerged: true,
    obsoleteRemoved: obsoleteFiles,
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
