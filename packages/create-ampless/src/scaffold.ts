import { cp, readFile, writeFile, readdir, stat } from 'fs/promises'
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

export async function scaffold(templateDir: string, destDir: string, opts: ProjectOptions): Promise<void> {
  await cp(templateDir, destDir, { recursive: true })

  const vars: Record<string, string> = {
    projectName: opts.projectName,
    siteName: opts.siteName,
    year: String(new Date().getFullYear()),
    plugins: JSON.stringify(opts.plugins),
  }

  await substituteDir(destDir, vars)
}
