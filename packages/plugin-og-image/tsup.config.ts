import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/load-image.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Keep @jsquash/* external so we don't try to bundle their WASM into
  // our JS — they load WASM lazily at runtime in Node and Edge.
  external: ['@jsquash/avif', '@jsquash/png', '@jsquash/webp', 'react', 'react/jsx-runtime'],
})
