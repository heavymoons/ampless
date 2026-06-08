import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx', 'src/editor.tsx'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Tiptap, React, and ampless are host-supplied — keep them external
  // so the plugin tarball stays tiny and React identity stays shared
  // with the consumer's Next.js app.
  external: ['react', 'react/jsx-runtime', '@tiptap/core', 'ampless'],
})
