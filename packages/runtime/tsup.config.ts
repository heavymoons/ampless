import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/middleware.ts',
    'src/routes/index.ts',
    'src/dispatchers/index.ts',
    'src/ui/index.ts',
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
    'react-dom',
    'aws-amplify',
    '@aws-amplify/adapter-nextjs',
    '@aws-amplify/adapter-nextjs/api',
    'ampless',
    '@ampless/plugin-og-image',
    '@ampless/plugin-og-image/load-image',
    // UI primitives consume these from the host project so consumers
    // can dedupe / tree-shake them properly.
    '@radix-ui/react-dialog',
    '@radix-ui/react-label',
    '@radix-ui/react-slot',
    'class-variance-authority',
    'clsx',
    'lucide-react',
    'tailwind-merge',
  ],
})
