import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runUpgradeIn } from './upgrade.js'

// Minimal valid ampless project package.json for test sites
function makeProjectPkg(extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      name: 'my-test-site',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'next dev',
        'my-script': 'echo hello',
      },
      dependencies: {
        'ampless': '^0.1.0-alpha.0',
        '@ampless/admin': '^0.1.0-alpha.0',
        'react': '^19.0.0',
        'my-own-dep': '^1.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
      ...extra,
    },
    null,
    2,
  ) + '\n'
}

// Minimal template package.json
function makeTemplatePkg(): string {
  return JSON.stringify(
    {
      name: '{{projectName}}',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'next dev',
        'update-ampless': 'npx create-ampless@alpha upgrade',
      },
      dependencies: {
        'ampless': '^0.2.0-alpha.1',
        '@ampless/admin': '^0.2.0-alpha.6',
        '@ampless/backend': '^0.2.0-alpha.2',
        '@ampless/runtime': '^0.2.0-alpha.3',
        '@ampless/plugin-seo': '^0.2.0-alpha.1',
        'react': '^19.0.0',
      },
      devDependencies: {
        typescript: '^6.0.0',
      },
    },
    null,
    2,
  ) + '\n'
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ampless-upgrade-test-'))
  writeFileSync(join(dir, 'package.json'), makeProjectPkg())
  writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
  mkdirSync(join(dir, 'amplify'))
  writeFileSync(join(dir, 'amplify', 'backend.ts'), '// backend')
  return dir
}

function makeTemplateDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ampless-upgrade-template-'))

  // default minimal template files
  writeFileSync(join(dir, 'package.json'), makeTemplatePkg())
  mkdirSync(join(dir, 'amplify'), { recursive: true })
  writeFileSync(join(dir, 'amplify', 'backend.ts'), '// template backend')
  writeFileSync(join(dir, 'cms.config.ts'), '// template cms.config')
  mkdirSync(join(dir, 'app', '(admin)', 'admin'), { recursive: true })
  writeFileSync(join(dir, 'app', '(admin)', 'admin', 'page.tsx'), '// template admin page')

  // additional files from caller
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }

  return dir
}

