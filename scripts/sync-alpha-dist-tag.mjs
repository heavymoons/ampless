#!/usr/bin/env node
/**
 * Tag every just-published package with the `alpha` npm dist-tag so
 * `npx <pkg>@alpha` resolves to the same version that `@latest` does.
 *
 * Background: in changesets pre-release mode (`.changeset/pre.json`
 * present), `changeset publish` still publishes to the `latest` dist
 * tag by default. The `alpha` tag therefore stays pinned to whatever
 * version was published before pre-mode was entered (alpha.0 here),
 * and `npx create-ampless@alpha` resolves to a long-stale version
 * that doesn't have any of the post-alpha.0 subcommands.
 *
 * This script re-asserts `alpha = <current version>` for every public
 * workspace package. Idempotent — safe to run when no new publish
 * happened (it just re-sets the tag to the same value).
 *
 * Auth: relies on the same `NODE_AUTH_TOKEN` env that `changeset
 * publish` uses in CI. Locally, the user's `~/.npmrc` token works
 * (subject to 2FA for human accounts; automation tokens bypass it).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRE_JSON = join(ROOT, '.changeset', 'pre.json')

// Only sync when we're actually in pre-release mode. Once `changeset
// pre exit` flips the project to stable, the alpha tag should stop
// chasing whatever lands on latest — at that point a former `@alpha`
// install would intentionally pin to the last pre-release.
if (!existsSync(PRE_JSON)) {
  console.log('Not in changesets pre mode (no .changeset/pre.json). Skipping alpha sync.')
  process.exit(0)
}

const PACKAGES_DIR = join(ROOT, 'packages')
const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true })

let success = 0
let skippedPrivate = 0
let skippedAlreadyTagged = 0
let failures = 0

/**
 * Read the current `alpha` dist-tag for `name`, or `null` if it isn't
 * set / the package isn't published / we can't reach the registry. We
 * pre-check before `dist-tag add` because the npm registry returns
 * `400 Bad Request` (not a no-op) for some packages when the requested
 * tag→version already matches — unscoped names like `create-ampless`
 * trip this consistently, scoped names like `@ampless/admin` don't.
 * Pre-checking lets us skip the redundant PUT cleanly.
 */
function currentAlphaVersion(name) {
  try {
    const stdout = execSync(`npm dist-tag ls ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    const m = stdout.match(/^alpha:\s*(\S+)\s*$/m)
    return m ? m[1] : null
  } catch {
    return null
  }
}

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const pkgPath = join(PACKAGES_DIR, entry.name, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    continue
  }
  if (pkg.private || !pkg.name || !pkg.version) {
    skippedPrivate++
    continue
  }
  const target = `${pkg.name}@${pkg.version}`
  const existing = currentAlphaVersion(pkg.name)
  if (existing === pkg.version) {
    skippedAlreadyTagged++
    continue
  }
  try {
    execSync(`npm dist-tag add ${target} alpha`, { stdio: ['ignore', 'inherit', 'inherit'] })
    success++
  } catch (err) {
    failures++
    console.error(`  failed: ${target} — ${err instanceof Error ? err.message : err}`)
  }
}

console.log(
  `alpha dist-tag sync: ${success} synced, ` +
    `${skippedAlreadyTagged} already at target, ` +
    `${skippedPrivate} skipped (private), ` +
    `${failures} failed`
)
if (failures > 0) process.exit(1)
