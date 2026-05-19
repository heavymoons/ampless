import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCopyThemeIn } from './copy-theme.js'

function makeAmplessProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ampless-copytheme-test-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', type: 'module' }, null, 2),
  )
  writeFileSync(join(dir, 'cms.config.ts'), 'export default {}')
  mkdirSync(join(dir, 'amplify'))
  writeFileSync(join(dir, 'amplify', 'backend.ts'), '// backend')
  // Seed a minimal blog theme.
  const blogDir = join(dir, 'themes', 'blog')
  mkdirSync(blogDir, { recursive: true })
  writeFileSync(
    join(blogDir, 'index.ts'),
    `import { defineThemeModule } from 'ampless'
export default defineThemeModule({
  name: 'blog',
  manifest: {},
  components: {},
})
`,
  )
  writeFileSync(
    join(blogDir, 'manifest.ts'),
    `import { defineTheme } from 'ampless'
export default defineTheme({
  name: 'blog',
  label: 'Blog',
})
`,
  )
  writeFileSync(
    join(blogDir, 'tokens.css'),
    `[data-theme='blog'] {
  --primary: oklch(0.205 0 0);
}
`,
  )
  return dir
}

describe('runCopyThemeIn', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeAmplessProject()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('copies the source dir and rewrites name + tokens selector', async () => {
    const result = await runCopyThemeIn(projectDir, 'blog', 'my-blog')

    expect(result.target).toBe('my-blog')
    expect(existsSync(join(projectDir, 'themes', 'my-blog'))).toBe(true)

    const index = readFileSync(join(projectDir, 'themes', 'my-blog', 'index.ts'), 'utf-8')
    expect(index).toContain("name: 'my-blog'")
    expect(index).not.toContain("name: 'blog'")

    const manifest = readFileSync(
      join(projectDir, 'themes', 'my-blog', 'manifest.ts'),
      'utf-8',
    )
    expect(manifest).toContain("name: 'my-blog'")

    const tokens = readFileSync(join(projectDir, 'themes', 'my-blog', 'tokens.css'), 'utf-8')
    expect(tokens).toContain("[data-theme='my-blog']")
    expect(tokens).not.toContain("[data-theme='blog']")
  })

  it('leaves the source theme untouched', async () => {
    const sourceIndexBefore = readFileSync(join(projectDir, 'themes', 'blog', 'index.ts'), 'utf-8')
    await runCopyThemeIn(projectDir, 'blog', 'my-blog')
    const sourceIndexAfter = readFileSync(join(projectDir, 'themes', 'blog', 'index.ts'), 'utf-8')
    expect(sourceIndexAfter).toBe(sourceIndexBefore)
  })

  it('regenerates themes-registry.ts to include the new theme', async () => {
    await runCopyThemeIn(projectDir, 'blog', 'my-blog')

    const registry = readFileSync(join(projectDir, 'themes-registry.ts'), 'utf-8')
    expect(registry).toContain("import blog from '@/themes/blog'")
    expect(registry).toContain("import myBlog from '@/themes/my-blog'")
    // Map key for the custom theme uses the kebab-case string literal
    // so the runtime lookup `themes[theme.active]` matches.
    expect(registry).toContain("'my-blog': myBlog,")
  })

  it('rejects target names without the my- prefix', async () => {
    await expect(runCopyThemeIn(projectDir, 'blog', 'fancy-blog')).rejects.toThrow(/must start with "my-"/)
  })

  it('rejects when source does not exist', async () => {
    await expect(runCopyThemeIn(projectDir, 'nonexistent', 'my-x')).rejects.toThrow(/Source theme not found/)
  })

  it('rejects when target already exists', async () => {
    mkdirSync(join(projectDir, 'themes', 'my-blog'))
    writeFileSync(join(projectDir, 'themes', 'my-blog', 'placeholder.ts'), '')
    await expect(runCopyThemeIn(projectDir, 'blog', 'my-blog')).rejects.toThrow(/already exists/)
  })

  it('rejects when source and target are identical', async () => {
    await expect(runCopyThemeIn(projectDir, 'my-blog', 'my-blog')).rejects.toThrow(/identical/)
  })

  it('throws on non-ampless project dirs', async () => {
    const bogus = mkdtempSync(join(tmpdir(), 'not-ampless-'))
    try {
      await expect(runCopyThemeIn(bogus, 'blog', 'my-blog')).rejects.toThrow(/Not an ampless project/)
    } finally {
      rmSync(bogus, { recursive: true, force: true })
    }
  })
})
