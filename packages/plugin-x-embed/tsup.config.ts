import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx', 'src/editor.tsx'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react/jsx-runtime', '@tiptap/core', 'ampless'],
})
