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

  // The public MCP route factory returns `{ POST, OPTIONS }`; the scaffold
  // must destructure BOTH handlers. A single
  // `export const POST = createPublicMcpRouteHandler(ampless)` would drop
  // OPTIONS and break the CORS preflight — pin the split-export shape so a
  // future template edit can't regress it.
  it('scaffolds app/api/mcp/route.ts exporting both POST and OPTIONS from the factory', async () => {
    const sharedDir = sharedTemplateDir()
    try {
      await stat(sharedDir)
    } catch {
      return
    }

    const dest = await mkdtemp(resolve(tmpdir(), 'scaffold-mcp-'))
    try {
      await scaffold(sharedDir, templatesDir, dest, {
        projectName: 'tmp-test',
        siteName: 'Tmp Test',
        themes: ['blog'],
        defaultTheme: 'blog',
        plugins: ['seo'],
      })

      const route = await readFile(resolve(dest, 'app', 'api', 'mcp', 'route.ts'), 'utf-8')
      expect(route).toContain('createPublicMcpRouteHandler')
      // Destructured (not a single one-shot assignment).
      expect(route).toContain('export const POST = handlers.POST')
      expect(route).toContain('export const OPTIONS = handlers.OPTIONS')
      // Guard against the one-shot mistake (anchored to a real statement
      // line, so the explanatory comment above doesn't count).
      expect(route).not.toMatch(/^export const POST = createPublicMcpRouteHandler/m)
      expect(route).toContain("export const runtime = 'nodejs'")
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })
})
