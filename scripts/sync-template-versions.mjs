#!/usr/bin/env node
/**
 * Sync `templates/_shared/package.json` deps for ampless packages to match
 * the current versions in `packages/<name>/package.json`.
 *
 * Runs after `changeset version` so the scaffolded project always points at
 * the same npm versions we're about to publish. Without this, scaffolded
 * projects would carry stale `^0.0.1` refs and `npm install` would fail.
 *
 * Skips packages that aren't supposed to land in user projects:
 *   - `create-ampless` (the scaffolder itself)
 *   - `@ampless/mcp-server` (installed globally / via npx, not as a dep)
 *
 * Re-runnable: idempotent. Safe to invoke before/after a publish.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const SHARED_PKG = join(ROOT, 'templates', '_shared', 'package.json')

// Packages that should NOT be added to template deps. They're either the
// scaffolder itself or tools the user installs out-of-band.
const SKIP = new Set(['create-ampless', '@ampless/mcp-server'])

/** Read each `packages/<dir>/package.json` and return {name -> version}. */
function readPackageVersions() {
  const map = new Map()
  for (const dir of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const pkgPath = join(PACKAGES_DIR, dir.name, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.name && pkg.version) map.set(pkg.name, pkg.version)
    } catch {
      // missing package.json — skip
    }
  }
  return map
}

function updateDepsSection(deps, versions) {
  if (!deps) return { changed: false, deps }
  let changed = false
  for (const [name, version] of versions) {
    if (SKIP.has(name)) continue
    if (deps[name] === undefined) continue // only update entries already present
    const range = `^${version}`
    if (deps[name] !== range) {
      deps[name] = range
      changed = true
    }
  }
  return { changed, deps }
}

function main() {
  const versions = readPackageVersions()
  const shared = JSON.parse(readFileSync(SHARED_PKG, 'utf8'))

  const before = JSON.stringify(shared, null, 2)
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (shared[section]) {
      updateDepsSection(shared[section], versions)
    }
  }
  const after = JSON.stringify(shared, null, 2) + '\n'

  if (after.trimEnd() === before.trimEnd()) {
    console.log('sync-template-versions: templates/_shared/package.json already in sync')
    return
  }

  writeFileSync(SHARED_PKG, after)
  console.log('sync-template-versions: updated templates/_shared/package.json')
  for (const [name, version] of versions) {
    if (SKIP.has(name)) continue
    console.log(`  ${name} -> ^${version}`)
  }
}

main()
