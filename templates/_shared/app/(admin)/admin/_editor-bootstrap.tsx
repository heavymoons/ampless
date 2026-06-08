'use client'

// Placeholder for fresh scaffolds before `update-ampless` runs.
// `npm run update-ampless` rewrites this file with auto-wired plugin
// editor extensions based on the project's installed `@ampless/plugin-*`
// packages.

import { installAdminEditorExtensions } from '@ampless/admin/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([])
  return <>{children}</>
}
