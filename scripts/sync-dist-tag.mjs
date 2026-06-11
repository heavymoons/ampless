#!/usr/bin/env node
/**
 * Tag every just-published package with the current pre-release npm
 * dist-tag (e.g. `alpha` or `beta`) so `npx <pkg>@alpha` (or `@beta`)
 * resolves to the same version that `@latest` does.
 *
 * Additionally, while a package has NO stable release yet, `latest` is
 * kept tracking the active pre-release channel as well. Rationale: with
 * no stable to point at, a bare `npm install <pkg>` (= `@latest`) would
 * otherwise serve whatever stale pre-release happened to be tagged last
 * (observed post-beta-flip: `latest` still served old alphas). The
 * tracking self-deactivates the moment a stable version owns `latest`:
 * if the current `latest` value has no prerelease suffix, the script
 * never touches it again — `npm publish` of stable versions manages
 * `latest` natively from then on, and later pre-release cycles (e.g.
 * 1.1.0-beta.*) only move their own channel tag.
 *
 * Background: in changesets pre-release mode (`.changeset/pre.json`
 * present), `changeset publish` still publishes to the `latest` dist
 * tag by default. The pre-release tag therefore stays pinned to whatever
 * version was published before pre-mode was entered (alpha.0 here),
 * and `npx create-ampless@alpha` resolves to a long-stale version
 * that doesn't have any of the post-alpha.0 subcommands.
 *
 * This script re-asserts `<dist-tag> = <current version>` for every
 * public workspace package whose `package.json` version's prerelease
 * identifier matches the dist-tag in `pre.json`. Idempotent — safe to
 * run when no new publish happened (it just re-sets the tag to the same
 * value).
 *
 * Auth: relies on the same `NODE_AUTH_TOKEN` env that `changeset
 * publish` uses in CI. Locally, the user's `~/.npmrc` token works
 * (subject to 2FA for human accounts; automation tokens bypass it).
 *
 * NOTE: Do NOT run this script locally unless you understand the
 * consequences — it has no dry-run mode and will call `npm dist-tag add`
 * against live npm if `~/.npmrc` has a token.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRE_JSON = join(ROOT, '.changeset', 'pre.json')

// Only sync when we're actually in pre-release mode. Once `changeset
// pre exit` flips the project to stable, the pre-release tag should
// stop chasing whatever lands on latest — at that point a former
// `@alpha` install would intentionally pin to the last pre-release.
if (!existsSync(PRE_JSON)) {
  console.log('Not in changesets pre mode (no .changeset/pre.json). Skipping dist-tag sync.')
  process.exit(0)
}

const preJson = JSON.parse(readFileSync(PRE_JSON, 'utf8'))
const distTag = preJson.tag // 'alpha' or 'beta' (or whatever future pre tag)
if (!distTag || typeof distTag !== 'string') {
  console.error('pre.json#tag is missing or not a string; aborting')
  process.exit(1)
}

console.log(`dist-tag sync starting (dist-tag: ${distTag})`)

const PACKAGES_DIR = join(ROOT, 'packages')
const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true })

let success = 0
let latestSynced = 0
let skippedPrivate = 0
let skippedAlreadyTagged = 0
let skippedLatestAlready = 0
let skippedLatestStable = 0
let skippedPrereleaseMismatch = 0
let failures = 0

/**
 * Read all current dist-tags for `name` as a `{ tag: version }` map, or
 * `{}` if the package isn't published / we can't reach the registry. We
 * pre-check before `dist-tag add` because the npm registry returns
 * `400 Bad Request` (not a no-op) for some packages when the requested
 * tag→version already matches — unscoped names like `create-ampless`
 * trip this consistently, scoped names like `@ampless/admin` don't.
 * Pre-checking lets us skip the redundant PUT cleanly. One `dist-tag ls`
 * per package serves both the pre-tag check and the `latest` check.
 */
function currentTags(name) {
  try {
    const stdout = execSync(`npm dist-tag ls ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    const tags = {}
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(\S+):\s*(\S+)\s*$/)
      if (m) tags[m[1]] = m[2]
    }
    return tags
  } catch {
    return {}
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

  // Version-prerelease integrity guard: skip packages whose pkg.version
  // prerelease identifier does not match pre.json.tag. This prevents
  // tagging an alpha-versioned tarball as beta (or vice versa) when the
  // pre.json.tag has been flipped but not every package was bumped yet.
  //
  // During normal alpha operation (pre.json.tag === 'alpha' and every
  // public package is on 1.0.0-alpha.<N>), prereleaseTag === 'alpha' ===
  // distTag for all packages — so this guard is a complete no-op.
  const prereleaseTag = pkg.version.match(/-([a-z]+)\./)?.[1]
  if (prereleaseTag !== distTag) {
    console.warn(
      `[skip] ${pkg.name}@${pkg.version} prerelease identifier '${prereleaseTag ?? '(none)'}' ` +
        `does not match pre.json.tag '${distTag}'`
    )
    skippedPrereleaseMismatch++
    continue
  }

  const target = `${pkg.name}@${pkg.version}`
  const tags = currentTags(pkg.name)

  if (tags[distTag] === pkg.version) {
    skippedAlreadyTagged++
  } else {
    try {
      execSync(`npm dist-tag add ${target} ${distTag}`, {
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      success++
    } catch (err) {
      failures++
      console.error(`  failed: ${target} — ${err instanceof Error ? err.message : err}`)
    }
  }

  // `latest` tracking — ONLY while no stable release owns the tag.
  // Guard: a stable `latest` (no '-' prerelease suffix) means the
  // package has shipped 1.0.0+; from then on `npm publish` manages
  // `latest` natively and this script must never move it (a 1.1.0-beta
  // cycle would otherwise yank `latest` off the stable release).
  const latest = tags['latest']
  if (latest && !latest.includes('-')) {
    skippedLatestStable++
  } else if (latest === pkg.version) {
    skippedLatestAlready++
  } else {
    try {
      execSync(`npm dist-tag add ${target} latest`, {
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      latestSynced++
    } catch (err) {
      failures++
      console.error(`  failed (latest): ${target} — ${err instanceof Error ? err.message : err}`)
    }
  }
}

console.log(
  `dist-tag sync (dist-tag: ${distTag}): ${success} synced, ` +
    `${skippedAlreadyTagged} already at target, ` +
    `latest: ${latestSynced} synced, ${skippedLatestAlready} already at target, ` +
    `${skippedLatestStable} left to stable, ` +
    `${skippedPrivate} skipped (private), ` +
    `${skippedPrereleaseMismatch} skipped (prerelease mismatch), ` +
    `${failures} failed`
)
if (failures > 0) process.exit(1)
