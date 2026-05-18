import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { scaffold } from './scaffold.js'
import { DEFAULT_GITIGNORE } from './gitignore.js'
import { sharedTemplateDir, templatesDir } from './templates.js'

describe('scaffold', () => {
  // Integration: runs against the real `templates/_shared` + `templates/blog`
  // in the monorepo. Skipped if those aren't accessible (e.g. running
  // against a published tarball without source).
  it('writes the canonical .gitignore into the destination project', async () => {
    const sharedDir = sharedTemplateDir()
    try {
      await stat(sharedDir)
    } catch {
      return
    }

    const dest = await mkdtemp(resolve(tmpdir(), 'scaffold-gitignore-'))
    try {
      await scaffold(sharedDir, templatesDir, dest, {
        projectName: 'tmp-test',
        siteName: 'Tmp Test',
        themes: ['blog'],
        defaultTheme: 'blog',
        plugins: ['seo'],
      })

      const gitignore = await readFile(resolve(dest, '.gitignore'), 'utf-8')
      expect(gitignore).toBe(DEFAULT_GITIGNORE)
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })
})
