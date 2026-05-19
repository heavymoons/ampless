import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log, outro } from '@clack/prompts'
import pc from 'picocolors'
import { validateMountableProject } from './mount.js'
import {
  CUSTOM_THEME_PREFIX,
  buildRegistry,
  discoverInstalledThemes,
  isCustomTheme,
} from './themes-registry.js'
import type { ParsedArgs } from './args.js'

export interface CopyThemeResult {
  source: string
  target: string
  filesRewritten: string[]
}

/**
 * Copy an installed theme to a new directory under `themes/`, rewriting
 * the theme's internal name (in `defineThemeModule`, `defineTheme`, and
 * the tokens.css selector) so the copy registers as a distinct theme
 * at runtime. The registry is regenerated to include the new entry.
 *
 * `target` must use the `${CUSTOM_THEME_PREFIX}` prefix — that
 * convention is what tells `create-ampless upgrade` to leave the copy
 * untouched on future syncs. Without it the copy would be overwritten
 * the next time upgrade runs, which defeats the customization point.
 */
export async function runCopyThemeIn(
  destDir: string,
  source: string,
  target: string,
): Promise<CopyThemeResult> {
  const problem = validateMountableProject(destDir)
  if (problem) {
    throw new Error(problem)
  }

  if (!isCustomTheme(target)) {
    throw new Error(
      `Target theme name must start with "${CUSTOM_THEME_PREFIX}" (got "${target}"). ` +
        `This prefix marks the theme as user-owned so create-ampless upgrade leaves it alone.`,
    )
  }

  if (source === target) {
    throw new Error(`Source and target are identical (${source}).`)
  }

  const themesDir = join(destDir, 'themes')
  const sourceDir = join(themesDir, source)
  const targetDir = join(themesDir, target)

  if (!existsSync(sourceDir)) {
    throw new Error(`Source theme not found: themes/${source}/`)
  }
  if (existsSync(targetDir)) {
    throw new Error(`Target theme already exists: themes/${target}/`)
  }

  // Copy the entire directory tree first; rewriting comes second so
  // newly-introduced files (added by future ampless releases) are
  // picked up automatically without expanding the rewrite list.
  await cp(sourceDir, targetDir, { recursive: true })

  const filesRewritten = await rewriteThemeName(targetDir, source, target)

  // Refresh the registry so the copy is bundled. Walks the themes/
  // directory afterwards so any other custom theme that was added
  // out-of-band gets picked up too.
  const installed = await discoverInstalledThemes(destDir)
  await writeFile(join(destDir, 'themes-registry.ts'), buildRegistry(installed), 'utf-8')

  return { source, target, filesRewritten }
}

/**
 * Rewrite every reference to `source` inside the copied theme directory
 * so it becomes a standalone theme. Three places matter:
 *  - `index.ts` and `manifest.ts` set `name: '<theme>'` — the dispatcher
 *    keys themes by this field at runtime
 *  - `tokens.css` scopes every variable under `[data-theme='<theme>']`
 *    — without this rewrite the active-theme attribute won't match
 *
 * Other references (theme labels, descriptions, README copy) intentionally
 * survive unchanged: those are display text the user can edit manually
 * during customization, and a blind global replace would corrupt them
 * if the theme name happens to coincide with a common word.
 */
async function rewriteThemeName(
  targetDir: string,
  source: string,
  target: string,
): Promise<string[]> {
  const touched: string[] = []

  await rewriteFile(join(targetDir, 'index.ts'), (s) =>
    s.replace(new RegExp(`name:\\s*'${escapeRegex(source)}'`), `name: '${target}'`)
      .replace(new RegExp(`name:\\s*"${escapeRegex(source)}"`), `name: "${target}"`),
    touched,
  )

  await rewriteFile(join(targetDir, 'manifest.ts'), (s) =>
    s.replace(new RegExp(`name:\\s*'${escapeRegex(source)}'`), `name: '${target}'`)
      .replace(new RegExp(`name:\\s*"${escapeRegex(source)}"`), `name: "${target}"`),
    touched,
  )

  await rewriteFile(join(targetDir, 'tokens.css'), (s) =>
    s.replace(new RegExp(`\\[data-theme='${escapeRegex(source)}'\\]`, 'g'), `[data-theme='${target}']`)
      .replace(new RegExp(`\\[data-theme="${escapeRegex(source)}"\\]`, 'g'), `[data-theme="${target}"]`),
    touched,
  )

  return touched
}

async function rewriteFile(
  path: string,
  transform: (content: string) => string,
  touched: string[],
): Promise<void> {
  if (!existsSync(path)) return
  const before = await readFile(path, 'utf-8')
  const after = transform(before)
  if (after === before) return
  await writeFile(path, after, 'utf-8')
  touched.push(path)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ----------------------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------------------

export async function runCopyTheme(args: ParsedArgs): Promise<void> {
  const destDir = process.cwd()
  const source = args.copyThemeSource
  const target = args.copyThemeTarget

  if (!source || !target) {
    log.error('Usage: npx create-ampless@latest copy-theme <source> <target>')
    log.info('Example: npx create-ampless@latest copy-theme blog my-blog')
    process.exit(1)
  }

  try {
    const result = await runCopyThemeIn(destDir, source, target)
    outro(
      `${pc.green('✔')} Copied themes/${result.source}/ → themes/${result.target}/\n\n` +
        `  Files rewritten:\n` +
        result.filesRewritten.map((f) => `    ${pc.dim(f)}`).join('\n') +
        `\n\n  themes-registry.ts updated. Next:\n` +
        `    ${pc.cyan(`Open themes/${result.target}/ and start customising`)}\n` +
        `    ${pc.cyan(`Activate via /admin/sites/<siteId>/theme`)}`,
    )
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
