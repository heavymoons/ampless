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
        'update-ampless': 'npx create-ampless@latest upgrade',
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
    const userContent = 'export default { site: { name: "my-site", url: "https://my-site.example.com" } }'
    writeFileSync(join(projectDir, 'cms.config.ts'), userContent)

    await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    const after = readFileSync(join(projectDir, 'cms.config.ts'), 'utf-8')
    expect(after).toBe(userContent)
  })

  // 5b. protected tsconfig.json: Next.js mutates this during build
  // (jsx: "preserve" → "react-jsx", appends .next/dev/types/**/*.ts to
  // `include`). Treating it as `replace` would overwrite those
  // mutations on every upgrade, producing a dirty diff that Next.js
  // immediately re-creates on the next build.
  it('does not overwrite tsconfig.json (protected)', async () => {
    const projectTsconfig = JSON.stringify(
      {
        compilerOptions: { jsx: 'react-jsx', strict: true },
        include: ['next-env.d.ts', '.next/dev/types/**/*.ts', '**/*.ts', '**/*.tsx'],
      },
      null,
      2,
    )
    writeFileSync(join(projectDir, 'tsconfig.json'), projectTsconfig)

    const templateTsconfig = JSON.stringify(
      {
        compilerOptions: { jsx: 'preserve', strict: true },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
      },
      null,
      2,
    )
    const tplWithTsconfig = makeTemplateDir({ 'tsconfig.json': templateTsconfig })
    try {
      await runUpgradeIn(projectDir, tplWithTsconfig, { noInstall: true })
      const after = readFileSync(join(projectDir, 'tsconfig.json'), 'utf-8')
      expect(after).toBe(projectTsconfig)
    } finally {
      rmSync(tplWithTsconfig, { recursive: true, force: true })
    }
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

  // 6b. protected plugins/: site-local plugin files → untouched. The
  // template seeds a README into plugins/ on initial scaffold; once
  // the directory exists everything inside is user territory (mirrors
  // the themes/my-* convention for user-customised themes).
  it('does not touch files under plugins/ (protected)', async () => {
    const userPluginPath = join(projectDir, 'plugins', 'reading-time', 'index.ts')
    mkdirSync(join(projectDir, 'plugins', 'reading-time'), { recursive: true })
    writeFileSync(userPluginPath, '// my site-local plugin')

    const userReadmePath = join(projectDir, 'plugins', 'README.md')
    writeFileSync(userReadmePath, '# my customised plugins README')

    // Template ships a different version of both files to ensure the
    // protected guard runs.
    const tplWithPlugins = makeTemplateDir({
      'plugins/README.md': '# template README',
      'plugins/reading-time/index.ts': '// template plugin (should never reach the project)',
    })
    try {
      await runUpgradeIn(projectDir, tplWithPlugins, { noInstall: true })
      expect(readFileSync(userPluginPath, 'utf-8')).toBe('// my site-local plugin')
      expect(readFileSync(userReadmePath, 'utf-8')).toBe(
        '# my customised plugins README',
      )
    } finally {
      rmSync(tplWithPlugins, { recursive: true, force: true })
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
    expect(merged.scripts['update-ampless']).toBe('npx create-ampless@latest upgrade')
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

describe('runUpgradeIn — obsolete file cleanup', () => {
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

  // 1. Template no longer has a file → user copy is deleted
  it('deletes a file in a managed path that no longer exists in the template', async () => {
    // Scaffold an old route shell in the user's project
    mkdirSync(join(projectDir, 'app', 'api', 'mcp'), { recursive: true })
    writeFileSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'), '// old mcp route')

    // Template does NOT have app/api/mcp/
    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'))).toBe(false)
    expect(existsSync(join(projectDir, 'app', 'api', 'mcp'))).toBe(false)
    expect(result.obsoleteRemoved).toContain('app/api/mcp/route.ts')
  })

  // 2. dry-run: obsolete file is reported but NOT deleted
  it('dry-run: reports obsolete files but does not delete them', async () => {
    mkdirSync(join(projectDir, 'app', 'api', 'mcp'), { recursive: true })
    writeFileSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'), '// old mcp route')

    const result = await runUpgradeIn(projectDir, templateDir, { dryRun: true, noInstall: true })

    // File survives dry-run
    expect(existsSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'))).toBe(true)
    // But it's still listed in the result
    expect(result.obsoleteRemoved).toContain('app/api/mcp/route.ts')
  })

  // 3. Files outside managed paths are never touched
  it('does not touch user-owned files outside managed paths', async () => {
    mkdirSync(join(projectDir, 'app', 'blog'), { recursive: true })
    writeFileSync(join(projectDir, 'app', 'blog', 'page.tsx'), '// user blog page')

    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(join(projectDir, 'app', 'blog', 'page.tsx'))).toBe(true)
    expect(result.obsoleteRemoved).not.toContain('app/blog/page.tsx')
  })

  // 4. Files that exist in both user and template are preserved
  it('does not delete a managed-path file that still exists in the template', async () => {
    // User already has admin page (template also ships it via makeTemplateDir)
    mkdirSync(join(projectDir, 'app', '(admin)', 'admin'), { recursive: true })
    writeFileSync(join(projectDir, 'app', '(admin)', 'admin', 'page.tsx'), '// user admin page')

    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    // File is overwritten by the replace logic, but not removed by the cleanup
    expect(existsSync(join(projectDir, 'app', '(admin)', 'admin', 'page.tsx'))).toBe(true)
    expect(result.obsoleteRemoved).not.toContain('app/(admin)/admin/page.tsx')
  })

  // 5. Directory-level retire: multiple orphan files + empty dir pruned
  it('removes all files when the entire managed directory is retired', async () => {
    mkdirSync(join(projectDir, 'app', 'api', 'mcp'), { recursive: true })
    writeFileSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'), '// route')
    writeFileSync(join(projectDir, 'app', 'api', 'mcp', 'utils.ts'), '// utils')

    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(join(projectDir, 'app', 'api', 'mcp', 'route.ts'))).toBe(false)
    expect(existsSync(join(projectDir, 'app', 'api', 'mcp', 'utils.ts'))).toBe(false)
    expect(existsSync(join(projectDir, 'app', 'api', 'mcp'))).toBe(false)
    expect(result.obsoleteRemoved).toContain('app/api/mcp/route.ts')
    expect(result.obsoleteRemoved).toContain('app/api/mcp/utils.ts')
  })

  // 6. Whitelist boundary: app/api/posts is not managed even though app/api/admin is
  it('does not treat app/api/posts as managed just because app/api/admin is listed', async () => {
    mkdirSync(join(projectDir, 'app', 'api', 'posts'), { recursive: true })
    writeFileSync(join(projectDir, 'app', 'api', 'posts', 'route.ts'), '// user posts api')

    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(join(projectDir, 'app', 'api', 'posts', 'route.ts'))).toBe(true)
    expect(result.obsoleteRemoved).not.toContain('app/api/posts/route.ts')
  })

  // 7. Retired files whitelist: leaves an unrelated file in lib/ alone
  it('leaves an unrelated file in lib/ alone', async () => {
    mkdirSync(join(projectDir, 'lib'), { recursive: true })
    writeFileSync(join(projectDir, 'lib', 'my-custom-helper.ts'), '// user custom helper')

    const result = await runUpgradeIn(projectDir, templateDir, { noInstall: true })

    expect(existsSync(join(projectDir, 'lib', 'my-custom-helper.ts'))).toBe(true)
    expect(result.obsoleteRemoved).not.toContain('lib/my-custom-helper.ts')
  })
})
