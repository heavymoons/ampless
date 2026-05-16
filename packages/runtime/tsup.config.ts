import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/middleware.ts',
    'src/routes/index.ts',
    'src/dispatchers/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  // Keep all peer/host-supplied modules external — runtime is consumed by
  // Next.js app routes, which already brings these in. Bundling them
  // would duplicate them at build time and break Next's HMR / RSC
  // boundary handling.
  external: [
    'next',
    'next/headers',
    'next/server',
    'next/og',
    'next/navigation',
    'react',
    'react/jsx-runtime',
    'aws-amplify',
    '@aws-amplify/adapter-nextjs',
    '@aws-amplify/adapter-nextjs/api',
    'ampless',
    '@ampless/plugin-og-image',
    '@ampless/plugin-og-image/load-image',
  ],
})
