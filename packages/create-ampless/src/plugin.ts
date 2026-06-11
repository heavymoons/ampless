/**
 * `npx create-ampless@beta plugin <name>` — scaffold an ampless plugin.
 *
 * Two modes:
 *   - `local` (default): writes `plugins/<name>/index.ts` inside the current
 *     ampless site directory. The site is the build / publish unit; the plugin
 *     file lives alongside app code.
 *   - `standalone`: writes a complete npm package at `./<name>/` ready for
 *     `npm publish`. The package name may include a scope
 *     (`@scope/ampless-plugin-foo`); the last segment becomes the
 *     `AmplessPlugin.name` identifier.
 *
 * Placeholder substitution uses `{{key}}` tokens in template files, consistent
 * with the pattern in `scaffold.ts` and `upgrade.ts`.
 */

import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import {
  log,
  outro,
  text,
  select,
  multiselect,
  isCancel,
  cancel,
} from '@clack/prompts'
import pc from 'picocolors'
import type { ParsedArgs } from './args.js'
import { VALID_PLUGIN_TRUST_LEVELS, VALID_PLUGIN_CAPABILITIES } from './args.js'
import { pluginTemplateDir } from './templates.js'
import { validateMountableProject } from './mount.js'

// ----------------------------------------------------------------------------
// Version constant
// ----------------------------------------------------------------------------

/**
 * The minimum `ampless` dependency version that generated plugin
 * scaffolds declare. Keep this pinned to the beta line until v1.0; the
 * caret range in the template lets npm resolve the newest beta build.
 *
 * Current: ampless@1.0.0-beta.0
 */
const SCAFFOLD_AMPLESS_VERSION = '1.0.0-beta.0'

// ----------------------------------------------------------------------------
// Text extensions (mirrors upgrade.ts + scaffold.ts)
// ----------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  '.json',
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.env',
  '.txt',
  '.yaml',
  '.yml',
  '.toml',
  '.gitignore',
])

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface CreatePluginResult {
  mode: 'local' | 'standalone'
  /** Final scaffolded directory (absolute path). */
  outputDir: string
  /** kebab-case identifier used in AmplessPlugin.name. */
  pluginName: string
  /** npm package name (only set in standalone mode). */
  packageName?: string
}

// ----------------------------------------------------------------------------
// String helpers
// ----------------------------------------------------------------------------

/** `'site-verification'` → `'site-verification'` (pass-through for kebab). */
function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '')
}

