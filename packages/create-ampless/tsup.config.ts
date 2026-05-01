import { defineConfig } from 'tsup'
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const TEMPLATES_ROOT = resolve(__dirname, '..', '..', 'templates')
const DIST_TEMPLATES_ROOT = resolve(__dirname, 'dist', 'templates')

// Theme modules shipped in the npm tarball. Each lives at
// `templates/<theme>/` (a self-contained theme: manifest + pages +
// tokens.css). Add a new entry here when introducing a new theme so
// the published tarball includes it; the CLI prompt also needs the
// theme listed in `prompts.ts`.
const THEMES = ['blog', 'minimal', 'landing', 'corporate', 'docs']

// Shared base copied first during scaffold. Always bundled.
const SHARED = '_shared'

function shouldKeep(rel: string): boolean {
  // Skip developer-only artifacts inside per-theme working copies that
  // shouldn't ship in the published template.
  if (rel.startsWith('node_modules')) return false
  if (rel.startsWith('.next')) return false
  if (rel.startsWith('amplify_outputs')) return false
  if (rel.startsWith('.amplify')) return false
  if (rel.endsWith('tsconfig.tsbuildinfo')) return false
  if (rel === 'package-lock.json') return false
  if (rel === 'next-env.d.ts') return false
  return true
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // Copy each theme's templates/<theme> into dist/templates/<theme>
  // so they ship with the npm tarball. The runtime path resolver in
  // src/templates.ts checks dist/templates first, then falls back to
  // the monorepo layout.
  async onSuccess() {
    for (const dir of [SHARED, ...THEMES]) {
      const src = resolve(TEMPLATES_ROOT, dir)
      const dest = resolve(DIST_TEMPLATES_ROOT, dir)
      await rm(dest, { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      await cp(src, dest, {
        recursive: true,
        filter: (path) => {
          const rel = path.slice(src.length).replace(/^\//, '')
          return shouldKeep(rel)
        },
      })
    }
  },
})
