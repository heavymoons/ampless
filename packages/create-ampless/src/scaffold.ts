import { cp, readFile, writeFile, readdir } from 'fs/promises'
import { join, extname } from 'path'
import type { ProjectOptions } from './prompts.js'

const TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.css', '.env', '.txt', '.yaml', '.yml', '.toml', '.gitignore',
])

async function substituteFile(filePath: string, vars: Record<string, string>): Promise<void> {
  const ext = extname(filePath) || filePath.endsWith('.gitignore') ? '.gitignore' : ''
  if (!TEXT_EXTENSIONS.has(ext)) return

  const content = await readFile(filePath, 'utf-8')
  const replaced = content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
  if (replaced !== content) await writeFile(filePath, replaced, 'utf-8')
}

async function substituteDir(dirPath: string, vars: Record<string, string>): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await substituteDir(fullPath, vars)
      } else {
        await substituteFile(fullPath, vars)
      }
    })
  )
}

/**
 * Scaffold a new project from a shared base + theme overlay.
 *
 * 1. Copy the shared base (`templates/_shared/`) — admin app, amplify
 *    backend, lib, ui components, middleware, cms.config defaults, etc.
 * 2. Overlay the chosen theme directory (`templates/<theme>/`) on top —
 *    public pages, globals.css, README, anything theme-specific. Files
 *    that exist in both win on the theme side; theme-only files just
 *    appear in addition.
 * 3. Run `{{var}}` substitution on every text file in the result.
 */
export async function scaffold(
  sharedDir: string,
  themeDir: string,
  destDir: string,
  opts: ProjectOptions
): Promise<void> {
  await cp(sharedDir, destDir, { recursive: true })
  await cp(themeDir, destDir, { recursive: true, force: true })

  const vars: Record<string, string> = {
    projectName: opts.projectName,
    siteName: opts.siteName,
    year: String(new Date().getFullYear()),
    plugins: JSON.stringify(opts.plugins),
  }

  await substituteDir(destDir, vars)
}
