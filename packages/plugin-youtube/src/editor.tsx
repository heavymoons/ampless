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

function getBareUrlLinkHref(el: HTMLElement): string | null {
  if (el.tagName.toLowerCase() === 'a') {
    return el.getAttribute('href')
  }

  if (el.tagName.toLowerCase() !== 'p') return null
  const children = Array.from(el.children)
  if (children.length !== 1) return null

  const link = children[0]
  if (!(link instanceof HTMLElement)) return null
  if (link.tagName.toLowerCase() !== 'a') return null

  const href = link.getAttribute('href')?.trim()
  if (!href) return null

  const linkText = link.textContent?.trim()
  if (linkText !== href) return null
  if (el.textContent?.trim() !== linkText) return null

  return href
}

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
        parseHTML: (el: HTMLElement) => {
          const dataVideoId = el.getAttribute('data-video-id')
          if (dataVideoId != null) return dataVideoId

          // Defensive fallback for the `tag: 'div[data-ampless-youtube]'`
          // self-render rule. That rule has no `getAttrs`, so tiptap consults
          // this addAttributes.parseHTML — and the higher-priority `tag: 'p'`
          // / `tag: 'a[href]'` rules already have their own getAttrs so they
          // don't reach here. If the malformed `<div data-ampless-youtube>`
          // somehow lost its `data-video-id` (e.g. a downstream HTML sanitiser
          // stripped data-* attrs but left the tag) we try to recover the id
          // from a bare URL link inside it. Normal happy-path HTML never hits
          // this branch.
          const href = getBareUrlLinkHref(el)
          return href ? (parseYoutubeUrl(href) ?? '') : ''
        },
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
      {
        tag: 'p',
        priority: 100,
        getAttrs: (el) => {
          const href = getBareUrlLinkHref(el as HTMLElement) ?? ''
          const videoId = parseYoutubeUrl(href)
          if (!videoId) return false
          return { videoId, start: null }
        },
      },
      {
        // Bare-URL `<a>` standalone (outside a single-link `<p>`). Mirrors the
        // markdown-side `extractSingleUrl` rule from PR #258: only intercept
        // when the link's visible text equals its href — `[caption](url)` /
        // `<a href="https://youtu.be/abc">caption</a>` should stay a normal
        // captioned Link, not silently swallow the caption into an embed.
        tag: 'a[href]',
        priority: 100,
        getAttrs: (el) => {
          const link = el as HTMLElement
          const href = link.getAttribute('href')?.trim() ?? ''
          if (!href) return false
          const linkText = link.textContent?.trim() ?? ''
          if (linkText !== href) return false
          const videoId = parseYoutubeUrl(href)
          if (!videoId) return false
          return { videoId, start: null }
        },
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
        // tiptap's paste rule internally calls `String.prototype.matchAll`
        // which throws when the regex doesn't carry the `g` flag. Clone
        // the source regex (which is anchored `^...$` for use in the
        // renderer / markdown extractor) into a global form here. Anchored
        // global is fine — without the `m` flag, `^...$` only anchor at the
        // start / end of the **entire input**, so this matches at most
        // once for the pasted input as a whole (= exactly the single-URL
        // paste case we care about).
        find: new RegExp(YOUTUBE_URL.source, 'g'),
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

/**
 * Canonical named export consumed by the codegen'd
 * `_editor-bootstrap.tsx`. Plugins MUST export this symbol from
 * their `./editor` module (= the subpath declared in
 * `package.json#amplessPlugin.editorExports`) for the
 * auto-wiring to find them.
 */
export const editorExtension = AmplessYoutubeNode

import type { TiptapNodeMarkdownAdapters } from 'ampless'

/**
 * tiptap → markdown adapter map. Serialises `amplessYoutube` nodes back
 * to a bare `https://youtu.be/<videoId>` URL line so the admin's
 * "format: tiptap → markdown" body switch is lossless. The reverse
 * direction (URL → embed node on paste) is handled by the existing paste
 * rule + `extractSingleUrl` path in the runtime.
 *
 * `update-ampless` reads this export (via namespace import `* as`) and
 * wires it into `installAdminTiptapNodeMarkdown`.
 */
export const tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null
    return `https://youtu.be/${videoId}`
  },
}
