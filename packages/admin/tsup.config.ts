import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/pages/index.ts',
    'src/api/index.ts',
    'src/components/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  // NOTE: tsup/esbuild strips per-file `'use client'` / `'use server'`
  // directives. We rely on the templates' shim files
  // (components/i18n-provider.tsx, etc.) to carry the directive and
  // re-establish the client boundary on the consumer side. If we later
  // need a more robust solution (e.g. for non-shim consumers), a
  // bespoke esbuild plugin or `splitting: false` + per-entry banner
  // could work, but neither off-the-shelf plugin we tried is
  // compatible with current tsup/esbuild versions.
  // Tiptap, radix, lucide, and other host-supplied deps must stay
  // external — Next.js bundles them once at the app level, so
  // pulling them into admin's bundle would double them (and break
  // React identity for tiptap's editor singleton).
  external: [
    'next',
    'next/headers',
    'next/server',
    'next/og',
    'next/navigation',
    'next/cache',
    'next/link',
    'react',
    'react/jsx-runtime',
    'react-dom',
    'aws-amplify',
    'aws-amplify/api',
    'aws-amplify/auth',
    'aws-amplify/auth/server',
    'aws-amplify/storage',
    'aws-amplify/storage/server',
    '@aws-amplify/adapter-nextjs',
    'ampless',
    'ampless/media',
    '@ampless/runtime',
    '@ampless/runtime/ui',
    '@radix-ui/react-dialog',
    '@radix-ui/react-label',
    '@radix-ui/react-slot',
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/extension-link',
    '@tiptap/extension-image',
    '@tiptap/pm',
    'class-variance-authority',
    'clsx',
    'lucide-react',
    'react-image-crop',
    'tailwind-merge',
  ],
  loader: {
    '.json': 'json',
  },
})
