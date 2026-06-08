'use client'

// Phase 7 admin-editor extension slot. Templates wire first-party
// embed plugins' tiptap Node extensions here so the admin's
// <TiptapEditor> picks them up. Empty by default — uncomment the
// imports + the registration to enable YouTube / x.com embeds.
//
// Wired into the admin layout via:
//   createAdminLayout(admin, { editorBootstrap: EditorBootstrap })

import { installAdminEditorExtensions } from '@ampless/admin/editor'
// import { youtubeEditor } from '@ampless/plugin-youtube/editor'
// import { tweetEditor } from '@ampless/plugin-x-embed/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([
    // youtubeEditor.extension,
    // tweetEditor.extension,
  ])
  return <>{children}</>
}
