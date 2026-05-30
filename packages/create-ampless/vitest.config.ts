import { defineConfig } from 'vitest/config'

// Restrict vitest discovery to source files. Without this, the
// post-build `dist/templates/plugin-standalone/src/index.test.ts`
// template (with `{{ }}` placeholders still in it) gets picked up by
// the default include glob and crashes when vitest tries to parse the
// neighbouring template `package.json` for project metadata.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
