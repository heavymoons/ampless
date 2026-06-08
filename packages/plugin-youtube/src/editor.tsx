'use client'

// `@ampless/plugin-youtube/editor` — client-side tiptap Node extension
// for the admin editor. Templates wire this up in
// `_editor-bootstrap.tsx`:
//
//   'use client'
//   import { installAdminEditorExtensions } from '@ampless/admin/editor'
//   import { youtubeEditor } from '@ampless/plugin-youtube/editor'
//   export function EditorBootstrap({ children }) {
//     installAdminEditorExtensions([youtubeEditor.extension])
//     return <>{children}</>
//   }
//
// The Node is `atom: true` (not editable inline) — once inserted the
// user can drag/select/delete it as a block but not type inside it.
// Paste rules + slash command equivalent live here so authors can drop
// a YouTube URL into the editor and have it auto-replace into the
// embed node.

import { Node, mergeAttributes } from '@tiptap/core'
import { parseYoutubeUrl, YOUTUBE_URL } from './shared.js'

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    amplessYoutube: {
      /** Insert a YouTube embed node with the given video id (+ optional start). */
      setYoutube: (opts: { videoId: string; start?: number }) => ReturnType
      /**
       * Insert a YouTube embed from a URL. Returns false (and does
       * nothing) if the URL doesn't match the canonical / short form.
       */
      insertYoutubeFromUrl: (url: string) => ReturnType
    }
  }
}

export const AmplessYoutubeNode = Node.create({
  name: 'amplessYoutube',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      videoId: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-video-id') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-video-id': String(attrs.videoId ?? ''),
        }),
      },
      start: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-start')
          if (v === null) return null
          const n = Number(v)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.start != null ? { 'data-start': String(attrs.start) } : {},
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-ampless-youtube]',
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ampless-youtube': '',
        class: 'ampless-youtube-placeholder',
      }),
      ['span', {}, `YouTube: ${HTMLAttributes['data-video-id'] ?? ''}`],
    ]
  },
  addCommands() {
    return {
      setYoutube:
        (opts) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { videoId: opts.videoId, start: opts.start ?? null },
          }),
      insertYoutubeFromUrl:
        (url) =>
        ({ commands }) => {
          const videoId = parseYoutubeUrl(url)
          if (!videoId) return false
          return commands.insertContent({
            type: this.name,
            attrs: { videoId, start: null },
          })
        },
    }
  },
  addPasteRules() {
    return [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        find: YOUTUBE_URL,
        handler: ({ range, match, commands }: any) => {
          const videoId = match[1] ?? match[2]
          if (!videoId) return
          commands.deleteRange(range)
          commands.insertContent({
            type: this.name,
            attrs: { videoId, start: null },
          })
        },
      }) as never,
    ]
  },
})

/**
 * Named export consumed by templates' `_editor-bootstrap.tsx`. The
 * `.extension` field is the tiptap Node — the wrapper object exists so
 * future per-instance configuration can be added without breaking the
 * call site.
 */
export const youtubeEditor = {
  extension: AmplessYoutubeNode,
}
