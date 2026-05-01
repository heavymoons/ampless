import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Resolve at runtime so the same compiled bundle works in two layouts:
//   - npm install: templates ship as `dist/templates/` (sibling of index.js)
//   - monorepo dev: templates live at `<repo-root>/templates/`
//
// We check the published-package layout first; tests / local dev fall
// through to the monorepo lookup.
function resolveTemplatesDir(): string {
  const distDir = resolve(fileURLToPath(import.meta.url), '..')
  const bundled = resolve(distDir, 'templates')
  if (existsSync(bundled)) return bundled
  return resolve(distDir, '..', '..', '..', 'templates')
}

export const templatesDir = resolveTemplatesDir()

/**
 * Path to the shared base copied first by `scaffold()`. Contains the
 * admin app, amplify backend, lib, ui components — anything every
 * theme has in common.
 */
export function sharedTemplateDir(): string {
  return resolve(templatesDir, '_shared')
}

/**
 * Path to a theme overlay (e.g. `'blog'`, `'minimal'`). Contains the
 * theme-specific public pages and CSS that get layered on top of
 * the shared base.
 */
export function templatePath(theme: string): string {
  return resolve(templatesDir, theme)
}
