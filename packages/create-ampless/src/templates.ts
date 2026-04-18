import { fileURLToPath } from 'url'
import { resolve } from 'path'

// dist/templates.js から見て packages/create-ampless/ が2つ上、monorepo root がさらに2つ上
const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..')
export const templatesDir = resolve(packageRoot, '..', '..', 'templates')

export function templatePath(theme: string): string {
  return resolve(templatesDir, theme)
}
