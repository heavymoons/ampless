import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// Next.js 16 removed `next lint`; `npm run lint` runs the ESLint CLI
// directly against this flat config. This file is yours: `update-ampless`
// never overwrites it once it exists.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Template hooks keep unused-but-documented params as `_name`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.amplify/**',
    'amplify_outputs.json',
  ]),
])
