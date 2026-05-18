import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateMountableProject, originPointsAt, MOUNT_DEFAULT_GITIGNORE } from './mount.js'

describe('validateMountableProject', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ampless-mount-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an error message when package.json is missing', () => {
    expect(validateMountableProject(dir)).toMatch(/missing package\.json/)
  })

  it('returns an error message when cms.config.ts is missing', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(validateMountableProject(dir)).toMatch(/missing cms\.config\.ts/)
  })

  it('returns an error when amplify/ is missing', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
    expect(validateMountableProject(dir)).toMatch(/missing amplify/)
  })

  it('returns null when amplify/backend.ts is present', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
    mkdirSync(join(dir, 'amplify'))
    writeFileSync(join(dir, 'amplify', 'backend.ts'), '// ...')
    expect(validateMountableProject(dir)).toBeNull()
  })

  it('returns null when amplify/data/resource.ts is present (newer layout)', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
    mkdirSync(join(dir, 'amplify', 'data'), { recursive: true })
    writeFileSync(join(dir, 'amplify', 'data', 'resource.ts'), '// ...')
    expect(validateMountableProject(dir)).toBeNull()
  })
})

describe('originPointsAt', () => {
  const owner = 'ishinao'
  const name = 'ishinao.net'

  it('accepts canonical https url', () => {
    expect(originPointsAt('https://github.com/ishinao/ishinao.net', owner, name)).toBe(true)
  })
  it('accepts https url with .git suffix', () => {
    expect(originPointsAt('https://github.com/ishinao/ishinao.net.git', owner, name)).toBe(true)
  })
  it('accepts ssh form (gh repo create default)', () => {
    expect(originPointsAt('git@github.com:ishinao/ishinao.net.git', owner, name)).toBe(true)
    expect(originPointsAt('git@github.com:ishinao/ishinao.net', owner, name)).toBe(true)
  })
  it('rejects a different repo', () => {
    expect(originPointsAt('https://github.com/other/repo', owner, name)).toBe(false)
  })
  it('rejects bare strings', () => {
    expect(originPointsAt('', owner, name)).toBe(false)
    expect(originPointsAt('github.com/ishinao/ishinao.net', owner, name)).toBe(false)
  })
})

describe('MOUNT_DEFAULT_GITIGNORE', () => {
  it('excludes amplify_outputs.json and node_modules', () => {
    expect(MOUNT_DEFAULT_GITIGNORE).toMatch(/^amplify_outputs\.json$/m)
    expect(MOUNT_DEFAULT_GITIGNORE).toMatch(/^node_modules\//m)
    expect(MOUNT_DEFAULT_GITIGNORE).toMatch(/^\.next\//m)
  })
})
