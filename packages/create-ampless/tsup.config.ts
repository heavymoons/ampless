import { defineConfig } from 'tsup'
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const TEMPLATES_SRC = resolve(__dirname, '..', '..', 'templates', 'blog')
const TEMPLATES_DEST = resolve(__dirname, 'dist', 'templates', 'blog')

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // Copy templates/blog into the package's dist/ so they ship with the
  // npm tarball. The runtime path resolver in src/templates.ts checks
  // dist/templates first, then falls back to the monorepo layout.
  async onSuccess() {
    await rm(TEMPLATES_DEST, { recursive: true, force: true })
    await mkdir(TEMPLATES_DEST, { recursive: true })
    await cp(TEMPLATES_SRC, TEMPLATES_DEST, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(TEMPLATES_SRC.length).replace(/^\//, '')
        // Skip developer-only artifacts inside the e2e copy that shouldn't
        // ship in the published template.
        if (rel.startsWith('node_modules')) return false
        if (rel.startsWith('.next')) return false
        if (rel.startsWith('amplify_outputs')) return false
        if (rel.startsWith('.amplify')) return false
        if (rel.endsWith('tsconfig.tsbuildinfo')) return false
        if (rel === 'package-lock.json') return false
        if (rel === 'next-env.d.ts') return false
        return true
      },
    })
  },
})
