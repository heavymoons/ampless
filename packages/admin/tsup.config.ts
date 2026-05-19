import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'

// `preserveDirectives` — inline esbuild plugin that re-prepends
// per-file `'use client'` / `'use server'` directives onto the
// emitted bundle chunks.
//
// Why this exists: tsup (via esbuild) strips per-file directives
// when it concatenates source modules into a single output. That's
// fine for app code, but a library shipped to a Next.js consumer
// loses its server-vs-client boundary metadata, and the consumer
// ends up evaluating React-hook / class-based client code in the
// RSC server runtime, blowing up with
//   `TypeError: Class extends value undefined is not a constructor or null`
// (react-image-crop's ReactCrop is the typical trigger).
//
// Prior attempts (kept for future maintainers' awareness):
// 1. `rollup-plugin-preserve-directives` — calls a rollup plugin
//    API tsup doesn't fully implement (`renderChunk.call`).
// 2. `esbuild-plugin-preserve-directives` — peer-dep / ESM-export
//    mismatch with our esbuild version.
// 3. Consumer-side shim `'use client'` — works for thin
//    re-export shims but admin/pages must stay server components
//    (they `await headers()` etc.).
const preserveDirectives: Plugin = {
  name: 'preserve-directives',
  setup(build) {
    const directiveByInput = new Map<string, 'use client' | 'use server'>()

    build.onLoad({ filter: /\.[tj]sx?$/ }, async (args) => {
      const text = await readFile(args.path, 'utf8')
      // Match the first non-whitespace token — accept either single or
      // double quotes, with or without a trailing semicolon. We don't
      // try to skip leading comments; in this codebase all directives
      // are the literal first line, and that matches React / Next.js
      // conventions.
      const m = text.match(/^\s*['"]use (client|server)['"]\s*;?/)
      if (m) {
        directiveByInput.set(args.path, `use ${m[1]}` as 'use client' | 'use server')
      }
      // Return undefined so esbuild falls through to its default
      // loader. We're only using onLoad as a tap to read source text.
      return undefined
    })

    // Force write: false so `result.outputFiles` is populated in
    // `onEnd`. tsup already sets write: false today, but this stays
    // defensive in case that ever changes.
    build.initialOptions.write = false

    build.onEnd(async (result) => {
      if (result.errors.length || !result.metafile || !result.outputFiles) return

      // Strategy: prepend the directive to three kinds of outputs:
      //
      //   1. Entry outputs whose own direct inputs include a
      //      directive-bearing file (e.g. `dist/pages/index.js`
      //      inlines all the 'use client' page modules — those
      //      modules' source isn't in a shared chunk, so the
      //      entry needs the directive itself).
      //
      //   2. Entry outputs that are pure re-export shims (their
      //      sole direct input is the entry source file with no
      //      directive of its own), and whose imported chunks
      //      carry the directive (e.g. `dist/components/index.js`
      //      re-exports from a 'use client' chunk). The entry
      //      needs the directive so Next.js sees the client
      //      boundary at the consumer-visible module.
      //
      //   3. Internal chunks whose own inputs are entirely
      //      `'use client'` (no `'use server'` mixed in) — these
      //      need the directive so consumers that import them
      //      across a server/client boundary (e.g. a server-side
      //      `dist/pages/index.js` rendering a client component
      //      that lives in a shared chunk) see the client
      //      boundary at the import edge.
      //
      // Internal chunks that mix `'use client'` + `'use server'`
      // inputs are left un-tagged with a warning — neither
      // directive is correct for the whole file. The maintainer
      // should split the server-action surface into its own
      // entry. (`'use client'` chunks can still be safely imported
      // from server entries: Next.js treats the imported values
      // as client refs and emits boundary stubs. The dangerous
      // case — a server-only entry that needs a server-friendly
      // value from a client-marked chunk — doesn't arise in this
      // codebase, but if you add one, the symptom will be a
      // "client function called from server" runtime error and
      // the fix is to split the chunk.)
      //
      // Edge case: an entry that reaches both `'use client'` and
      // `'use server'` inputs. We can't honor both — prepend
      // `'use client'` and warn. The maintainer should split the
      // server-action surface into its own entry.
      const metafileOutputs = result.metafile.outputs
      const outputRelByAbs = new Map<string, string>()
      for (const outputRel of Object.keys(metafileOutputs)) {
        outputRelByAbs.set(path.resolve(process.cwd(), outputRel), outputRel)
      }

      function directivesFromInputs(
        info: typeof metafileOutputs[string]
      ): Set<'use client' | 'use server'> {
        const dirs = new Set<'use client' | 'use server'>()
        for (const inputRel of Object.keys(info.inputs)) {
          const abs = path.resolve(process.cwd(), inputRel)
          const dir = directiveByInput.get(abs)
          if (dir) dirs.add(dir)
        }
        return dirs
      }

      function directivesFromImportedChunks(
        info: typeof metafileOutputs[string]
      ): Set<'use client' | 'use server'> {
        const dirs = new Set<'use client' | 'use server'>()
        for (const imp of info.imports ?? []) {
          const chunkInfo = metafileOutputs[imp.path]
          if (!chunkInfo) continue
          for (const d of directivesFromInputs(chunkInfo)) dirs.add(d)
        }
        return dirs
      }

      const encoder = new TextEncoder()
      for (let i = 0; i < result.outputFiles.length; i++) {
        const file = result.outputFiles[i]
        if (!file.path.endsWith('.js')) continue
        const outputRel = outputRelByAbs.get(file.path)
        if (!outputRel) continue
        const info = metafileOutputs[outputRel]
        if (!info) continue

        const isEntry = Boolean(info.entryPoint)
        let dirs = directivesFromInputs(info)

        if (isEntry) {
          if (dirs.size === 0) {
            // No directive among this entry's own inputs. If the
            // entry is a pure re-export shim — i.e. its only input
            // is the entry source itself, meaning all the real
            // code lives in chunks it imports — pull directives
            // from those chunks. Otherwise (substantive entry
            // with multiple inlined inputs and none
            // directive-bearing), leave the entry untagged; that
            // matches files like `dist/index.js` and
            // `dist/api/index.js` which inline server-only code
            // and must not be marked client.
            const inputCount = Object.keys(info.inputs).length
            const isPureReExport = inputCount <= 1
            if (isPureReExport) {
              dirs = directivesFromImportedChunks(info)
            }
          }
        } else {
          // Internal chunk. Only tag if its inputs are purely one
          // directive (all `'use client'`, or all `'use server'`).
          // If it mixes both, leave it un-tagged and warn —
          // neither directive is correct for the whole file, and
          // the fix is to split the chunk via an explicit entry.
          if (dirs.size > 1) {
            console.warn(
              `[preserve-directives] Internal chunk ${outputRel} mixes ` +
                `${[...dirs].join(' and ')} inputs. ` +
                `Leaving un-tagged — neither directive is correct for the ` +
                `whole file. Split the server-action surface into its own ` +
                `entry to keep the boundaries clean.`
            )
            continue
          }
          if (dirs.size === 0) continue
        }

        if (dirs.size === 0) continue

        if (isEntry && dirs.size > 1) {
          console.warn(
            `[preserve-directives] Output ${outputRel} reaches both ` +
              `${[...dirs].join(' and ')} inputs. ` +
              `Prepending 'use client' (the stricter boundary). ` +
              `Split-and-fix per-directive output is out of scope — ` +
              `adjust tsup entry/splitting if a server-action surface ` +
              `needs its own bundle.`
          )
        }

        const directive: 'use client' | 'use server' = dirs.has('use client')
          ? 'use client'
          : ([...dirs][0] as 'use server')
        const existing = file.text
        if (
          existing.startsWith(`'${directive}'`) ||
          existing.startsWith(`"${directive}"`)
        ) {
          continue
        }
        const next = `'${directive}';\n${existing}`
        // tsup runs with `write: false`, so files are not on disk
        // yet at this point. We rewrite the in-memory outputFiles
        // entries; tsup will then write them out.
        result.outputFiles[i] = {
          ...file,
          contents: encoder.encode(next),
          hash: file.hash,
          path: file.path,
          text: next,
        }
      }
    })
  },
}

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/pages/index.ts',
    'src/api/index.ts',
    'src/components/index.ts',
    // Split the Server Action module into its own entry so it ends
    // up in a file marked `'use server'` (via the preserveDirectives
    // plugin), rather than getting bundled into the shared
    // client-components chunk where its `'use server'` directive
    // would be lost. Not part of the public API surface — consumed
    // only by `src/components/theme-settings-form.tsx` via the
    // relative `../lib/theme-actions.js` import, which resolves to
    // this entry's output through the shared internal-chunk
    // optimization that tsup performs across entries.
    'src/lib/theme-actions.ts',
    // Private entry for the admin-only Users management view. It's
    // imported solely by `src/pages/users-list.tsx`; without its own
    // entry esbuild inlines it into `dist/pages/index.js`, which
    // then triggers the preserveDirectives plugin to mark that
    // server-side entry as `'use client'` (because users-list-view
    // is a client component). Listing it here gives esbuild a
    // reason to emit a separate chunk that `dist/pages/index.js`
    // imports across the server/client boundary cleanly — without
    // widening the public `@ampless/admin/components` barrel with
    // an admin-only view.
    'src/components/users-list-view.tsx',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  // metafile is required so the `preserveDirectives` plugin can map
  // output chunks back to the input source files that fed them, then
  // re-prepend the appropriate `'use client'` / `'use server'`
  // directive. See the plugin's preamble comment above for the
  // history of why tsup/esbuild needs this.
  metafile: true,
  esbuildPlugins: [preserveDirectives],
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
