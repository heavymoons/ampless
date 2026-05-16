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