describe('runUpgradeIn', () => {
  let projectDir: string
  let templateDir: string

  beforeEach(() => {
    projectDir = makeProjectDir()
    templateDir = makeTemplateDir()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(templateDir, { recursive: true, force: true })
  })

  // 1. validate failure: non-ampless dir → throws
  it('throws when the target is not an ampless project', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ampless-upgrade-empty-'))
    try {
      await expect(
        runUpgradeIn(emptyDir, templateDir, { dryRun: true, noInstall: true }),
      ).rejects.toThrow(/Not an ampless project/)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  // 2. dry-run: no files changed
  it('dry-run: writes nothing to disk', async () => {
    const beforePkg = readFileSync(join(projectDir, 'package.json'), 'utf-8')

    await runUpgradeIn(projectDir, templateDir, { dryRun: true, noInstall: true })

    const afterPkg = readFileSync(join(projectDir, 'package.json'), 'utf-8')
    expect(afterPkg).toBe(beforePkg)
  })

  // 3. add new file: template has a file not in project → added
  it('adds a file that exists in template but not in project', async () => {
    const newFilePath = join(projectDir, 'app', '(admin)', 'admin', 'page.tsx')
    expect(existsSync(newFilePath)).toBe(false)

    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(newFilePath)).toBe(true)
    const content = readFileSync(newFilePath, 'utf-8')
    expect(content).toBe('// template admin page')
  })

  // 4. replace: site has old content → template content wins
  it('overwrites an existing file with template content', async () => {
    writeFileSync(join(projectDir, 'amplify', 'backend.ts'), '// OLD backend')

    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    const content = readFileSync(join(projectDir, 'amplify', 'backend.ts'), 'utf-8')
    expect(content).toBe('// template backend')
  })

  // 5. protected cms.config.ts: edited by user → untouched
  it('does not overwrite cms.config.ts (protected)', async () => {
    const userContent = 'export default { sites: ["my-site"] }'
    writeFileSync(join(projectDir, 'cms.config.ts'), userContent)

    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    const after = readFileSync(join(projectDir, 'cms.config.ts'), 'utf-8')
    expect(after).toBe(userContent)
  })

  // 6. protected themes/: user's theme file → untouched
  it('does not touch files under themes/ (protected)', async () => {
    const customThemePath = join(projectDir, 'themes', 'blog', 'page.tsx')
    mkdirSync(join(projectDir, 'themes', 'blog'), { recursive: true })
    writeFileSync(customThemePath, '// my custom theme page')

    // template with a themes/ file to ensure the protected guard runs
    const tplWithTheme = makeTemplateDir({
      'themes/blog/page.tsx': '// template theme page',
    })
    try {
      await runUpgradeIn(projectDir, tplWithTheme, { noInstall: true })
      const after = readFileSync(customThemePath, 'utf-8')
      expect(after).toBe('// my custom theme page')
    } finally {
      rmSync(tplWithTheme, { recursive: true, force: true })
    }
  })

  // 7. package.json merge: ampless deps updated, other deps/scripts untouched
  it('merges ampless deps and update-ampless script but leaves other keys intact', async () => {
    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    const merged = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))

    // ampless deps bumped to template versions
    expect(merged.dependencies['ampless']).toBe('^0.2.0-alpha.1')
    expect(merged.dependencies['@ampless/admin']).toBe('^0.2.0-alpha.6')

    // new ampless dep from template added
    expect(merged.dependencies['@ampless/backend']).toBe('^0.2.0-alpha.2')

    // non-ampless dep untouched
    expect(merged.dependencies['react']).toBe('^19.0.0')
    expect(merged.dependencies['my-own-dep']).toBe('^1.0.0')

    // project name and version untouched
    expect(merged.name).toBe('my-test-site')
    expect(merged.version).toBe('0.1.0')

    // user's own script untouched
    expect(merged.scripts['my-script']).toBe('echo hello')

    // update-ampless script set from template
    expect(merged.scripts['update-ampless']).toBe('npx create-ampless@alpha upgrade')
  })

  // 8a. seed-if-missing *.custom.ts: project lacks the stub → upgrade adds it
  it('seeds *.custom.ts stubs into projects that do not have them yet', async () => {
    // Pre-2026-05 scaffolds shipped without the extension stubs. The
    // matching resource.ts / backend.ts now import './*.custom.js', so
    // a missing stub would break the build — upgrade has to seed them.
    const stub = 'export function customSchemaModels(_a: any): Record<string, unknown> { return {} }'
    const tplWithCustom = makeTemplateDir({
      'amplify/data/resource.custom.ts': stub,
      'amplify/backend.custom.ts': 'export function customizeBackend(_b: any): void {}',
    })
    try {
      // Sanity: project starts without the stubs.
      expect(existsSync(join(projectDir, 'amplify', 'data', 'resource.custom.ts'))).toBe(false)
      expect(existsSync(join(projectDir, 'amplify', 'backend.custom.ts'))).toBe(false)

      const result = await runUpgradeIn(projectDir, tplWithCustom, { noInstall: true })

      expect(existsSync(join(projectDir, 'amplify', 'data', 'resource.custom.ts'))).toBe(true)
      expect(existsSync(join(projectDir, 'amplify', 'backend.custom.ts'))).toBe(true)
      expect(readFileSync(join(projectDir, 'amplify', 'data', 'resource.custom.ts'), 'utf-8')).toBe(stub)
      expect(result.seeded).toContain('amplify/data/resource.custom.ts')
      expect(result.seeded).toContain('amplify/backend.custom.ts')
    } finally {
      rmSync(tplWithCustom, { recursive: true, force: true })
    }
  })

  // 8b. protected *.custom.ts: user's extension file → untouched
  it('does not overwrite *.custom.ts files (protected)', async () => {
    const userContent = `
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { backend } from './backend.js'

backend.processorTrusted.resources.lambda.addToRolePolicy(
  new PolicyStatement({ effect: Effect.ALLOW, actions: ['ses:SendEmail'], resources: ['*'] })
)

export {}
`
    // Write user's custom extension into the project
    writeFileSync(join(projectDir, 'amplify', 'backend.custom.ts'), userContent)

    // Template also ships a backend.custom.ts (the empty scaffold)
    const tplWithCustom = makeTemplateDir({
      'amplify/backend.custom.ts': 'export {}',
      'amplify/data/resource.custom.ts':
        'export function customSchemaModels(_a: any): Record<string, unknown> { return {} }',
    })
    try {
      await runUpgradeIn(projectDir, tplWithCustom, { noInstall: true })
      const after = readFileSync(join(projectDir, 'amplify', 'backend.custom.ts'), 'utf-8')
      expect(after).toBe(userContent)
    } finally {
      rmSync(tplWithCustom, { recursive: true, force: true })
    }
  })

  // substituteVars: {{projectName}} in replaced file uses project's name
  it('substitutes {{projectName}} in replaced text files', async () => {
    mkdirSync(join(templateDir, 'lib'), { recursive: true })
    writeFileSync(join(templateDir, 'lib', 'site.ts'), 'export const name = "{{projectName}}"')

    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    const content = readFileSync(join(projectDir, 'lib', 'site.ts'), 'utf-8')
    expect(content).toBe('export const name = "my-test-site"')
  })
})