/** `'site-verification'` → `'siteVerification'` */
function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** `'site-verification'` → `'SiteVerification'` */
function toPascalCase(kebab: string): string {
  const c = toCamelCase(kebab)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

/** `'site-verification'` → `'Site verification'` (first word capitalised, rest lower). */
function toDisplayName(kebab: string): string {
  const words = kebab.split('-')
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// Make `--description` safe for substitution into a JS/TS docstring
// (e.g. the JSDoc above the factory function) and Markdown body text.
//
// Two real risks:
//   1. An asterisk-slash sequence inside a JSDoc block closes the
//      comment early, and the rest of the docstring becomes code.
//   2. Newlines split the description across template lines and corrupt
//      indentation.
//
// We escape the closing-comment sequence with a backslash and collapse
// whitespace to single spaces. The result is plain ASCII-safe text
// that fits on one line.
function sanitizeForJsComment(s: string): string {
  return s
    .replace(/\*\//g, '*\\/')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** `'@scope/foo-bar'` → `'foo-bar'`. Used for the output directory
 *  name (without the npm scope). */
function lastSegment(packageName: string): string {
  return packageName.replace(/^@[^/]+\//, '')
}

/**
 * Resolve the `AmplessPlugin.name` (kebab-case identifier) from a
 * standalone npm package name. Strips both the `@scope/` prefix and the
 * conventional `plugin-` / `ampless-plugin-` prefix so first-party and
 * community plugins line up:
 *
 *   `@ampless/plugin-gtm`               → `gtm`
 *   `@ishinao/ampless-plugin-site-vrfn` → `site-vrfn`
 *   `ampless-plugin-clarity`            → `clarity`
 *   `weird-name`                        → `weird-name`  (no prefix found)
 *
 * This mirrors the convention already used by every first-party plugin
 * shipped to date; `AmplessPlugin.name` is meant to be the short
 * identifier that admins / instanceIds see, not the full npm path.
 */
function pluginNameFromPackage(packageName: string): string {
  const segment = lastSegment(packageName)
  // Strip `ampless-plugin-` first, then plain `plugin-`, so the more
  // specific community prefix wins over the bare first-party one.
  if (segment.startsWith('ampless-plugin-')) {
    return segment.slice('ampless-plugin-'.length)
  }
  if (segment.startsWith('plugin-')) {
    return segment.slice('plugin-'.length)
  }
  return segment
}

// ----------------------------------------------------------------------------
// Template substitution helpers
// ----------------------------------------------------------------------------

async function substituteFile(
  filePath: string,
  vars: Record<string, string>,
): Promise<void> {
  // Treat basename `.gitignore` as a text file even though extname() returns ''.
  const ext = extname(filePath) || (basename(filePath) === '.gitignore' ? '.gitignore' : '')
  if (!TEXT_EXTENSIONS.has(ext)) return

  const content = await readFile(filePath, 'utf-8')
  const replaced = content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
  if (replaced !== content) await writeFile(filePath, replaced, 'utf-8')
}

async function substituteDir(
  dir: string,
  vars: Record<string, string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await substituteDir(fullPath, vars)
      } else {
        await substituteFile(fullPath, vars)
      }
    }),
  )
}

// ----------------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------------

/**
 * Strict kebab-case for `AmplessPlugin.name`. Each segment must start
 * with a lowercase letter (so it produces a valid TS identifier after
 * camelCasing — `123Plugin` from `ampless-plugin-123` is rejected),
 * letters / digits only inside, segments separated by single hyphens
 * (no leading / trailing / consecutive hyphens). The
 * `pluginNameFromPackage` result is re-validated against this so that
 * standalone scaffolds with a prefix-stripped junk identifier
 * (`ampless-plugin-123foo` → `123foo`) surface the same error as a
 * direct invalid `--local` name.
 */
const KEBAB_RE = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/
/**
 * npm package name: optional `@scope/` prefix, then a kebab segment.
 * Both the scope and the unscoped name use the same strict form as
 * `KEBAB_RE` so they produce valid directory names and TS identifiers.
 */
const PACKAGE_NAME_RE = /^(@[a-z][a-z0-9-]*\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

// ----------------------------------------------------------------------------
// Core implementation
// ----------------------------------------------------------------------------

/**
 * Inner scaffold logic. Accepts an explicit `destDir` so it can be tested
 * without touching `process.cwd()`.
 */
export async function runCreatePluginIn(
  destDir: string,
  args: ParsedArgs,
): Promise<CreatePluginResult> {
  // 1. Mode — default to 'local' when not supplied.
  const mode: 'local' | 'standalone' = args.pluginMode ?? 'local'

  // 2. Prompt for missing args -----------------------------------------------

  let rawName = args.pluginName

  if (!rawName) {
    // `--skip-confirm` is documented as "Skip all interactive prompts and
    // use defaults / flag values (for CI / automation)". A missing
    // `<name>` has no documented default — the prompt is the only path
    // that fills it in. With skip-confirm on, that prompt would block
    // forever waiting on a TTY, so fail loudly instead. Matches the
    // skip-confirm-bypasses-prompts treatment used for trust-level and
    // capabilities further down.
    if (args.skipConfirm === true) {
      throw new Error(
        mode === 'local'
          ? 'Plugin name is required when --skip-confirm is set. Pass it as the positional argument: `create-ampless plugin <name> --skip-confirm`.'
          : 'Plugin package name is required when --skip-confirm is set. Pass it as the positional argument: `create-ampless plugin <package-name> --standalone --skip-confirm`.',
      )
    }
    const answer = await text({
      message:
        mode === 'local'
          ? 'Plugin name (kebab-case, e.g. "site-verification"):'
          : 'Plugin package name (e.g. "@scope/ampless-plugin-foo" or "ampless-plugin-foo"):',
      validate(v) {
        if (!v) return 'Plugin name is required'
        const re = mode === 'local' ? KEBAB_RE : PACKAGE_NAME_RE
        if (!re.test(v)) {
          return mode === 'local'
            ? 'Must be kebab-case starting with a lowercase letter (e.g. "site-verification")'
            : 'Must be a valid npm package name (e.g. "ampless-plugin-foo" or "@scope/ampless-plugin-foo")'
        }
      },
    })
    if (isCancel(answer)) {
      cancel('Cancelled.')
      process.exit(0)
    }
    rawName = answer as string
  } else {
    // Validate the name supplied via CLI flag.
    const re = mode === 'local' ? KEBAB_RE : PACKAGE_NAME_RE
    if (!re.test(rawName)) {
      throw new Error(
        mode === 'local'
          ? `Invalid plugin name "${rawName}". Must be kebab-case (e.g. "site-verification").`
          : `Invalid plugin name "${rawName}". Must be a valid npm package name (e.g. "ampless-plugin-foo" or "@scope/ampless-plugin-foo").`,
      )
    }
  }

  // When `--skip-confirm` is set (CI / non-interactive use), fill in
  // missing optional flags with the documented defaults instead of
  // launching an interactive prompt. The defaults match what the
  // prompt's initial values would have been:
  //   --trust-level untrusted
  //   --capabilities publicHead,adminSettings
  // This keeps `--skip-confirm` honest — once it's set, the command
  // must complete without blocking on a TTY.
  const skipConfirm = args.skipConfirm === true

  let trustLevel = args.pluginTrustLevel
  if (!trustLevel) {
    if (skipConfirm) {
      trustLevel = 'untrusted'
    } else {
      const answer = await select({
        message: 'Trust level:',
        options: VALID_PLUGIN_TRUST_LEVELS.map((t) => ({
          value: t,
          label: t,
          hint:
            t === 'untrusted'
              ? 'No special permissions (default)'
              : t === 'trusted'
                ? 'Can read site config'
                : 'Full access to internal APIs',
        })),
      })
      if (isCancel(answer)) {
        cancel('Cancelled.')
        process.exit(0)
      }
      trustLevel = answer as ParsedArgs['pluginTrustLevel']
    }
  }

  let capabilities = args.pluginCapabilities
  if (!capabilities) {
    if (skipConfirm) {
      capabilities = ['publicHead', 'adminSettings']
    } else {
      const answer = await multiselect({
        message: 'Capabilities (space to toggle, enter to confirm):',
        options: VALID_PLUGIN_CAPABILITIES.map((c) => ({
          value: c,
          label: c,
        })),
        initialValues: ['publicHead', 'adminSettings'],
        required: false,
      })
      if (isCancel(answer)) {
        cancel('Cancelled.')
        process.exit(0)
      }
      capabilities = answer as string[]
    }
  }

  // description is optional — prompt is skipped, empty string is fine.
  // The raw value is user-supplied via `--description` so it may contain
  // characters that would corrupt the output if substituted naively:
  //   - `*/` inside a JS docstring closes the comment block early
  //   - quotes / backslashes / newlines inside a JSON string need escaping
  //
  // We split the value into two substitution tokens:
  //   `{{description}}`       — sanitised for JS comments / Markdown
  //   `{{descriptionJson}}`   — JSON.stringify'd (already includes the
  //                             surrounding quotes), used in package.json
  //                             as `"description": {{descriptionJson}},`
  const rawDescription = args.pluginDescription ?? ''
  const description = sanitizeForJsComment(rawDescription)
  const descriptionJson = JSON.stringify(rawDescription)

  // 3. Derive identifiers ----------------------------------------------------

  // In local mode rawName IS the kebab identifier.
  // In standalone mode rawName is the full package name; extract the last segment.
  // Local mode: rawName is already the kebab identifier the author
  // wants. Standalone mode: rawName is an npm package name; the
  // AmplessPlugin.name is the short identifier after stripping the
  // scope and conventional plugin- / ampless-plugin- prefix.
  const nameKebab = mode === 'local' ? rawName : pluginNameFromPackage(rawName)
  const packageName = mode === 'standalone' ? rawName : nameKebab

  // Re-validate `nameKebab` against the strict kebab pattern. The
  // upstream PACKAGE_NAME_RE / KEBAB_RE checks ran on the raw input,
  // but standalone scaffolds derive `nameKebab` from the input by
  // stripping the npm scope and the conventional `ampless-plugin-` /
  // `plugin-` prefix. Names like `ampless-plugin-123foo` pass the
  // package regex but yield `123foo` after stripping — which then
  // produces a TS identifier starting with a digit and a broken
  // factory name. Catch that here.
  if (!KEBAB_RE.test(nameKebab)) {
    throw new Error(
      `Invalid plugin name: "${nameKebab}" (derived from "${rawName}" by stripping the npm scope and the conventional ampless-plugin- prefix) is not valid kebab-case. ` +
        `Each segment must start with a letter and contain only letters and digits. ` +
        `Examples: "site-verification", "image-zoom".`,
    )
  }

  const nameCamelCase = toCamelCase(nameKebab)
  const NamePascalCase = toPascalCase(nameKebab)
  const DisplayName = toDisplayName(nameKebab)
  void toKebab // defined for completeness; nameKebab already is kebab

  // 4. Validate output directory does not already exist ----------------------

  let outputDir: string

  if (mode === 'local') {
    const problem = validateMountableProject(destDir)
    if (problem) {
      throw new Error(problem)
    }
    outputDir = join(destDir, 'plugins', nameKebab)
    if (existsSync(outputDir)) {
      throw new Error(
        `Plugin directory already exists: plugins/${nameKebab}/\n` +
          `Remove it first or choose a different name.`,
      )
    }
  } else {
    // standalone: output goes to <destDir>/<nameSegment>/
    const nameSegment = lastSegment(rawName)
    outputDir = join(destDir, nameSegment)
    if (existsSync(outputDir)) {
      throw new Error(
        `Directory already exists: ${nameSegment}/\n` +
          `Remove it first or choose a different name.`,
      )
    }
  }

  // 5. Copy template ----------------------------------------------------------

  const templateDir = pluginTemplateDir(mode)
  if (!existsSync(templateDir)) {
    throw new Error(
      `Plugin template not found: ${templateDir}\n` +
        `The ${mode === 'local' ? 'plugin-local' : 'plugin-standalone'} template directory ` +
        `has not been added to the repo yet. Run \`git pull\` to pick up the latest templates.`,
    )
  }

  await mkdir(outputDir, { recursive: true })
  await cp(templateDir, outputDir, { recursive: true })

  // 6. Placeholder substitution ----------------------------------------------

  const capabilitiesList =
    capabilities && capabilities.length > 0
      ? capabilities.map((c) => `'${c}'`).join(', ')
      : ''

  const capabilitiesJsonArray =
    capabilities && capabilities.length > 0
      ? capabilities.map((c) => `"${c}"`).join(', ')
      : ''

  const vars: Record<string, string> = {
    // Use camelCase keys so they survive substituteVars' `\w+` regex.
    // Templates reference them as `{{nameKebab}}` (not `{{name-kebab}}`).
    nameKebab,
    nameCamelCase,
    NameCamelCase: NamePascalCase,
    packageName,
    description,
    descriptionJson,
    trustLevel: trustLevel ?? 'untrusted',
    capabilitiesList,
    capabilitiesJsonArray,
    DisplayName,
    displayNameJa: DisplayName, // same as English for now; maintainers can localise
    amplessVersion: SCAFFOLD_AMPLESS_VERSION,
  }

  await substituteDir(outputDir, vars)

  // 7. Return result ---------------------------------------------------------

  return {
    mode,
    outputDir,
    pluginName: nameKebab,
    packageName: mode === 'standalone' ? packageName : undefined,
  }
}

// ----------------------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------------------

/**
 * CLI wrapper: resolves `destDir` from `process.cwd()`, calls
 * `runCreatePluginIn`, and prints the outcome via `outro()`.
 */
export async function runCreatePlugin(args: ParsedArgs): Promise<void> {
  const destDir = process.cwd()

  try {
    const result = await runCreatePluginIn(destDir, args)

    if (result.mode === 'local') {
      const rel = `plugins/${result.pluginName}/`
      const factoryName = `${toCamelCase(result.pluginName)}Plugin`
      outro(
        `${pc.green('✔')} Plugin scaffolded at ${pc.bold(rel)}\n\n` +
          `  Register it in ${pc.cyan('cms.config.ts')}:\n\n` +
          `    import ${factoryName} from './plugins/${result.pluginName}'\n\n` +
          `    export default defineConfig({\n` +
          `      // ...\n` +
          `      plugins: [\n` +
          `        ${factoryName}(),\n` +
          `      ],\n` +
          `    })\n\n` +
          `  Then restart the dev server to pick up the new plugin.`,
      )
    } else {
      const dirName = result.packageName
        ? lastSegment(result.packageName)
        : result.pluginName
      outro(
        `${pc.green('✔')} Standalone plugin scaffolded at ${pc.bold(dirName + '/')}\n\n` +
          `  Next steps:\n` +
          `    ${pc.cyan(`cd ${dirName}`)}\n` +
          `    ${pc.cyan('pnpm install')}\n` +
          `    ${pc.cyan('pnpm test')}\n` +
          `    ${pc.cyan('pnpm build')}\n` +
          `    ${pc.cyan('pnpm publish --access public --tag beta')}\n\n` +
          `  Then add the published package to your ampless site:\n` +
          `    ${pc.cyan(`pnpm add ${result.packageName ?? result.pluginName}`)}`,
      )
    }
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
