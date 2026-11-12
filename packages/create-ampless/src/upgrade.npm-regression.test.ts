import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runUpgradeIn } from './upgrade.js'

// Real-npm regression for `next` overrides (EOVERRIDE). Needs network
// (npm resolves metadata), so it is opt-in and NOT part of the default
// suite:  VERIFY_NPM=1 pnpm --filter create-ampless test src/upgrade.npm-regression
const enabled = process.env['VERIFY_NPM'] === '1'

function npmLockOnly(dir: string): { status: number | null; stderr: string } {
  const r = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' })
  return { status: r.status, stderr: r.stderr }
}

async function upgradeProject(overrides: Record<string, unknown>): Promise<{ dir: string; pkgPath: string }> {
  const proj = mkdtempSync(join(tmpdir(), 'ampless-npmreg-p-'))
  const tpl = mkdtempSync(join(tmpdir(), 'ampless-npmreg-t-'))
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { next: '^16.2.6' }, overrides }))
  writeFileSync(join(proj, 'cms.config.ts'), '1')
  mkdirSync(join(proj, 'amplify'))
  writeFileSync(join(proj, 'amplify/backend.ts'), '1')
  writeFileSync(join(tpl, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { next: '^16.4.6' } }))
  mkdirSync(join(tpl, 'amplify'))
  writeFileSync(join(tpl, 'amplify/backend.ts'), '1')
  writeFileSync(join(tpl, 'cms.config.ts'), '1')
  await runUpgradeIn(proj, tpl, { noInstall: true })
  rmSync(tpl, { recursive: true, force: true })
  return { dir: proj, pkgPath: join(proj, 'package.json') }
}

describe.skipIf(!enabled)('real npm: upgraded package.json installs (no EOVERRIDE)', { timeout: 120_000 }, () => {
  it.each([
    ['exact equal override', { next: '^16.2.6' }],
    ['$next', { next: '$next' }],
    ['selector key (bump skipped)', { 'next@^16.2.6': '^16.2.6' }],
    ['selector next@16 (bump skipped)', { 'next@16': '^16.2.6' }],
    ['nested selector under another package', { '@ampless/admin': { 'next@^16.2.6': '^16.2.6' } }],
  ])('%s', async (_n, overrides) => {
    const { dir } = await upgradeProject(overrides)
    try {
      const r = npmLockOnly(dir)
      expect(r.stderr).not.toMatch(/EOVERRIDE/)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('control: raising only the dependency under a selector override fails with EOVERRIDE', async () => {
    const { dir, pkgPath } = await upgradeProject({ 'next@^16.2.6': '^16.2.6' })
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      pkg.dependencies.next = '^16.4.6'
      writeFileSync(pkgPath, JSON.stringify(pkg))
      const r = npmLockOnly(dir)
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/EOVERRIDE/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
