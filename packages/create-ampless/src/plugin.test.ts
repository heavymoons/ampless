import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCreatePluginIn } from './plugin.js'
import type { ParsedArgs } from './args.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Create a minimal valid ampless project in a tmpdir. */
function makeAmplessProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-plugin-test-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-site',
        version: '0.1.0',
        private: true,
        type: 'module',
        dependencies: { ampless: '^1.0.0-beta.0' },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
  mkdirSync(join(dir, 'amplify'))
  writeFileSync(join(dir, 'amplify', 'backend.ts'), '// backend')
  return dir
}

/** Create a plain tmpdir for standalone scaffold (no ampless project needed). */
function makeStandaloneCwd(): string {
  return mkdtempSync(join(tmpdir(), 'create-plugin-standalone-'))
}

/** Build a ParsedArgs baseline so individual tests only override what they need. */
function baseArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    deploy: false,
    mount: false,
    upgrade: false,
    copyTheme: false,
    createPlugin: true,
    setupEncryptionKey: false,
    gitignore: false,
    dryRun: false,
    noInstall: false,
    githubPrivate: false,
    createIamRole: false,
    skipConfirm: true,
    help: false,
    unknown: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

describe('runCreatePluginIn — local mode', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeAmplessProject()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('scaffolds a local plugin with all placeholders substituted', async () => {
    const args = baseArgs({
      pluginName: 'reading-time',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: 'Reading time estimator',
    })
    const result = await runCreatePluginIn(projectDir, args)

    expect(result.mode).toBe('local')
    expect(result.pluginName).toBe('reading-time')
    expect(existsSync(join(projectDir, 'plugins', 'reading-time', 'index.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'plugins', 'reading-time', 'README.md'))).toBe(true)

    const code = readFileSync(
      join(projectDir, 'plugins', 'reading-time', 'index.ts'),
      'utf-8',
    )
    // placeholders replaced
    expect(code).toContain("name: 'reading-time'")
    expect(code).toContain("trust_level: 'untrusted'")
    expect(code).toContain("'publicHead'")
    // no unreplaced tokens remaining
    expect(code).not.toContain('{{nameKebab}}')
    expect(code).not.toContain('{{NameCamelCase}}')
    expect(code).not.toContain('{{trustLevel}}')
    expect(code).not.toContain('{{capabilitiesList}}')
  })

  it('correctly substitutes PascalCase and camelCase identifiers', async () => {
    const args = baseArgs({
      pluginName: 'reading-time',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    await runCreatePluginIn(projectDir, args)

    const code = readFileSync(
      join(projectDir, 'plugins', 'reading-time', 'index.ts'),
      'utf-8',
    )
    // interface and function names
    expect(code).toContain('ReadingTimeOptions')       // {{NameCamelCase}} → PascalCase
    expect(code).toContain('readingTimePlugin')        // {{nameCamelCase}} → camelCase
  })

  it('expands multiple capabilities into the capabilities array', async () => {
    const args = baseArgs({
      pluginName: 'multi-cap',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead', 'adminSettings'],
    })
    await runCreatePluginIn(projectDir, args)

    const code = readFileSync(
      join(projectDir, 'plugins', 'multi-cap', 'index.ts'),
      'utf-8',
    )
    expect(code).toContain("'publicHead'")
    expect(code).toContain("'adminSettings'")
  })

  it('succeeds when pluginDescription is omitted (undefined)', async () => {
    const args = baseArgs({
      pluginName: 'no-desc',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: undefined,
    })
    const result = await runCreatePluginIn(projectDir, args)
    expect(result.pluginName).toBe('no-desc')
    expect(existsSync(join(projectDir, 'plugins', 'no-desc', 'index.ts'))).toBe(true)
  })

  it('throws when the plugin directory already exists', async () => {
    mkdirSync(join(projectDir, 'plugins', 'reading-time'), { recursive: true })
    writeFileSync(
      join(projectDir, 'plugins', 'reading-time', 'index.ts'),
      '// existing plugin',
    )

    const args = baseArgs({
      pluginName: 'reading-time',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    await expect(runCreatePluginIn(projectDir, args)).rejects.toThrow(
      /Plugin directory already exists/,
    )
  })

  it('throws when the target is not an ampless project (no cms.config.ts)', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'create-plugin-empty-'))
    try {
      const args = baseArgs({
        pluginName: 'my-plugin',
        pluginMode: 'local',
        pluginTrustLevel: 'untrusted',
        pluginCapabilities: ['publicHead'],
      })
      await expect(runCreatePluginIn(emptyDir, args)).rejects.toThrow(
        /Not an ampless project/,
      )
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('returns undefined packageName for local mode', async () => {
    const args = baseArgs({
      pluginName: 'local-only',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    const result = await runCreatePluginIn(projectDir, args)
    expect(result.packageName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Standalone mode
// ---------------------------------------------------------------------------

describe('runCreatePluginIn — standalone mode', () => {
  let cwd: string

  beforeEach(() => {
    cwd = makeStandaloneCwd()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('scaffolds a complete standalone package with all required files', async () => {
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-foo',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead', 'adminSettings'],
      pluginDescription: 'Foo plugin',
    })
    const result = await runCreatePluginIn(cwd, args)

    expect(result.mode).toBe('standalone')
    expect(result.pluginName).toBe('foo')
    expect(result.packageName).toBe('@smoke/ampless-plugin-foo')

    const dir = join(cwd, 'ampless-plugin-foo')
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
    expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(dir, 'tsup.config.ts'))).toBe(true)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'index.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'index.test.ts'))).toBe(true)
  })

  it('generates a package.json with correct name, amplessPlugin metadata, and exports', async () => {
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-foo',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead', 'adminSettings'],
      pluginDescription: 'Foo plugin',
    })
    await runCreatePluginIn(cwd, args)

    const pkgPath = join(cwd, 'ampless-plugin-foo', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    expect(pkg.name).toBe('@smoke/ampless-plugin-foo')
    expect(pkg.amplessPlugin.name).toBe('foo')
    expect(pkg.amplessPlugin.capabilities).toEqual(['publicHead', 'adminSettings'])
    expect(pkg.exports['./package.json']).toBe('./package.json')
  })

  it('generates src/index.ts with correct packageName and name identifiers', async () => {
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-foo',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: 'Foo plugin',
    })
    await runCreatePluginIn(cwd, args)

    const code = readFileSync(
      join(cwd, 'ampless-plugin-foo', 'src', 'index.ts'),
      'utf-8',
    )
    expect(code).toContain("packageName: '@smoke/ampless-plugin-foo'")
    expect(code).toContain("name: 'foo'")
    expect(code).not.toContain('{{packageName}}')
    expect(code).not.toContain('{{nameKebab}}')
  })

  it('handles an unscoped package name correctly', async () => {
    const args = baseArgs({
      pluginName: 'ampless-plugin-bar',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    const result = await runCreatePluginIn(cwd, args)

    expect(result.pluginName).toBe('bar')
    expect(result.packageName).toBe('ampless-plugin-bar')
    const dir = join(cwd, 'ampless-plugin-bar')
    expect(existsSync(dir)).toBe(true)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    expect(pkg.amplessPlugin.name).toBe('bar')
  })

  it('keeps the full name for a plain name with no recognised prefix', async () => {
    const args = baseArgs({
      pluginName: 'weird-name',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    const result = await runCreatePluginIn(cwd, args)

    expect(result.pluginName).toBe('weird-name')
    expect(result.packageName).toBe('weird-name')
    const dir = join(cwd, 'weird-name')
    expect(existsSync(dir)).toBe(true)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    expect(pkg.amplessPlugin.name).toBe('weird-name')
  })

  it('throws when the output directory already exists', async () => {
    mkdirSync(join(cwd, 'ampless-plugin-collision'))
    const args = baseArgs({
      pluginName: 'ampless-plugin-collision',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    await expect(runCreatePluginIn(cwd, args)).rejects.toThrow(
      /Directory already exists/,
    )
  })

  it('stamps the scaffold ampless version into package.json dependencies', async () => {
    const args = baseArgs({
      pluginName: 'ampless-plugin-versioned',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
    })
    await runCreatePluginIn(cwd, args)

    const pkg = JSON.parse(
      readFileSync(join(cwd, 'ampless-plugin-versioned', 'package.json'), 'utf-8'),
    )
    // version must be a semver-ish string starting with ^ and target beta
    expect(pkg.dependencies.ampless).toMatch(/^\^[\d.]+.*beta/)
  })
})

// ---------------------------------------------------------------------------
// pluginNameFromPackage — via scaffold result (indirect)
// ---------------------------------------------------------------------------

describe('pluginNameFromPackage resolution (via standalone scaffold)', () => {
  let cwd: string

  beforeEach(() => {
    cwd = makeStandaloneCwd()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  const cases: Array<[string, string]> = [
    ['@ampless/plugin-gtm', 'gtm'],
    ['@ishinao/ampless-plugin-site-vrfn', 'site-vrfn'],
    ['ampless-plugin-clarity', 'clarity'],
    ['weird-name', 'weird-name'],
  ]

  for (const [packageName, expectedPluginName] of cases) {
    it(`"${packageName}" resolves to pluginName "${expectedPluginName}"`, async () => {
      const args = baseArgs({
        pluginName: packageName,
        pluginMode: 'standalone',
        pluginTrustLevel: 'untrusted',
        pluginCapabilities: ['publicHead'],
      })
      const result = await runCreatePluginIn(cwd, args)
      expect(result.pluginName).toBe(expectedPluginName)

      // Clean up directory so the next case can reuse the same cwd.
      const dirName = packageName.replace(/^@[^/]+\//, '')
      rmSync(join(cwd, dirName), { recursive: true, force: true })
    })
  }
})

// ---------------------------------------------------------------------------
// Defensive: user-supplied flag values that previously corrupted output
// ---------------------------------------------------------------------------

describe('runCreatePluginIn — input sanitisation', () => {
  let cwd: string
  beforeEach(() => {
    cwd = makeStandaloneCwd()
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('--description with quotes produces a valid package.json (JSON.stringify path)', async () => {
    const description = `Bob's "quoted" plugin\ttabs and \\backslashes`
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-quoted',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: description,
      skipConfirm: true,
    })
    await runCreatePluginIn(cwd, args)
    const pkgPath = join(cwd, 'ampless-plugin-quoted', 'package.json')
    // Should parse without throwing.
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.description).toBe(description)
  })

  it('--description with `*/` is escaped so it cannot close the JSDoc early', async () => {
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-stardash',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: 'Closing */ then more code',
      skipConfirm: true,
    })
    await runCreatePluginIn(cwd, args)
    const code = readFileSync(
      join(cwd, 'ampless-plugin-stardash', 'src', 'index.ts'),
      'utf-8',
    )
    // The sanitised form (asterisk-backslash-slash) appears in the file...
    expect(code).toContain('Closing *\\/ then more code')
    // ...and the raw `*/` from the description does NOT appear inside
    // a docstring line (which would terminate the comment early).
    // Each JSDoc line starts with ` * ` (space-asterisk-space); the
    // input description, if unescaped, would produce one matching this
    // regex.
    expect(code).not.toMatch(/^\s*\*\s.*Closing \*\/[^\\]/m)
    // The generated TS still parses — a sanity check is enough; the
    // build step in CI proves we didn't break anything structural.
  })

  it('--description with newlines collapses to a single line in JS comment', async () => {
    const args = baseArgs({
      pluginName: '@smoke/ampless-plugin-multiline',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      pluginDescription: 'First line\nSecond line\n\nFourth line',
      skipConfirm: true,
    })
    await runCreatePluginIn(cwd, args)
    const code = readFileSync(
      join(cwd, 'ampless-plugin-multiline', 'src', 'index.ts'),
      'utf-8',
    )
    expect(code).toContain('First line Second line Fourth line')
    // No raw newline inside the description token.
    expect(code).not.toContain('First line\nSecond line')
  })
})

// ---------------------------------------------------------------------------
// Defensive: strict name validation
// ---------------------------------------------------------------------------

describe('runCreatePluginIn — name validation', () => {
  let projectDir: string
  let standaloneDir: string

  beforeEach(() => {
    projectDir = makeAmplessProject()
    standaloneDir = makeStandaloneCwd()
  })
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(standaloneDir, { recursive: true, force: true })
  })

  it('rejects a local name with a trailing hyphen', async () => {
    const args = baseArgs({
      pluginName: 'foo-',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      skipConfirm: true,
    })
    await expect(runCreatePluginIn(projectDir, args)).rejects.toThrow(/Invalid plugin name/)
  })

  it('rejects a local name with double hyphens', async () => {
    const args = baseArgs({
      pluginName: 'foo--bar',
      pluginMode: 'local',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      skipConfirm: true,
    })
    await expect(runCreatePluginIn(projectDir, args)).rejects.toThrow(/Invalid plugin name/)
  })

  it('rejects a standalone name where the stripped tail is digit-only', async () => {
    // Strict pattern rejects this at the package-name level (segment
    // must start with a letter), so the error message references the
    // npm-package shape; either error proves the bad form is blocked.
    const args = baseArgs({
      pluginName: 'ampless-plugin-123',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      skipConfirm: true,
    })
    await expect(runCreatePluginIn(standaloneDir, args)).rejects.toThrow(/Invalid plugin name/)
  })

  it('rejects a standalone name where the stripped tail begins with a digit', async () => {
    // Package-name regex catches `123foo` segment as invalid.
    const args = baseArgs({
      pluginName: 'ampless-plugin-123foo',
      pluginMode: 'standalone',
      pluginTrustLevel: 'untrusted',
      pluginCapabilities: ['publicHead'],
      skipConfirm: true,
    })
    await expect(runCreatePluginIn(standaloneDir, args)).rejects.toThrow(/Invalid plugin name/)
  })
})

// ---------------------------------------------------------------------------
// Defensive: --skip-confirm wires defaults instead of blocking on prompts
// ---------------------------------------------------------------------------

describe('runCreatePluginIn — --skip-confirm fills defaults', () => {
  let projectDir: string
  beforeEach(() => {
    projectDir = makeAmplessProject()
  })
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('falls back to "untrusted" + ["publicHead","adminSettings"] when --skip-confirm and no flags', async () => {
    const args = baseArgs({
      pluginName: 'ci-default',
      pluginMode: 'local',
      // Note: NO pluginTrustLevel, NO pluginCapabilities
      skipConfirm: true,
    })
    // Without skipConfirm this would hang waiting for `select`/`multiselect`.
    // The test passes iff the call completes without blocking, picking
    // the documented defaults.
    const result = await runCreatePluginIn(projectDir, args)
    expect(result.pluginName).toBe('ci-default')
    const code = readFileSync(
      join(projectDir, 'plugins', 'ci-default', 'index.ts'),
      'utf-8',
    )
    expect(code).toContain("trust_level: 'untrusted'")
    expect(code).toContain("'publicHead'")
    expect(code).toContain("'adminSettings'")
  })

  it('throws (does not prompt) when --skip-confirm is set and the plugin name is missing', async () => {
    // --skip-confirm has no documented default for the positional name
    // — the prompt is the only path that fills it in. With skip-confirm
    // on, fall through to a hard error so CI / scripted runs never
    // block on a TTY.
    const args = baseArgs({
      // pluginName intentionally omitted
      pluginMode: 'local',
      skipConfirm: true,
    })
    await expect(runCreatePluginIn(projectDir, args)).rejects.toThrow(
      /Plugin name is required when --skip-confirm is set/,
    )
  })

  it('throws (does not prompt) when --skip-confirm is set and the standalone plugin name is missing', async () => {
    const cwd = makeStandaloneCwd()
    try {
      const args = baseArgs({
        pluginMode: 'standalone',
        skipConfirm: true,
      })
      await expect(runCreatePluginIn(cwd, args)).rejects.toThrow(
        /Plugin package name is required when --skip-confirm is set/,
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
